import type { AnalysisResult } from '../../parsers/netlog/parser';
import type { DiagnosticCard, DiagnosticCategory, DiagnosticEvidence } from './types';

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function setDiff(current: string[], baseline: string[]): string[] {
  const baselineSet = new Set(baseline);
  return uniq(current.filter(item => item && !baselineSet.has(item))).sort();
}

function safeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname || '/'}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function safeProxyValue(value: string): string {
  return value.replace(/\b(PROXY|HTTPS?|SOCKS5?)\s+([^;\s]+)/gi, (_match, kind: string, endpoint: string) => {
    const withoutCredentials = endpoint.includes('@') ? endpoint.slice(endpoint.lastIndexOf('@') + 1) : endpoint;
    return `${kind.toUpperCase()} ${withoutCredentials}`;
  });
}

function safeEndpointValue(value: string): string {
  return /^https?:\/\//i.test(value) ? safeUrl(value) : value;
}

function proxySignature(result: AnalysisResult): string[] {
  const info = result.proxyInfo;
  return [
    info.hasProxy ? 'has-proxy' : 'no-proxy',
    info.proxyType || '',
    info.pacUrl ? `pac:${safeUrl(info.pacUrl)}` : '',
    ...(info.proxyList || []).map(item => `proxy:${safeProxyValue(item)}`),
    info.isVPN ? 'vpn-hint' : '',
  ].filter(Boolean);
}

function protocolSignature(result: AnalysisResult): string[] {
  return Object.keys(result.protocols || {}).sort();
}

function failedDomainSignature(result: AnalysisResult): string[] {
  return result.failedDomains.flatMap(domain => domain.errorCodes.map(code => `${domain.domain}:${code}`));
}

function connectionFailureSignature(result: AnalysisResult): string[] {
  return result.connectionFailures.map(item => `${safeUrl(item.url)}:${item.error}`);
}

function tlsIssueSignature(result: AnalysisResult): string[] {
  return result.certIssues.map(item => `${item.host}:${item.error}`);
}

function networkChangeSignature(result: AnalysisResult): string[] {
  const counts = new Map<string, number>();
  return result.networkChanges.map(item => {
    const type = item.typeName || 'network-change';
    const occurrence = (counts.get(type) || 0) + 1;
    counts.set(type, occurrence);
    return `${type}#${occurrence}`;
  });
}

function ipSignature(result: AnalysisResult): string[] {
  return uniq(result.failedDomains.flatMap(domain => [...domain.ips, domain.resolvedIp, domain.remoteIp].filter(Boolean) as string[]));
}

function isIncomplete(result: AnalysisResult): boolean {
  return Boolean(result.largeFileMode?.truncatedEventsPreview || result.largeFileMode?.reachedEventsEnd === false);
}

function makeCard(input: {
  id: string;
  category: DiagnosticCategory;
  title: string;
  conclusion: string;
  additions: string[];
  baselineCount: number;
  currentCount: number;
  incomplete: boolean;
  severity?: DiagnosticCard['severity'];
  evidenceSource?: DiagnosticEvidence['source'];
}): DiagnosticCard {
  const { id, category, title, conclusion, additions, baselineCount, currentCount, incomplete, severity = 'warning', evidenceSource = 'netlog' } = input;
  return {
    id,
    source: 'netlog',
    category,
    severity: incomplete ? 'info' : severity,
    confidence: incomplete ? 'low' : 'medium',
    confidenceFactors: [
      { label: '异常样本新增差异', impact: 'positive', detail: `${additions.length} 个新增项` },
      ...(incomplete ? [{ label: '采集不完整', impact: 'negative' as const, detail: 'baseline 或 current NetLog 是 preview/truncated，不能生成高置信退化结论' }] : []),
    ],
    title,
    conclusion,
    scope: { type: additions.length > 1 ? 'multi-domain' : 'single-domain', summary: `${additions.length} 个新增项` },
    evidence: [
      { label: 'baseline 项数', value: String(baselineCount), source: evidenceSource },
      { label: 'current 项数', value: String(currentCount), source: evidenceSource },
      ...additions.slice(0, 8).map((item, index) => ({ label: `新增项 ${index + 1}`, value: item, source: evidenceSource })),
    ],
    limitations: ['差异本身不是根因，需要结合 HAR 请求、时间窗口和具体错误证据判断。'],
    actions: [{
      role: category === 'server' ? 'backend' : 'it',
      title: '核对新增差异',
      detail: '对比正常/异常环境的网络配置、代理、DNS、TLS 和协议策略。',
    }],
  };
}

