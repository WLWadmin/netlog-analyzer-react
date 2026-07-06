import type { FinalDiagnosisSummary } from './finalSummaryTypes';
import type { DiagnosticCard } from './types';

export interface DiagnosisEvidenceGuardReport {
  confirmedCount: number;
  highlyLikelyCount: number;
  symptomOnlyCount: number;
  needsMoreDataHeadlineCount: number;
  missingInfoCount: number;
  evidenceGapCardCount: number;
  forbiddenConfirmedMatches: Array<{
    conclusionId: string;
    token: string;
    field: 'title' | 'reason' | 'problem' | 'impact' | 'evidence';
  }>;
}

export const forbiddenConfirmedTokens = [
  'dns answer',
  'socket peer',
  'x-request-ip',
  'host-time-candidate',
  'global-candidate',
  'state-only',
  'proxy config',
  'quic state',
  'http/2 state',
  'socket state',
  'dns answer 候选',
  'socket peer 候选',
  'x-request-ip 候选',
  '代理配置事实',
  '协议状态',
  '状态事实',
];

export interface ForbiddenConfirmedTextMatch {
  token: string;
  snippet: string;
}

function normalize(value: string | undefined): string {
  return (value || '').toLowerCase();
}

function hasEvidenceGapMarker(card: DiagnosticCard): boolean {
  const text = [
    card.id,
    card.title,
    card.conclusion,
    ...(card.limitations || []),
    ...card.evidence.flatMap(item => [item.label, item.value, item.detail || '']),
  ].join('\n').toLowerCase();
  return text.includes('evidence-gap') ||
    text.includes('证据缺口') ||
    text.includes('不能推断') ||
    text.includes('无法确认') ||
    text.includes('needs more data');
}

export function buildDiagnosisEvidenceGuardReport(summary: FinalDiagnosisSummary): DiagnosisEvidenceGuardReport {
  const report: DiagnosisEvidenceGuardReport = {
    confirmedCount: summary.headline.filter(item => item.kind === 'confirmed').length,
    highlyLikelyCount: summary.headline.filter(item => item.kind === 'highly-likely').length,
    symptomOnlyCount: summary.headline.filter(item => item.kind === 'symptom-only').length,
    needsMoreDataHeadlineCount: summary.headline.filter(item => item.kind === 'needs-more-data').length,
    missingInfoCount: summary.missingInfo.length,
    evidenceGapCardCount: summary.expertCards.filter(hasEvidenceGapMarker).length,
    forbiddenConfirmedMatches: [],
  };

  for (const conclusion of summary.headline.filter(item => item.kind === 'confirmed')) {
    const fields = [
      ['title', conclusion.title],
      ['reason', conclusion.reason],
      ['problem', conclusion.problem],
      ['impact', conclusion.impact],
      ['evidence', conclusion.keyEvidence.map(item => `${item.label}: ${item.value} ${item.detail || ''}`).join('\n')],
    ] as const;

    for (const [field, value] of fields) {
      const normalized = normalize(value);
      for (const token of forbiddenConfirmedTokens) {
        if (normalized.includes(token)) {
          report.forbiddenConfirmedMatches.push({
            conclusionId: conclusion.id,
            token,
            field,
          });
        }
      }
    }
  }

  return report;
}

export function scanConfirmedTextForForbiddenEvidence(text: string): ForbiddenConfirmedTextMatch[] {
  const normalized = normalize(text);
  const confirmedMarkers = [
    'confirmed',
    '确认根因',
    '已确认',
    '确认是',
    '确定是',
  ];
  const hasAffirmativeConfirmedMarker = confirmedMarkers.some(marker => {
    const index = normalized.indexOf(marker);
    if (index < 0) return false;
    const prefix = normalized.slice(Math.max(0, index - 4), index);
    return !prefix.includes('不能') && !prefix.includes('无法') && !prefix.includes('未能');
  });
  if (!hasAffirmativeConfirmedMarker) return [];
  return forbiddenConfirmedTokens
    .filter(token => normalized.includes(token))
    .map(token => {
      const index = normalized.indexOf(token);
      const start = Math.max(0, index - 60);
      const end = Math.min(text.length, index + token.length + 60);
      return {
        token,
        snippet: text.slice(start, end),
      };
    });
}
