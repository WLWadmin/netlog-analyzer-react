/**
 * HAR + NetLog 联合诊断
 *
 * 核心思路：
 * 1. HAR 给出请求级 timing 现象。
 * 2. NetLog 给出浏览器网络栈事件、错误码、代理、TLS/DNS 证据。
 * 3. 联合诊断只在同 host 证据能对齐时给出高置信结论，避免全局异常牵连无关请求。
 */

import type { HarAnalysisResult, HarRequestEntry } from '../../harParser';
import type { AnalysisResult, URLRequest, FailedDomain, SslIssue } from '../../parsers/netlog/parser';
import { classifyNetError } from '../../parsers/netlog/errorClassifier';
import type {
  DiagnosticCard,
  DiagnosisSummary,
  CollectionQuality,
} from './types';
import { HAR_DIAG_THRESHOLDS } from './harThresholds';
import { buildTimeAlignmentContext } from './timeAlignment';
import { correlateHarRequestToNetlog, correlateHarRequestsToNetlog, type CorrelationLevel, type RequestCorrelation } from './requestCorrelation';
import { buildHarObservations, buildNetlogObservations, type DiagnosisObservation } from './diagnosisObservation';
import { applyEvidenceFusion, fuseDiagnosisEvidence } from './evidenceFusion';
import { getHarTimingPhase, normalizeHarTiming, type HarDisplayTimingPhaseKey } from './harTimingNormalization';

// ========== 对齐逻辑 ==========

interface NetlogRequestRef {
  request: URLRequest;
  index: number;
  host: string;
  path: string;
}

interface HostNetlogIndex {
  requests: NetlogRequestRef[];
  failedDomains: FailedDomain[];
  dnsFailures: FailedDomain[];
  tlsIssues: SslIssue[];
}

interface AlignmentIndex {
  byHost: Map<string, HostNetlogIndex>;
  proxyEventCount: number;
  proxyHostHints: Set<string>;
}

interface AlignedEntry {
  harEntry: HarRequestEntry;
  host: string;
  path: string;
  netlogRequests: NetlogRequestRef[];
  hostIndex?: HostNetlogIndex;
  alignLevel: 'exact-url' | 'same-path' | 'same-host-time' | 'same-host' | 'none';
  alignScore: number;
  isSlow: boolean;
}

function normalizeHost(hostOrUrl: string | undefined | null): string {
  if (!hostOrUrl) return '';
  try {
    if (hostOrUrl.startsWith('http://') || hostOrUrl.startsWith('https://')) {
      return new URL(hostOrUrl).hostname.toLowerCase();
    }
  } catch { /* ignore */ }
  return hostOrUrl
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/:\d+$/, '');
}

function parseUrlParts(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), path: u.pathname || '/' };
  } catch {
    return { host: '', path: '' };
  }
}

function mapCorrelationLevel(level: CorrelationLevel): AlignedEntry['alignLevel'] {
  switch (level) {
    case 'exact-url-method':
      return 'exact-url';
    case 'same-origin-path-method':
    case 'same-host-path':
      return 'same-path';
    case 'same-host-time':
      return 'same-host-time';
    case 'same-host-only':
      return 'same-host';
    default:
      return 'none';
  }
}

function timingMs(entry: HarRequestEntry, phase: HarDisplayTimingPhaseKey): number {
  return getHarTimingPhase(normalizeHarTiming(entry), phase)?.durationMs || 0;
}

function isDnsErrorDomain(domain: FailedDomain): boolean {
  return domain.errorCodes.some(code => classifyNetError(code).catName === 'DNS');
}

function ensureHostIndex(index: AlignmentIndex, host: string): HostNetlogIndex {
  const key = host || '(unknown)';
  let value = index.byHost.get(key);
  if (!value) {
    value = { requests: [], failedDomains: [], dnsFailures: [], tlsIssues: [] };
    index.byHost.set(key, value);
  }
  return value;
}

