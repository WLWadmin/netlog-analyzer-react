import type { DiagnosticCard, DiagnosticCategory, DiagnosticEvidence } from './types';
import { buildIncidentNarrative } from './incidentNarrative';
import { calculateImpactScope, type ImpactScopeResult } from './impactScope';
import { summarizeRequestImportance, type RequestImportance } from './requestImportance';

export type IncidentRecoveryState = 'recovered' | 'ongoing' | 'unknown';

export interface IncidentEpisode {
  id: string;
  category: DiagnosticCategory;
  title: string;
  severity: DiagnosticCard['severity'];
  confidence: DiagnosticCard['confidence'];
  state: IncidentRecoveryState;
  timeComparable: boolean;
  clock?: 'epoch' | 'relative' | 'unknown';
  startMs?: number;
  endMs?: number;
  recoveredAtMs?: number;
  affectedRequestIds: number[];
  affectedSourceIds: number[];
  affectedEventIds: string[];
  affectedDomainCount: number;
  affectedRequestCount: number;
  impactScope: ImpactScopeResult;
  counterEvidenceSummary: string[];
  rankingReasons: string[];
  representativeRequestIds: number[];
  representativeSourceIds: number[];
  cards: DiagnosticCard[];
  evidence: DiagnosticEvidence[];
  narrative: string;
  score: number;
}

const CATEGORY_WINDOW_MS: Partial<Record<DiagnosticCategory, number>> = {
  dns: 8000,
  connect: 10000,
  tls: 12000,
  proxy: 15000,
  'network-change': 20000,
  protocol: 10000,
  server: 5000,
  performance: 5000,
  'browser-queue': 5000,
  unknown: 5000,
};

const SEVERITY_WEIGHT = { critical: 60, warning: 36, info: 12 };
const CONFIDENCE_WEIGHT = { high: 24, medium: 14, low: 4 };

function evidenceTime(evidence: DiagnosticEvidence[]): Array<{ startMs: number; endMs: number }> {
  return evidence.flatMap(item => {
    const detail = [item.detail, item.value].filter(Boolean).join(' ');
    const start = detail.match(/startMs[:=](\d+(?:\.\d+)?)/i);
    const end = detail.match(/endMs[:=](\d+(?:\.\d+)?)/i);
    if (!start) return [];
    const startMs = Number(start[1]);
    const endMs = end ? Number(end[1]) : startMs;
    return Number.isFinite(startMs) ? [{ startMs, endMs: Number.isFinite(endMs) ? endMs : startMs }] : [];
  });
}

function cardTimeRange(card: DiagnosticCard): { startMs?: number; endMs?: number; comparable: boolean; clock?: 'epoch' | 'relative' | 'unknown' } {
  if (card.timeRange && Number.isFinite(card.timeRange.startMs) && Number.isFinite(card.timeRange.endMs)) {
    return { startMs: card.timeRange.startMs, endMs: card.timeRange.endMs, comparable: true, clock: card.timeRange.clock };
  }
  const evidenceRanges = evidenceTime(card.evidence);
  if (!evidenceRanges.length) return { comparable: false };
  return {
    startMs: Math.min(...evidenceRanges.map(item => item.startMs)),
    endMs: Math.max(...evidenceRanges.map(item => item.endMs)),
    comparable: true,
    clock: 'unknown',
  };
}

function categoryWindow(category: DiagnosticCategory): number {
  return CATEGORY_WINDOW_MS[category] ?? 5000;
}

function cardDomains(card: DiagnosticCard): string[] {
  const text = [
    card.title,
    card.conclusion,
    ...card.evidence.flatMap(item => [item.value, item.detail || '']),
  ].join(' ');
  return Array.from(new Set((text.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/gi) || []).map(item => item.toLowerCase())));
}

function commonInfrastructure(a: DiagnosticCard, b: DiagnosticCard): boolean {
  const aDomains = new Set(cardDomains(a));
  const bDomains = cardDomains(b);
  if (bDomains.some(domain => aDomains.has(domain))) return true;
  if (a.category === 'proxy' || b.category === 'proxy') return true;
  return false;
}

