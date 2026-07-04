import type { AnalysisResult } from '../../parsers/netlog/parser';
import type {
  AltSvcStateView,
  CacheStateView,
  DnsStateView,
  Http2StateView,
  ProxyStateView,
  QuicStateView,
  ReportingStateView,
  SocketsStateView,
  StreamPoolStateView,
} from '../../workers/netlogDatasetViews';
import { maskEvidenceValue } from './maskedExport';

export interface NetlogExpertEvidencePackageInput {
  result: AnalysisResult;
  analysisId?: string;
  datasetReady?: boolean;
  dnsState?: DnsStateView;
  proxyState?: ProxyStateView;
  quicState?: QuicStateView;
  http2State?: Http2StateView;
  socketsState?: SocketsStateView;
  cacheState?: CacheStateView;
  altSvcState?: AltSvcStateView;
  streamPoolState?: StreamPoolStateView;
  reportingState?: ReportingStateView;
  generatedAt?: Date;
}

const MAX_ROWS = 10;

export function buildNetlogExpertEvidencePackage(input: NetlogExpertEvidencePackageInput): string {
  const { result } = input;
  const lines: string[] = [];

  lines.push('# NetLog 专家证据包');
  lines.push(`> 生成时间：${(input.generatedAt || new Date()).toLocaleString()}`);
  lines.push(`> Dataset 状态：${input.datasetReady ? 'ready' : 'summary-only'}`);
  if (input.analysisId) {
    lines.push(`> analysisId：${safeText(input.analysisId)}`);
  }
  lines.push('');
  lines.push('本证据包用于协作排查：保留 eventId/sourceId、状态计数和脱敏后的关键值，避免直接导出原始 params。');
  lines.push('');

  addOverview(lines, result);
  addRequestEvidence(lines, result);
  addDnsSection(lines, input.dnsState);
  addProxySection(lines, input.proxyState);
  addSocketsSection(lines, input.socketsState);
  addHttp2Section(lines, input.http2State);
  addQuicSection(lines, input.quicState);
  addCacheSection(lines, input.cacheState);
  addAltSvcSection(lines, input.altSvcState);
  addStreamPoolSection(lines, input.streamPoolState);
  addReportingSection(lines, input.reportingState);

  lines.push('## 证据使用说明');
  lines.push('- `eventId` / `sourceId` 可回到 Raw Evidence 或 Events 中定位原始事件。');
  lines.push('- `summary-only` 表示 Dataset 索引尚未就绪，证据包只包含轻量解析摘要。');
  lines.push('- 本文件是证据索引，不等同于根因结论；根因仍需结合复现时间、网络拓扑和业务影响确认。');
  lines.push('');

  return lines.join('\n');
}

function addOverview(lines: string[], result: AnalysisResult) {
  lines.push('## 采集概览');
  addTable(lines, ['项目', '值'], [
    ['总事件', result.totalEvents],
    ['Source 数', result.uniqueSources],
    ['峰值并发', result.peakConcurrency],
    ['URL 请求', result.urlRequests.length],
    ['失败域名', result.failedDomains.length],
    ['慢请求', result.slowRequests.length],
    ['错误 / 警告', `${result.errors.length} / ${result.warnings.length}`],
    ['时间范围', `${result.timeRange.start} - ${result.timeRange.end}`],
    ['浏览器', result.systemInfo.browser || '-'],
    ['操作系统', result.systemInfo.os || '-'],
    ['NetLog 版本', result.systemInfo.netLogVersion || '-'],
  ]);
  lines.push('');
}

function addRequestEvidence(lines: string[], result: AnalysisResult) {
  lines.push('## 失败和慢请求摘要');
  lines.push('### 失败域名 Top');
  addTable(lines, ['域名', '次数', '错误码', 'IP', '样例 URL'], result.failedDomains.slice(0, MAX_ROWS).map(domain => [
    domain.domain,
    domain.count,
    domain.errorCodes.join(', ') || '-',
    domain.ips.slice(0, 5).join(', ') || '-',
    domain.urls[0] || '-',
  ]));
  lines.push('');

  lines.push('### 请求证据 Top');
  const requests = result.urlRequests
    .filter(req => req.error !== undefined || (req.duration || 0) >= 3000)
    .sort((a, b) => {
      if ((a.error !== undefined) !== (b.error !== undefined)) return a.error !== undefined ? -1 : 1;
      return (b.duration || 0) - (a.duration || 0);
    })
    .slice(0, MAX_ROWS);
  addTable(lines, ['sourceId', '方法', '状态/错误', '耗时(ms)', '协议', 'URL'], requests.map(req => [
    req.id,
    req.method,
    req.error !== undefined ? `ERR ${req.error}` : (req.statusCode || req.status || '-'),
    req.duration ?? '-',
    req.protocol || '-',
    req.url,
  ]));
  lines.push('');
}