function buildAlignmentIndex(netlogResult: AnalysisResult): AlignmentIndex {
  const index: AlignmentIndex = {
    byHost: new Map(),
    proxyEventCount: netlogResult.proxyEvents.length,
    proxyHostHints: new Set(),
  };

  netlogResult.urlRequests.forEach((request, requestIndex) => {
    const { host, path } = parseUrlParts(request.url);
    if (!host) return;
    ensureHostIndex(index, host).requests.push({ request, index: requestIndex, host, path });
  });

  netlogResult.failedDomains.forEach(domain => {
    const host = normalizeHost(domain.domain);
    if (!host) return;
    const bucket = ensureHostIndex(index, host);
    bucket.failedDomains.push(domain);
    if (isDnsErrorDomain(domain)) bucket.dnsFailures.push(domain);
  });

  netlogResult.sslIssues.forEach(issue => {
    const host = normalizeHost(issue.host);
    if (!host || host === 'unknown') return;
    ensureHostIndex(index, host).tlsIssues.push(issue);
  });

  netlogResult.proxyEvents.forEach(evt => {
    const p = evt.params || {};
    [
      p.host,
      p.hostname,
      p.tunnel_host,
      p.url,
      p.proxy_host,
    ].forEach(value => {
      const host = normalizeHost(typeof value === 'string' ? value : '');
      if (host) index.proxyHostHints.add(host);
    });
  });

  return index;
}

function alignHarWithNetlog(
  harResult: HarAnalysisResult,
  netlogResult: AnalysisResult,
  timeContext: ReturnType<typeof buildTimeAlignmentContext>
): AlignedEntry[] {
  const index = buildAlignmentIndex(netlogResult);

  return harResult.entries.map(harEntry => {
    const { host, path } = parseUrlParts(harEntry.url);
    const hostIndex = host ? index.byHost.get(host) : undefined;
    const candidates = hostIndex?.requests || [];
    const correlation = correlateHarRequestToNetlog(harEntry, netlogResult.urlRequests, timeContext);
    const alignedIdSet = new Set(correlation.netlogSourceIds);
    const alignedRequests = alignedIdSet.size > 0
      ? candidates.filter(ref => alignedIdSet.has(ref.request.id))
      : [];
    const alignLevel = mapCorrelationLevel(correlation.level);
    const alignScore = correlation.score;

    return {
      harEntry,
      host,
      path,
      netlogRequests: alignedRequests,
      hostIndex,
      alignLevel,
      alignScore,
      isSlow: harEntry.isSlow || harEntry.time >= HAR_DIAG_THRESHOLDS.totalSlow,
    };
  });
}

function alignLevelText(level: AlignedEntry['alignLevel']): string {
  switch (level) {
    case 'exact-url': return 'URL 完全匹配';
    case 'same-path': return '同 host + path 匹配';
    case 'same-host-time': return '同 host + 时间窗口匹配';
    case 'same-host': return '同 host 匹配';
    default: return '未对齐';
  }
}

function confidenceFromAlignment(entries: AlignedEntry[], hasDirectEvidence: boolean): DiagnosticCard['confidence'] {
  if (!hasDirectEvidence) return 'low';
  const best = Math.max(...entries.map(e => e.alignScore), 0);
  if (best >= 0.8) return 'high';
  if (best >= 0.55) return 'medium';
  return 'low';
}

function uniqueHosts(entries: AlignedEntry[]): string[] {
  return [...new Set(entries.map(e => e.host).filter(Boolean))];
}

function collectRequestIds(entries: AlignedEntry[], limit = 10): number[] {
  return entries.slice(0, limit).map(e => e.harEntry.id);
}

function collectSourceIdsFromRequests(entries: AlignedEntry[], limit = 10): number[] {
  const ids = new Set<number>();
  for (const entry of entries) {
    for (const ref of entry.netlogRequests) {
      ids.add(ref.request.id);
      if (ids.size >= limit) return Array.from(ids);
    }
  }
  return Array.from(ids);
}

function buildAlignmentEvidence(entries: AlignedEntry[]) {
  const counts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[alignLevelText(entry.alignLevel)] = (acc[alignLevelText(entry.alignLevel)] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([level, count]) => `${level} ${count} 个`).join('，');
}

