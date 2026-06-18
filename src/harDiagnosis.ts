/**
 * HAR 汇总诊断计算层
 *
 * 从 HarAnalysisResult 计算出完整的诊断数据，供 HarSummaryDiagnosis 展示。
 * 纯函数，无副作用。
 */

import type {
  HarAnalysisResult,
  HarTiming,
  HarCategory,
} from './harParser';
import { formatHarTime, HAR_SLOW_THRESHOLD_MS } from './harParser';
import { SLOW_REQUEST_MS, MODERATE_REQUEST_MS, SLOW_SSL_MS } from './constants/analysisThresholds';

// ========== 阈值常量 ==========

const THRESHOLDS = {
  dnsSlow: SLOW_SSL_MS,
  connectSlow: 500,
  sslSlow: 500,
  ttfbSlow: 800,
  receiveSlow: MODERATE_REQUEST_MS,
  blockedSlow: SLOW_SSL_MS,
  totalSlow: HAR_SLOW_THRESHOLD_MS,
  totalVerySlow: SLOW_REQUEST_MS,
  largeResource: 1024 * 1024,
  redirectCount: 3,
};

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

function isIPv6(ip: string): boolean {
  if (!ip || ip === '-') return false;
  return ip.includes(':');
}

function classifyIP(ip: string): IpStats['type'] {
  if (!ip || ip === '-') return 'unknown';
  if (isLoopbackIP(ip)) return 'loopback';
  if (isIPv6(ip)) return 'ipv6';
  if (isPrivateIP(ip)) return 'private';
  return 'public';
}

function getPhaseStatus(avg: number, max: number, p95: number, slowCount: number, threshold: number, label: string): NetworkPhaseStatus {
  let status: DiagnosisStatus = 'healthy';
  let detail = `${label}正常`;
  if (p95 > threshold * 3 || slowCount > 10) {
    status = 'critical';
    detail = `${label}严重偏高`;
  } else if (p95 > threshold || slowCount > 3) {
    status = 'warning';
    detail = `${label}偏高`;
  }
  return { label, status, avgMs: Math.round(avg), maxMs: Math.round(max), p95Ms: Math.round(p95), slowCount, slowDomains: [], detail };
}

// ========== 主计算函数 ==========

