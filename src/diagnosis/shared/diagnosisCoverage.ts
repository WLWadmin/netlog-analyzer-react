import type { HarRequestEntry } from '../../harParser';
import type { AnalysisResult } from '../../parsers/netlog/parser';
import { getHarRequestIssue } from './harRequestIssue';
import type { DiagnosisObservation } from './diagnosisObservation';
import type { RequestCorrelation } from './requestCorrelation';

export interface DiagnosisCoverage {
  totalAbnormalObjects: number;
  explained: number;
  partiallyExplained: number;
  unexplained: number;
  excluded: number;
  coverageRate: number;
  denominatorMayBeIncomplete: boolean;
  unexplainedRequestIds: number[];
  unexplainedSourceIds: number[];
  reasons: Array<{ reason: string; count: number }>;
}

function addReason(map: Map<string, number>, reason: string) {
  map.set(reason, (map.get(reason) || 0) + 1);
}

function emptyCoverage(denominatorMayBeIncomplete = false): DiagnosisCoverage {
  return {
    totalAbnormalObjects: 0,
    explained: 0,
    partiallyExplained: 0,
    unexplained: 0,
    excluded: 0,
    coverageRate: 1,
    denominatorMayBeIncomplete,
    unexplainedRequestIds: [],
    unexplainedSourceIds: [],
    reasons: [],
  };
}

