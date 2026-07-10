import type { HarRequestEntry } from '../../harParser';
import { formatHarTime } from '../../harParser';
import { classifyNetError } from '../../parsers/netlog/errorClassifier';
import { getHarRequestIssue, type HarRequestIssue } from './harRequestIssue';
import { getHarTimingPhase, normalizeHarTiming, type HarDisplayTimingPhaseKey } from './harTimingNormalization';

export type HarIssueCategory =
  | 'dns'
  | 'connection'
  | 'tls'
  | 'proxy'
  | 'browser-block'
  | 'cors'
  | 'auth'
  | 'server-error'
  | 'http-error'
  | 'queueing'
  | 'stalled'
  | 'ttfb'
  | 'download'
  | 'unknown-failure';

export type HarEvidenceLevel =
  | 'explicit-observation'
  | 'timing-signal'
  | 'heuristic'
  | 'insufficient';

export interface HarIssueCluster {
  id: string;
  category: HarIssueCategory;
  evidenceLevel: HarEvidenceLevel;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  userFacingSummary: string;
  affectedRequestCount: number;
  affectedDomainCount: number;
  affectedRequestIds: number[];
  representativeRequestIds: number[];
  maxDurationMs?: number;
  timeWindow?: {
    startMs: number;
    endMs: number;
  };
  evidence: Array<{
    label: string;
    value: string;
    source: 'har' | 'derived';
    requestIds?: number[];
  }>;
  roleHints: Array<'user' | 'it' | 'frontend' | 'backend'>;
  requiresNetLog: boolean;
  groupingReason: string;
}

const EVIDENCE_RANK: Record<HarEvidenceLevel, number> = {
  'explicit-observation': 4,
  'timing-signal': 3,
  heuristic: 2,
  insufficient: 1,
};

const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };
const TIME_WINDOW_MS = 5000;

function safeDomain(domain?: string): string {
  return domain || 'unknown-domain';
}

function safeRequestName(entry: HarRequestEntry): string {
  try {
    const url = new URL(entry.url);
    return `${url.hostname}${url.pathname || '/'}`;
  } catch {
    return `${entry.domain || 'unknown-domain'}${entry.name ? `/${entry.name.split('?')[0]}` : ''}`;
  }
}

function netErrorCategory(entry: HarRequestEntry): HarIssueCategory {
  if (entry.status === 407 || /proxy/i.test(entry.netErrorText || '')) return 'proxy';
  if (entry.netErrorCode === undefined) return 'unknown-failure';
  const category = classifyNetError(entry.netErrorCode).catName;
  if (category === 'DNS') return 'dns';
  if (category === '连接') return 'connection';
  if (category === '证书') return 'tls';
  if (category === '代理') return 'proxy';
  if (category === '阻止') return 'browser-block';
  return 'unknown-failure';
}

function slowCategory(entry: HarRequestEntry, issue: HarRequestIssue): HarIssueCategory {
  const normalized = normalizeHarTiming(entry);
  const candidates: Array<{ key: HarDisplayTimingPhaseKey; category: HarIssueCategory; duration: number }> = [
    { key: 'queueing', category: 'queueing', duration: getHarTimingPhase(normalized, 'queueing')?.durationMs || 0 },
    { key: 'stalled', category: 'stalled', duration: getHarTimingPhase(normalized, 'stalled')?.durationMs || 0 },
    { key: 'dns', category: 'dns', duration: getHarTimingPhase(normalized, 'dns')?.durationMs || 0 },
    { key: 'tcp', category: 'connection', duration: getHarTimingPhase(normalized, 'tcp')?.durationMs || 0 },
    { key: 'ssl', category: 'tls', duration: getHarTimingPhase(normalized, 'ssl')?.durationMs || 0 },
    { key: 'wait', category: 'ttfb', duration: getHarTimingPhase(normalized, 'wait')?.durationMs || 0 },
    { key: 'receive', category: 'download', duration: getHarTimingPhase(normalized, 'receive')?.durationMs || 0 },
  ];
  const fromIssue = candidates.find(item => item.duration === issue.durationMs);
  if (fromIssue) return fromIssue.category;
  if (issue.phase === 'wait') return 'ttfb';
  if (issue.phase === 'receive') return 'download';
  if (issue.phase === 'dns') return 'dns';
  if (issue.phase === 'ssl') return 'tls';
  if (issue.phase === 'connect') return 'connection';
  return 'stalled';
}