export function compareNetlogBaselines(baseline: AnalysisResult, current: AnalysisResult): DiagnosticCard[] {
  const incomplete = isIncomplete(baseline) || isIncomplete(current);
  const specs: Array<{
    id: string;
    category: DiagnosticCategory;
    title: string;
    conclusion: string;
    baseline: string[];
    current: string[];
    severity?: DiagnosticCard['severity'];
  }> = [
    {
      id: 'netlog-baseline-dns-servers',
      category: 'dns',
      title: '异常 NetLog 新增 DNS 服务器或解析路径',
      conclusion: '异常环境出现正常环境未见的 DNS 服务器或 DoH 候选，是 DNS 路径变化线索。',
      baseline: [...baseline.dnsServers, ...(baseline.dohCandidates || []).map(item => safeEndpointValue(item.value))],
      current: [...current.dnsServers, ...(current.dohCandidates || []).map(item => safeEndpointValue(item.value))],
    },
    {
      id: 'netlog-baseline-proxy',
      category: 'proxy',
      title: '异常 NetLog 新增代理/PAC/VPN 线索',
      conclusion: '异常环境出现正常环境未见的代理、PAC 或 VPN 线索。',
      baseline: proxySignature(baseline),
      current: proxySignature(current),
    },
    {
      id: 'netlog-baseline-ip',
      category: 'connect',
      title: '异常 NetLog 新增 IP/出口差异',
      conclusion: '异常环境解析或连接到正常环境未见的 IP，可能代表出口、CDN 或调度变化。',
      baseline: ipSignature(baseline),
      current: ipSignature(current),
    },
    {
      id: 'netlog-baseline-tls',
      category: 'tls',
      title: '异常 NetLog 新增 TLS/证书错误',
      conclusion: '异常环境出现正常环境未见的 TLS 或证书错误。',
      baseline: tlsIssueSignature(baseline),
      current: tlsIssueSignature(current),
      severity: 'critical',
    },
    {
      id: 'netlog-baseline-protocol',
      category: 'protocol',
      title: '异常 NetLog 新增协议路径',
      conclusion: '异常环境出现正常环境未见的协议路径，可能是 HTTP/2、QUIC 或代理路径变化线索。',
      baseline: protocolSignature(baseline),
      current: protocolSignature(current),
    },
    {
      id: 'netlog-baseline-errors',
      category: 'unknown',
      title: '异常 NetLog 新增错误分布',
      conclusion: '异常环境出现正常环境未见的失败域名或连接错误。',
      baseline: [...failedDomainSignature(baseline), ...connectionFailureSignature(baseline)],
      current: [...failedDomainSignature(current), ...connectionFailureSignature(current)],
      severity: 'critical',
    },
    {
      id: 'netlog-baseline-network-change',
      category: 'network-change',
      title: '异常 NetLog 新增网络切换事件',
      conclusion: '异常环境出现正常环境未见的网络切换事件。',
      baseline: networkChangeSignature(baseline),
      current: networkChangeSignature(current),
    },
  ];

  const cards = specs.flatMap(spec => {
    const additions = setDiff(spec.current, spec.baseline);
    if (additions.length === 0) return [];
    return [makeCard({
      id: spec.id,
      category: spec.category,
      title: spec.title,
      conclusion: spec.conclusion,
      additions,
      baselineCount: spec.baseline.length,
      currentCount: spec.current.length,
      incomplete,
      severity: spec.severity,
    })];
  });

  if (cards.length === 0) {
    return [{
      id: 'netlog-baseline-no-new-diff',
      source: 'netlog',
      category: 'unknown',
      severity: 'info',
      confidence: incomplete ? 'low' : 'medium',
      title: 'NetLog A-B 对比未发现新增差异',
      conclusion: '异常 NetLog 未出现正常 NetLog 没有的 DNS、代理、TLS、协议、网络切换或错误分布差异。',
      scope: { type: 'unknown', summary: '未发现新增差异' },
      evidence: [
        { label: 'baseline events', value: String(baseline.totalEvents), source: 'netlog' },
        { label: 'current events', value: String(current.totalEvents), source: 'netlog' },
      ],
      limitations: incomplete ? ['采集不完整，不能把“未发现差异”作为强反证。'] : ['无新增差异不代表无问题，需要结合 HAR 和复现步骤。'],
      actions: [],
    }];
  }

  return cards;
}
