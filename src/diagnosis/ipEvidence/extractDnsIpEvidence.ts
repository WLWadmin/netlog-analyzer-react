import type { HarAnalysisResult, HarRequestEntry } from '../../harParser';
import type { AnalysisResult, URLRequest } from '../../parsers/netlog/parser';
import { classifyDnsServer } from './classifyDnsServer';
import { normalizeIp } from './ipNormalize';
import type {
  CipSipEvidenceRow,
  DnsAnswerEvidence,
  DnsIpEvidenceSummary,
  DnsServerEvidence,
  IpEvidenceItem,
  RequestImpact,
} from './ipEvidenceTypes';

const DEFAULT_SLOW_MS = 1000;

function hostFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function isProblemHarEntry(entry: HarRequestEntry): boolean {
  return entry.isFailed || entry.status >= 400 || entry.isSlow || entry.time >= DEFAULT_SLOW_MS;
}

function isProblemNetlogRequest(req: URLRequest): boolean {
  return Boolean(req.error || (req.statusCode && req.statusCode >= 400) || (req.duration || 0) >= DEFAULT_SLOW_MS);
}

function impactFromHarEntry(entry: HarRequestEntry): RequestImpact {
  if (entry.isFailed || entry.status >= 400) return 'failed';
  if (entry.isSlow || entry.time >= DEFAULT_SLOW_MS) return 'slow';
  return 'normal';
}

function impactFromNetlogRequest(req: URLRequest): RequestImpact {
  if (req.error || (req.statusCode && req.statusCode >= 400)) return 'failed';
  if ((req.duration || 0) >= DEFAULT_SLOW_MS) return 'slow';
  return 'normal';
}

function extractSocketIpValues(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object') return [raw];
  const value = raw as Record<string, unknown>;
  return [
    value.ip,
    value.address,
    value.ip_address,
    value.endpoint,
    value.ip_endpoint,
  ].filter(Boolean);
}

function addIpEvidence(
  map: Map<string, IpEvidenceItem>,
  rawIp: unknown,
  patch: Omit<IpEvidenceItem, 'id' | 'ip' | 'count'>
) {
  const ip = normalizeIp(rawIp);
  if (!ip) return;

  const key = [ip, patch.host || '', patch.role, patch.source, patch.impact, patch.url || ''].join('|');
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }

  map.set(key, {
    ...patch,
    id: key,
    ip,
    count: 1,
  });
}

function buildRows(items: IpEvidenceItem[]): CipSipEvidenceRow[] {
  const draftRows = new Map<string, {
    host: string;
    cipIps: Set<string>;
    sipIps: Set<string>;
    items: IpEvidenceItem[];
    descriptions: Set<string>;
  }>();

  for (const item of items) {
    const baseHost = item.host || hostFromUrl(item.url) || item.url || '-';
    const provisionalKey = baseHost;
    const row = draftRows.get(provisionalKey) || {
      host: baseHost,
      cipIps: new Set<string>(),
      sipIps: new Set<string>(),
      items: [],
      descriptions: new Set<string>(),
    };

    if (item.role === 'cip') {
      row.cipIps.add(item.ip);
    }
    if (item.role === 'sip' || item.role === 'socket-peer' || item.role === 'dns-answer') {
      row.sipIps.add(item.ip);
    }
    row.items.push(item);
    row.descriptions.add(item.description);
    draftRows.set(provisionalKey, row);
  }

  const mergedRows = new Map<string, CipSipEvidenceRow>();
  for (const row of draftRows.values()) {
    const cipIps = Array.from(row.cipIps).sort();
    const sipIps = Array.from(row.sipIps).sort();
    const key = [row.host, cipIps.join(','), sipIps.join(',')].join('|');
    const uniqueItems = Array.from(new Map(row.items.map(item => [
      [item.url || item.host || '-', item.statusCode || '', item.error || '', item.durationMs || ''].join('|'),
      item,
    ])).values());
    const sortedItems = uniqueItems.sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
    const topItems = sortedItems.slice(0, 3);
    const representative = topItems[0] || sortedItems[0];
    const existing = mergedRows.get(key);
    const nextRequests = topItems.map(item => ({
      url: item.url || item.host || '-',
      statusCode: item.statusCode,
      error: item.error,
      durationMs: item.durationMs,
      impact: item.impact,
    }));

    if (existing) {
      existing.representativeRequests = [...existing.representativeRequests, ...nextRequests]
        .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
        .slice(0, 3);
      existing.durationMs = Math.max(existing.durationMs || 0, representative?.durationMs || 0);
      existing.descriptions = Array.from(new Set([...existing.descriptions, ...row.descriptions])).slice(0, 6);
      continue;
    }

    mergedRows.set(key, {
      id: key,
      host: row.host,
      hostOrUrl: row.host,
      impact: representative?.impact || 'normal',
      statusCode: representative?.statusCode,
      error: representative?.error,
      durationMs: representative?.durationMs,
      cipIps,
      sipIps,
      representativeRequests: nextRequests,
      descriptions: Array.from(row.descriptions).slice(0, 6),
    });
  }

  return Array.from(mergedRows.values()).sort((a, b) => {
    const impactScore = (impact: RequestImpact) => impact === 'failed' ? 0 : impact === 'slow' ? 1 : 2;
    const impactDiff = impactScore(a.impact) - impactScore(b.impact);
    if (impactDiff !== 0) return impactDiff;
    return (b.durationMs || 0) - (a.durationMs || 0);
  });
}