function mapIssue(entry: HarRequestEntry, issue: HarRequestIssue): { category: HarIssueCategory; evidenceLevel: HarEvidenceLevel; requiresNetLog: boolean } | null {
  switch (issue.kind) {
    case 'normal':
      return null;
    case 'net-error':
      return { category: netErrorCategory(entry), evidenceLevel: 'explicit-observation', requiresNetLog: ['dns', 'connection', 'tls', 'proxy', 'unknown-failure'].includes(netErrorCategory(entry)) };
    case 'blocked':
      return { category: 'browser-block', evidenceLevel: 'explicit-observation', requiresNetLog: false };
    case 'cors':
      return { category: 'cors', evidenceLevel: 'heuristic', requiresNetLog: true };
    case 'auth':
      return { category: entry.status === 407 ? 'proxy' : 'auth', evidenceLevel: 'explicit-observation', requiresNetLog: entry.status === 407 };
    case 'server-error':
      return { category: 'server-error', evidenceLevel: 'explicit-observation', requiresNetLog: false };
    case 'http-error':
      return { category: 'http-error', evidenceLevel: 'explicit-observation', requiresNetLog: false };
    case 'status-zero':
    case 'unknown-failure':
      return { category: 'unknown-failure', evidenceLevel: 'insufficient', requiresNetLog: true };
    case 'slow':
      return { category: slowCategory(entry, issue), evidenceLevel: 'timing-signal', requiresNetLog: issue.phase !== 'wait' && issue.phase !== 'receive' };
  }
}

function categoryLabel(category: HarIssueCategory): string {
  const labels: Record<HarIssueCategory, string> = {
    dns: 'DNS 解析',
    connection: 'TCP/连接',
    tls: 'TLS/证书',
    proxy: '代理',
    'browser-block': '浏览器阻止',
    cors: 'CORS 疑似',
    auth: '鉴权/权限',
    'server-error': '服务端错误',
    'http-error': 'HTTP 请求错误',
    queueing: 'Queueing',
    stalled: 'Stalled',
    ttfb: '服务端响应',
    download: '下载',
    'unknown-failure': '未知失败',
  };
  return labels[category];
}

function defaultRoles(category: HarIssueCategory): HarIssueCluster['roleHints'] {
  switch (category) {
    case 'ttfb':
    case 'server-error':
      return ['backend'];
    case 'http-error':
    case 'cors':
    case 'auth':
      return ['frontend', 'backend'];
    case 'queueing':
      return ['frontend'];
    case 'download':
      return ['frontend', 'it'];
    case 'browser-block':
      return ['frontend', 'it'];
    case 'unknown-failure':
      return ['user'];
    default:
      return ['it'];
  }
}

function severityFor(category: HarIssueCategory, count: number, issueSeverity: HarRequestIssue['severity']): HarIssueCluster['severity'] {
  if (issueSeverity === 'critical' || ['dns', 'connection', 'tls', 'proxy', 'server-error'].includes(category)) return 'critical';
  if (count > 1 || issueSeverity === 'warning') return 'warning';
  return 'info';
}

function stableWindow(entry: HarRequestEntry): number {
  if (!Number.isFinite(entry.startMs) || entry.startMs <= 0) return 0;
  return Math.floor(entry.startMs / TIME_WINDOW_MS);
}