export function diagnoseHar(result: HarAnalysisResult): HarDiagnosisResult {
  const entries = result.entries;
  const total = entries.length;

  // ---- 基础统计 ----
  const timings = entries.map(e => e.timings);
  const dnsArr = timings.map(t => t.dns).filter(v => v > 0).sort((a, b) => a - b);
  const connectArr = timings.map(t => t.connect).filter(v => v > 0).sort((a, b) => a - b);
  const sslArr = timings.map(t => t.ssl).filter(v => v > 0).sort((a, b) => a - b);
  const waitArr = timings.map(t => t.wait).filter(v => v > 0).sort((a, b) => a - b);
  const receiveArr = timings.map(t => t.receive).filter(v => v > 0).sort((a, b) => a - b);
  // blockedArr reserved for future use

  const avgDns = avg(dnsArr);
  const avgConnect = avg(connectArr);
  const avgSsl = avg(sslArr);
  const avgWait = avg(waitArr);
  const avgReceive = avg(receiveArr);
  // avgBlocked / p95Blocked reserved for future use

  const p95Dns = percentile(dnsArr, 0.95);
  const p95Connect = percentile(connectArr, 0.95);
  const p95Ssl = percentile(sslArr, 0.95);
  const p95Wait = percentile(waitArr, 0.95);
  const p95Receive = percentile(receiveArr, 0.95);

  const dnsSlow = entries.filter(e => e.timings.dns > THRESHOLDS.dnsSlow).length;
  const connectSlow = entries.filter(e => e.timings.connect > THRESHOLDS.connectSlow).length;
  const sslSlow = entries.filter(e => e.timings.ssl > THRESHOLDS.sslSlow).length;
  const ttfbSlow = entries.filter(e => e.timings.wait > THRESHOLDS.ttfbSlow).length;
  const receiveSlow = entries.filter(e => e.timings.receive > THRESHOLDS.receiveSlow).length;
  const blockedSlow = entries.filter(e => e.timings.blocked > THRESHOLDS.blockedSlow).length;

  // ---- 网络状态 ----
  const networkStatus: NetworkPhaseStatus[] = [
    getPhaseStatus(avgDns, dnsArr[dnsArr.length - 1] || 0, p95Dns, dnsSlow, THRESHOLDS.dnsSlow, 'DNS'),
    getPhaseStatus(avgConnect, connectArr[connectArr.length - 1] || 0, p95Connect, connectSlow, THRESHOLDS.connectSlow, 'TCP'),
    getPhaseStatus(avgSsl, sslArr[sslArr.length - 1] || 0, p95Ssl, sslSlow, THRESHOLDS.sslSlow, 'TLS'),
    getPhaseStatus(avgWait, waitArr[waitArr.length - 1] || 0, p95Wait, ttfbSlow, THRESHOLDS.ttfbSlow, 'TTFB'),
    getPhaseStatus(avgReceive, receiveArr[receiveArr.length - 1] || 0, p95Receive, receiveSlow, THRESHOLDS.receiveSlow, '下载'),
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
    count2xx: entries.filter(e => e.status >= 200 && e.status < 300).length,
    count3xx: entries.filter(e => e.status >= 300 && e.status < 400).length,
    count4xx: entries.filter(e => e.status >= 400 && e.status < 500).length,
    count5xx: entries.filter(e => e.status >= 500).length,
    count0: entries.filter(e => e.status === 0).length,
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

  // ---- 域名统计 ----
  const domainMap = new Map<string, DomainStats>();
  for (const e of entries) {
    const d = domainMap.get(e.domain) || { domain: e.domain, count: 0, failedCount: 0, avgTime: 0, totalSize: 0, ips: [] };
    d.count++;
    if (e.isFailed) d.failedCount++;
    d.totalSize += e.size;
    if (e.remoteAddress && e.remoteAddress !== '-' && !d.ips.includes(e.remoteAddress)) {
      d.ips.push(e.remoteAddress);
    }
    domainMap.set(e.domain, d);
  }
  for (const d of domainMap.values()) {
    const domainEntries = entries.filter(e => e.domain === d.domain);
    d.avgTime = Math.round(avg(domainEntries.map(e => e.time)));
  }
  const domainStats = Array.from(domainMap.values()).sort((a, b) => b.count - a.count);

  // ---- IP 统计 ----
  const ipMap = new Map<string, IpStats>();
  for (const e of entries) {
    if (!e.remoteAddress || e.remoteAddress === '-') continue;
    const ip = e.remoteAddress.split(':')[0];
    const i = ipMap.get(ip) || { ip, count: 0, failedCount: 0, avgTime: 0, domains: [], type: classifyIP(ip) };
    i.count++;
    if (e.isFailed) i.failedCount++;
    if (!i.domains.includes(e.domain)) i.domains.push(e.domain);
    ipMap.set(ip, i);
  }
  for (const i of ipMap.values()) {
    const ipEntries = entries.filter(e => e.remoteAddress.startsWith(i.ip));
    i.avgTime = Math.round(avg(ipEntries.map(e => e.time)));
  }
  const ipStats = Array.from(ipMap.values()).sort((a, b) => b.count - a.count);

  // ---- 重复请求检测 ----
  const urlMap = new Map<string, { count: number; totalWasted: number }>();
  for (const e of entries) {
    const key = `${e.method} ${e.url}`;
    const u = urlMap.get(key) || { count: 0, totalWasted: 0 };
    u.count++;
    if (u.count > 1) u.totalWasted += e.size;
    urlMap.set(key, u);
  }
  const duplicateRequests = Array.from(urlMap.entries())
    .filter(([, v]) => v.count > 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([url, v]) => ({ url, count: v.count, totalWasted: v.totalWasted }));

  // ---- 资源类型统计 ----
  const resourceStats: ResourceStats[] = (Object.keys(result.typeCounts) as HarCategory[])
    .map(cat => {
      const catEntries = entries.filter(e => e.category === cat);
      return {
        category: cat,
        count: result.typeCounts[cat],
        totalSize: catEntries.reduce((s, e) => s + e.size, 0),
        avgTime: Math.round(avg(catEntries.map(e => e.time))),
        failedCount: catEntries.filter(e => e.isFailed).length,
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
  const cachedCount = entries.filter(e => {
    const cc = e.responseHeaders.find(h => h.name.toLowerCase() === 'cache-control')?.value || '';
    return cc.includes('max-age') || cc.includes('immutable') || e.status === 304;
  }).length;
  const cacheStats: CacheStats = {
    cachedCount,
    uncachedCount: total - cachedCount,
    cacheRate: total > 0 ? Math.round((cachedCount / total) * 100) : 0,
  };

  // ---- 压缩统计 ----
  const ceHeader = entries.filter(e => {
    const ce = e.responseHeaders.find(h => h.name.toLowerCase() === 'content-encoding')?.value || '';
    return ce.includes('gzip') || ce.includes('br') || ce.includes('deflate');
  });
  const compressedCount = ceHeader.length;
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
  const httpsCount = entries.filter(e => e.url.startsWith('https:')).length;
  const h2Count = entries.filter(e => e.protocol === 'h2').length;
  const h3Count = entries.filter(e => e.protocol === 'h3').length;
  const h11Count = entries.filter(e => e.protocol === 'http/1.1').length;
  const mixedContentCount = entries.filter(e => e.url.startsWith('http:') && !e.url.startsWith('http://localhost')).length;

  const missingSecurityHeaders: string[] = [];
  const firstEntry = entries[0];
  if (firstEntry) {
    const respHeaders = firstEntry.responseHeaders.map(h => h.name.toLowerCase());
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
  if (httpStatus.countFailed > 0) healthScore -= Math.min(30, httpStatus.countFailed * 2);
  if (result.slowCount > 0) healthScore -= Math.min(20, result.slowCount);
  if (networkStatus.some(n => n.status === 'critical')) healthScore -= 15;
  if (networkStatus.some(n => n.status === 'warning')) healthScore -= 5;
  if (duplicateRequests.length > 0) healthScore -= 5;
  if (uncompressedLargeResources.length > 0) healthScore -= 5;
  healthScore = Math.max(0, healthScore);

  let overallStatus: DiagnosisStatus = 'healthy';
  if (healthScore < 60) overallStatus = 'critical';
  else if (healthScore < 80) overallStatus = 'warning';

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
