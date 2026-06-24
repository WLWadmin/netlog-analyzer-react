/**
 * NetLog 诊断结果 → DiagnosticCard 适配层
 * 将 NetLog 分析结果转换为统一 DiagnosticCard 结构
 */

import type { AnalysisResult, FailedDomain, ProxyInfo } from '../../parsers/netlog/parser';
import type { Suggestion } from '../../parsers/netlog/diagnosis';
import { classifyNetError } from '../../parsers/netlog/errorClassifier';
import type {
  DiagnosticCard,
  DiagnosticCategory,
  DiagnosticEvidence,
  DiagnosticAction,
  DiagnosticScope,
  DiagnosticRole,
  CollectionQuality,
  DiagnosisSummary,
} from './types';

function generateId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Date.now().toString(36)}`;
}

function mapErrorCategoryToDiagnostic(errorCat: string): DiagnosticCategory {
  const map: Record<string, DiagnosticCategory> = {
    'DNS': 'dns',
    '证书': 'tls',
    '代理': 'proxy',
    '网络变更': 'network-change',
    '阻止': 'security',
    '协议': 'protocol',
    '连接': 'connect',
    '应用层': 'server',
    '缓存': 'cache',
    '其他': 'unknown',
  };
  return map[errorCat] || 'unknown';
}

function buildScope(
  affectedCount: number,
  domainCount?: number,
  type?: DiagnosticScope['type']
): DiagnosticScope {
  if (affectedCount === 1) {
    return { type: type || 'single-request', summary: '影响 1 个请求', affectedRequestCount: 1 };
  }
  if (domainCount && domainCount > 1) {
    return {
      type: type || 'multi-domain',
      summary: `影响 ${affectedCount} 个请求，涉及 ${domainCount} 个域名`,
      affectedRequestCount: affectedCount,
      affectedDomainCount: domainCount,
    };
  }
  return {
    type: type || 'global',
    summary: `影响 ${affectedCount} 个请求`,
    affectedRequestCount: affectedCount,
  };
}

// ========== 从 Suggestion 构建 Card ==========

function suggestionToCard(suggestion: Suggestion, index: number, result: AnalysisResult): DiagnosticCard {
  // ========== 结构化字段优先策略 ==========
  // 1. 优先使用 Suggestion 结构化字段（errorCode / category / severity）
  // 2. 次选从 title 正则提取错误码，再用 errorClassifier 映射
  // 3. 最后兜底：从 title 关键词推断

  const errorCode: number | null = suggestion.errorCode ?? extractErrorCodeFromTitle(suggestion.title);

  // category 优先级：结构化字段 > errorClassifier > title 关键词兜底
  let category: DiagnosticCategory;
  if (suggestion.category) {
    category = mapErrorCategoryToDiagnostic(suggestion.category);
  } else if (errorCode) {
    category = mapErrorCategoryToDiagnostic(classifyNetError(errorCode).catName);
  } else {
    category = inferCategoryFromTitle(suggestion.title);
  }

  // severity 优先级：结构化字段 > icon/title 启发式
  let severity: DiagnosticCard['severity'];
  if (suggestion.severity) {
    severity = suggestion.severity;
  } else if (suggestion.icon === '🚨' || suggestion.title.includes('劫持') || suggestion.title.includes('VPN')) {
    severity = 'critical';
  } else if (suggestion.icon === '❌' || suggestion.title.includes('失败')) {
    severity = 'warning';
  } else if (suggestion.icon === '⚠️') {
    severity = 'warning';
  } else {
    severity = 'info';
  }

  const evidence: DiagnosticEvidence[] = [];

  // 从 detail 中提取证据
  if (suggestion.detail) {
    const lines = suggestion.detail.split('\n').filter(l => l.trim());
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
        evidence.push({
          label: `证据 ${i + 1}`,
          value: trimmed.replace(/^[-•]\s*/, ''),
          source: 'netlog',
        });
      } else if (trimmed.includes('影响范围')) {
        evidence.push({
          label: '影响范围',
          value: trimmed.replace(/.*影响范围[:：]\s*/, ''),
          source: 'derived',
        });
      }
    });
  }

  // 关联请求
  const relatedRequestIds = findRelatedRequests(suggestion, result);
  if (relatedRequestIds.length > 0) {
    evidence.push({
      label: '相关请求',
      value: `${relatedRequestIds.length} 个请求`,
      source: 'netlog',
      requestIds: relatedRequestIds,
    });
  }

  // 构建 actions
  const actions = buildActionsFromSuggestion(suggestion, category);

  // 确定置信度
  let confidence: DiagnosticCard['confidence'] = 'medium';
  if (errorCode && result.connectionFailures.some(f => f.error === errorCode)) {
    confidence = 'high';
  }

  // 影响范围
  const affectedCount = relatedRequestIds.length || result.connectionFailures.length || 1;
  const domainCount = new Set(relatedRequestIds.map(id => {
    const req = result.urlRequests.find(r => r.id === id);
    if (!req || !req.url) return '';
    try { return new URL(req.url).hostname; } catch { return ''; }
  }).filter(Boolean)).size;

  const limitations: string[] = [];
  if (!errorCode) {
    limitations.push('NetLog 未包含明确的错误码，当前判断为启发式推测');
  }
  if (result.dnsServers.length === 0 && category === 'dns') {
    limitations.push('当前 NetLog 未包含 DNS 配置数据，无法判断 DNS 服务器地址');
  }

  return {
    id: generateId('netlog', index),
    source: 'netlog',
    category,
    severity,
    confidence,
    title: suggestion.title,
    conclusion: suggestion.conclusion,
    scope: buildScope(affectedCount, domainCount || undefined, domainCount > 1 ? 'multi-domain' : 'global'),
    evidence,
    actions,
    limitations: limitations.length > 0 ? limitations : undefined,
    relatedRequestIds: relatedRequestIds.length > 0 ? relatedRequestIds : undefined,
  };
}

/**
 * 集中封装的错误码提取逻辑
 * 优先级：结构化字段 > title 正则提取
 * 注意：下游应优先使用 Suggestion.errorCode 结构化字段
 */
function extractErrorCodeFromTitle(title: string): number | null {
  const match = title.match(/\((-?\d+)\)/);
  return match ? Number(match[1]) : null;
}

function inferCategoryFromTitle(title: string): DiagnosticCategory {
  if (title.includes('DNS') || title.includes('域名解析')) return 'dns';
  if (title.includes('证书') || title.includes('SSL') || title.includes('TLS')) return 'tls';
  if (title.includes('代理') || title.includes('VPN') || title.includes('PAC')) return 'proxy';
  if (title.includes('连接') || title.includes('超时') || title.includes('RESET')) return 'connect';
  if (title.includes('HTTP/2') || title.includes('QUIC') || title.includes('协议')) return 'protocol';
  if (title.includes('网络变更')) return 'network-change';
  if (title.includes('阻止') || title.includes('拦截')) return 'security';
  if (title.includes('慢请求')) return 'performance';
  if (title.includes('缓存')) return 'cache';
  return 'unknown';
}

function findRelatedRequests(suggestion: Suggestion, result: AnalysisResult): number[] {
  const ids: number[] = [];
  // 优先使用结构化 errorCode，其次从 title 提取
  const errorCode = suggestion.errorCode ?? extractErrorCodeFromTitle(suggestion.title);

  if (errorCode) {
    result.connectionFailures
      .filter(f => f.error === errorCode)
      .forEach(f => {
        const req = result.urlRequests.find(r => r.url === f.url);
        if (req && !ids.includes(req.id)) ids.push(req.id);
      });
  }

  // 根据标题关键词匹配
  if (suggestion.title.includes('DNS')) {
    result.urlRequests
      .filter(r => r.error && classifyNetError(r.error).catName === 'DNS')
      .forEach(r => { if (!ids.includes(r.id)) ids.push(r.id); });
  }
  if (suggestion.title.includes('代理') || suggestion.title.includes('VPN')) {
    result.urlRequests.forEach(r => { if (!ids.includes(r.id)) ids.push(r.id); });
  }

  return ids.slice(0, 10);
}

function buildActionsFromSuggestion(suggestion: Suggestion, category: DiagnosticCategory): DiagnosticAction[] {
  const actions: DiagnosticAction[] = [];

  if (suggestion.actions && suggestion.actions.length > 0) {
    suggestion.actions.forEach(actionText => {
      const role = inferRoleFromAction(actionText);
      actions.push({
        role,
        title: actionText.slice(0, 50),
        detail: actionText,
      });
    });
  }

  // 根据类别添加标准动作
  switch (category) {
    case 'dns':
      if (!actions.some(a => a.title.includes('nslookup'))) {
        actions.push({
          role: 'user',
          title: 'DNS 解析测试',
          detail: '使用 nslookup 测试域名解析',
          command: 'nslookup example.com',
          platform: 'all',
          expectedResult: '应返回正确的 IP 地址',
        });
      }
      break;
    case 'tls':
      if (!actions.some(a => a.title.includes('openssl'))) {
        actions.push({
          role: 'user',
          title: 'TLS 握手测试',
          detail: '使用 openssl 检查 TLS 握手',
          command: 'openssl s_client -connect example.com:443 -servername example.com',
          platform: 'all',
          expectedResult: '应成功建立 TLS 连接',
        });
      }
      break;
    case 'proxy':
      if (!actions.some(a => a.title.includes('curl'))) {
        actions.push({
          role: 'user',
          title: '绕过代理测试',
          detail: '在公司安全策略允许的情况下，使用 curl 绕过代理测试',
          command: 'curl -v --noproxy \'*\' https://example.com',
          platform: 'all',
          expectedResult: '应能正常访问目标地址',
        });
      }
      break;
    case 'connect':
      if (!actions.some(a => a.title.includes('ping'))) {
        actions.push({
          role: 'user',
          title: '网络连通性测试',
          detail: '使用 ping 测试网络连通性',
          command: 'ping example.com -n 20',
          platform: 'all',
          expectedResult: '丢包率应 < 5%，延迟应 < 200ms',
        });
      }
      break;
  }

  return actions;
}

/**
 * 从 action 文本推断角色
 * 优先级规则：按关键词匹配，第一个匹配到的角色胜出
 * 注意：这是一个启发式推断，上游 Suggestion 应尽量提供结构化 role
 */
function inferRoleFromAction(actionText: string): DiagnosticRole {
  const text = actionText.toLowerCase();
  // 优先级 1：IT 相关
  if (text.includes('it') || text.includes('防火墙') || text.includes('代理') || text.includes('dns') || text.includes('vpn')) return 'it';
  // 优先级 2：后端相关
  if (text.includes('后端') || text.includes('服务端') || text.includes('数据库') || text.includes('服务器') || text.includes('证书')) return 'backend';
  // 优先级 3：前端相关
  if (text.includes('前端') || text.includes('缓存策略') || text.includes('资源加载') || text.includes('页面')) return 'frontend';
  // 默认：用户
  return 'user';
}

// ========== 主转换函数 ==========

export function netlogToCards(result: AnalysisResult, suggestions: Suggestion[]): DiagnosticCard[] {
  const cards = suggestions.map((s, i) => suggestionToCard(s, i, result));

  // 添加代理/VPN 环境卡片（如果检测到但未生成）
  if (result.proxyInfo.hasProxy && !cards.some(c => c.category === 'proxy')) {
    cards.push(buildProxyCard(result.proxyInfo, result));
  }

  // 添加 DNS 劫持卡片（如果检测到但未生成）
  const hijackedDomains = result.failedDomains.filter(d =>
    d.ips.some(ip => ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1')
  );
  if (hijackedDomains.length > 0 && !cards.some(c => c.title.includes('劫持'))) {
    cards.push(buildDnsHijackCard(hijackedDomains));
  }

  // ========== 批次 C 增强：DNS 解析诊断卡片 ==========
  if (result.failedDomains.length > 0 && !cards.some(c => c.category === 'dns' && c.severity === 'critical')) {
    const dnsErrors = result.failedDomains.filter(d => d.errorCodes.some(ec => ec === -105 || ec === -137 || ec === -139));
    if (dnsErrors.length > 0) {
      cards.push({
        id: generateId('netlog-dns-detail', 0),
        source: 'netlog',
        category: 'dns',
        severity: 'critical',
        confidence: 'high',
        title: `DNS 解析失败 (${dnsErrors.length} 个域名)`,
        conclusion: `${dnsErrors.length} 个域名出现 DNS 解析失败（ERR_NAME_NOT_RESOLVED / ERR_NAME_RESOLUTION_FAILED），所有相关请求均无法完成`,
        scope: buildScope(
          dnsErrors.reduce((s, d) => s + d.count, 0),
          dnsErrors.length,
          dnsErrors.length > 1 ? 'multi-domain' : 'single-domain'
        ),
        evidence: dnsErrors.slice(0, 5).map((d, i) => ({
          label: `失败域名 ${i + 1}`,
          value: `${d.domain} — 错误码: ${d.errorCodes.join(', ')}，失败 ${d.count} 次`,
          source: 'netlog',
        })),
        actions: [
          {
            role: 'user',
            title: '更换 DNS 测试',
            detail: '国内用户修改 DNS 为 223.5.5.5 或 119.29.29.29；海外用户修改为 8.8.8.8 或 1.1.1.1',
            command: 'nslookup example.com 223.5.5.5',
            platform: 'all',
            expectedResult: '应返回正确的 IP 地址',
          },
          {
            role: 'it',
            title: '检查企业 DNS 配置',
            detail: '确认企业 DNS 服务器是否正常工作，检查 DHCP 分配的 DNS 地址',
          },
        ],
        limitations: result.dnsServers.length === 0
          ? ['当前 NetLog 未包含 DNS 配置数据，无法判断使用的 DNS 服务器地址']
          : undefined,
      });
    }
  }

  // ========== 批次 C 增强：TLS/证书诊断卡片 ==========
  if (result.certIssues.length > 0 && !cards.some(c => c.category === 'tls')) {
    const certHosts = [...new Set(result.certIssues.map(si => si.host))].slice(0, 10);
    const timeoutCerts = result.certIssues.filter(si => si.category === 'timeout');
    const certCerts = result.certIssues.filter(si => si.category === 'cert');
    const protocolCerts = result.certIssues.filter(si => si.category === 'protocol');

    let conclusion = `${result.certIssues.length} 个 SSL/TLS 问题涉及 ${certHosts.length} 个主机`;
    if (timeoutCerts.length > 0) {
      conclusion += `，其中 ${timeoutCerts.length} 个为握手超时（可能是网络问题而非证书问题）`;
    }
    if (certCerts.length > 0) {
      conclusion += `，${certCerts.length} 个为证书验证失败`;
    }

    cards.push({
      id: generateId('netlog-tls-detail', 0),
      source: 'netlog',
      category: 'tls',
      severity: certCerts.length > 0 ? 'critical' : 'warning',
      confidence: 'high',
      title: `TLS/证书问题 (${result.certIssues.length} 个)`,
      conclusion,
      scope: buildScope(result.certIssues.length, certHosts.length, certHosts.length > 1 ? 'multi-domain' : 'single-domain'),
      evidence: [
        {
          label: '涉及主机',
          value: certHosts.join('、'),
          source: 'netlog',
        },
        {
          label: '超时类',
          value: `${timeoutCerts.length} 个`,
          source: 'netlog',
        },
        {
          label: '证书类',
          value: `${certCerts.length} 个`,
          source: 'netlog',
        },
        {
          label: '协议类',
          value: `${protocolCerts.length} 个`,
          source: 'netlog',
        },
      ],
      actions: [
        {
          role: 'user',
          title: 'TLS 握手测试',
          detail: '使用 openssl 检查目标主机的 TLS 握手是否正常',
          command: 'openssl s_client -connect example.com:443 -servername example.com',
          platform: 'all',
          expectedResult: '应成功建立 TLS 连接并显示证书信息',
        },
        ...(certCerts.length > 0 ? [{
          role: 'backend' as const,
          title: '检查证书有效性',
          detail: '确认服务器证书是否过期、域名是否匹配、证书链是否完整',
        }] : []),
        ...(timeoutCerts.length > 0 ? [{
          role: 'user' as const,
          title: '区分超时与证书问题',
          detail: 'TLS 超时（如 -118）通常是网络问题导致握手未完成，而非证书本身有问题。建议先排查网络连通性',
        }] : []),
      ],
      limitations: [
        'NetLog 的 SSL 事件可能不包含完整的证书链信息',
        '-118 (ERR_SSL_PROTOCOL_ERROR) 在 NetLog 中常被误归为证书问题，实际可能是握手超时',
      ],
    });
  }

  // ========== 批次 C 增强：连接池/排队诊断卡片 ==========
  if (result.stalledRequests.length > 0 && !cards.some(c => c.category === 'browser-queue')) {
    const stalledDomains = [...new Set(result.stalledRequests.map(r => {
      try { return new URL(r.url).hostname; } catch { return ''; }
    }).filter(Boolean))];
    cards.push({
      id: generateId('netlog-stalled', 0),
      source: 'netlog',
      category: 'browser-queue',
      severity: 'warning',
      confidence: 'high',
      title: `请求排队/停滞 (${result.stalledRequests.length} 个)`,
      conclusion: `${result.stalledRequests.length} 个请求出现停滞（stalled），浏览器可能因连接池耗尽或并发限制导致请求排队`,
      scope: buildScope(result.stalledRequests.length, stalledDomains.length, stalledDomains.length > 1 ? 'multi-domain' : 'global'),
      evidence: [
        {
          label: '停滞请求数',
          value: `${result.stalledRequests.length} 个`,
          source: 'netlog',
        },
        {
          label: '涉及域名',
          value: stalledDomains.slice(0, 5).join('、') + (stalledDomains.length > 5 ? ` 等 ${stalledDomains.length} 个` : ''),
          source: 'derived',
        },
      ],
      actions: [
        {
          role: 'frontend',
          title: '优化请求调度',
          detail: '减少页面加载时的并发请求数量，使用资源预加载、懒加载、优先级调度',
        },
        {
          role: 'frontend',
          title: '启用 HTTP/2',
          detail: 'HTTP/2 支持多路复用，可消除浏览器对同一域名的连接数限制（Chrome 限制 6 个）',
        },
      ],
    });
  }

  // ========== 批次 C 增强：HTTP/2 与 QUIC 诊断卡片 ==========
  const protocolCounts = result.protocols;
  const h2Count = (protocolCounts['HTTP/2'] || 0) + (protocolCounts['h2'] || 0);
  const quicCount = (protocolCounts['QUIC'] || 0) + (protocolCounts['h3'] || 0);
  const h11Count = (protocolCounts['HTTP/1.1'] || 0) + (protocolCounts['http/1.1'] || 0);
  const totalWithProtocol = h2Count + quicCount + h11Count;

  if (totalWithProtocol > 10 && h11Count > totalWithProtocol * 0.5) {
    cards.push({
      id: generateId('netlog-protocol', 0),
      source: 'netlog',
      category: 'protocol',
      severity: 'info',
      confidence: 'high',
      title: 'HTTP/2 协议覆盖率偏低',
      conclusion: `${h11Count} 个请求 (${((h11Count / totalWithProtocol) * 100).toFixed(0)}%) 仍使用 HTTP/1.1，建议启用 HTTP/2 以利用多路复用减少连接开销`,
      scope: buildScope(h11Count, undefined, 'global'),
      evidence: [
        { label: 'HTTP/1.1', value: `${h11Count} 个`, source: 'netlog' },
        { label: 'HTTP/2', value: `${h2Count} 个`, source: 'netlog' },
        { label: 'QUIC/HTTP3', value: `${quicCount} 个`, source: 'netlog' },
      ],
      actions: [
        {
          role: 'backend',
          title: '启用 HTTP/2',
          detail: '在服务端配置 HTTP/2 支持（Nginx: listen 443 http2; Node.js: 使用 http2 模块）',
        },
        {
          role: 'backend',
          title: '考虑启用 QUIC',
          detail: 'QUIC (HTTP/3) 可进一步减少连接建立延迟，尤其对高延迟网络效果显著',
        },
      ],
    });
  }

  if (quicCount > 0 && !cards.some(c => c.category === 'protocol')) {
    cards.push({
      id: generateId('netlog-quic', 0),
      source: 'netlog',
      category: 'protocol',
      severity: 'info',
      confidence: 'high',
      title: `QUIC/HTTP3 协议使用 (${quicCount} 个请求)`,
      conclusion: `${quicCount} 个请求使用 QUIC 协议，可享受 0-RTT 连接建立和多路复用优势`,
      scope: buildScope(quicCount, undefined, 'global'),
      evidence: [
        { label: 'QUIC 请求', value: `${quicCount} 个`, source: 'netlog' },
        { label: 'HTTP/2 请求', value: `${h2Count} 个`, source: 'netlog' },
        { label: 'HTTP/1.1 请求', value: `${h11Count} 个`, source: 'netlog' },
      ],
      actions: [],
    });
  }

  // ========== 批次 C 增强：网络切换诊断卡片 ==========
  if (result.networkChanges.length > 0 && !cards.some(c => c.category === 'network-change')) {
    const changeTimes = result.networkChanges.map(e => ({
      time: new Date(e.time).toLocaleString(),
      type: e.params?.change_type || e.params?.type || e.phaseName || '未知',
    }));
    cards.push({
      id: generateId('netlog-netchange', 0),
      source: 'netlog',
      category: 'network-change',
      severity: result.networkChanges.length > 3 ? 'warning' : 'info',
      confidence: 'high',
      title: `检测到网络切换 (${result.networkChanges.length} 次)`,
      conclusion: result.networkChanges.length > 3
        ? `采集期间发生 ${result.networkChanges.length} 次网络切换，频繁切换可能导致请求失败或超时`
        : `采集期间发生 ${result.networkChanges.length} 次网络切换，部分请求失败可能与网络切换有关`,
      scope: buildScope(result.networkChanges.length, undefined, 'global'),
      evidence: changeTimes.slice(0, 5).map((c, i) => ({
        label: `切换 ${i + 1}`,
        value: `${c.time} — ${c.type}`,
        source: 'netlog',
      })),
      actions: [
        {
          role: 'user',
          title: '稳定网络环境后重试',
          detail: '网络切换期间产生的错误可能是暂时性的，建议在稳定网络环境下重新采集',
        },
        {
          role: 'it',
          title: '排查网络切换原因',
          detail: '检查 WiFi/有线网络切换策略、VPN 连接稳定性、网络设备配置',
        },
      ],
    });
  }

  // 按严重程度排序
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  cards.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return cards;
}

function buildProxyCard(proxyInfo: ProxyInfo, result: AnalysisResult): DiagnosticCard {
  const evidence: DiagnosticEvidence[] = [
    {
      label: '代理模式',
      value: proxyInfo.proxyType || '未知',
      source: 'netlog',
    },
  ];
  if (proxyInfo.proxyList.length > 0) {
    evidence.push({
      label: '代理服务器',
      value: proxyInfo.proxyList.join(', '),
      source: 'netlog',
    });
  }
  if (proxyInfo.pacUrl) {
    evidence.push({
      label: 'PAC 地址',
      value: proxyInfo.pacUrl,
      source: 'netlog',
    });
  }

  return {
    id: generateId('netlog-proxy', 0),
    source: 'netlog',
    category: 'proxy',
    severity: 'info',
    confidence: 'high',
    title: proxyInfo.isVPN ? '检测到 VPN 环境' : '检测到代理服务器配置',
    conclusion: proxyInfo.isVPN
      ? '日志中检测到 VPN 使用迹象，VPN 可能导致网络延迟增加或 DNS 被接管'
      : `当前配置了代理（模式: ${proxyInfo.proxyType}），代理可能导致请求被拦截或延迟增加`,
    scope: buildScope(result.urlRequests.length, undefined, 'global'),
    evidence,
    actions: [
      {
        role: 'user',
        title: '临时关闭代理对比',
        detail: '在公司安全策略允许的情况下，临时关闭代理/VPN 后对比测试',
      },
      {
        role: 'it',
        title: '检查代理配置',
        detail: '确认代理服务器是否正常运行，PAC 脚本是否正确配置',
      },
    ],
  };
}

function buildDnsHijackCard(hijackedDomains: FailedDomain[]): DiagnosticCard {
  return {
    id: generateId('netlog-hijack', 0),
    source: 'netlog',
    category: 'dns',
    severity: 'critical',
    confidence: 'high',
    title: `检测到 DNS 劫持 (${hijackedDomains.length} 个域名)`,
    conclusion: 'DNS 劫持是严重的网络故障，通常是运营商 LOCAL DNS 故障导致，需要立即更换 DNS',
    scope: buildScope(hijackedDomains.reduce((s, d) => s + d.count, 0), hijackedDomains.length, 'multi-domain'),
    evidence: hijackedDomains.map((d, i) => ({
      label: `劫持域名 ${i + 1}`,
      value: `${d.domain} → ${d.ips.filter(ip => ip === '127.0.0.1' || ip === '0.0.0.0').join(', ')}`,
      source: 'netlog',
    })),
    actions: [
      {
        role: 'user',
        title: '紧急更换 DNS',
        detail: '国内用户立即将 DNS 更改为 223.5.5.5 或 119.29.29.29；海外用户更改为 8.8.8.8 或 1.1.1.1',
        command: 'nslookup example.com 223.5.5.5',
        platform: 'all',
        expectedResult: '应返回正确的公网 IP 地址',
      },
      {
        role: 'it',
        title: '修改企业 DNS 配置',
        detail: '联系公司 IT 修改 DHCP 出口 DNS，避免使用问题 DNS 服务器',
      },
    ],
    limitations: [
      '解析到私网 IP 不一定异常，企业内网服务、Split DNS、内网域名都可能解析到私网 IP',
    ],
  };
}

// ========== 采集质量检测 ==========

export function checkNetlogQuality(result: AnalysisResult): CollectionQuality {
  const issues: CollectionQuality['issues'] = [];
  const missingFields: string[] = [];
  const recommendations: string[] = [];

  // 检查事件数量
  if (result.totalEvents < 50) {
    issues.push({
      type: 'insufficient_data',
      severity: 'warning',
      message: '事件数量过少',
      detail: `仅 ${result.totalEvents} 个事件，可能无法完整反映网络状况`,
    });
    recommendations.push('建议在更多场景下采集 NetLog，确保包含完整的网络交互过程');
  }

  // 检查是否包含 constants
  if (result.totalEvents > 0 && !result.systemInfo.browser) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '未包含系统信息',
      detail: 'NetLog 未包含浏览器/操作系统信息，可能影响部分诊断',
    });
    missingFields.push('systemInfo');
  }

  // 检查 DNS 事件
  if (result.dnsEvents.length === 0) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '未包含 DNS 事件',
      detail: '当前 NetLog 未包含 DNS 配置数据，因此无法判断 DNS 服务器地址',
    });
    missingFields.push('dnsEvents');
    recommendations.push('采集 NetLog 时确保勾选 "Include raw bytes" 选项');
  }

  // 检查 Proxy 事件
  if (result.proxyEvents.length === 0 && !result.proxyInfo.hasProxy) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '未包含代理事件',
      detail: '当前 NetLog 未包含代理相关事件，无法判断代理配置',
    });
    missingFields.push('proxyEvents');
  }

  // 检查 SSL 事件
  if (result.sslEvents.length === 0 && result.urlRequests.some(r => r.url?.startsWith('https:'))) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '未包含 SSL 事件',
      detail: '存在 HTTPS 请求但未记录 SSL 事件，无法分析 TLS 握手细节',
    });
    missingFields.push('sslEvents');
  }

  // 检查 URL_REQUEST
  if (result.urlRequests.length === 0) {
    issues.push({
      type: 'insufficient_data',
      severity: 'warning',
      message: '未包含 URL 请求',
      detail: 'NetLog 中未找到 URL_REQUEST 事件，无法进行请求级分析',
    });
  }

  // 检查采集时间跨度
  const timeSpan = result.timeRange.end - result.timeRange.start;
  if (timeSpan > 0 && timeSpan < 5000) {
    issues.push({
      type: 'suspicious_pattern',
      severity: 'info',
      message: '采集时间跨度过短',
      detail: `仅 ${(timeSpan / 1000).toFixed(1)} 秒，可能未完整记录网络交互`,
    });
    recommendations.push('建议在完整复现问题后再停止 NetLog 采集');
  }

  return {
    source: 'netlog',
    isDiagnosable: result.totalEvents >= 20 && result.urlRequests.length > 0,
    issues,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
  };
}

// ========== 汇总函数 ==========

export function buildNetlogDiagnosisSummary(
  result: AnalysisResult,
  suggestions: Suggestion[]
): DiagnosisSummary {
  const cards = netlogToCards(result, suggestions);
  const quality = checkNetlogQuality(result);

  const overallSeverity: DiagnosisSummary['overallSeverity'] =
    cards.some(c => c.severity === 'critical') ? 'critical' :
    cards.some(c => c.severity === 'warning') ? 'warning' : 'info';

  return {
    cards,
    quality,
    overallSeverity,
  };
}
