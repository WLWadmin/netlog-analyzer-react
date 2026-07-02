import type {
  CipSipEvidenceRow,
  DnsAnswerEvidence,
  DnsIpEvidenceSummary,
  IpEvidenceItem,
  IpEvidenceRole,
  IpEvidenceSource,
  RequestImpact,
} from '../diagnosis/ipEvidence';
import { normalizeIp } from '../diagnosis/ipEvidence';

interface EventSeed {
  eventId: number;
  byteStart?: number;
  byteEnd?: number;
  time: number;
  typeName: string;
  sourceId: number;
  sourceTypeName: string;
  phase: number;
  params?: Record<string, unknown>;
}

interface RequestDraft {
  sourceId: number;
  url?: string;
  method?: string;
  startTime?: number;
  endTime?: number;
  statusCode?: number;
  error?: string | number;
  durationMs?: number;
}

const DEFAULT_SLOW_MS = 1000;

function hostFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function parseHeaders(headers: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  const addLine = (line: string) => {
    const idx = line.indexOf(':');
    if (idx > 0) result[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  };
  if (Array.isArray(headers)) headers.forEach(line => typeof line === 'string' && addLine(line));
  else if (typeof headers === 'string') headers.split(/\r?\n/).forEach(addLine);
  else if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof value === 'string') result[key.toLowerCase()] = value;
      else if (Array.isArray(value)) result[key.toLowerCase()] = value.join(', ');
    }
  }
  return result;
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
    value.endpoint_address,
  ].filter(Boolean);
}

function extractDnsAnswerCandidates(params: Record<string, unknown>): Array<{ host: string; ips: string[] }> {
  const candidates: Array<{ host: string; ips: string[] }> = [];
  const add = (host: unknown, ips: unknown[]) => {
    if (typeof host !== 'string' || !host.trim()) return;
    const cleanIps = Array.from(new Set(ips.map(normalizeIp).filter((ip): ip is string => Boolean(ip))));
    if (cleanIps.length > 0) candidates.push({ host: host.trim(), ips: cleanIps });
  };

  const results = params.results;
  if (results && typeof results === 'object' && !Array.isArray(results)) {
    const value = results as Record<string, unknown>;
    const host = (value.aliases as unknown[])?.[0] || params.host || params.hostname || params.domain_name;
    const ipEndpoints = Array.isArray(value.ip_endpoints) ? value.ip_endpoints : [];
    add(host, ipEndpoints.flatMap(item => extractSocketIpValues(item)));
  }
  if (Array.isArray(results)) {
    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const value = item as Record<string, unknown>;
      const endpoints = Array.isArray(value.endpoints) ? value.endpoints : [];
      add(value.domain_name, endpoints.flatMap(endpoint => extractSocketIpValues(endpoint)));
    }
  }
  add(params.host || params.hostname || params.domain_name || params.qname, [
    params.address,
    params.address_list,
    params.endpoint_results,
    params.ip_endpoints,
  ].flatMap(value => Array.isArray(value) ? value.flatMap(extractSocketIpValues) : extractSocketIpValues(value)));

  return candidates;
}

function requestImpact(req?: RequestDraft): RequestImpact {
  if (!req) return 'normal';
  if (req.error || (req.statusCode && req.statusCode >= 400)) return 'failed';
  if ((req.durationMs || 0) >= DEFAULT_SLOW_MS) return 'slow';
  return 'normal';
}

function addEvidence(map: Map<string, IpEvidenceItem>, rawIp: unknown, patch: Omit<IpEvidenceItem, 'id' | 'ip' | 'count'>) {
  const ip = normalizeIp(rawIp);
  if (!ip) return;
  const key = [
    ip,
    patch.host || '',
    patch.role,
    patch.source,
    patch.url || '',
    patch.eventId ?? '',
    patch.sourceId ?? '',
    patch.description,
  ].join('|');
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  map.set(key, { ...patch, id: key, ip, count: 1 });
}

