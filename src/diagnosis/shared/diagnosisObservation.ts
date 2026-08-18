import type { HarRequestEntry } from '../../harParser';
import type { AnalysisResult, FailedDomain, URLRequest } from '../../parsers/netlog/parser';
import { classifyNetError } from '../../parsers/netlog/errorClassifier';
import { getNetErrorDescription } from '../../parsers/netlog/constants';
import { getHarRequestIssue, type HarRequestIssue } from './harRequestIssue';
import { getHarTimingPhase, normalizeHarTiming } from './harTimingNormalization';
import type { DiagnosticCategory, DiagnosticEvidence } from './types';

export type DiagnosisEvidenceLevel =
  | 'confirmed-observation'
  | 'correlated'
  | 'supporting'
  | 'heuristic'
  | 'insufficient';

export interface DiagnosisObservation {
  id: string;
  source: 'har' | 'netlog';
  category: DiagnosticCategory;
  subject: {
    requestId?: number;
    sourceId?: number;
    eventIds?: string[];
    domain?: string;
    safePath?: string;
    method?: string;
  };
  timeRange?: { startMs: number; endMs: number; clock: 'epoch' | 'relative' };
  severity: 'critical' | 'warning' | 'info';
  evidenceLevel: DiagnosisEvidenceLevel;
  fact: string;
  evidence: DiagnosticEvidence[];
  counterEvidence?: DiagnosticEvidence[];
  requiresMoreEvidence: boolean;
  primary: boolean;
  explanationState: 'explained' | 'partial' | 'unexplained';
}

function safeUrlParts(url: string): { domain?: string; safePath?: string } {
  try {
    const parsed = new URL(url);
    return { domain: parsed.hostname, safePath: parsed.pathname || '/' };
  } catch {
    return {};
  }
}

function harIssueCategory(entry: HarRequestEntry, issue: HarRequestIssue): DiagnosticCategory {
  if (issue.kind === 'cors') return 'cors';
  if (issue.kind === 'blocked') return 'security';
  if (issue.kind === 'auth') return entry.status === 407 ? 'proxy' : 'security';
  if (issue.kind === 'server-error') return 'server';
  if (issue.kind === 'http-error') return 'client';
  if (issue.kind === 'status-zero' || issue.kind === 'unknown-failure') return 'unknown';
  if (issue.kind === 'slow') {
    if (issue.phase === 'dns') return 'dns';
    if (issue.phase === 'connect') return 'connect';
    if (issue.phase === 'ssl') return 'tls';
    if (issue.phase === 'wait') return 'server';
    if (issue.phase === 'receive') return 'performance';
    return 'browser-queue';
  }
  if (issue.kind === 'net-error') {
    const cat = entry.netErrorCode !== undefined ? classifyNetError(entry.netErrorCode).catName : '';
    if (cat === 'DNS') return 'dns';
    if (cat === '证书') return 'tls';
    if (cat === '代理') return 'proxy';
    if (cat === '连接') return 'connect';
    if (cat === '阻止') return 'security';
    const text = (entry.netErrorText || '').toUpperCase();
    if (/ERR_(?:NAME_|DNS_)/.test(text)) return 'dns';
    if (/ERR_(?:CERT_|SSL_)|CERTIFICATE/.test(text)) return 'tls';
    if (/ERR_(?:PROXY|TUNNEL)|PROXY/.test(text)) return 'proxy';
    if (/ERR_(?:CONNECTION_|ADDRESS_|NETWORK_|INTERNET_DISCONNECTED|TIMED_OUT)/.test(text)) return 'connect';
    if (/ERR_BLOCKED_BY_/.test(text)) return 'security';
  }
  return 'unknown';
}

function harEvidenceLevel(issue: HarRequestIssue): DiagnosisEvidenceLevel {
  if (issue.kind === 'normal') return 'insufficient';
  if (issue.kind === 'cors') return 'heuristic';
  if (issue.kind === 'slow') return 'supporting';
  if (issue.kind === 'status-zero' || issue.kind === 'unknown-failure') return 'insufficient';
  return 'confirmed-observation';
}

function explanationState(level: DiagnosisEvidenceLevel, requiresMoreEvidence: boolean): DiagnosisObservation['explanationState'] {
  if (level === 'insufficient') return 'unexplained';
  if (requiresMoreEvidence || level === 'heuristic' || level === 'supporting') return 'partial';
  return 'explained';
}