function relevantHarObservations(card: DiagnosticCard, observations: DiagnosisObservation[]): DiagnosisObservation[] {
  const ids = new Set(card.relatedRequestIds || []);
  return observations.filter(item => ids.size > 0
    ? item.subject.requestId !== undefined && ids.has(item.subject.requestId)
    : item.category === card.category);
}

function relevantNetlogObservations(card: DiagnosticCard, observations: DiagnosisObservation[], harObservations: DiagnosisObservation[]): DiagnosisObservation[] {
  const domains = new Set(harObservations.map(item => item.subject.domain).filter(Boolean));
  return observations.filter(item => {
    const categoryMatches = item.category === card.category || (card.category === 'server' && item.category === 'performance');
    const domainMatches = domains.size === 0 || (item.subject.domain !== undefined && domains.has(item.subject.domain));
    return categoryMatches && domainMatches;
  });
}

const COMBINED_CATEGORY_LABEL: Partial<Record<DiagnosticCard['category'], string>> = {
  dns: 'DNS',
  connect: '连接',
  tls: 'TLS/证书',
  proxy: '代理',
  protocol: '协议',
  'network-change': '网络切换',
  security: '浏览器/安全策略',
};

function buildCorrelatedFailureCards(
  harObservations: DiagnosisObservation[],
  netlogObservations: DiagnosisObservation[],
  correlations: RequestCorrelation[]
): DiagnosticCard[] {
  const groups = new Map<string, Array<{ har: DiagnosisObservation; netlog: DiagnosisObservation; correlation: RequestCorrelation }>>();
  harObservations.forEach(har => {
    if (har.subject.requestId === undefined || !['confirmed-observation', 'insufficient'].includes(har.evidenceLevel)) return;
    const correlation = correlations.find(item => item.harRequestId === har.subject.requestId && item.score >= 0.9);
    if (!correlation) return;
    const netlog = netlogObservations.find(item =>
      item.evidenceLevel === 'confirmed-observation' &&
      item.subject.domain === har.subject.domain &&
      item.subject.sourceId !== undefined &&
      correlation.netlogSourceIds.includes(item.subject.sourceId) &&
      ['dns', 'connect', 'tls', 'proxy', 'protocol', 'network-change', 'security'].includes(item.category) &&
      (har.category === 'unknown' || item.category === har.category)
    );
    if (!netlog) return;
    const category = har.category === 'unknown' ? netlog.category : har.category;
    const key = `${category}:${har.subject.domain || 'unknown'}`;
    const items = groups.get(key) || [];
    items.push({ har, netlog, correlation });
    groups.set(key, items);
  });

  return Array.from(groups.entries()).map(([key, items]) => {
    const category = items[0].har.category === 'unknown' ? items[0].netlog.category : items[0].har.category;
    const requestIds = Array.from(new Set(items.map(item => item.har.subject.requestId).filter((id): id is number => id !== undefined)));
    const sourceIds = Array.from(new Set(items.flatMap(item => item.correlation.netlogSourceIds)));
    const ranges = items.map(item => item.har.timeRange).filter((range): range is NonNullable<typeof range> => Boolean(range));
    const timeRange = ranges.length === items.length
      ? { startMs: Math.min(...ranges.map(range => range.startMs)), endMs: Math.max(...ranges.map(range => range.endMs)), clock: 'epoch' as const }
      : undefined;
    const domain = items[0].har.subject.domain || '未知域名';
    const label = COMBINED_CATEGORY_LABEL[category] || category;
    return {
      id: `combined-explicit-${key.replace(/[^a-zA-Z0-9:_-]/g, '-')}`,
      source: 'combined',
      category,
      severity: items.some(item => item.har.severity === 'critical' || item.netlog.severity === 'critical') ? 'critical' : 'warning',
      confidence: 'high',
      timeRange,
      title: `联合诊断：${label}失败证据在同请求上吻合`,
      conclusion: `HAR 记录了 ${items.length} 个失败请求，NetLog 在 ${domain} 记录了同类网络栈错误，优先排查${label}链路。`,
      scope: {
        type: requestIds.length === 1 ? 'single-request' : 'single-domain',
        summary: `影响 ${requestIds.length} 个请求 / 1 个域名`,
        affectedRequestCount: requestIds.length,
        affectedDomainCount: 1,
      },
      evidence: [
        { label: 'HAR 失败请求', value: `${requestIds.length} 个`, source: 'har', requestIds },
        { label: 'NetLog 同类错误', value: `${items.length} 条`, source: 'netlog', sourceIds },
        { label: '关联方式', value: 'method + origin + pathname 强关联', source: 'derived' },
      ],
      actions: [],
      limitations: ['联合证据确认的是同请求现象吻合，最终环境或责任归属仍需结合复现条件确认。'],
      relatedRequestIds: requestIds,
      relatedSourceIds: sourceIds,
      mergedSources: ['har', 'netlog'],
      navigationTarget: { tab: 'requests', requestIds, sourceIds, keyword: domain },
    } satisfies DiagnosticCard;
  });
}