function buildSummary(
  dnsServers: DnsServerEvidence[],
  dnsAnswers: DnsAnswerEvidence[],
  items: IpEvidenceItem[],
  options?: { dnsEventCount?: number }
): DnsIpEvidenceSummary {
  const copyableIps = Array.from(new Set([
    ...items.map(item => item.ip),
    ...dnsAnswers.flatMap(item => item.ips),
  ])).filter(Boolean);
  const copyableDnsServers = Array.from(new Set(dnsServers.map(item => item.ip))).filter(Boolean);

  return {
    dnsServers,
    dnsAnswers,
    dnsEventCount: options?.dnsEventCount,
    failedOrSlowIps: items,
    cipSipRows: buildRows(items),
    copyableIps,
    copyableDnsServers,
    guidance: [
      '先看 DNS 服务器是否为海外公共 DNS、本地网关 DNS 或公共 DNS；如怀疑 CDN 调度异常，优先对比运营商 DNS / 企业 DNS。',
      '再复制失败/慢请求关联的 CIP/SIP 到可访问的 IP 归属查询网站、企业 IP 库或发给网络团队确认运营商和地域。',
      '如果失败/慢请求 SIP 或 DNS answer 查询结果为海外，属于跨境调度线索；如果与用户当前网络运营商不同，属于跨运营商访问线索。',
    ],
    limitations: [
      '本模块不联网查询 IP 归属，也不会自动外发公网 IP。',
      '仅凭 HAR / NetLog 不能确认链路故障；如需确认，请补充 MTR / traceroute、客户端出口 IP 和复现时间。',
      'CIP/SIP 的具体语义取决于原始字段，请以“来源字段”列为准。',
    ],
  };
}

export function extractDnsIpEvidenceFromHar(result: HarAnalysisResult): DnsIpEvidenceSummary {
  const itemMap = new Map<string, IpEvidenceItem>();

  for (const entry of result.entries || []) {
    if (!isProblemHarEntry(entry)) continue;
    const host = entry.domain || hostFromUrl(entry.url);
    const impact = impactFromHarEntry(entry);
    const base = {
      host,
      url: entry.url,
      impact,
      statusCode: entry.status,
      durationMs: entry.time,
    };

    addIpEvidence(itemMap, entry.remoteAddress, {
      ...base,
      role: 'sip',
      source: 'har.serverIPAddress',
      description: `HAR serverIPAddress：${entry.method} ${entry.status || '-'} ${entry.url}`,
    });
    addIpEvidence(itemMap, entry.xTtCip, {
      ...base,
      role: 'cip',
      source: 'har.x-tt-cip',
      description: `HAR x-tt-cip：${entry.method} ${entry.status || '-'} ${entry.url}`,
    });
    addIpEvidence(itemMap, entry.xLscSourceIp, {
      ...base,
      role: 'cip',
      source: 'har.x-lsc-source-ip',
      description: `HAR x-lsc-source-ip：${entry.method} ${entry.status || '-'} ${entry.url}`,
    });
  }

  return buildSummary([], [], Array.from(itemMap.values()), { dnsEventCount: 0 });
}

