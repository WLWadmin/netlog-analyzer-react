/**
 * HAR + NetLog 联合诊断
 * 核心思路：把 HAR 的请求级 timing 与 NetLog 的事件级网络状态对齐，
 * 生成 "HAR 看到慢，NetLog 解释为什么慢" 的联合诊断卡片
 */

import type { HarAnalysisResult, HarRequestEntry } from '../../harParser';
import type { AnalysisResult } from '../../parsers/netlog/parser';
import type {
  DiagnosticCard,
  DiagnosisSummary,
  CollectionQuality,
} from './types';

// ========== 对齐逻辑 ==========

interface AlignedEntry {
  harEntry: HarRequestEntry;
  /** NetLog 中可能关联的 URL_REQUEST 索引列表 */
  netlogRequestIndices: number[];
  host: string;
  isSlow: boolean;
}

function alignHarWithNetlog(
  harResult: HarAnalysisResult,
  netlogResult: AnalysisResult
): AlignedEntry[] {
  const aligned: AlignedEntry[] = [];

  for (const harEntry of harResult.entries) {
    let host = '';
    try { host = new URL(harEntry.url).hostname; } catch { /* skip */ }

    // 在 NetLog URL_REQUEST 中找同 host 的请求
    const netlogIndices: number[] = [];
    netlogResult.urlRequests.forEach((r, idx) => {
      try {
        const rHost = new URL(r.url).hostname;
        if (rHost === host) netlogIndices.push(idx);
      } catch { /* skip */ }
    });

    aligned.push({
      harEntry,
      netlogRequestIndices: netlogIndices,
      host,
      isSlow: harEntry.isSlow || harEntry.time >= 1000,
    });
  }

  return aligned;
}

// ========== 联合诊断卡片生成 ==========