function buildCoverageFromObjectIds(
  abnormalIds: Array<{ key: string; requestId?: number; sourceId?: number }>,
  observations: DiagnosisObservation[],
  denominatorMayBeIncomplete = false
): DiagnosisCoverage {
  if (abnormalIds.length === 0) return emptyCoverage(denominatorMayBeIncomplete);
  const observationsByKey = new Map<string, DiagnosisObservation[]>();
  observations.forEach(observation => {
    const requestId = observation.subject.requestId;
    const sourceId = observation.subject.sourceId;
    if (requestId !== undefined) {
      const key = `request:${requestId}`;
      observationsByKey.set(key, [...(observationsByKey.get(key) || []), observation]);
    }
    if (sourceId !== undefined) {
      const key = `source:${sourceId}`;
      observationsByKey.set(key, [...(observationsByKey.get(key) || []), observation]);
    }
    if (observation.subject.domain && observation.source === 'netlog') {
      const key = `domain:${observation.subject.domain}`;
      observationsByKey.set(key, [...(observationsByKey.get(key) || []), observation]);
    }
  });

  let explained = 0;
  let partiallyExplained = 0;
  let unexplained = 0;
  const unexplainedRequestIds: number[] = [];
  const unexplainedSourceIds: number[] = [];
  const reasons = new Map<string, number>();

  abnormalIds.forEach(item => {
    const related = observationsByKey.get(item.key) || [];
    if (related.some(observation => observation.explanationState === 'explained')) {
      explained += 1;
      return;
    }
    if (related.some(observation => observation.explanationState === 'partial')) {
      partiallyExplained += 1;
      addReason(reasons, '需要补充证据或仅有支持线索');
      return;
    }
    unexplained += 1;
    if (item.requestId !== undefined) unexplainedRequestIds.push(item.requestId);
    if (item.sourceId !== undefined) unexplainedSourceIds.push(item.sourceId);
    addReason(reasons, related.length ? '当前 observation 证据不足' : '没有匹配 observation');
  });

  return {
    totalAbnormalObjects: abnormalIds.length,
    explained,
    partiallyExplained,
    unexplained,
    excluded: 0,
    coverageRate: (explained + partiallyExplained) / abnormalIds.length,
    denominatorMayBeIncomplete,
    unexplainedRequestIds,
    unexplainedSourceIds,
    reasons: Array.from(reasons.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

export function calculateHarDiagnosisCoverage(entries: HarRequestEntry[], observations: DiagnosisObservation[]): DiagnosisCoverage {
  const abnormalIds = entries
    .filter(entry => getHarRequestIssue(entry).kind !== 'normal')
    .map(entry => ({ key: `request:${entry.id}`, requestId: entry.id }));
  return buildCoverageFromObjectIds(abnormalIds, observations);
}

export function calculateNetlogDiagnosisCoverage(
  result: AnalysisResult,
  observations: DiagnosisObservation[],
  options?: { datasetComplete?: boolean }
): DiagnosisCoverage {
  const abnormalByKey = new Map<string, { key: string; sourceId?: number }>();
  result.failedDomains.forEach(domain => abnormalByKey.set(`domain:${domain.domain}`, { key: `domain:${domain.domain}` }));
  result.connectionFailures.forEach((failure, index) => {
    try {
      const domain = new URL(failure.url).hostname;
      abnormalByKey.set(`domain:${domain}`, { key: `domain:${domain}` });
    } catch {
      abnormalByKey.set(`connection:${index}`, { key: `connection:${index}` });
    }
  });
  result.certIssues.forEach(issue => abnormalByKey.set(`domain:${issue.host}`, { key: `domain:${issue.host}` }));
  result.slowRequests.forEach(request => abnormalByKey.set(`source:${request.id}`, { key: `source:${request.id}`, sourceId: request.id }));
  const abnormalIds = Array.from(abnormalByKey.values());

  const coverage = buildCoverageFromObjectIds(
    abnormalIds,
    observations,
    options?.datasetComplete === false || Boolean(result.largeFileMode?.truncatedEventsPreview)
  );

  if (coverage.denominatorMayBeIncomplete) {
    return {
      ...coverage,
      reasons: [
        ...coverage.reasons,
        { reason: 'Dataset 可能不完整，覆盖率分母可能偏低', count: 1 },
      ],
    };
  }
  return coverage;
}

export function calculateCombinedDiagnosisCoverage(
  harObservations: DiagnosisObservation[],
  netlogObservations: DiagnosisObservation[],
  correlations: RequestCorrelation[],
  denominatorMayBeIncomplete = false
): DiagnosisCoverage {
  const objects = new Map<string, DiagnosisObservation[]>();
  const add = (key: string, observation: DiagnosisObservation) => {
    objects.set(key, [...(objects.get(key) || []), observation]);
  };

  harObservations.filter(item => item.primary).forEach(item => {
    add(`har:${item.subject.requestId ?? item.id}`, item);
  });
  netlogObservations.filter(item => item.primary).forEach(netlog => {
    const correlatedHar = harObservations.find(har => {
      if (har.subject.requestId === undefined || har.subject.domain !== netlog.subject.domain) return false;
      const correlation = correlations.find(item => item.harRequestId === har.subject.requestId);
      return Boolean(correlation && correlation.score >= 0.9 && (har.category === netlog.category || har.category === 'unknown'));
    });
    if (correlatedHar) {
      add(`har:${correlatedHar.subject.requestId}`, netlog);
      return;
    }
    const subject = netlog.subject.domain || netlog.subject.sourceId || netlog.id;
    add(`netlog:${netlog.category}:${subject}`, netlog);
  });

  if (objects.size === 0) return emptyCoverage(denominatorMayBeIncomplete);
  let explained = 0;
  let partiallyExplained = 0;
  let unexplained = 0;
  const unexplainedRequestIds: number[] = [];
  const unexplainedSourceIds: number[] = [];
  const reasons = new Map<string, number>();
  objects.forEach(items => {
    if (items.some(item => item.explanationState === 'explained')) {
      explained += 1;
      return;
    }
    if (items.some(item => item.explanationState === 'partial')) {
      partiallyExplained += 1;
      addReason(reasons, '需要补充证据或仅有支持线索');
      return;
    }
    unexplained += 1;
    items.forEach(item => {
      if (item.subject.requestId !== undefined) unexplainedRequestIds.push(item.subject.requestId);
      if (item.subject.sourceId !== undefined) unexplainedSourceIds.push(item.subject.sourceId);
    });
    addReason(reasons, '当前 observation 证据不足');
  });

  return {
    totalAbnormalObjects: objects.size,
    explained,
    partiallyExplained,
    unexplained,
    excluded: 0,
    coverageRate: (explained + partiallyExplained) / objects.size,
    denominatorMayBeIncomplete,
    unexplainedRequestIds: Array.from(new Set(unexplainedRequestIds)),
    unexplainedSourceIds: Array.from(new Set(unexplainedSourceIds)),
    reasons: Array.from(reasons.entries()).map(([reason, count]) => ({ reason, count })),
  };
}