function dedupeCombinedCards(cards: DiagnosticCard[]): DiagnosticCard[] {
  return cards.filter((card, index) => {
    const ids = new Set(card.relatedRequestIds || []);
    return !cards.slice(0, index).some(previous =>
      previous.category === card.category &&
      (previous.relatedRequestIds || []).some(id => ids.has(id))
    );
  });
}

function applyCombinedEvidenceFusion(
  cards: DiagnosticCard[],
  harObservations: DiagnosisObservation[],
  netlogObservations: DiagnosisObservation[],
  correlations: RequestCorrelation[]
): DiagnosticCard[] {
  return cards.map(card => {
    const harForCard = relevantHarObservations(card, harObservations);
    const netlogForCard = relevantNetlogObservations(card, netlogObservations, harForCard);
    const requestIds = new Set(card.relatedRequestIds || harForCard.map(item => item.subject.requestId).filter((id): id is number => id !== undefined));
    const correlationsForCard = correlations.filter(item => requestIds.has(item.harRequestId));
    const fusion = fuseDiagnosisEvidence({
      harObservations: harForCard,
      netlogObservations: netlogForCard,
      correlations: correlationsForCard,
      baseConfidence: card.confidence,
    });
    return applyEvidenceFusion(card, fusion);
  });
}

// ========== 联合诊断卡片生成 ==========