export function extractDnsIpEvidenceFromNetlog(result: AnalysisResult): DnsIpEvidenceSummary {
  const itemMap = new Map<string, IpEvidenceItem>();
  const dnsServers = Array.from(new Set(result.dnsServers || []))
    .map(normalizeIp)
    .filter((ip): ip is string => Boolean(ip))
    .map(classifyDnsServer);
  const dnsAnswers: DnsAnswerEvidence[] = (result.dnsRecords || [])
    .map(record => ({
      host: record.host,
      ips: Array.from(new Set((record.ips || []).map(normalizeIp).filter((ip): ip is string => Boolean(ip)))),
      source: record.source,
      time: record.time,
    }))
    .filter(record => record.ips.length > 0);

  for (const req of result.urlRequests || []) {
    if (!isProblemNetlogRequest(req)) continue;
    const host = hostFromUrl(req.url);
    const impact = impactFromNetlogRequest(req);
    const base = {
      host,
      url: req.url,
      impact,
      statusCode: req.statusCode,
      error: req.error,
      durationMs: req.duration,
    };

    addIpEvidence(itemMap, req.resolvedIp, {
      ...base,
      role: 'cip',
      source: 'netlog.URLRequest.resolvedIp',
      description: `NetLog resolvedIp：${req.method} ${req.statusCode || req.errorDesc || req.error || '-'} ${req.url}`,
    });
    addIpEvidence(itemMap, req.remoteIp, {
      ...base,
      role: 'sip',
      source: 'netlog.URLRequest.remoteIp',
      description: `NetLog remoteIp：${req.method} ${req.statusCode || req.errorDesc || req.error || '-'} ${req.url}`,
    });

    for (const evt of req.events || []) {
      const params = evt.params || {};
      const rawSocketIps = [
        { raw: params.ip_endpoint, source: 'netlog.params.ip_endpoint' as const },
        { raw: params.address, source: 'netlog.params.address' as const },
        { raw: params.peer_address, source: 'netlog.params.peer_address' as const },
      ].flatMap(item => extractSocketIpValues(item.raw).map(raw => ({ raw, source: item.source })));

      for (const item of rawSocketIps) {
        addIpEvidence(itemMap, item.raw, {
          ...base,
          role: 'socket-peer',
          source: item.source,
          description: `NetLog ${evt.typeName || 'socket'}：${req.method} ${req.statusCode || req.errorDesc || req.error || '-'} ${req.url}`,
        });
      }
    }
  }

  const problemHosts = new Set(Array.from(itemMap.values()).map(item => item.host).filter(Boolean));
  for (const domain of result.failedDomains || []) {
    const failedIps = [...(domain.ips || []), domain.resolvedIp, domain.remoteIp];
    for (const ip of failedIps) {
      addIpEvidence(itemMap, ip, {
        host: domain.domain,
        impact: 'failed',
        error: domain.errorCodes?.join(','),
        role: 'sip',
        source: 'netlog.failedDomains.ips',
        description: `NetLog failedDomains：${domain.domain} errors=${domain.errorCodes?.join(',') || '-'}`,
      });
    }
  }

  for (const answer of dnsAnswers) {
    if (!problemHosts.has(answer.host)) continue;
    for (const ip of answer.ips) {
      addIpEvidence(itemMap, ip, {
        host: answer.host,
        impact: 'dns',
        role: 'dns-answer',
        source: 'netlog.dnsRecords.ips',
        description: `NetLog dnsRecords：${answer.host} -> ${ip}`,
      });
    }
  }

  return buildSummary(dnsServers, dnsAnswers, Array.from(itemMap.values()), {
    dnsEventCount: result.dnsEvents?.length || 0,
  });
}