function clusterKey(entry: HarRequestEntry, issue: HarRequestIssue, category: HarIssueCategory): string {
  const domain = safeDomain(entry.domain);
  const window = stableWindow(entry);
  if (issue.kind === 'net-error') return `net-error:${category}:${entry.netErrorText || entry.netErrorCode || 'unknown'}:${domain}:${window}`;
  if (issue.kind === 'blocked') return `blocked:${entry.blockedReason || 'unknown'}:${domain}:${window}`;
  if (issue.kind === 'server-error' || issue.kind === 'http-error' || issue.kind === 'auth') return `http:${category}:${entry.status}:${domain}:${window}`;
  if (issue.kind === 'slow') return `slow:${category}:${domain}:${window}`;
  return `failure:${category}:${domain}:${window}`;
}

function makeTitle(category: HarIssueCategory, count: number): string {
  if (category === 'unknown-failure') return `${count} 个请求未拿到 HTTP 响应，HAR 缺少更底层错误`;
  if (category === 'browser-block') return `浏览器阻止了 ${count} 个请求`;
  if (['ttfb', 'queueing', 'stalled', 'dns', 'connection', 'tls', 'download'].includes(category)) {
    return `${count} 个请求集中慢在${categoryLabel(category)}阶段`;
  }
  if (category === 'server-error') return `${count} 个请求出现 5xx 服务端错误`;
  if (category === 'auth') return `${count} 个请求出现鉴权或权限问题`;
  return `${count} 个请求出现${categoryLabel(category)}现象`;
}

function buildSummary(cluster: Omit<HarIssueCluster, 'userFacingSummary'>, total: number): string {
  const count = cluster.affectedRequestCount;
  const ratio = total ? Math.round((count / total) * 100) : 0;
  const roles = cluster.roleHints.map(role => ({ user: '用户', it: 'IT', frontend: '前端', backend: '后端' }[role])).join(' / ');
  const boundary = cluster.requiresNetLog ? 'HAR 只能说明请求现象，建议补充同次 NetLog 确认底层网络栈原因。' : 'HAR 已记录可直接观察的请求现象，但不等于确认责任归属。';
  return `${cluster.title}，影响 ${count} 个请求（约 ${ratio}%）和 ${cluster.affectedDomainCount} 个域名。建议先由 ${roles} 查看；${boundary}`;
}

function representativeIds(items: Array<{ entry: HarRequestEntry; issue: HarRequestIssue }>): number[] {
  const picked = [
    [...items].sort((a, b) => SEVERITY_RANK[b.issue.severity === 'normal' ? 'info' : b.issue.severity] - SEVERITY_RANK[a.issue.severity === 'normal' ? 'info' : a.issue.severity])[0]?.entry.id,
    [...items].sort((a, b) => b.entry.time - a.entry.time)[0]?.entry.id,
    [...items].sort((a, b) => a.entry.startMs - b.entry.startMs || a.entry.id - b.entry.id)[0]?.entry.id,
  ].filter((id): id is number => id !== undefined);
  return Array.from(new Set(picked)).slice(0, 3);
}

