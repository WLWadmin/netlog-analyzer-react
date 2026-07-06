import type {
  CipSipEvidenceRow,
  DnsAnswerEvidence,
  DnsIpEvidenceSummary,
  IpEvidenceItem,
  IpEvidenceAssociation,
  IpEvidenceRole,
  IpEvidenceSource,
  RequestImpact,
} from '../diagnosis/ipEvidence';
import { normalizeIp } from '../diagnosis/ipEvidence';
import {
  extractDnsAnswerCandidates as extractSharedDnsAnswerCandidates,
  summarizeDnsAnswerCandidates,
  type DnsAnswerCandidate,
} from '../parsers/netlog/dnsAnswerCandidates';
import { hasNetlogSourceDependencyMarker } from './netlogEventJsonProbe';

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
  eventJson?: string;
}

interface SocketProbeSnapshot {
  dependencies: { ids: number[]; unparsed: number };
  socketIps: Array<{ raw: unknown; source: IpEvidenceSource }>;
  paramKeys: string[];
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
const MAX_SOURCE_GRAPH_DEPTH = 8;
const DIRECT_SOURCE_ID_KEYS = [
  'source_id',
  'sourceId',
  'parent_source_id',
  'parentSourceId',
  'url_request_source_id',
  'urlRequestSourceId',
  'request_source_id',
  'requestSourceId',
  'stream_source_id',
  'streamSourceId',
  'socket_source_id',
  'socketSourceId',
  'connect_job_source_id',
  'connectJobSourceId',
  'job_source_id',
  'jobSourceId',
];

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

function requestImpact(req?: RequestDraft): RequestImpact {
  if (!req) return 'normal';
  if (req.error || (req.statusCode && req.statusCode >= 400)) return 'failed';
  if ((req.durationMs || 0) >= DEFAULT_SLOW_MS) return 'slow';
  return 'normal';
}

function extractSourceIdFromObject(value: Record<string, unknown>): number | undefined {
  const id = Number(value.id ?? value.source_id ?? value.sourceId);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function extractDependencySourceIds(params: Record<string, unknown>): { ids: number[]; unparsed: number } {
  const ids = new Set<number>();
  for (const key of DIRECT_SOURCE_ID_KEYS) {
    const id = Number(params[key]);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  const roots = [
    params.source,
    params.source_dependency,
    params.sourceDependency,
    params.source_dependencies,
    params.sourceDependencies,
    params.dependencies,
  ].filter(value => value !== undefined);
  let unparsed = 0;
  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') {
      unparsed += 1;
      return;
    }
    const value = node as Record<string, unknown>;
    const id = extractSourceIdFromObject(value);
    if (id) ids.add(id);
    const nested = [
      value.source_dependency,
      value.sourceDependency,
      value.source_dependencies,
      value.sourceDependencies,
      value.dependency,
      value.dependencies,
      value.source,
    ].filter(item => item !== undefined);
    if (!id && nested.length === 0) unparsed += 1;
    nested.forEach(item => visit(item, depth + 1));
  };
  roots.forEach(root => visit(root));
  return { ids: Array.from(ids), unparsed };
}

function addSourceLink(map: Map<number, Set<number>>, from: number, to?: number) {
  if (!to || from === to) return;
  if (!map.has(from)) map.set(from, new Set());
  if (!map.has(to)) map.set(to, new Set());
  map.get(from)!.add(to);
  map.get(to)!.add(from);
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
    return existing;
  }
  const item = { ...patch, id: key, ip, count: 1 };
  map.set(key, item);
  return item;
}

function increment(map: Record<string, number>, key: string | undefined) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function paramKeyStats(params: Record<string, unknown>): string[] {
  return Object.keys(params).sort();
}

function isLocalAddressEvent(typeName: string): boolean {
  return typeName.includes('LOCAL_ADDRESS');
}

