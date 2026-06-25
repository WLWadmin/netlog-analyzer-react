/**
 * HAR 汇总诊断计算层
 *
 * 从 HarAnalysisResult 计算出完整的诊断数据，供 HarSummaryDiagnosis 展示。
 * 纯函数，无副作用。
 * 性能优化：所有基础统计合并为单次遍历，避免多次 .filter() 全量扫描。
 */

import type {
  HarAnalysisResult,
  HarTiming,
  HarCategory,
} from './harParser';
import { formatHarTime } from './harParser';
import { HAR_DIAG_THRESHOLDS } from './diagnosis/shared/harThresholds';

// 兼容既有代码变量名，实际阈值统一收口到 HAR_DIAG_THRESHOLDS。
const THRESHOLDS = HAR_DIAG_THRESHOLDS;

// ========== 类型定义 ==========

export type DiagnosisStatus = 'healthy' | 'warning' | 'critical';

export interface NetworkPhaseStatus {
  label: string;
  status: DiagnosisStatus;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
  slowCount: number;
  slowDomains: string[];
  detail: string;
}

export interface HttpStatusBreakdown {
  total: number;
  count2xx: number;
  count3xx: number;
  count4xx: number;
  count5xx: number;
  count0: number;
  countFailed: number;
}

export interface SlowRequestBreakdown {
  dnsSlow: number;
  connectSlow: number;
  sslSlow: number;
  ttfbSlow: number;
  receiveSlow: number;
  blockedSlow: number;
  totalSlow: number;
}

export interface DomainStats {
  domain: string;
  count: number;
  failedCount: number;
  avgTime: number;
  totalSize: number;
  ips: string[];
}

export interface IpStats {
  ip: string;
  count: number;
  failedCount: number;
  avgTime: number;
  domains: string[];
  type: 'public' | 'private' | 'loopback' | 'ipv6' | 'unknown';
}

export interface ResourceStats {
  category: HarCategory;
  count: number;
  totalSize: number;
  avgTime: number;
  failedCount: number;
}

export interface CacheStats {
  cachedCount: number;
  uncachedCount: number;
  cacheRate: number;
}

export interface CompressionStats {
  compressedCount: number;
  uncompressedCount: number;
  compressionRate: number;
  savingsPotential: number; // 可节省字节数
}

export interface SecurityStats {
  httpsCount: number;
  httpCount: number;
  h2Count: number;
  h3Count: number;
  h11Count: number;
  mixedContentCount: number;
  missingSecurityHeaders: string[];
}

export interface AttributionItem {
  type: 'client' | 'network' | 'server' | 'cdn' | 'dns';
  severity: DiagnosisStatus;
  title: string;
  description: string;
  evidence: string[];
  priority: number; // 0=P0, 1=P1, 2=P2
}

export interface TopRequest {
  id: number;
  name: string;
  url: string;
  domain: string;
  status: number;
  time: number;
  size: number;
  category: HarCategory;
}

export interface HarDiagnosisResult {
  // 1. 诊断结论
  overallStatus: DiagnosisStatus;
  healthScore: number;
  summary: string;
  findings: string[];

  // 2. 关键指标
  totalRequests: number;
  failedCount: number;
  slowCount: number;
  totalSize: number;
  totalTime: number;
  avgTtfb: number;
  p95Ttfb: number;
  domainCount: number;
  ipCount: number;

  // 3. 网络状态
  networkStatus: NetworkPhaseStatus[];

  // 4. 请求异常
  httpStatus: HttpStatusBreakdown;
  slowBreakdown: SlowRequestBreakdown;
  failedRequests: TopRequest[];
  slowRequests: TopRequest[];

  // 5. 域名/IP
  domainStats: DomainStats[];
  ipStats: IpStats[];
  duplicateRequests: { url: string; count: number; totalWasted: number }[];

  // 6. 资源分析
  resourceStats: ResourceStats[];
  largestResources: TopRequest[];