function addDnsSection(lines: string[], state?: DnsStateView) {
  lines.push('## DNS State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['配置 DNS', state.configServers.length],
    ['Host Resolver Cache', state.hostResolverCache.length],
    ['解析任务结果', state.taskResults.length],
    ['DNS 错误', state.dnsErrors.length],
    ['DoH 候选', state.dohCandidates.length],
    ['IPv6 检查', state.ipv6ReachabilityChecks.length],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  lines.push('### DNS 错误样例');
  addTable(lines, ['eventId', 'sourceId', 'host', 'queryType', 'error'], state.dnsErrors.slice(0, MAX_ROWS).map(item => [
    item.eventId ?? '-',
    item.sourceId ?? '-',
    item.host,
    item.queryType || '-',
    item.error,
  ]));
  lines.push('');
}

function addProxySection(lines: string[], state?: ProxyStateView) {
  lines.push('## Proxy State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['发现代理证据', state.hasProxyEvidence ? '是' : '否'],
    ['代理配置', state.proxyConfigs.length],
    ['代理事件', state.proxyEvents.length],
    ['请求级错误', state.requestScopedErrors.length],
    ['决策链', state.resolutionChains.length],
    ['代理服务器', state.proxyServers.join(', ') || '-'],
    ['PAC URL', state.pacUrls.join(', ') || '-'],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  addImpactTable(lines, state.impactSummaries);
}

function addSocketsSection(lines: string[], state?: SocketsStateView) {
  lines.push('## Sockets State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['Socket 数', state.sockets.length],
    ['事件数', state.eventCount],
    ['Connect', state.connectCount],
    ['TLS', state.tlsCount],
    ['Stall', state.stallCount],
    ['SocketPool', state.socketPoolCount],
    ['错误', state.errors.length],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  lines.push('### Socket 错误样例');
  addTable(lines, ['eventId', 'sourceId', 'type', 'peerAddress', 'error'], state.errors.slice(0, MAX_ROWS).map(item => [
    item.eventId,
    item.sourceId,
    item.typeName,
    item.peerAddress || '-',
    item.error ?? '-',
  ]));
  lines.push('');
}

function addHttp2Section(lines: string[], state?: Http2StateView) {
  lines.push('## HTTP/2 State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['Session', state.sessions.length],
    ['Stream', state.streams.length],
    ['事件数', state.eventCount],
    ['GOAWAY', state.goawayCount],
    ['RST_STREAM', state.rstStreamCount],
    ['Window Update', state.windowUpdateCount],
    ['未关联 Stream', state.unlinkedStreamCount],
    ['请求级候选', state.requestScopedCandidateCount],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  addImpactTable(lines, state.impactSummaries);
}

function addQuicSection(lines: string[], state?: QuicStateView) {
  lines.push('## QUIC State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['Session', state.sessions.length],
    ['QUIC 事件', state.quicEventCount],
    ['HTTP/3 事件', state.http3EventCount],
    ['状态事件', state.stateEvents.length],
    ['错误', state.errors.length],
    ['请求级候选', state.requestScopedCandidateCount],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  addImpactTable(lines, state.impactSummaries);
}

function addCacheSection(lines: string[], state?: CacheStateView) {
  lines.push('## Cache State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['Entry', state.entries.length],
    ['事件数', state.eventCount],
    ['Open / Create', `${state.openCount} / ${state.createCount}`],
    ['Read / Write', `${state.readCount} / ${state.writeCount}`],
    ['Doom', state.doomCount],
    ['Bypass', state.bypassCount],
    ['Validation', state.validationCount],
    ['错误', state.errorCount],
    ['请求级候选', state.requestScopedCandidateCount],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  addImpactTable(lines, state.impactSummaries);
}

function addAltSvcSection(lines: string[], state?: AltSvcStateView) {
  lines.push('## Alt-Svc State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['Alternative', state.alternatives.length],
    ['事件数', state.eventCount],
    ['Found / Used', `${state.foundCount} / ${state.usedCount}`],
    ['Broken', state.brokenCount],
    ['Cleared', state.clearedCount],
    ['请求级候选', state.requestScopedCandidateCount],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  lines.push('### Alternative 样例');
  addTable(lines, ['key', 'host/origin', 'protocol', 'alternative', 'broken', 'eventId'], state.alternatives.slice(0, MAX_ROWS).map(item => [
    item.key,
    item.host || item.origin || '-',
    item.protocol || '-',
    item.alternativeService || '-',
    item.brokenCount,
    item.firstEventId ?? '-',
  ]));
  lines.push('');
  addImpactTable(lines, state.impactSummaries);
}

function addStreamPoolSection(lines: string[], state?: StreamPoolStateView) {
  lines.push('## StreamPool State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['Job', state.jobs.length],
    ['事件数', state.eventCount],
    ['Waiting', state.waitCount],
    ['Stalled', state.stalledCount],
    ['Reused / Bound socket', `${state.reusedSocketCount} / ${state.boundSocketCount}`],
    ['Connect Job', state.connectJobCount],
    ['错误', state.errorCount],
    ['请求级候选', state.requestScopedCandidateCount],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  addImpactTable(lines, state.impactSummaries);
}

function addReportingSection(lines: string[], state?: ReportingStateView) {
  lines.push('## Reporting/NEL State');
  if (!state) return addMissingState(lines);
  addTable(lines, ['项目', '值'], [
    ['Endpoint', state.endpointCount],
    ['事件数', state.eventCount],
    ['Queued', state.queuedCount],
    ['Uploaded / Succeeded', `${state.uploadCount} / ${state.successCount}`],
    ['Failure', state.failureCount],
    ['Cache', state.cacheCount],
    ['请求级候选', state.requestScopedCandidateCount],
    ['证据缺口', state.evidenceGaps.join('; ') || '-'],
  ]);
  lines.push('');
  lines.push('### Reporting Endpoint 样例');
  addTable(lines, ['key', 'origin', 'group', 'endpoint', 'upload', 'failure', 'eventId'], state.endpoints.slice(0, MAX_ROWS).map(item => [
    item.key,
    item.origin || '-',
    item.group || '-',
    item.url || '-',
    item.uploadCount,
    item.failureCount,
    item.firstEventId ?? '-',
  ]));
  lines.push('');
  addImpactTable(lines, state.impactSummaries);
}

function addImpactTable(
  lines: string[],
  impacts: Array<{
    kind: string;
    summary: string;
    eventId?: number;
    sourceId?: number;
    sessionSourceId?: number;
    streamSourceId?: number;
    requestScoped?: boolean;
    error?: number | string;
  }>
) {
  lines.push('### 影响摘要 Top');
  addTable(lines, ['eventId', 'sourceId', 'kind', 'requestScoped', 'error', 'summary'], impacts.slice(0, MAX_ROWS).map(item => [
    item.eventId ?? '-',
    item.sourceId ?? item.sessionSourceId ?? item.streamSourceId ?? '-',
    item.kind,
    item.requestScoped === undefined ? '-' : (item.requestScoped ? '是' : '否'),
    item.error ?? '-',
    item.summary,
  ]));
  lines.push('');
}

function addMissingState(lines: string[]) {
  lines.push('- Dataset 状态视图未就绪，当前证据包未包含该部分。');
  lines.push('');
}

function addTable(lines: string[], headers: string[], rows: Array<Array<unknown>>) {
  if (rows.length === 0) {
    lines.push('- 无');
    return;
  }

  lines.push(`| ${headers.map(markdownCell).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(markdownCell).join(' | ')} |`);
  }
}

function markdownCell(value: unknown): string {
  return safeText(value)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function safeText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return maskExportText(value.map(item => String(item)).join(', '));
  return maskExportText(String(value));
}

function maskExportText(value: string): string {
  const withMaskedUrls = value.replace(/https?:\/\/[^\s|)]+/g, url => maskEvidenceValue(url));
  return maskEvidenceValue(withMaskedUrls);
}