export function buildHarIssueClusters(entries: HarRequestEntry[], options?: { maxPrimaryClusters?: number }): HarIssueCluster[] {
  const groups = new Map<string, Array<{ entry: HarRequestEntry; issue: HarRequestIssue; category: HarIssueCategory; evidenceLevel: HarEvidenceLevel; requiresNetLog: boolean }>>();
  entries.forEach(entry => {
    const issue = getHarRequestIssue(entry);
    const mapped = mapIssue(entry, issue);
    if (!mapped) return;
    if (issue.kind === 'slow' && entries.length > 1 && entry.time < 1000) return;
    const key = clusterKey(entry, issue, mapped.category);
    const list = groups.get(key) || [];
    list.push({ entry, issue, ...mapped });
    groups.set(key, list);
  });

  const clusters = Array.from(groups.entries()).map(([key, items]) => {
    const entriesInGroup = items.map(item => item.entry);
    const issue = items[0].issue;
    const category = items[0].category;
    const evidenceLevel = items[0].evidenceLevel;
    const domains = Array.from(new Set(entriesInGroup.map(entry => safeDomain(entry.domain))));
    const startValues = entriesInGroup.map(entry => entry.startMs).filter(ms => Number.isFinite(ms) && ms > 0);
    const endValues = entriesInGroup.map(entry => entry.startMs + entry.time).filter(ms => Number.isFinite(ms) && ms > 0);
    const maxDurationMs = Math.max(...items.map(item => item.issue.durationMs || item.entry.time || 0), 0);
    const affectedRequestIds = entriesInGroup.map(entry => entry.id).sort((a, b) => a - b);
    const representativeRequestIds = representativeIds(items);
    const roles = Array.from(new Set(items.flatMap(item => item.issue.roleHint ? [item.issue.roleHint] : defaultRoles(category))));
    const severity = severityFor(category, items.length, issue.severity);
    const basis = issue.kind === 'slow' ? `${categoryLabel(category)} timing` : issue.label;
    const clusterBase = {
      id: key.replace(/[^a-zA-Z0-9:_-]/g, '-'),
      category,
      evidenceLevel,
      severity,
      title: makeTitle(category, items.length),
      affectedRequestCount: items.length,
      affectedDomainCount: domains.length,
      affectedRequestIds,
      representativeRequestIds,
      maxDurationMs,
      timeWindow: startValues.length ? { startMs: Math.min(...startValues), endMs: Math.max(...endValues) } : undefined,
      evidence: [
        { label: '归组依据', value: basis, source: 'derived' as const, requestIds: representativeRequestIds },
        { label: '涉及域名', value: domains.join('、'), source: 'derived' as const },
        ...(maxDurationMs > 0 ? [{ label: '最大耗时', value: formatHarTime(maxDurationMs), source: 'har' as const, requestIds: representativeRequestIds }] : []),
        { label: '代表请求', value: representativeRequestIds.map(id => `#${id + 1} ${safeRequestName(entries[id])}`).join('；'), source: 'har' as const, requestIds: representativeRequestIds },
      ],
      roleHints: roles as HarIssueCluster['roleHints'],
      requiresNetLog: items.some(item => item.requiresNetLog),
      groupingReason: `按 ${safeDomain(entriesInGroup[0].domain)} 的 ${basis} 在同一时间窗口聚合`,
    };
    return {
      ...clusterBase,
      userFacingSummary: buildSummary(clusterBase, entries.length),
    };
  });

  const sorted = clusters.sort((a, b) => {
    const aImportant = a.affectedRequestIds.some(id => ['doc', 'xhr'].includes(entries.find(e => e.id === id)?.category || ''));
    const bImportant = b.affectedRequestIds.some(id => ['doc', 'xhr'].includes(entries.find(e => e.id === id)?.category || ''));
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      || EVIDENCE_RANK[b.evidenceLevel] - EVIDENCE_RANK[a.evidenceLevel]
      || Number(bImportant) - Number(aImportant)
      || b.affectedRequestCount - a.affectedRequestCount
      || (b.maxDurationMs || 0) - (a.maxDurationMs || 0)
      || (a.timeWindow?.startMs || 0) - (b.timeWindow?.startMs || 0)
      || a.id.localeCompare(b.id);
  });

  return sorted.slice(0, options?.maxPrimaryClusters ?? sorted.length);
}

export function getHarEvidenceLevelLabel(level: HarEvidenceLevel): string {
  switch (level) {
    case 'explicit-observation': return '明确现象';
    case 'timing-signal': return '强线索';
    case 'heuristic': return '疑似';
    case 'insufficient': return '需补充证据';
  }
}

export function getHarRoleLabel(role: HarIssueCluster['roleHints'][number]): string {
  return { user: '用户', it: 'IT', frontend: '前端', backend: '后端' }[role];
}