  // 7. 缓存与压缩
  cacheStats: CacheStats;
  compressionStats: CompressionStats;
  uncompressedLargeResources: TopRequest[];

  // 8. 安全与协议
  securityStats: SecurityStats;

  // 9. 问题归因
  attributions: AttributionItem[];

  // 10. 修复建议
  suggestions: { priority: number; title: string; detail: string }[];
}

// ========== 工具函数 ==========

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((sorted.length - 1) * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function isPrivateIP(ip: string): boolean {
  if (!ip || ip === '-') return false;
  // IPv4 私有地址
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  // 本地回环
  if (/^127\./.test(ip) || ip === 'localhost') return true;
  return false;
}

function isLoopbackIP(ip: string): boolean {
  if (!ip || ip === '-') return false;
  return /^127\./.test(ip) || ip === 'localhost';
}

/** 从 remoteAddress 中提取纯 IP（去除端口），正确处理 IPv4:port 和 [IPv6]:port */
function extractHostFromAddress(remoteAddress: string): string {
  if (!remoteAddress || remoteAddress === '-') return '-';
  // IPv6 with brackets: [::1]:443 -> ::1
  if (remoteAddress.startsWith('[')) {
    const bracketEnd = remoteAddress.indexOf(']');
    if (bracketEnd > 0) {
      return remoteAddress.slice(1, bracketEnd);
    }
  }
  // IPv4 with port: 192.168.1.1:8080 -> 192.168.1.1
  const lastColon = remoteAddress.lastIndexOf(':');
  if (lastColon > 0) {
    const beforeColon = remoteAddress.slice(0, lastColon);
    // 确保冒号前不是 IPv6（IPv6 含多个冒号，且前面已处理 bracket 情况）
    if (!beforeColon.includes(':')) {
      return beforeColon;
    }
  }
  return remoteAddress;
}

function isIPv6Address(ip: string): boolean {
  if (!ip || ip === '-') return false;
  // 排除 IPv4:port 的情况（IPv4 不含 :: 且最多一个冒号）
  if (ip.includes('::')) return true;
  // 统计冒号数量，IPv6 通常有多个
  const colonCount = (ip.match(/:/g) || []).length;
  return colonCount > 1;
}

function classifyIP(ip: string): IpStats['type'] {
  if (!ip || ip === '-') return 'unknown';
  if (isLoopbackIP(ip)) return 'loopback';
  if (isIPv6Address(ip)) return 'ipv6';
  if (isPrivateIP(ip)) return 'private';
  return 'public';
}

function getPhaseStatus(avg: number, max: number, p95: number, slowCount: number, total: number, threshold: number, label: string): NetworkPhaseStatus {
  const slowRate = total > 0 ? slowCount / total : 0;
  let status: DiagnosisStatus = 'healthy';
  let detail = `${label}正常`;

  if (p95 > threshold * 3 || max > threshold * 8 || slowRate > 0.2) {
    status = 'critical';
    detail = `${label}严重偏高`;
  } else if (p95 > threshold || max > threshold * 4 || slowRate > 0.05 || slowCount > 3) {
    status = 'warning';
    detail = `${label}偏高`;
  }

  return { label, status, avgMs: Math.round(avg), maxMs: Math.round(max), p95Ms: Math.round(p95), slowCount, slowDomains: [], detail };
}

// ========== 主计算函数 ==========

export function diagnoseHar(result: HarAnalysisResult): HarDiagnosisResult {
  const entries = result.entries;
  const total = entries.length;
  const hasHttpsDocument = entries.some(e => e.category === 'doc' && e.url.startsWith('https:'));

  // ---- 单次遍历：收集所有基础统计 ----
  const dnsArr: number[] = [];
  const connectArr: number[] = [];
  const sslArr: number[] = [];
  const waitArr: number[] = [];
  const receiveArr: number[] = [];

  let dnsSlow = 0;
  let connectSlow = 0;
  let sslSlow = 0;
  let ttfbSlow = 0;
  let receiveSlow = 0;
  let blockedSlow = 0;

  let count2xx = 0;
  let count3xx = 0;
  let count4xx = 0;
  let count5xx = 0;
  let count0 = 0;

  let httpsCount = 0;
  let h2Count = 0;
  let h3Count = 0;
  let h11Count = 0;
  let mixedContentCount = 0;
  let cachedCount = 0;
  let compressedCount = 0;

  // domain/ip 统计（O(N) 单次遍历 + Map 累加）
  const domainMap = new Map<string, DomainStats & { _totalTime: number }>();
  const ipMap = new Map<string, IpStats & { _totalTime: number }>();
  const urlMap = new Map<string, { count: number; totalWasted: number }>();
  const catStatsMap = new Map<HarCategory, { count: number; totalSize: number; totalTime: number; failedCount: number }>();

  for (const e of entries) {
    // timings
    const t = e.timings;
    if (t.dns > 0) dnsArr.push(t.dns);
    if (t.connect > 0) connectArr.push(t.connect);
    if (t.ssl > 0) sslArr.push(t.ssl);
    if (t.wait > 0) waitArr.push(t.wait);
    if (t.receive > 0) receiveArr.push(t.receive);

    if (t.dns > THRESHOLDS.dnsSlow) dnsSlow++;
    if (t.connect > THRESHOLDS.connectSlow) connectSlow++;
    if (t.ssl > THRESHOLDS.sslSlow) sslSlow++;
    if (t.wait > THRESHOLDS.ttfbSlow) ttfbSlow++;
    if (t.receive > THRESHOLDS.receiveSlow) receiveSlow++;
    if (t.blocked > THRESHOLDS.blockedSlow) blockedSlow++;

    // HTTP status
    if (e.status >= 200 && e.status < 300) count2xx++;
    else if (e.status >= 300 && e.status < 400) count3xx++;
    else if (e.status >= 400 && e.status < 500) count4xx++;
    else if (e.status >= 500) count5xx++;
    else if (e.status === 0) count0++;

    // security
    if (e.url.startsWith('https:')) httpsCount++;
    if (e.protocol === 'h2') h2Count++;
    if (e.protocol === 'h3') h3Count++;
    if (e.protocol === 'http/1.1') h11Count++;
    if (hasHttpsDocument && e.url.startsWith('http:') && !e.url.startsWith('http://localhost')) mixedContentCount++;

    // cache
    const cc = e.responseHeaders.find(h => h.name.toLowerCase() === 'cache-control')?.value || '';
    if (cc.includes('max-age') || cc.includes('immutable') || e.status === 304) cachedCount++;

    // compression
    const ce = e.responseHeaders.find(h => h.name.toLowerCase() === 'content-encoding')?.value || '';
    if (ce.includes('gzip') || ce.includes('br') || ce.includes('deflate')) compressedCount++;

    // domain stats (累加 totalTime，避免后续 O(N²) 回查)
    const d = domainMap.get(e.domain) || { domain: e.domain, count: 0, failedCount: 0, avgTime: 0, totalSize: 0, ips: [], _totalTime: 0 };
    d.count++;
    if (e.isFailed) d.failedCount++;
    d.totalSize += e.size;
    d._totalTime += e.time;
    if (e.remoteAddress && e.remoteAddress !== '-' && !d.ips.includes(e.remoteAddress)) {
      d.ips.push(e.remoteAddress);
    }
    domainMap.set(e.domain, d);

    // ip stats
    if (e.remoteAddress && e.remoteAddress !== '-') {
      const ip = extractHostFromAddress(e.remoteAddress);
      if (ip !== '-') {
        const i = ipMap.get(ip) || { ip, count: 0, failedCount: 0, avgTime: 0, domains: [], type: classifyIP(ip), _totalTime: 0 };
        i.count++;
        if (e.isFailed) i.failedCount++;
        i._totalTime += e.time;
        if (!i.domains.includes(e.domain)) i.domains.push(e.domain);
        ipMap.set(ip, i);
      }
    }

    // duplicate requests
    const urlKey = `${e.method} ${e.url}`;
    const u = urlMap.get(urlKey) || { count: 0, totalWasted: 0 };
    u.count++;
    if (u.count > 1) u.totalWasted += e.size;
    urlMap.set(urlKey, u);

    // category stats
    const cat = e.category;
    const cs = catStatsMap.get(cat) || { count: 0, totalSize: 0, totalTime: 0, failedCount: 0 };
    cs.count++;
    cs.totalSize += e.size;
    cs.totalTime += e.time;
    if (e.isFailed) cs.failedCount++;
    catStatsMap.set(cat, cs);
  }

  // ---- 排序 timings 用于 percentile ----
  dnsArr.sort((a, b) => a - b);
  connectArr.sort((a, b) => a - b);
  sslArr.sort((a, b) => a - b);
  waitArr.sort((a, b) => a - b);
  receiveArr.sort((a, b) => a - b);

  const avgDns = avg(dnsArr);
  const avgConnect = avg(connectArr);
  const avgSsl = avg(sslArr);
  const avgWait = avg(waitArr);
  const avgReceive = avg(receiveArr);

  const p95Dns = percentile(dnsArr, 0.95);
  const p95Connect = percentile(connectArr, 0.95);
  const p95Ssl = percentile(sslArr, 0.95);
  const p95Wait = percentile(waitArr, 0.95);
  const p95Receive = percentile(receiveArr, 0.95);

  // ---- 网络状态 ----
  const networkStatus: NetworkPhaseStatus[] = [
    getPhaseStatus(avgDns, dnsArr[dnsArr.length - 1] || 0, p95Dns, dnsSlow, total, THRESHOLDS.dnsSlow, 'DNS'),
    getPhaseStatus(avgConnect, connectArr[connectArr.length - 1] || 0, p95Connect, connectSlow, total, THRESHOLDS.connectSlow, 'TCP'),
    getPhaseStatus(avgSsl, sslArr[sslArr.length - 1] || 0, p95Ssl, sslSlow, total, THRESHOLDS.sslSlow, 'TLS'),
    getPhaseStatus(avgWait, waitArr[waitArr.length - 1] || 0, p95Wait, ttfbSlow, total, THRESHOLDS.ttfbSlow, 'TTFB'),
    getPhaseStatus(avgReceive, receiveArr[receiveArr.length - 1] || 0, p95Receive, receiveSlow, total, THRESHOLDS.receiveSlow, '下载'),
  ];

  // 填充慢域名
  for (const ns of networkStatus) {
    const key = ns.label === 'DNS' ? 'dns' : ns.label === 'TCP' ? 'connect' : ns.label === 'TLS' ? 'ssl' : ns.label === 'TTFB' ? 'wait' : 'receive';
    const threshold = ns.label === 'DNS' ? THRESHOLDS.dnsSlow : ns.label === 'TCP' ? THRESHOLDS.connectSlow : ns.label === 'TLS' ? THRESHOLDS.sslSlow : ns.label === 'TTFB' ? THRESHOLDS.ttfbSlow : THRESHOLDS.receiveSlow;
    const slowMap = new Map<string, number>();
    for (const e of entries) {
      const val = e.timings[key as keyof HarTiming] as number;
      if (val > threshold) {
        slowMap.set(e.domain, (slowMap.get(e.domain) || 0) + 1);
      }
    }
    ns.slowDomains = Array.from(slowMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([d]) => d);
  }

  // ---- HTTP 状态统计 ----
  const httpStatus: HttpStatusBreakdown = {
    total,
    count2xx,
    count3xx,
    count4xx,
    count5xx,
    count0,
    countFailed: result.failedCount,
  };

  // ---- 慢请求分类 ----
  const slowBreakdown: SlowRequestBreakdown = {
    dnsSlow,
    connectSlow,
    sslSlow,
    ttfbSlow,
    receiveSlow,
    blockedSlow,
    totalSlow: result.slowCount,
  };

  // ---- 失败/慢请求 Top ----
  const failedRequests: TopRequest[] = entries
    .filter(e => e.isFailed)
    .sort((a, b) => b.time - a.time)
    .slice(0, 10)
    .map(e => ({ id: e.id, name: e.name, url: e.url, domain: e.domain, status: e.status, time: e.time, size: e.size, category: e.category }));

  const slowRequests: TopRequest[] = entries
    .filter(e => e.isSlow)
    .sort((a, b) => b.time - a.time)
    .slice(0, 10)
    .map(e => ({ id: e.id, name: e.name, url: e.url, domain: e.domain, status: e.status, time: e.time, size: e.size, category: e.category }));

  // ---- 域名统计（O(N) 计算 avgTime） ----
  const domainStats: DomainStats[] = [];
  for (const d of domainMap.values()) {
    domainStats.push({
      domain: d.domain,
      count: d.count,
      failedCount: d.failedCount,
      avgTime: Math.round(d._totalTime / d.count),
      totalSize: d.totalSize,
      ips: d.ips,
    });
  }
  domainStats.sort((a, b) => b.count - a.count);

  // ---- IP 统计（O(N) 计算 avgTime） ----
  const ipStats: IpStats[] = [];
  for (const i of ipMap.values()) {
    ipStats.push({
      ip: i.ip,
      count: i.count,
      failedCount: i.failedCount,
      avgTime: Math.round(i._totalTime / i.count),
      domains: i.domains,
      type: i.type,
    });
  }
  ipStats.sort((a, b) => b.count - a.count);

  // ---- 重复请求检测 ----
  const duplicateRequests = Array.from(urlMap.entries())
    .filter(([, v]) => v.count > 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([url, v]) => ({ url, count: v.count, totalWasted: v.totalWasted }));

  // ---- 资源类型统计（O(1) 从 catStatsMap 取） ----
  const resourceStats: ResourceStats[] = (Object.keys(result.typeCounts) as HarCategory[])
    .map(cat => {
      const cs = catStatsMap.get(cat);
      return {
        category: cat,
        count: result.typeCounts[cat],
        totalSize: cs ? cs.totalSize : 0,
        avgTime: cs && cs.count > 0 ? Math.round(cs.totalTime / cs.count) : 0,
        failedCount: cs ? cs.failedCount : 0,
      };
    })
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count);

  // ---- 最大资源 Top ----
  const largestResources: TopRequest[] = entries
    .filter(e => e.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map(e => ({ id: e.id, name: e.name, url: e.url, domain: e.domain, status: e.status, time: e.time, size: e.size, category: e.category }));

  // ---- 缓存统计 ----
  const cacheStats: CacheStats = {
    cachedCount,
    uncachedCount: total - cachedCount,
    cacheRate: total > 0 ? Math.round((cachedCount / total) * 100) : 0,
  };

  // ---- 压缩统计 ----
  const compressionStats: CompressionStats = {
    compressedCount,
    uncompressedCount: total - compressedCount,
    compressionRate: total > 0 ? Math.round((compressedCount / total) * 100) : 0,
    savingsPotential: 0, // 简化处理
  };

  // ---- 未压缩大资源 ----
  const uncompressedLargeResources: TopRequest[] = entries
    .filter(e => {
      const ce = e.responseHeaders.find(h => h.name.toLowerCase() === 'content-encoding')?.value || '';
      return e.size > THRESHOLDS.largeResource && !ce.includes('gzip') && !ce.includes('br') && !ce.includes('deflate');
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map(e => ({ id: e.id, name: e.name, url: e.url, domain: e.domain, status: e.status, time: e.time, size: e.size, category: e.category }));

  // ---- 安全与协议统计 ----
  const missingSecurityHeaders: string[] = [];
  const securityHeaderTarget = entries.find(e =>
    e.category === 'doc' && e.url.startsWith('https:') && e.status >= 200 && e.status < 400
  ) || entries.find(e =>
    e.url.startsWith('https:') && e.status >= 200 && e.status < 400
  );
  if (securityHeaderTarget) {
    const respHeaders = securityHeaderTarget.responseHeaders.map(h => h.name.toLowerCase());
    const required = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options'];
    for (const h of required) {
      if (!respHeaders.includes(h)) missingSecurityHeaders.push(h);
    }
  }

  const securityStats: SecurityStats = {
    httpsCount,
    httpCount: total - httpsCount,
    h2Count,
    h3Count,
    h11Count,
    mixedContentCount,
    missingSecurityHeaders,
  };

  // ---- 健康评分 ----
  let healthScore = 100;
  const failRate = total > 0 ? httpStatus.countFailed / total : 0;
  const slowRate = total > 0 ? result.slowCount / total : 0;

  if (failRate > 0.1) healthScore -= 35;
  else if (failRate > 0.03) healthScore -= 20;
  else if (failRate > 0) healthScore -= Math.min(10, httpStatus.countFailed * 2);

  if (slowRate > 0.3) healthScore -= 30;
  else if (slowRate > 0.1) healthScore -= 20;
  else if (slowRate > 0.03) healthScore -= 10;

  const criticalPhaseCount = networkStatus.filter(n => n.status === 'critical').length;
  const warningPhaseCount = networkStatus.filter(n => n.status === 'warning').length;
  healthScore -= criticalPhaseCount * 10;
  healthScore -= warningPhaseCount * 5;

  if (duplicateRequests.length > 0) healthScore -= 5;
  if (uncompressedLargeResources.length > 0) healthScore -= 5;
  healthScore = Math.max(0, healthScore);

  let overallStatus: DiagnosisStatus = 'healthy';
  if (healthScore < 60) overallStatus = 'critical';
  else if (healthScore < 85) overallStatus = 'warning';

  // ---- 核心发现 ----
  const findings: string[] = [];
  if (httpStatus.countFailed > 0) findings.push(`存在 ${httpStatus.countFailed} 个异常请求，其中 ${httpStatus.count5xx} 个为 5xx 服务端错误`);
  if (result.slowCount > 0) findings.push(`存在 ${result.slowCount} 个慢请求，P95 TTFB 为 ${formatHarTime(p95Wait)}`);
  if (networkStatus.some(n => n.status === 'critical')) {
    const critical = networkStatus.filter(n => n.status === 'critical').map(n => n.label).join('、');
    findings.push(`${critical} 阶段严重偏高`);
  }
  if (duplicateRequests.length > 0) findings.push(`检测到 ${duplicateRequests.length} 个 URL 被重复请求`);
  if (ipStats.some(i => i.type === 'private')) findings.push(`检测到内网 IP 请求，可能位于企业内网环境`);
  if (uncompressedLargeResources.length > 0) findings.push(`检测到 ${uncompressedLargeResources.length} 个大资源未启用压缩`);
  if (findings.length === 0) findings.push('网络状态良好，未发现明显异常');

  const summary = findings[0] || '网络状态良好';

  // ---- 问题归因 ----
  const attributions: AttributionItem[] = [];

  // 服务端问题
  if (ttfbSlow > 3 || httpStatus.count5xx > 0) {
    attributions.push({
      type: 'server',
      severity: httpStatus.count5xx > 0 ? 'critical' : 'warning',
      title: '疑似服务端响应慢',
      description: `TTFB 偏慢请求 ${ttfbSlow} 个，5xx 错误 ${httpStatus.count5xx} 个`,
      evidence: entries.filter(e => e.timings.wait > THRESHOLDS.ttfbSlow).slice(0, 3).map(e => `${e.domain}${e.name} - ${formatHarTime(e.timings.wait)}`),
      priority: 0,
    });
  }

  // 网络问题
  if (dnsSlow > 3 || connectSlow > 3) {
    attributions.push({
      type: 'network',
      severity: 'warning',
      title: '疑似用户网络质量较差',
      description: `DNS 偏慢 ${dnsSlow} 个，TCP 建连偏慢 ${connectSlow} 个`,
      evidence: entries.filter(e => e.timings.dns > THRESHOLDS.dnsSlow).slice(0, 3).map(e => `${e.domain} - DNS ${formatHarTime(e.timings.dns)}`),
      priority: 1,
    });
  }

  // CDN 问题
  const cdnIssues = domainStats.filter(d => d.ips.length > 1 && d.failedCount > 0);
  if (cdnIssues.length > 0) {
    attributions.push({
      type: 'cdn',
      severity: 'warning',
      title: '疑似 CDN 节点异常',
      description: `${cdnIssues.length} 个域名命中多个 IP 且存在失败请求`,
      evidence: cdnIssues.slice(0, 3).map(d => `${d.domain} - ${d.ips.length} 个 IP，${d.failedCount} 个失败`),
      priority: 1,
    });
  }

  // 客户端问题
  if (blockedSlow > 5) {
    attributions.push({
      type: 'client',
      severity: 'warning',
      title: '疑似浏览器侧排队问题',
      description: `${blockedSlow} 个请求 blocked 时间超过 ${THRESHOLDS.blockedSlow}ms`,
      evidence: entries.filter(e => e.timings.blocked > THRESHOLDS.blockedSlow).slice(0, 3).map(e => `${e.domain}${e.name} - blocked ${formatHarTime(e.timings.blocked)}`),
      priority: 1,
    });
  }

  // DNS 问题
  if (dnsSlow > 5) {
    attributions.push({
      type: 'dns',
      severity: 'warning',
      title: '疑似 DNS 解析异常',
      description: `${dnsSlow} 个请求 DNS 耗时超过 ${THRESHOLDS.dnsSlow}ms`,
      evidence: entries.filter(e => e.timings.dns > THRESHOLDS.dnsSlow).slice(0, 3).map(e => `${e.domain} - DNS ${formatHarTime(e.timings.dns)}`),
      priority: 1,
    });
  }

  // ---- 修复建议 ----
  const suggestions: { priority: number; title: string; detail: string }[] = [];
  if (httpStatus.count5xx > 0) {
    suggestions.push({ priority: 0, title: '优先排查 5xx 服务端错误', detail: `检测到 ${httpStatus.count5xx} 个 5xx 错误，建议检查服务端日志和接口稳定性` });
  }
  if (ttfbSlow > 5) {
    suggestions.push({ priority: 0, title: '优化服务端响应时间', detail: `${ttfbSlow} 个请求 TTFB 超过 ${THRESHOLDS.ttfbSlow}ms，建议优化数据库查询、缓存策略或接口逻辑` });
  }
  if (cdnIssues.length > 0) {
    suggestions.push({ priority: 1, title: '检查 CDN 节点健康度', detail: `${cdnIssues.length} 个域名命中多个 IP 且存在失败，建议排查 CDN 节点状态` });
  }
  if (duplicateRequests.length > 0) {
    suggestions.push({ priority: 1, title: '消除重复请求', detail: `检测到 ${duplicateRequests.length} 个 URL 被重复请求，建议检查前端缓存策略` });
  }
  if (uncompressedLargeResources.length > 0) {
    suggestions.push({ priority: 2, title: '启用响应压缩', detail: `${uncompressedLargeResources.length} 个大资源未启用 gzip/br 压缩` });
  }

  return {
    overallStatus,
    healthScore,
    summary,
    findings,

    totalRequests: total,
    failedCount: result.failedCount,
    slowCount: result.slowCount,
    totalSize: result.totalSize,
    totalTime: result.totalTime,
    avgTtfb: Math.round(avgWait),
    p95Ttfb: Math.round(p95Wait),
    domainCount: domainStats.length,
    ipCount: ipStats.length,

    networkStatus,
    httpStatus,
    slowBreakdown,
    failedRequests,
    slowRequests,

    domainStats,
    ipStats,
    duplicateRequests,

    resourceStats,
    largestResources,

    cacheStats,
    compressionStats,
    uncompressedLargeResources,

    securityStats,

    attributions,
    suggestions,
  };
}
