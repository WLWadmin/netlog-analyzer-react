import type { HarRequestEntry } from '../../harParser';
import type { URLRequest } from '../../parsers/netlog/parser';
import { netlogTimeToEpochMs, type TimeAlignmentContext } from './timeAlignment';

export type CorrelationLevel =
  | 'exact-url-method'
  | 'same-origin-path-method'
  | 'same-host-path'
  | 'same-host-time'
  | 'same-host-only'
  | 'none';

export interface RequestCorrelation {
  harRequestId: number;
  netlogSourceIds: number[];
  primaryNetlogSourceId?: number;
  candidateCount: number;
  level: CorrelationLevel;
  score: number;
  reasons: string[];
  conflicts: string[];
  timeDeltaMs?: number;
  safeKey: string;
}

interface SafeParts {
  origin: string;
  host: string;
  path: string;
  method: string;
  safeKey: string;
  urlWithoutQuery: string;
}

const LEVEL_SCORE: Record<CorrelationLevel, number> = {
  'exact-url-method': 1,
  'same-origin-path-method': 0.9,
  'same-host-path': 0.75,
  'same-host-time': 0.65,
  'same-host-only': 0.45,
  none: 0,
};

function safeParts(url: string, method = 'GET'): SafeParts {
  try {
    const parsed = new URL(url);
    const normalizedMethod = method.toUpperCase();
    const path = parsed.pathname || '/';
    const origin = parsed.origin.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    return {
      origin,
      host,
      path,
      method: normalizedMethod,
      safeKey: `${normalizedMethod} ${origin}${path}`,
      urlWithoutQuery: `${origin}${path}`,
    };
  } catch {
    const normalizedMethod = method.toUpperCase();
    return {
      origin: '',
      host: '',
      path: '',
      method: normalizedMethod,
      safeKey: `${normalizedMethod} unknown`,
      urlWithoutQuery: '',
    };
  }
}

function timeDeltaMs(har: HarRequestEntry, request: URLRequest, timeContext: TimeAlignmentContext): number | undefined {
  if (!timeContext.enabled || !Number.isFinite(har.startMs) || !Number.isFinite(request.startTime)) return undefined;
  const netlogStart = netlogTimeToEpochMs(request.startTime, timeContext);
  if (netlogStart === undefined) return undefined;
  return Math.abs(har.startMs - netlogStart);
}

function compareCandidate(har: HarRequestEntry, request: URLRequest, timeContext: TimeAlignmentContext) {
  const harParts = safeParts(har.url, har.method);
  const requestParts = safeParts(request.url, request.method);
  const conflicts: string[] = [];
  const reasons: string[] = [];
  const delta = timeDeltaMs(har, request, timeContext);

  if (harParts.method !== requestParts.method) conflicts.push(`method 不一致：HAR=${harParts.method}, NetLog=${requestParts.method}`);
  if (harParts.host !== requestParts.host) conflicts.push('host 不一致');
  if (harParts.path !== requestParts.path && harParts.host === requestParts.host) conflicts.push('path 不一致');

  let level: CorrelationLevel = 'none';
  if (harParts.urlWithoutQuery && harParts.urlWithoutQuery === requestParts.urlWithoutQuery && harParts.method === requestParts.method) {
    level = har.url === request.url ? 'exact-url-method' : 'same-origin-path-method';
    reasons.push(level === 'exact-url-method' ? 'URL 与 method 完全一致' : 'origin + pathname + method 一致，query value 未参与关联');
  } else if (harParts.host && harParts.host === requestParts.host && harParts.path === requestParts.path) {
    level = 'same-host-path';
    reasons.push('host + pathname 一致');
  } else if (harParts.host && harParts.host === requestParts.host && delta !== undefined && delta <= (timeContext.windowMs || 0)) {
    level = 'same-host-time';
    reasons.push(`同 host 且时间差 ${Math.round(delta)}ms 落入 ${timeContext.windowMs}ms 窗口`);
  } else if (harParts.host && harParts.host === requestParts.host) {
    level = 'same-host-only';
    reasons.push('仅 host 一致，只能作为 supporting evidence');
  }

  if (level !== 'none' && harParts.method !== requestParts.method) {
    level = level === 'same-host-only' ? 'same-host-only' : 'same-host-path';
  }

  return {
    request,
    level,
    score: LEVEL_SCORE[level],
    reasons,
    conflicts,
    timeDeltaMs: delta,
    safeKey: harParts.safeKey,
  };
}

export function correlateHarRequestToNetlog(
  harEntry: HarRequestEntry,
  netlogRequests: URLRequest[],
  timeContext: TimeAlignmentContext
): RequestCorrelation {
  const compared = netlogRequests
    .map(request => compareCandidate(harEntry, request, timeContext))
    .filter(item => item.level !== 'none')
    .sort((a, b) => b.score - a.score
      || (a.timeDeltaMs ?? Number.POSITIVE_INFINITY) - (b.timeDeltaMs ?? Number.POSITIVE_INFINITY)
      || a.request.id - b.request.id);

  const best = compared[0];
  if (!best) {
    return {
      harRequestId: harEntry.id,
      netlogSourceIds: [],
      candidateCount: 0,
      level: 'none',
      score: 0,
      reasons: [],
      conflicts: ['没有找到可关联的 NetLog URL_REQUEST'],
      safeKey: safeParts(harEntry.url, harEntry.method).safeKey,
    };
  }

  const sameLevel = compared.filter(item => item.level === best.level);
  const ambiguous = sameLevel.length > 1;
  return {
    harRequestId: harEntry.id,
    netlogSourceIds: sameLevel.map(item => item.request.id),
    primaryNetlogSourceId: best.request.id,
    candidateCount: compared.length,
    level: best.level,
    score: ambiguous ? Math.min(best.score, LEVEL_SCORE['same-host-path']) : best.score,
    reasons: Array.from(new Set([
      ...best.reasons,
      ...(ambiguous ? [`存在 ${sameLevel.length} 个同等级候选，未唯一定位到 NetLog 请求`] : []),
    ])),
    conflicts: Array.from(new Set([
      ...sameLevel.flatMap(item => item.conflicts),
      ...(ambiguous ? ['同等级候选不唯一，不能作为强请求关联'] : []),
    ])).slice(0, 5),
    timeDeltaMs: best.timeDeltaMs,
    safeKey: best.safeKey,
  };
}

export function correlateHarRequestsToNetlog(
  harEntries: HarRequestEntry[],
  netlogRequests: URLRequest[],
  timeContext: TimeAlignmentContext
): RequestCorrelation[] {
  return harEntries.map(entry => correlateHarRequestToNetlog(entry, netlogRequests, timeContext));
}

export function summarizeRequestCorrelations(correlations: RequestCorrelation[]) {
  const strong = correlations.filter(item => item.score >= 0.9).length;
  const weak = correlations.filter(item => item.score > 0 && item.score < 0.9).length;
  const none = correlations.filter(item => item.score === 0).length;
  return {
    total: correlations.length,
    strong,
    weak,
    none,
    strongRate: correlations.length ? strong / correlations.length : 0,
    weakRate: correlations.length ? weak / correlations.length : 0,
    noneRate: correlations.length ? none / correlations.length : 0,
  };
}