export function combinedDiagnosisToCards(
  harResult: HarAnalysisResult,
  netlogResult: AnalysisResult
): DiagnosticCard[] {
  const cards: DiagnosticCard[] = [];
  const timeContext = buildTimeAlignmentContext(harResult.entries, netlogResult.urlRequests, netlogResult.netlogClockContext);
  const timeLimitation = timeContext.enabled ? undefined : timeContext.reason;
  const aligned = alignHarWithNetlog(harResult, netlogResult, timeContext);
  const correlations = correlateHarRequestsToNetlog(harResult.entries, netlogResult.urlRequests, timeContext);
  const harObservations = buildHarObservations(harResult.entries);
  const netlogObservations = buildNetlogObservations(netlogResult);
  cards.push(...buildCorrelatedFailureCards(harObservations, netlogObservations, correlations));
  const slowAligned = aligned.filter(a => a.isSlow);

  const netlogIndex = buildAlignmentIndex(netlogResult);

  // 1. HAR DNS 慢 + 同 host NetLog DNS 失败
  const slowWithDnsIssue = slowAligned.filter(a =>
    timingMs(a.harEntry, 'dns') > HAR_DIAG_THRESHOLDS.dnsSlow &&
    (a.hostIndex?.dnsFailures.length || 0) > 0
  );
  if (slowWithDnsIssue.length > 0) {
    const hosts = uniqueHosts(slowWithDnsIssue);
    const dnsFailures = slowWithDnsIssue.flatMap(a => a.hostIndex?.dnsFailures || []);
    const confidence = confidenceFromAlignment(slowWithDnsIssue, dnsFailures.length > 0);
    cards.push({
      id: 'combined-dns-slow',
      source: 'combined',
      category: 'dns',
      severity: 'critical',
      confidence,
      title: '联合诊断：DNS 慢请求与同域名 NetLog DNS 失败吻合',
      conclusion: `HAR 中 ${slowWithDnsIssue.length} 个慢请求 DNS 耗时超过 ${HAR_DIAG_THRESHOLDS.dnsSlow}ms，且 NetLog 在相同域名检测到 DNS 错误，优先排查 DNS 解析链路`,
      scope: {
        type: hosts.length > 1 ? 'multi-domain' : 'single-domain',
        summary: `影响 ${hosts.length} 个域名`,
        affectedRequestCount: slowWithDnsIssue.length,
        affectedDomainCount: hosts.length,
      },
      evidence: [
        { label: 'HAR DNS 慢请求', value: `${slowWithDnsIssue.length} 个`, source: 'har', requestIds: collectRequestIds(slowWithDnsIssue) },
        { label: 'NetLog DNS 失败域名', value: [...new Set(dnsFailures.map(d => `${d.domain} (${d.errorCodes.join(', ')})`))].slice(0, 5).join('、'), source: 'netlog' },
        { label: '对齐方式', value: buildAlignmentEvidence(slowWithDnsIssue), source: 'derived' },
        { label: '涉及域名', value: hosts.slice(0, 5).join('、'), source: 'derived' },
      ],
      actions: [
        { role: 'user', title: '验证 DNS 解析', detail: '使用 nslookup 对异常域名做当前网络解析验证', command: `nslookup ${hosts[0] || 'example.com'}` },
        { role: 'user', title: '切换 DNS 对比', detail: '切换公共 DNS 或手机热点后复现，确认是否为当前解析链路问题' },
        { role: 'it', title: '检查企业 DNS / PAC', detail: '核对企业 DNS、代理 PAC、VPN 是否接管或污染该域名解析' },
      ],
      limitations: [
        'HAR 与 NetLog 时间基准可能不同，当前优先使用 host/URL 证据对齐',
        `置信度依据：${buildAlignmentEvidence(slowWithDnsIssue)}`,
        ...(timeLimitation ? [timeLimitation] : []),
      ],
      relatedRequestIds: collectRequestIds(slowWithDnsIssue),
      relatedSourceIds: collectSourceIdsFromRequests(slowWithDnsIssue),
      navigationTarget: { tab: 'requests', requestIds: collectRequestIds(slowWithDnsIssue), keyword: hosts[0] },
      mergedSources: ['har', 'netlog'],
    });
  }

  // 2. HAR 慢 + NetLog 代理介入。代理本身是全局配置，但仍要求 HAR 出现代理敏感阶段变慢。
  const proxySensitiveSlow = slowAligned.filter(a =>
    netlogResult.proxyInfo.hasProxy &&
    (
      timingMs(a.harEntry, 'queueing') + timingMs(a.harEntry, 'stalled') + timingMs(a.harEntry, 'proxy') > HAR_DIAG_THRESHOLDS.blockedSlow ||
      timingMs(a.harEntry, 'tcp') > HAR_DIAG_THRESHOLDS.connectSlow ||
      timingMs(a.harEntry, 'ssl') > HAR_DIAG_THRESHOLDS.sslSlow ||
      timingMs(a.harEntry, 'wait') > HAR_DIAG_THRESHOLDS.ttfbSlow
    )
  );
  if (proxySensitiveSlow.length > 0 && netlogIndex.proxyEventCount > 0) {
    const hosts = uniqueHosts(proxySensitiveSlow);
    const hasHostProxyHint = hosts.some(host => netlogIndex.proxyHostHints.has(host));
    cards.push({
      id: 'combined-proxy-slow',
      source: 'combined',
      category: 'proxy',
      severity: 'warning',
      confidence: hasHostProxyHint ? 'high' : 'medium',
      title: '联合诊断：慢请求与代理介入存在关联',
      conclusion: `HAR 中 ${proxySensitiveSlow.length} 个慢请求集中在 blocked/connect/ssl/wait 阶段，NetLog 同时检测到代理配置，代理或 PAC 可能引入排队、建连或隧道延迟`,
      scope: {
        type: 'global',
        summary: '代理可能影响全局请求',
        affectedRequestCount: proxySensitiveSlow.length,
        affectedDomainCount: hosts.length,
      },
      evidence: [
        { label: 'HAR 代理敏感慢请求', value: `${proxySensitiveSlow.length} 个`, source: 'har', requestIds: collectRequestIds(proxySensitiveSlow) },
        { label: 'NetLog 代理事件', value: `${netlogIndex.proxyEventCount} 个`, source: 'netlog' },
        { label: '代理类型', value: netlogResult.proxyInfo.proxyType || '未知', source: 'netlog' },
        { label: '对齐方式', value: buildAlignmentEvidence(proxySensitiveSlow), source: 'derived' },
      ],
      actions: [
        { role: 'user', title: '绕过代理测试', detail: '临时关闭代理或切换网络，对比慢请求是否消失', command: "curl -v --noproxy '*' https://example.com" },
        { role: 'it', title: '检查 PAC / CONNECT 隧道', detail: '确认 PAC 命中规则、代理认证、CONNECT tunnel 和代理服务器负载是否正常' },
      ],
      limitations: [
        '代理是全局配置，NetLog 未必能把每个代理事件精确绑定到单个 HAR 请求',
        hasHostProxyHint ? 'NetLog 代理事件包含相关 host 线索' : '未在代理事件中发现明确 host 线索，因此按中置信度处理',
        ...(timeLimitation ? [timeLimitation] : []),
      ],
      relatedRequestIds: collectRequestIds(proxySensitiveSlow),
      relatedSourceIds: collectSourceIdsFromRequests(proxySensitiveSlow),
      navigationTarget: { tab: 'events', keyword: 'PROXY' },
      mergedSources: ['har', 'netlog'],
    });
  }

  // 3. HAR TLS 慢 + 同 host NetLog TLS/证书异常
  const slowWithTls = slowAligned.filter(a =>
    timingMs(a.harEntry, 'ssl') > HAR_DIAG_THRESHOLDS.sslSlow &&
    (a.hostIndex?.tlsIssues.length || 0) > 0
  );
  if (slowWithTls.length > 0) {
    const hosts = uniqueHosts(slowWithTls);
    const tlsIssues = slowWithTls.flatMap(a => a.hostIndex?.tlsIssues || []);
    cards.push({
      id: 'combined-tls-slow',
      source: 'combined',
      category: 'tls',
      severity: 'warning',
      confidence: confidenceFromAlignment(slowWithTls, tlsIssues.length > 0),
      title: '联合诊断：TLS 握手慢与同域名 SSL 异常吻合',
      conclusion: `HAR 中 ${slowWithTls.length} 个请求 TLS 阶段超过 ${HAR_DIAG_THRESHOLDS.sslSlow}ms，NetLog 在相同域名检测到 SSL/TLS 异常，建议排查证书链、中间设备或 HTTPS Inspection`,
      scope: {
        type: hosts.length > 1 ? 'multi-domain' : 'single-domain',
        summary: `TLS 握手影响 ${hosts.length} 个域名`,
        affectedRequestCount: slowWithTls.length,
        affectedDomainCount: hosts.length,
      },
      evidence: [
        { label: 'HAR TLS 慢请求', value: `${slowWithTls.length} 个`, source: 'har', requestIds: collectRequestIds(slowWithTls) },
        { label: 'NetLog SSL 问题', value: tlsIssues.slice(0, 5).map(i => `${i.host}: ${i.error}`).join('、'), source: 'netlog' },
        { label: '对齐方式', value: buildAlignmentEvidence(slowWithTls), source: 'derived' },
      ],
      actions: [
        { role: 'user', title: '检查证书链', detail: '查看浏览器证书详情，确认是否被企业网关或安全软件替换' },
        { role: 'it', title: '验证 TLS 握手', detail: '使用 openssl 检查目标域名证书链和协议协商', command: `openssl s_client -connect ${hosts[0] || 'example.com'}:443 -servername ${hosts[0] || 'example.com'}` },
      ],
      limitations: [
        'TLS 慢也可能来自服务端证书链或 OCSP/CRL 查询，不一定完全是客户端网络问题',
        ...(timeLimitation ? [timeLimitation] : []),
      ],
      relatedRequestIds: collectRequestIds(slowWithTls),
      relatedSourceIds: collectSourceIdsFromRequests(slowWithTls),
      navigationTarget: { tab: 'events', keyword: hosts[0] || 'SSL', errorOnly: true },
      mergedSources: ['har', 'netlog'],
    });
  }

  // 4. 反证/解释：HAR 慢但 NetLog 无同 host 错误，提醒可能偏服务端或采集不匹配。
  const slowWithoutNetlogCause = slowAligned.filter(a =>
    a.alignLevel !== 'none' &&
    timingMs(a.harEntry, 'wait') > HAR_DIAG_THRESHOLDS.ttfbSlow &&
    !(a.hostIndex?.failedDomains.length) &&
    !(a.hostIndex?.tlsIssues.length)
  );
  if (slowWithoutNetlogCause.length > 0) {
    const hosts = uniqueHosts(slowWithoutNetlogCause);
    cards.push({
      id: 'combined-server-or-quality',
      source: 'combined',
      category: 'server',
      severity: 'info',
      confidence: 'medium',
      title: '联合诊断：HAR TTFB 慢但 NetLog 未发现同域名网络错误',
      conclusion: `HAR 中 ${slowWithoutNetlogCause.length} 个请求主要慢在 TTFB，NetLog 未发现同域名 DNS/TLS/连接错误，更像服务端处理、回源、CDN 或采集时间不完全重合`,
      scope: {
        type: hosts.length > 1 ? 'multi-domain' : 'single-domain',
        summary: `影响 ${hosts.length} 个域名`,
        affectedRequestCount: slowWithoutNetlogCause.length,
        affectedDomainCount: hosts.length,
      },
      evidence: [
        { label: 'HAR TTFB 慢请求', value: `${slowWithoutNetlogCause.length} 个`, source: 'har', requestIds: collectRequestIds(slowWithoutNetlogCause) },
        { label: 'NetLog 同域名错误', value: '未发现 DNS/TLS/连接错误', source: 'netlog' },
        { label: '对齐方式', value: buildAlignmentEvidence(slowWithoutNetlogCause), source: 'derived' },
      ],
      actions: [
        { role: 'backend', title: '查询服务端耗时', detail: '结合 x-tt-logid / server-timing 查询网关、应用、数据库和下游依赖耗时' },
        { role: 'user', title: '补采同次复现日志', detail: '若怀疑采集不匹配，重新同时采集 HAR 与 NetLog 后复现' },
      ],
      limitations: [
        '这是反证型结论：不能证明服务端一定异常，只能说明当前 NetLog 未支持网络层根因',
        ...(timeLimitation ? [timeLimitation] : []),
      ],
      relatedRequestIds: collectRequestIds(slowWithoutNetlogCause),
      relatedSourceIds: collectSourceIdsFromRequests(slowWithoutNetlogCause),
      navigationTarget: { tab: 'requests', requestIds: collectRequestIds(slowWithoutNetlogCause), keyword: hosts[0] },
      mergedSources: ['har', 'netlog'],
    });
  }

  const withTimeRanges = dedupeCombinedCards(cards).map(card => {
    if (card.timeRange) return card;
    const requestIds = new Set(card.relatedRequestIds || []);
    const entries = harResult.entries.filter(entry => requestIds.has(entry.id) && Number.isFinite(entry.startMs));
    if (entries.length === 0) return card;
    return {
      ...card,
      timeRange: {
        startMs: Math.min(...entries.map(entry => entry.startMs)),
        endMs: Math.max(...entries.map(entry => entry.startMs + entry.time)),
        clock: 'epoch' as const,
      },
    };
  });
  return applyCombinedEvidenceFusion(withTimeRanges, harObservations, netlogObservations, correlations);
}

