import type { DiagnosticCard, DiagnosticConfidenceFactor, DiagnosticConfidenceLevel, DiagnosticEvidence } from './types';
import type { DiagnosisObservation } from './diagnosisObservation';
import type { RequestCorrelation } from './requestCorrelation';

export interface EvidenceFusionResult {
  confidence: DiagnosticConfidenceLevel;
  mergedSources: ('har' | 'netlog')[];
  supportingEvidence: DiagnosticEvidence[];
  counterEvidence: DiagnosticEvidence[];
  conflictNotes: string[];
  confidenceFactors: DiagnosticConfidenceFactor[];
  limitations: string[];
}

const CONFIDENCE_SCORE: Record<DiagnosticConfidenceLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function confidenceFromScore(score: number): DiagnosticConfidenceLevel {
  if (score >= 3) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

function observationEvidence(observation: DiagnosisObservation, originalSource: 'har' | 'netlog'): DiagnosticEvidence[] {
  return observation.evidence.map(item => ({ ...item, originalSource }));
}

function sameDomain(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function sameCategory(har: DiagnosisObservation, netlog: DiagnosisObservation): boolean {
  if (har.category === netlog.category) return true;
  if (har.category === 'server' && netlog.category === 'performance') return true;
  if (har.category === 'performance' && netlog.category === 'server') return true;
  return false;
}

function isNetworkLayer(category: string): boolean {
  return ['dns', 'connect', 'tls', 'proxy', 'protocol', 'network-change'].includes(category);
}

function hasSourceBoundCorrelation(
  har: DiagnosisObservation,
  netlog: DiagnosisObservation,
  correlations: RequestCorrelation[]
): boolean {
  if (har.subject.requestId === undefined || netlog.subject.sourceId === undefined) return false;
  const requestId = har.subject.requestId;
  const sourceId = netlog.subject.sourceId;
  return correlations.some(item =>
    item.harRequestId === requestId &&
    item.score >= 0.9 &&
    item.netlogSourceIds.includes(sourceId)
  );
}

function buildConflictNotes(har: DiagnosisObservation[], netlog: DiagnosisObservation[], correlations: RequestCorrelation[]): string[] {
  const notes: string[] = [];
  const strongCorrelations = correlations.filter(item => item.score >= 0.9);

  if (strongCorrelations.length === 0 && har.length > 0 && netlog.length > 0) {
    notes.push('HAR 与 NetLog 缺少强请求关联，只能作为同域或时间邻近线索。');
  }

  correlations
    .flatMap(item => item.conflicts)
    .slice(0, 3)
    .forEach(conflict => notes.push(`请求关联冲突：${conflict}`));

  return Array.from(new Set(notes));
}

function buildCounterEvidence(har: DiagnosisObservation[], netlog: DiagnosisObservation[], correlations: RequestCorrelation[]): DiagnosticEvidence[] {
  const harServerOrTtfb = har.filter(item => item.category === 'server' || item.category === 'performance');
  const harDomains = new Set(harServerOrTtfb.map(item => item.subject.domain?.toLowerCase()).filter(Boolean));
  const netlogNetworkFailures = netlog.filter(item =>
    isNetworkLayer(item.category) &&
    item.severity === 'critical' &&
    Boolean(item.subject.domain && harDomains.has(item.subject.domain.toLowerCase()))
  );
  const netlogServerOrPerformance = netlog.filter(item => item.category === 'server' || item.category === 'performance');
  const hasStrongCorrelation = correlations.some(item => item.score >= 0.9);
  if (!hasStrongCorrelation || harServerOrTtfb.length === 0 || netlogNetworkFailures.length > 0 || netlogServerOrPerformance.length > 0) return [];
  const domains = Array.from(new Set(harServerOrTtfb.map(item => item.subject.domain).filter(Boolean)));
  return [{
    label: '反证',
    value: domains.length ? `${domains.join('、')} 未见同域网络层失败` : 'NetLog 未见同域网络层失败',
    source: 'netlog',
    originalSource: 'netlog',
    detail: '这是反证型证据：只能降低客户端网络层根因置信度，不能证明服务端一定异常。',
  }];
}

function buildConfidenceFactors(
  correlations: RequestCorrelation[],
  supportingPairCount: number,
  counterEvidence: DiagnosticEvidence[],
  conflictNotes: string[]
): DiagnosticConfidenceFactor[] {
  const factors: DiagnosticConfidenceFactor[] = [];
  if (supportingPairCount > 0) {
    factors.push({ label: '双源证据', impact: 'positive', detail: 'HAR 与 NetLog 都提供了绑定到同一请求的 observation。' });
  }
  if (supportingPairCount > 0 && correlations.some(item => item.score >= 0.9)) {
    factors.push({ label: '强请求关联', impact: 'positive', detail: '存在 method + origin + pathname 级别的强关联。' });
  } else if (correlations.some(item => item.score >= 0.9)) {
    factors.push({ label: '双源证据未绑定', impact: 'neutral', detail: '请求关联较强，但 NetLog observation 缺少属于该请求的 sourceId，不能提升置信度。' });
  } else if (correlations.some(item => item.score > 0)) {
    factors.push({ label: '弱请求关联', impact: 'neutral', detail: '仅存在 host、host+path 或时间邻近级别的弱关联。' });
  }
  if (counterEvidence.length > 0) {
    factors.push({ label: '反证', impact: 'negative', detail: 'NetLog 未支持对应网络层根因，需要降低网络层归因置信度。' });
  }
  if (conflictNotes.length > 0) {
    factors.push({ label: '证据冲突', impact: 'negative', detail: conflictNotes[0] });
  }
  return factors;
}

export function fuseDiagnosisEvidence(input: {
  harObservations: DiagnosisObservation[];
  netlogObservations: DiagnosisObservation[];
  correlations: RequestCorrelation[];
  baseConfidence?: DiagnosticConfidenceLevel;
}): EvidenceFusionResult {
  const { harObservations, netlogObservations, correlations, baseConfidence = 'medium' } = input;
  const supportingPairs = harObservations.flatMap(har => netlogObservations.filter(netlog => {
    return sameDomain(har.subject.domain, netlog.subject.domain) &&
      sameCategory(har, netlog) &&
      hasSourceBoundCorrelation(har, netlog, correlations);
  }).map(netlog => ({ har, netlog })));

  const supportingEvidence = [
    ...harObservations.slice(0, 3).flatMap(item => observationEvidence(item, 'har')),
    ...supportingPairs.slice(0, 3).flatMap(pair => observationEvidence(pair.netlog, 'netlog')),
  ];
  const counterEvidence = buildCounterEvidence(harObservations, netlogObservations, correlations);
  const conflictNotes = buildConflictNotes(harObservations, netlogObservations, correlations);
  const confidenceFactors = buildConfidenceFactors(correlations, supportingPairs.length, counterEvidence, conflictNotes);

  let score = CONFIDENCE_SCORE[baseConfidence];
  if (supportingPairs.length > 0) score += 1;
  if (supportingPairs.length > 0 && correlations.some(item => item.score >= 0.9)) score += 0.5;
  if (supportingPairs.length === 0 && harObservations.length > 0 && netlogObservations.length > 0) {
    score = Math.min(score, CONFIDENCE_SCORE.medium);
  }
  if (counterEvidence.length > 0) score -= 1;
  if (conflictNotes.length > 0) score -= 0.5;

  const mergedSources: ('har' | 'netlog')[] = [
    ...(harObservations.length > 0 ? ['har' as const] : []),
    ...(netlogObservations.length > 0 ? ['netlog' as const] : []),
  ];
  const limitations = [
    ...(counterEvidence.length > 0 ? ['evidence-gap: 反证只能降低某类根因置信度，不能单独证明另一类根因。'] : []),
    ...(conflictNotes.length > 0 ? ['evidence-gap: 存在证据冲突或弱关联，需要人工复核关联请求。'] : []),
  ];

  return {
    confidence: confidenceFromScore(score),
    mergedSources,
    supportingEvidence,
    counterEvidence,
    conflictNotes,
    confidenceFactors,
    limitations,
  };
}

export function applyEvidenceFusion(card: DiagnosticCard, fusion: EvidenceFusionResult): DiagnosticCard {
  const evidenceKeys = new Set(card.evidence.map(item => `${item.label}:${item.value}:${item.originalSource || item.source}`));
  const newEvidence = fusion.supportingEvidence.filter(item => {
    const key = `${item.label}:${item.value}:${item.originalSource || item.source}`;
    if (evidenceKeys.has(key)) return false;
    evidenceKeys.add(key);
    return true;
  });

  return {
    ...card,
    confidence: fusion.confidence,
    mergedSources: fusion.mergedSources.length ? fusion.mergedSources : card.mergedSources,
    confidenceFactors: [
      ...(card.confidenceFactors || []),
      ...fusion.confidenceFactors,
    ],
    evidence: [
      ...card.evidence,
      ...newEvidence.slice(0, 6),
      ...fusion.counterEvidence,
    ],
    limitations: Array.from(new Set([...(card.limitations || []), ...fusion.limitations])),
    conflictNotes: Array.from(new Set([...(card.conflictNotes || []), ...fusion.conflictNotes])),
  };
}