export function combinedDiagnosisToCards(
  harResult: HarAnalysisResult,
  netlogResult: AnalysisResult
): DiagnosticCard[] {
  const cards: DiagnosticCard[] = [];
  const aligned = alignHarWithNetlog(harResult, netlogResult);

  const slowAligned = aligned.filter(a => a.isSlow);
  if (slowAligned.length === 0) return cards;

  // 1. HAR 慢 + NetLog 有 DNS 问题
  const slowWithDnsIssue = slowAligned.filter(a =>
    a.harEntry.timings.dns > 200 && netlogResult.failedDomains.length > 0
  );
  if (slowWithDnsIssue.length > 0) {
    const hosts = [...new Set(slowWithDnsIssue.map(a => a.host))];
    cards.push({
      id: 'combined-dns-slow',
      source: 'combined',
      category: 'dns',
      severity: 'critical',
      confidence: 'high',
      title: '联合诊断：DNS 解析慢与 NetLog DNS 失败域吻合',
      conclusion: `HAR 中 ${slowWithDnsIssue.length} 个慢请求的 DNS 耗时偏高，且 NetLog 检测到 ${netlogResult.failedDomains.length} 个失败域名，高度吻合`,
      scope: { type: 'multi-domain', summary: `影响 ${hosts.length} 个域名`, affectedDomainCount: hosts.length },
      evidence: [
        { label: 'HAR 慢请求数', value: String(slowWithDnsIssue.length), source: 'har' },
        { label: 'NetLog 失败域名', value: netlogResult.failedDomains.slice(0, 5).map(d => d.domain).join(', '), source: 'netlog' },
        { label: '涉及域名', value: hosts.slice(0, 5).join(', '), source: 'derived' },
      ],
      actions: [
        { role: 'user', title: '验证 DNS 解析', detail: '使用 nslookup 验证失败域名在当前网络下是否可解析', command: `nslookup ${netlogResult.failedDomains[0]?.domain || 'example.com'}` },
        { role: 'it', title: '检查 DNS 服务器配置', detail: '确认当前使用的 DNS 服务器是否正常，必要时切换到公共 DNS' },
      ],
      limitations: ['联合诊断基于 host 粒度对齐，不保证 HAR 请求和 NetLog 事件严格 1:1 对应'],
      relatedRequestIds: slowWithDnsIssue.slice(0, 10).map(a => a.harEntry.id),
      navigationTarget: { tab: 'requests', errorOnly: true, keyword: 'DNS' },
    });
  }

  // 2. HAR 慢 + NetLog 有 Proxy 问题
  const slowWithProxy = slowAligned.filter(() =>
    netlogResult.proxyInfo.hasProxy && netlogResult.proxyEvents.length > 0
  );
  if (slowWithProxy.length > 0) {
    cards.push({
      id: 'combined-proxy-slow',
      source: 'combined',
      category: 'proxy',
      severity: 'warning',
      confidence: 'medium',
      title: '联合诊断：慢请求与代理介入吻合',
      conclusion: `HAR 中有 ${slowWithProxy.length} 个慢请求，且 NetLog 检测到代理介入，代理可能引入额外延迟`,
      scope: { type: 'global', summary: '代理全局影响' },
      evidence: [
        { label: 'HAR 慢请求数', value: String(slowWithProxy.length), source: 'har' },
        { label: 'NetLog 代理事件', value: String(netlogResult.proxyEvents.length), source: 'netlog' },
        { label: '代理类型', value: netlogResult.proxyInfo.proxyType || '未知', source: 'netlog' },
      ],
      actions: [
        { role: 'it', title: '检查代理策略', detail: '确认 PAC、VPN、代理认证和 CONNECT tunnel 是否正常' },
        { role: 'user', title: '绕过代理测试', detail: '临时关闭代理后重新访问，对比是否仍有慢请求', command: "curl -v --noproxy '*' https://example.com" },
      ],
      limitations: ['代理介入不一定直接导致慢请求，需要结合 connect/ssl timing 综合判断'],
      navigationTarget: { tab: 'events', keyword: 'PROXY' },
    });
  }

  // 3. HAR 慢 + NetLog 有 TLS 问题
  const slowWithTls = slowAligned.filter(a =>
    (a.harEntry.timings.ssl > 300) && netlogResult.certIssues.length > 0
  );
  if (slowWithTls.length > 0) {
    cards.push({
      id: 'combined-tls-slow',
      source: 'combined',
      category: 'tls',
      severity: 'warning',
      confidence: 'high',
      title: '联合诊断：TLS 握手慢与 NetLog SSL 异常吻合',
      conclusion: `HAR 中 ${slowWithTls.length} 个请求 TLS 握手耗时偏高，且 NetLog 检测到 ${netlogResult.certIssues.length} 个 SSL 问题`,
      scope: { type: 'multi-domain', summary: `TLS 握手影响多个域名` },
      evidence: [
        { label: 'HAR TLS 慢请求数', value: String(slowWithTls.length), source: 'har' },
        { label: 'NetLog SSL 问题数', value: String(netlogResult.certIssues.length), source: 'netlog' },
      ],
      actions: [
        { role: 'it', title: '检查 TLS 链路', detail: '使用 openssl s_client 验证证书链和协议版本', command: 'openssl s_client -connect example.com:443 -servername example.com' },
      ],
      limitations: ['TLS 握手慢也可能与服务端 TLS 配置有关，不一定是客户端网络问题'],
      navigationTarget: { tab: 'events', keyword: 'SSL', errorOnly: true },
    });
  }

  return cards;
}

// ========== 联合采集质量 ==========

export function checkCombinedQuality(
  harResult: HarAnalysisResult,
  netlogResult: AnalysisResult
): CollectionQuality {
  const issues: CollectionQuality['issues'] = [];
  const recommendations: string[] = [];

  // 检查对齐率
  const aligned = alignHarWithNetlog(harResult, netlogResult);
  const alignedCount = aligned.filter(a => a.netlogRequestIndices.length > 0).length;
  const alignRate = harResult.totalRequests > 0 ? alignedCount / harResult.totalRequests : 0;

  if (alignRate < 0.3 && harResult.totalRequests > 5) {
    issues.push({
      type: 'suspicious_pattern',
      severity: 'warning',
      message: 'HAR 与 NetLog 对齐率低',
      detail: `仅 ${(alignRate * 100).toFixed(0)}% 的 HAR 请求能在 NetLog 中找到同 host 请求，联合诊断可靠性受限`,
    });
    recommendations.push('确保 HAR 和 NetLog 在同一浏览器会话、同一时间段内采集');
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

  return { cards, quality, overallSeverity };
}