function isSocketEvidenceEvent(typeName: string): boolean {
  return /SOCKET|CONNECT|UDP|TCP/.test(typeName) && !isLocalAddressEvent(typeName);
}

function extractJsonObjectBlock(json: string, key: string): string | undefined {
  const keyIndex = json.indexOf(`"${key}"`);
  if (keyIndex < 0) return undefined;
  const colonIndex = json.indexOf(':', keyIndex);
  if (colonIndex < 0) return undefined;
  let start = colonIndex + 1;
  while (start < json.length && /\s/.test(json[start])) start += 1;
  if (json[start] !== '{') return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < json.length; i += 1) {
    const ch = json[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return json.slice(start, i + 1);
    }
  }
  return undefined;
}

function extractJsonTopLevelKeys(jsonObjectBlock: string): string[] {
  const keys = new Set<string>();
  let depth = 0;
  let inString = false;
  let escape = false;
  let readingKey = false;
  let expectingKey = false;
  let keyBuffer = '';
  for (let i = 0; i < jsonObjectBlock.length; i += 1) {
    const ch = jsonObjectBlock[i];
    if (readingKey) {
      if (escape) {
        keyBuffer += ch;
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        readingKey = false;
        keys.add(keyBuffer);
        keyBuffer = '';
      } else {
        keyBuffer += ch;
      }
      continue;
    }
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (ch === '{' && depth === 1) expectingKey = true;
    else if (ch === ',' && depth === 1) expectingKey = true;
    else if (ch === ':' && depth === 1) expectingKey = false;
    else if (ch === '"' && depth === 1) {
      if (!expectingKey) {
        inString = true;
        continue;
      }
      readingKey = true;
      keyBuffer = '';
    } else if (ch === '"') {
      inString = true;
    }
  }
  return Array.from(keys).sort();
}

function extractJsonStringOrNumber(json: string, fieldNames: string[]): string | number | undefined {
  for (const fieldName of fieldNames) {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = json.match(new RegExp(`"${escaped}"\\s*:\\s*(?:"([^"]*)"|(-?\\d+(?:\\.\\d+)?))`));
    if (match?.[1] !== undefined) return match[1];
    if (match?.[2] !== undefined) return Number(match[2]);
  }
  return undefined;
}

function extractJsonSourceDependencyIds(json: string, paramsBlock: string): { ids: number[]; unparsed: number } {
  const ids = new Set<number>();
  for (const key of DIRECT_SOURCE_ID_KEYS) {
    const value = extractJsonStringOrNumber(paramsBlock, [key]);
    const id = Number(value);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  const hasDependencyLikeShape = hasNetlogSourceDependencyMarker(json) || /"source"\s*:/.test(paramsBlock);
  if (hasDependencyLikeShape) {
    const matches = paramsBlock.matchAll(/"(?:id|source_id|sourceId)"\s*:\s*(\d+)/g);
    for (const match of matches) {
      const id = Number(match[1]);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
  }
  return {
    ids: Array.from(ids),
    unparsed: hasDependencyLikeShape && ids.size === 0 ? 1 : 0,
  };
}

function probeSocketEvidenceParams(seed: EventSeed): SocketProbeSnapshot | undefined {
  if (!seed.eventJson || !isSocketEvidenceEvent(seed.typeName)) return undefined;
  const paramsBlock = extractJsonObjectBlock(seed.eventJson, 'params');
  if (!paramsBlock) return undefined;
  const socketIps = [
    { raw: extractJsonStringOrNumber(paramsBlock, ['ip_endpoint']), source: 'netlog.params.ip_endpoint' as const },
    { raw: extractJsonStringOrNumber(paramsBlock, ['address']), source: 'netlog.params.address' as const },
    { raw: extractJsonStringOrNumber(paramsBlock, ['peer_address']), source: 'netlog.params.peer_address' as const },
  ].flatMap(item => extractSocketIpValues(item.raw).map(raw => ({ raw, source: item.source })));
  if (socketIps.length === 0 && !hasNetlogSourceDependencyMarker(seed.eventJson)) return undefined;
  return {
    dependencies: extractJsonSourceDependencyIds(seed.eventJson, paramsBlock),
    socketIps,
    paramKeys: extractJsonTopLevelKeys(paramsBlock),
  };
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
    associations: Set<IpEvidenceAssociation>;
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
      associations: new Set(),
    };
    if (item.role === 'cip') row.cipIps.add(item.ip);
    if (item.role === 'sip') row.sipIps.add(item.ip);
    if (item.role === 'socket-peer') row.socketPeerIps.add(item.ip);
    if (item.role === 'dns-answer') row.dnsAnswerIps.add(item.ip);
    if (item.role === 'server-observed-client-ip') row.serverObservedClientIps.add(item.ip);
    row.items.push(item);
    row.descriptions.add(item.description);
    if (item.association) row.associations.add(item.association);
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
      evidenceAssociations: Array.from(row.associations),
    };
  });
}