function requiresHarMoreEvidence(issue: HarRequestIssue): boolean {
  return issue.kind === 'status-zero'
    || issue.kind === 'unknown-failure'
    || issue.kind === 'cors'
    || issue.kind === 'net-error'
    || (issue.kind === 'slow' && !['wait', 'receive'].includes(issue.phase || ''));
}

function harTimingEvidence(entry: HarRequestEntry, issue: HarRequestIssue): DiagnosticEvidence[] {
  if (issue.kind !== 'slow') return [];
  const phaseLabels: Record<string, string> = {
    queueing: 'Queueing',
    stalled: 'Stalled',
    dns: 'DNS',
    tcp: 'TCP',
    ssl: 'TLS',
    wait: 'TTFB',
    receive: 'Download',
  };
  const normalized = normalizeHarTiming(entry);
  const phases = ['queueing', 'stalled', 'dns', 'tcp', 'ssl', 'wait', 'receive'] as const;
  const phase = phases
    .map(key => getHarTimingPhase(normalized, key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.durationMs - a.durationMs)[0];
  return phase ? [{ label: '主耗时阶段', value: `${phaseLabels[phase.key] || phase.key} ${Math.round(phase.durationMs)}ms`, source: 'har', requestIds: [entry.id] }] : [];
}

export function buildHarObservations(entries: HarRequestEntry[]): DiagnosisObservation[] {
  return entries.flatMap(entry => {
    const issue = getHarRequestIssue(entry);
    if (issue.kind === 'normal') return [];
    const parts = safeUrlParts(entry.url);
    const level = harEvidenceLevel(issue);
    const requiresMoreEvidence = requiresHarMoreEvidence(issue);
    const severity = issue.severity === 'normal' ? 'info' : issue.severity;
    const observation: DiagnosisObservation = {
      id: `har:request:${entry.id}:primary`,
      source: 'har',
      category: harIssueCategory(entry, issue),
      subject: {
        requestId: entry.id,
        domain: entry.domain || parts.domain,
        safePath: parts.safePath,
        method: entry.method,
      },
      timeRange: Number.isFinite(entry.startMs)
        ? { startMs: entry.startMs, endMs: entry.startMs + entry.time, clock: 'epoch' }
        : undefined,
      severity,
      evidenceLevel: level,
      fact: issue.kind === 'status-zero'
        ? '浏览器没有拿到 HTTP 响应，不是服务端返回了 0'
        : issue.label,
      evidence: [
        { label: '请求', value: `${entry.method} ${parts.domain || entry.domain || 'unknown'}${parts.safePath || ''}`, source: 'har', requestIds: [entry.id] },
        { label: '主问题', value: issue.label, source: 'derived', requestIds: [entry.id] },
        ...harTimingEvidence(entry, issue),
      ],
      requiresMoreEvidence,
      primary: true,
      explanationState: explanationState(level, requiresMoreEvidence),
    };
    return [observation];
  });
}

function categoryFromNetError(code: number): DiagnosticCategory {
  const cat = classifyNetError(code).catName;
  if (cat === 'DNS') return 'dns';
  if (cat === '证书') return 'tls';
  if (cat === '代理') return 'proxy';
  if (cat === '连接') return 'connect';
  if (cat === '协议') return 'protocol';
  if (cat === '网络变更') return 'network-change';
  if (cat === '阻止') return 'security';
  return 'unknown';
}

function buildFailedDomainObservation(domain: FailedDomain): DiagnosisObservation {
  const code = domain.errorCodes[0] ?? 0;
  const category = categoryFromNetError(code);
  return {
    id: `netlog:domain:${domain.domain}:${code}`,
    source: 'netlog',
    category,
    subject: { domain: domain.domain },
    timeRange: Number.isFinite(domain.firstTime) && Number.isFinite(domain.lastTime)
      ? { startMs: domain.firstTime, endMs: domain.lastTime, clock: 'relative' }
      : undefined,
    severity: category === 'unknown' ? 'warning' : 'critical',
    evidenceLevel: code ? 'confirmed-observation' : 'insufficient',
    fact: code ? `${domain.domain} 记录到 ${getNetErrorDescription(code)}` : `${domain.domain} 记录到未知网络错误`,
    evidence: [
      { label: '域名', value: domain.domain, source: 'netlog' },
      { label: '错误码', value: domain.errorCodes.join(', ') || 'unknown', source: 'netlog' },
      { label: '失败次数', value: String(domain.count), source: 'netlog' },
    ],
    requiresMoreEvidence: category === 'unknown',
    primary: true,
    explanationState: category === 'unknown' ? 'unexplained' : 'explained',
  };
}

function buildSlowRequestObservation(request: URLRequest): DiagnosisObservation {
  const parts = safeUrlParts(request.url);
  return {
    id: `netlog:request:${request.id}:slow`,
    source: 'netlog',
    category: 'performance',
    subject: {
      sourceId: request.id,
      domain: parts.domain,
      safePath: parts.safePath,
      method: request.method,
    },
    timeRange: Number.isFinite(request.startTime)
      ? { startMs: request.startTime, endMs: request.startTime + (request.duration || 0), clock: 'relative' }
      : undefined,
    severity: 'warning',
    evidenceLevel: 'supporting',
    fact: `NetLog 记录请求耗时 ${Math.round(request.duration || 0)}ms`,
    evidence: [
      { label: '请求', value: `${request.method} ${parts.domain || 'unknown'}${parts.safePath || ''}`, source: 'netlog', sourceIds: [request.id] },
      { label: '耗时', value: `${Math.round(request.duration || 0)}ms`, source: 'netlog', sourceIds: [request.id] },
    ],
    requiresMoreEvidence: true,
    primary: true,
    explanationState: 'partial',
  };
}

export function buildNetlogObservations(result: AnalysisResult, options?: { datasetComplete?: boolean }): DiagnosisObservation[] {
  const observations: DiagnosisObservation[] = [];
  result.failedDomains.forEach(domain => observations.push(buildFailedDomainObservation(domain)));
  result.connectionFailures.forEach((failure, index) => {
    const parts = safeUrlParts(failure.url);
    const category = categoryFromNetError(failure.error);
    observations.push({
      id: `netlog:connection:${index}:${failure.error}`,
      source: 'netlog',
      category,
      subject: { domain: parts.domain, safePath: parts.safePath, sourceId: failure.requestId },
      timeRange: Number.isFinite(failure.time) ? { startMs: failure.time, endMs: failure.time, clock: 'relative' } : undefined,
      severity: 'critical',
      evidenceLevel: 'confirmed-observation',
      fact: `NetLog 记录连接错误 ${getNetErrorDescription(failure.error)}`,
      evidence: [
        { label: '请求', value: `${parts.domain || 'unknown'}${parts.safePath || ''}`, source: 'netlog' },
        { label: '错误码', value: String(failure.error), source: 'netlog' },
      ],
      requiresMoreEvidence: false,
      primary: true,
      explanationState: 'explained',
    });
  });
  result.sslIssues.forEach(issue => {
    observations.push({
      id: `netlog:tls:${issue.host}:${issue.error}`,
      source: 'netlog',
      category: 'tls',
      subject: { domain: issue.host, sourceId: issue.event.source.id, eventIds: [`${issue.event.source.id}:${issue.event.typeName}`] },
      timeRange: Number.isFinite(issue.event.time) ? { startMs: issue.event.time, endMs: issue.event.time, clock: 'relative' } : undefined,
      severity: 'critical',
      evidenceLevel: 'confirmed-observation',
      fact: `NetLog 记录 TLS/证书错误 ${issue.error}`,
      evidence: [
        { label: '主机', value: issue.host, source: 'netlog', eventIds: [`${issue.event.source.id}:${issue.event.typeName}`] },
        { label: '错误码', value: String(issue.error), source: 'netlog' },
      ],
      requiresMoreEvidence: false,
      primary: true,
      explanationState: 'explained',
    });
  });
  result.slowRequests.forEach(request => observations.push(buildSlowRequestObservation(request)));

  if (options?.datasetComplete === false || result.largeFileMode?.truncatedEventsPreview) {
    observations.push({
      id: 'netlog:dataset:preview-incomplete',
      source: 'netlog',
      category: 'quality',
      subject: {},
      severity: 'warning',
      evidenceLevel: 'insufficient',
      fact: '当前 NetLog Dataset 可能不完整，覆盖率分母可能偏低',
      evidence: [{ label: 'Dataset 状态', value: 'preview 或截断', source: 'derived' }],
      requiresMoreEvidence: true,
      primary: false,
      explanationState: 'partial',
    });
  }

  return observations;
}