// ========== 联合采集质量 ==========

export function checkCombinedQuality(
  harResult: HarAnalysisResult,
  netlogResult: AnalysisResult
): CollectionQuality {
  const issues: CollectionQuality['issues'] = [];
  const recommendations: string[] = [];

  const timeContext = buildTimeAlignmentContext(harResult.entries, netlogResult.urlRequests, netlogResult.netlogClockContext);
  const aligned = alignHarWithNetlog(harResult, netlogResult, timeContext);
  const alignedCount = aligned.filter(a => a.alignLevel !== 'none').length;
  const strongAlignedCount = aligned.filter(a => a.alignLevel === 'exact-url' || a.alignLevel === 'same-path').length;
  const alignRate = harResult.totalRequests > 0 ? alignedCount / harResult.totalRequests : 0;
  const strongAlignRate = harResult.totalRequests > 0 ? strongAlignedCount / harResult.totalRequests : 0;

  if (alignRate < 0.3 && harResult.totalRequests > 5) {
    issues.push({
      type: 'suspicious_pattern',
      severity: 'warning',
      message: 'HAR 与 NetLog 对齐率低',
      detail: `仅 ${(alignRate * 100).toFixed(0)}% 的 HAR 请求能在 NetLog 中找到同 host 请求，联合诊断可靠性受限`,
    });
    recommendations.push('确保 HAR 和 NetLog 在同一浏览器会话、同一时间段内采集');
  }

  if (alignRate >= 0.3 && strongAlignRate < 0.1 && harResult.totalRequests > 20) {
    issues.push({
      type: 'suspicious_pattern',
      severity: 'info',
      message: '精确 URL 对齐较少',
      detail: `同 host 对齐率为 ${(alignRate * 100).toFixed(0)}%，但 URL/path 强对齐仅 ${(strongAlignRate * 100).toFixed(0)}%，结论会更多依赖 host 级证据`,
    });
    recommendations.push('联合诊断中优先采信同 host 且同 URL/path 的证据，host 级结论需人工复核');
  }

  if (netlogResult.totalEvents < 50 || harResult.totalRequests < 5) {
    issues.push({
      type: 'insufficient_data',
      severity: 'warning',
      message: '数据量不足以支撑联合诊断',
      detail: `HAR ${harResult.totalRequests} 个请求 / NetLog ${netlogResult.totalEvents} 个事件，数据过少`,
    });
  }

  return {
    source: 'combined',
    isDiagnosable: alignRate >= 0.2 && harResult.totalRequests >= 3 && netlogResult.totalEvents >= 20,
    issues,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
  };
}

// ========== 联合诊断汇总 ==========

export function buildCombinedDiagnosisSummary(
  harResult: HarAnalysisResult,
  netlogResult: AnalysisResult
): DiagnosisSummary {
  const cards = combinedDiagnosisToCards(harResult, netlogResult);
  const quality = checkCombinedQuality(harResult, netlogResult);

  const overallSeverity: DiagnosisSummary['overallSeverity'] =
    cards.some(c => c.severity === 'critical') ? 'critical' :
    cards.some(c => c.severity === 'warning') ? 'warning' : 'info';

  const highConfidenceCount = cards.filter(c => c.confidence === 'high').length;
  const combinedConfidence: DiagnosisSummary['combinedConfidence'] =
    !quality.isDiagnosable ? 'low' :
    highConfidenceCount > 0 ? 'high' :
    cards.some(c => c.confidence === 'medium') ? 'medium' : 'low';

  const fusionConflicts = Array.from(new Set([
    ...quality.issues
      .filter(issue => issue.severity === 'warning')
      .map(issue => issue.message),
    ...cards.flatMap(card => card.conflictNotes || []),
  ]));

  return { cards, quality, overallSeverity, combinedConfidence, fusionConflicts };
}