export function createNetlogEndpointEvidenceReducer() {
  const requests = new Map<number, RequestDraft>();
  const sourceLinks = new Map<number, Set<number>>();
  const itemMap = new Map<string, IpEvidenceItem>();
  const socketPeerMeta = new Map<string, { typeName: string; sourceTypeName: string; paramKeys: string[]; hasSourceLinks: boolean }>();
  const dnsAnswerMap = new Map<string, DnsAnswerEvidence>();
  const dnsAnswerCandidates: DnsAnswerCandidate[] = [];
  let sourceDependencyEdges = 0;
  let sourceDependencyUnparsed = 0;

  const findLinkedRequest = (sourceId: number): { req: RequestDraft; depth: number } | undefined => {
    const direct = requests.get(sourceId);
    if (direct) return { req: direct, depth: 0 };
    const visited = new Set<number>([sourceId]);
    const queue: Array<{ sourceId: number; depth: number }> = [{ sourceId, depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= MAX_SOURCE_GRAPH_DEPTH) continue;
      const nextIds = sourceLinks.get(current.sourceId);
      if (!nextIds) continue;
      for (const nextId of nextIds) {
        if (visited.has(nextId)) continue;
        const req = requests.get(nextId);
        if (req) return { req, depth: current.depth + 1 };
        visited.add(nextId);
        queue.push({ sourceId: nextId, depth: current.depth + 1 });
      }
    }
    return undefined;
  };

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
      association: role === 'server-observed-client-ip' || role === 'cip' || role === 'sip'
        ? 'header-only'
        : 'direct-url-request',
      role,
      source,
      description,
    });
  };

  const accept = (seed: EventSeed) => {
    const params = seed.params || {};
    const socketProbe = probeSocketEvidenceParams(seed);
    const dependencies = socketProbe?.dependencies || extractDependencySourceIds(params);
    sourceDependencyUnparsed += dependencies.unparsed;
    for (const dependencySourceId of dependencies.ids) {
      const before = sourceLinks.get(seed.sourceId)?.size || 0;
      addSourceLink(sourceLinks, seed.sourceId, dependencySourceId);
      const after = sourceLinks.get(seed.sourceId)?.size || 0;
      if (after > before) sourceDependencyEdges += 1;
    }
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

    const socketIps = socketProbe?.socketIps || [
      { raw: params.ip_endpoint, source: 'netlog.params.ip_endpoint' as const },
      { raw: params.address, source: 'netlog.params.address' as const },
      { raw: params.peer_address, source: 'netlog.params.peer_address' as const },
    ].flatMap(item => extractSocketIpValues(item.raw).map(raw => ({ raw, source: item.source })));
    if (socketIps.length > 0 && isSocketEvidenceEvent(seed.typeName)) {
      for (const item of socketIps) {
        const evidence = addEvidence(itemMap, item.raw, {
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
          association: req ? 'direct-url-request' : 'global-candidate',
          associationReason: req ? 'direct-url-request' : undefined,
          unresolvedReason: req ? undefined : (sourceLinks.get(seed.sourceId)?.size ? 'sourceGraphNoUrlRequest' : 'noSourceLink'),
          description: req
            ? `Dataset ${seed.typeName}：${req.url}`
            : `Dataset ${seed.typeName}：连接目标候选 IP，未能关联到具体 URL_REQUEST`,
        });
        if (evidence) {
          socketPeerMeta.set(evidence.id, {
            typeName: seed.typeName,
            sourceTypeName: seed.sourceTypeName,
            paramKeys: socketProbe?.paramKeys || paramKeyStats(params),
            hasSourceLinks: Boolean(sourceLinks.get(seed.sourceId)?.size),
          });
        }
      }
    }

    for (const candidate of extractSharedDnsAnswerCandidates(params, seed)) {
      if (!candidate.host) continue;
      dnsAnswerCandidates.push(candidate);
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
          association: 'dns-only',
          description: `Dataset DNS answer：${answer.host} -> ${ip}`,
        });
      }
    }
    const items = Array.from(itemMap.values());
    const sourceGraphDepthHit: Record<string, number> = {};
    for (const item of items) {
      if (item.role !== 'socket-peer' || item.association !== 'global-candidate' || item.sourceId === undefined) continue;
      const linked = findLinkedRequest(item.sourceId);
      if (!linked) {
        const meta = socketPeerMeta.get(item.id);
        item.unresolvedReason = meta?.hasSourceLinks ? 'sourceGraphNoUrlRequest' : 'noSourceLink';
        continue;
      }
      const linkedReq = linked.req;
      item.host = hostFromUrl(linkedReq.url);
      item.url = linkedReq.url;
      item.impact = requestImpact(linkedReq);
      item.statusCode = linkedReq.statusCode;
      item.error = linkedReq.error;
      item.durationMs = linkedReq.durationMs;
      item.association = 'source-graph';
      item.associationReason = 'sourceDependency';
      item.unresolvedReason = undefined;
      item.description = `Dataset ${item.source}：通过 source graph 关联到 ${linkedReq.url || linkedReq.sourceId}`;
      increment(sourceGraphDepthHit, String(linked.depth));
    }
    const globalCandidateByTypeName: Record<string, number> = {};
    const globalCandidateBySourceTypeName: Record<string, number> = {};
    const globalCandidateParamKeys: Record<string, number> = {};
    const sourceGraphUnresolvedReasons: Record<string, number> = {};
    for (const item of items) {
      if (item.role !== 'socket-peer' || item.association !== 'global-candidate') continue;
      const meta = socketPeerMeta.get(item.id);
      increment(globalCandidateByTypeName, meta?.typeName || 'unknown');
      increment(globalCandidateBySourceTypeName, meta?.sourceTypeName || 'unknown');
      meta?.paramKeys.forEach(key => increment(globalCandidateParamKeys, key));
      increment(sourceGraphUnresolvedReasons, item.unresolvedReason || 'unknown');
    }
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
      sourceGraphStats: {
        socketPeerTotal: items.filter(item => item.role === 'socket-peer').length,
        socketPeerSourceGraphAssociated: items.filter(item => item.role === 'socket-peer' && item.association === 'source-graph').length,
        socketPeerGlobalCandidate: items.filter(item => item.role === 'socket-peer' && item.association === 'global-candidate').length,
        sourceDependencyEdges,
        sourceDependencyUnparsed,
        globalCandidateByTypeName,
        globalCandidateBySourceTypeName,
        globalCandidateParamKeys,
        sourceGraphDepthHit,
        sourceGraphUnresolvedReasons,
      },
      dnsAnswerSourceStats: summarizeDnsAnswerCandidates(dnsAnswerCandidates),
    };
  };

  return { accept, finish };
}