function buildRows(items: IpEvidenceItem[]): CipSipEvidenceRow[] {
  const rows = new Map<string, {
    host: string;
    cipIps: Set<string>;
    sipIps: Set<string>;
    socketPeerIps: Set<string>;
    dnsAnswerIps: Set<string>;
    serverObservedClientIps: Set<string>;
    items: IpEvidenceItem[];
    descriptions: Set<string>;
    traceKeys: Set<string>;
  }>();

  for (const item of items) {
    const host = item.host || hostFromUrl(item.url) || item.url || '-';
    const row = rows.get(host) || {
      host,
      cipIps: new Set(),
      sipIps: new Set(),
      socketPeerIps: new Set(),
      dnsAnswerIps: new Set(),
      serverObservedClientIps: new Set(),
      items: [],
      descriptions: new Set(),
      traceKeys: new Set(),
    };
    if (item.role === 'cip') row.cipIps.add(item.ip);
    if (item.role === 'sip') row.sipIps.add(item.ip);
    if (item.role === 'socket-peer') row.socketPeerIps.add(item.ip);
    if (item.role === 'dns-answer') row.dnsAnswerIps.add(item.ip);
    if (item.role === 'server-observed-client-ip') row.serverObservedClientIps.add(item.ip);
    row.items.push(item);
    row.descriptions.add(item.description);
    if (item.eventId !== undefined || item.sourceId !== undefined || item.byteStart !== undefined || item.byteEnd !== undefined) {
      row.traceKeys.add([item.eventId ?? '', item.sourceId ?? '', item.byteStart ?? '', item.byteEnd ?? ''].join(':'));
    }
    rows.set(host, row);
  }

  return Array.from(rows.values()).map(row => {
    const sortedItems = row.items.sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
    const representative = sortedItems[0];
    const evidenceTraces = Array.from(row.traceKeys).map(key => {
      const [eventId, sourceId, byteStart, byteEnd] = key.split(':');
      return {
        eventId: eventId === '' ? undefined : Number(eventId),
        sourceId: sourceId === '' ? undefined : Number(sourceId),
        byteStart: byteStart === '' ? undefined : Number(byteStart),
        byteEnd: byteEnd === '' ? undefined : Number(byteEnd),
      };
    });
    return {
      id: row.host,
      host: row.host,
      hostOrUrl: row.host,
      impact: representative?.impact || 'normal',
      statusCode: representative?.statusCode,
      error: representative?.error,
      durationMs: representative?.durationMs,
      cipIps: Array.from(row.cipIps).sort(),
      sipIps: Array.from(row.sipIps).sort(),
      socketPeerIps: Array.from(row.socketPeerIps).sort(),
      dnsAnswerIps: Array.from(row.dnsAnswerIps).sort(),
      serverObservedClientIps: Array.from(row.serverObservedClientIps).sort(),
      representativeRequests: sortedItems.slice(0, 3).map(item => ({
        url: item.url || item.host || '-',
        statusCode: item.statusCode,
        error: item.error,
        durationMs: item.durationMs,
        impact: item.impact,
      })),
      descriptions: Array.from(row.descriptions).slice(0, 6),
      evidenceTraces,
    };
  });
}