function canMerge(a: IncidentEpisode, card: DiagnosticCard): boolean {
  if (a.category !== card.category) return false;
  if (!commonInfrastructure(a.cards[0], card)) return false;
  const range = cardTimeRange(card);
  if (a.clock && range.clock && a.clock !== range.clock) return false;
  if (!a.timeComparable || !range.comparable || a.endMs === undefined || range.startMs === undefined) {
    return a.category === card.category && commonInfrastructure(a.cards[0], card);
  }
  return range.startMs - a.endMs <= Math.max(categoryWindow(a.category), categoryWindow(card.category));
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function severityMax(cards: DiagnosticCard[]): DiagnosticCard['severity'] {
  if (cards.some(card => card.severity === 'critical')) return 'critical';
  if (cards.some(card => card.severity === 'warning')) return 'warning';
  return 'info';
}

function confidenceMax(cards: DiagnosticCard[]): DiagnosticCard['confidence'] {
  if (cards.some(card => card.confidence === 'high')) return 'high';
  if (cards.some(card => card.confidence === 'medium')) return 'medium';
  return 'low';
}

function detectRecovery(cards: DiagnosticCard[], endMs?: number): { state: IncidentRecoveryState; recoveredAtMs?: number } {
  const allEvidence = cards.flatMap(card => card.evidence);
  const successEvidence = allEvidence.filter(item => /恢复|success|2xx|状态[:：=]?200|status[:：=]?200/i.test([item.label, item.value, item.detail || ''].join(' ')));
  const failureEvidence = allEvidence.filter(item => !successEvidence.includes(item));
  const failureRanges = evidenceTime(failureEvidence);
  const lastFailureEndMs = failureRanges.length ? Math.max(...failureRanges.map(item => item.endMs)) : endMs;
  const ranges = evidenceTime(successEvidence);
  if (ranges.length > 0) {
    const recoveredAtMs = Math.min(...ranges.map(item => item.startMs));
    if (lastFailureEndMs === undefined || recoveredAtMs >= lastFailureEndMs) return { state: 'recovered', recoveredAtMs };
  }
  if (cards.some(card => card.severity === 'critical' || card.confidence === 'high')) return { state: 'ongoing' };
  return { state: 'unknown' };
}

export interface BuildIncidentEpisodesOptions {
  requestImportancesByRequestId?: Map<number, RequestImportance>;
}

function episodeFromCards(index: number, cards: DiagnosticCard[], options: BuildIncidentEpisodesOptions = {}): IncidentEpisode {
  const ranges = cards.map(cardTimeRange).filter(item => item.comparable && item.startMs !== undefined && item.endMs !== undefined);
  const clocks = new Set(ranges.map(item => item.clock || 'unknown'));
  const timeComparable = ranges.length === cards.length && ranges.length > 0 && clocks.size === 1;
  const clock = timeComparable ? ranges[0].clock : undefined;
  const startMs = timeComparable ? Math.min(...ranges.map(item => item.startMs as number)) : undefined;
  const endMs = timeComparable ? Math.max(...ranges.map(item => item.endMs as number)) : undefined;
  const category = cards[0].category;
  const affectedRequestIds = uniq(cards.flatMap(card => card.relatedRequestIds || []).concat(cards.flatMap(card => card.evidence.flatMap(e => e.requestIds || []))));
  const affectedSourceIds = uniq(cards.flatMap(card => card.relatedSourceIds || []).concat(cards.flatMap(card => card.evidence.flatMap(e => e.sourceIds || []))));
  const affectedEventIds = uniq(cards.flatMap(card => card.relatedEventIds || []).concat(cards.flatMap(card => card.evidence.flatMap(e => e.eventIds || []))));
  const affectedDomainCount = Math.max(1, uniq(cards.flatMap(cardDomains)).length || Math.max(...cards.map(card => card.scope.affectedDomainCount || 0), 0));
  const affectedRequestCount = affectedRequestIds.length || cards.reduce((sum, card) => sum + (card.scope.affectedRequestCount || 0), 0);
  const severity = severityMax(cards);
  const confidence = confidenceMax(cards);
  const recovery = detectRecovery(cards, endMs);
  const evidence = cards.flatMap(card => card.evidence).slice(0, 8);
  const requestImportances = affectedRequestIds
    .map(id => options.requestImportancesByRequestId?.get(id))
    .filter((item): item is RequestImportance => Boolean(item));
  const impactScope = calculateImpactScope({ cards, requestImportances });
  const importanceSummary = summarizeRequestImportance(requestImportances);
  const representativeRequestIds = [...affectedRequestIds].sort((a, b) => {
    const ai = options.requestImportancesByRequestId?.get(a)?.score || 0;
    const bi = options.requestImportancesByRequestId?.get(b)?.score || 0;
    return bi - ai || a - b;
  }).slice(0, 3);
  const rankingReasons = uniq([
    ...impactScope.rankingReasons,
    ...(importanceSummary.reasonSummary.length ? [`代表请求按重要性排序：${importanceSummary.reasonSummary.join('；')}`] : []),
  ]);
  const partial: Omit<IncidentEpisode, 'narrative'> = {
    id: `episode-${category}-${index}`,
    category,
    title: `${category} 类故障事件`,
    severity,
    confidence,
    state: recovery.state,
    timeComparable,
    clock,
    startMs,
    endMs,
    recoveredAtMs: recovery.recoveredAtMs,
    affectedRequestIds,
    affectedSourceIds,
    affectedEventIds,
    affectedDomainCount,
    affectedRequestCount,
    impactScope,
    counterEvidenceSummary: impactScope.counterEvidenceSummary,
    rankingReasons,
    representativeRequestIds,
    representativeSourceIds: affectedSourceIds.slice(0, 3),
    cards,
    evidence,
    score: SEVERITY_WEIGHT[severity] + CONFIDENCE_WEIGHT[confidence] + affectedRequestCount + affectedDomainCount * 4 + (timeComparable ? 6 : 0) + Math.round(importanceSummary.maxScore / 5),
  };
  const episode = { ...partial, narrative: '' };
  return { ...episode, narrative: buildIncidentNarrative(episode) };
}

export function buildIncidentEpisodes(cards: DiagnosticCard[], options: BuildIncidentEpisodesOptions = {}): IncidentEpisode[] {
  const eligible = cards
    .filter(card => !(card.severity === 'info' && card.confidence === 'low'))
    .filter(card => (card.scope.affectedRequestCount || card.relatedRequestIds?.length || 0) > 1 || card.severity !== 'info')
    .sort((a, b) => {
      const ta = cardTimeRange(a).startMs ?? Number.POSITIVE_INFINITY;
      const tb = cardTimeRange(b).startMs ?? Number.POSITIVE_INFINITY;
      return ta - tb || a.category.localeCompare(b.category) || a.id.localeCompare(b.id);
    });

  const groups: DiagnosticCard[][] = [];
  for (const card of eligible) {
    const existing = groups.find(group => canMerge(episodeFromCards(0, group, options), card));
    if (existing) existing.push(card);
    else groups.push([card]);
  }

  return groups
    .map((group, index) => episodeFromCards(index + 1, group, options))
    .sort((a, b) => b.score - a.score || (a.startMs ?? Number.POSITIVE_INFINITY) - (b.startMs ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id));
}