export function createNetlogEndpointEvidenceReducer() {
  const requests = new Map<number, RequestDraft>();
  const itemMap = new Map<string, IpEvidenceItem>();
  const dnsAnswerMap = new Map<string, DnsAnswerEvidence>();

  const addRequestEvidence = (
    req: RequestDraft | undefined,
    seed: EventSeed,
    rawIp: unknown,
    role: IpEvidenceRole,
    source: IpEvidenceSource,
    description: string
  ) => {
    addEvidence(itemMap, rawIp, {
      host: hostFromUrl(req?.url),
      url: req?.url,
      impact: requestImpact(req),
      statusCode: req?.statusCode,
      error: req?.error,
      durationMs: req?.durationMs,
      sourceId: seed.sourceId,
      eventId: seed.eventId,
      byteStart: seed.byteStart,
      byteEnd: seed.byteEnd,
      role,
      source,
      description,
    });
  };

  const accept = (seed: EventSeed) => {
    const params = seed.params || {};
    let req = seed.sourceTypeName === 'URL_REQUEST' ? requests.get(seed.sourceId) : undefined;
    if (seed.sourceTypeName === 'URL_REQUEST' && (params.url || !req)) {
      req = req || { sourceId: seed.sourceId };
      if (typeof params.url === 'string') req.url = params.url;
      if (typeof params.method === 'string') req.method = params.method;
      req.startTime = req.startTime ?? seed.time;
      requests.set(seed.sourceId, req);
    }
    if (req) {
      if (seed.phase === 1) {
        req.endTime = seed.time;
        if (req.startTime !== undefined) req.durationMs = seed.time - req.startTime;
      }
      const err = params.net_error ?? params.error_code;
      if (err !== undefined && err !== 0) req.error = Number(err);
      if (typeof params.status_code === 'number') req.statusCode = params.status_code;
      const headers = parseHeaders(params.headers);
      addRequestEvidence(req, seed, headers['x-response-cinfo'] || headers['x-tt-cip'] || headers['x-lsc-source-ip'], 'cip', 'netlog.URLRequest.resolvedIp', `Dataset response client-side IP header：${req.url || seed.sourceId}`);
      addRequestEvidence(req, seed, headers['x-response-sinfo'], 'sip', 'netlog.URLRequest.remoteIp', `Dataset response server-side IP header：${req.url || seed.sourceId}`);
      addRequestEvidence(req, seed, headers['x-request-ip'], 'server-observed-client-ip', 'netlog.headers.x-request-ip', `Dataset x-request-ip：${req.url || seed.sourceId}`);
    }

    const socketIps = [
      { raw: params.ip_endpoint, source: 'netlog.params.ip_endpoint' as const },
      { raw: params.address, source: 'netlog.params.address' as const },
      { raw: params.peer_address, source: 'netlog.params.peer_address' as const },
    ].flatMap(item => extractSocketIpValues(item.raw).map(raw => ({ raw, source: item.source })));
    if (socketIps.length > 0 && /SOCKET|CONNECT|UDP|TCP/.test(seed.typeName)) {
      for (const item of socketIps) {
        addEvidence(itemMap, item.raw, {
          host: req ? hostFromUrl(req.url) : '未关联到具体请求',
          url: req?.url,
          impact: requestImpact(req),
          statusCode: req?.statusCode,
          error: req?.error,
          durationMs: req?.durationMs,
          sourceId: seed.sourceId,
          eventId: seed.eventId,
          byteStart: seed.byteStart,
          byteEnd: seed.byteEnd,
          role: 'socket-peer',
          source: item.source,
          description: req
            ? `Dataset ${seed.typeName}：${req.url}`
            : `Dataset ${seed.typeName}：连接目标候选 IP，未能关联到具体 URL_REQUEST`,
        });
      }
    }

    for (const candidate of extractDnsAnswerCandidates(params)) {
      const key = candidate.host;
      const existing = dnsAnswerMap.get(key);
      const ips = existing ? Array.from(new Set([...existing.ips, ...candidate.ips])) : candidate.ips;
      dnsAnswerMap.set(key, {
        host: candidate.host,
        ips,
        source: 'dns_event',
        time: seed.time,
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
      });
    }
  };

  const finish = (): DnsIpEvidenceSummary => {
    const dnsAnswers = Array.from(dnsAnswerMap.values()).filter(item => item.ips.length > 0);
    for (const answer of dnsAnswers) {
      for (const ip of answer.ips) {
        addEvidence(itemMap, ip, {
          host: answer.host,
          impact: 'dns',
          role: 'dns-answer',
          source: 'netlog.dnsRecords.ips',
          sourceId: answer.sourceId,
          eventId: answer.eventId,
          byteStart: answer.byteStart,
          byteEnd: answer.byteEnd,
          description: `Dataset DNS answer：${answer.host} -> ${ip}`,
        });
      }
    }
    const items = Array.from(itemMap.values());
    return {
      dnsServers: [],
      dnsAnswers,
      dohCandidates: [],
      dnsEventCount: dnsAnswers.length,
      failedOrSlowIps: items,
      cipSipRows: buildRows(items),
      copyableIps: Array.from(new Set([...items.map(item => item.ip), ...dnsAnswers.flatMap(item => item.ips)])),
      copyableDnsServers: [],
      guidance: [
        'Dataset Endpoint Evidence 基于全量事件扫描产出，不受 eventsPreview 和 URL_REQUEST.events 截断限制。',
      ],
      limitations: [
        'socket peer 若无法关联 URL_REQUEST，会作为连接目标候选 IP 展示，不能直接等同 SIP。',
      ],
    };
  };

  return { accept, finish };
}
