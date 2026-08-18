import type { SocketsStateView } from './netlogDatasetViews';
import { hasNetlogSourceDependencyMarker } from './netlogEventJsonProbe';
import { normalizeNetlogErrorValue } from './netlogErrorValue';

interface EventSeed {
  eventId: number;
  byteStart: number;
  byteEnd: number;
  time?: number;
  typeName: string;
  sourceId: number;
  sourceTypeName: string;
  params?: Record<string, unknown>;
  eventJson?: string;
  earlyPath?: boolean;
}

interface SocketParamsSnapshot {
  dependencySourceIds: number[];
  peerAddress?: string;
  pool?: string;
  error?: number | string;
  details?: string;
  source: 'probe' | 'params';
}

interface SocketDraft {
  sourceId: number;
  sourceTypeName: string;
  eventCount: number;
  connectCount: number;
  tlsCount: number;
  stallCount: number;
  errorCount: number;
  peerAddresses: Set<string>;
  socketPools: Set<string>;
  firstEventId?: number;
  lastEventId?: number;
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
  sourceDependencyIds: Set<number>;
}

function isSocketEvent(seed: EventSeed): boolean {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  return text.includes('SOCKET') || text.includes('TCP_') || text.includes('SSL_') || text.includes('TLS_') || text.includes('TRANSPORT_CONNECT');
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function errorValue(params: Record<string, unknown> | undefined): number | string | undefined {
  const value = params?.net_error ?? params?.error_code ?? params?.error ?? params?.os_error ?? params?.ssl_error;
  return normalizeNetlogErrorValue(value);
}

function detailValue(params: Record<string, unknown> | undefined): string | undefined {
  return firstString(params?.details, params?.description, params?.reason, params?.net_error_details);
}

function extractSourceIdFromObject(value: Record<string, unknown>): number | undefined {
  const id = Number(value.id ?? value.source_id ?? value.sourceId);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function extractDependencySourceIds(params: Record<string, unknown> | undefined): number[] {
  if (!params) return [];
  const roots = [
    params.source,
    params.source_dependency,
    params.sourceDependency,
    params.source_dependencies,
    params.sourceDependencies,
    params.dependencies,
  ].filter(value => value !== undefined);
  const ids = new Set<number>();
  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const value = node as Record<string, unknown>;
    const id = extractSourceIdFromObject(value);
    if (id) ids.add(id);
    [
      value.source,
      value.source_dependency,
      value.sourceDependency,
      value.source_dependencies,
      value.sourceDependencies,
      value.dependency,
      value.dependencies,
    ].filter(item => item !== undefined).forEach(item => visit(item, depth + 1));
  };
  roots.forEach(root => visit(root));
  return Array.from(ids);
}

function classifySocketImpact(typeName: string): SocketsStateView['impactSummaries'][number]['kind'] {
  const upper = typeName.toUpperCase();
  if (upper.includes('STALL') || upper.includes('TIMEOUT')) return 'stall';
  if (upper.includes('SSL_') || upper.includes('TLS_')) return 'tls';
  if (
    upper === 'TCP_CONNECT' ||
    upper === 'SOCKET_CONNECT' ||
    upper.startsWith('TRANSPORT_CONNECT') ||
    upper.endsWith('_CONNECT_ATTEMPT') ||
    upper === 'TCP_CONNECT_ATTEMPT'
  ) return 'connect';
  if (upper.includes('SOCKET_POOL') || upper.includes('CONNECT_JOB')) return 'pool';
  return 'socket-event';
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

function extractJsonSourceDependencyIds(json: string): number[] | undefined {
  const paramsBlock = extractJsonObjectBlock(json, 'params');
  if (!paramsBlock) return undefined;
  const hasDependencyLikeShape = hasNetlogSourceDependencyMarker(json) || /"source"\s*:/.test(paramsBlock);
  if (!hasDependencyLikeShape) return [];
  const ids = new Set<number>();
  const matches = paramsBlock.matchAll(/"(?:id|source_id|sourceId)"\s*:\s*(\d+)/g);
  for (const match of matches) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return ids.size > 0 ? Array.from(ids) : undefined;
}

function probeSocketParams(seed: EventSeed): SocketParamsSnapshot | undefined {
  if (!seed.eventJson) return undefined;
  const dependencySourceIds = extractJsonSourceDependencyIds(seed.eventJson);
  if (dependencySourceIds === undefined) return undefined;
  const peerAddress = firstString(extractJsonStringOrNumber(seed.eventJson, ['peer_address', 'peerAddress', 'address', 'remote_address', 'ip_endpoint']));
  const pool = firstString(extractJsonStringOrNumber(seed.eventJson, ['group_name', 'groupName', 'pool_name', 'poolName', 'socket_pool', 'socketPool']));
  const error = normalizeNetlogErrorValue(extractJsonStringOrNumber(seed.eventJson, ['net_error', 'error_code', 'error', 'os_error', 'ssl_error']));
  const details = firstString(extractJsonStringOrNumber(seed.eventJson, ['details', 'description', 'reason', 'net_error_details']));
  return {
    dependencySourceIds: dependencySourceIds.filter(id => id !== seed.sourceId),
    peerAddress,
    pool,
    error,
    details,
    source: 'probe',
  };
}

export function canProbeSocketParamsFromEventJson(eventJson: string): boolean {
  return extractJsonSourceDependencyIds(eventJson) !== undefined;
}

function paramsSocketSnapshot(seed: EventSeed): SocketParamsSnapshot {
  const params = seed.params || {};
  return {
    dependencySourceIds: extractDependencySourceIds(params).filter(id => id !== seed.sourceId),
    peerAddress: firstString(params.peer_address, params.peerAddress, params.address, params.remote_address, params.ip_endpoint),
    pool: firstString(params.group_name, params.groupName, params.pool_name, params.poolName, params.socket_pool, params.socketPool),
    error: errorValue(params),
    details: detailValue(params),
    source: 'params',
  };
}

export function createNetlogSocketsStateReducer() {
  const sockets = new Map<number, SocketDraft>();
  const socketPools = new Set<string>();
  const errors: SocketsStateView['errors'] = [];
  const sourceLinks = new Map<string, SocketsStateView['sourceLinks'][number]>();
  const impactSummaries: SocketsStateView['impactSummaries'] = [];
  let eventCount = 0;
  let connectCount = 0;
  let tlsCount = 0;
  let stallCount = 0;
  let probeAttemptedEvents = 0;
  let probeSatisfiedEvents = 0;
  let fallbackParamEvents = 0;
  let earlyReducerEvents = 0;

  const ensureSocket = (seed: EventSeed): SocketDraft => {
    const existing = sockets.get(seed.sourceId);
    if (existing) return existing;
    const created: SocketDraft = {
      sourceId: seed.sourceId,
      sourceTypeName: seed.sourceTypeName,
      eventCount: 0,
      connectCount: 0,
      tlsCount: 0,
      stallCount: 0,
      errorCount: 0,
      peerAddresses: new Set<string>(),
      socketPools: new Set<string>(),
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seed.time ?? 0,
      lastTime: seed.time ?? 0,
      sourceDependencyIds: new Set<number>(),
    };
    sockets.set(seed.sourceId, created);
    return created;
  };

  const accept = (seed: EventSeed) => {
    if (!isSocketEvent(seed)) return;
    eventCount += 1;
    if (seed.earlyPath) earlyReducerEvents += 1;
    const seedTime = seed.time ?? 0;
    const upperType = seed.typeName.toUpperCase();
    if (seed.eventJson) probeAttemptedEvents += 1;
    const probedParams = probeSocketParams(seed);
    if (probedParams) probeSatisfiedEvents += 1;
    else fallbackParamEvents += 1;
    const paramsSnapshot = probedParams || paramsSocketSnapshot(seed);
    const dependencySourceIds = paramsSnapshot.dependencySourceIds;
    const draft = ensureSocket(seed);
    draft.eventCount += 1;
    draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
    draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
    draft.firstByteStart = Math.min(draft.firstByteStart ?? seed.byteStart, seed.byteStart);
    draft.lastByteEnd = Math.max(draft.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
    draft.firstTime = Math.min(draft.firstTime ?? seedTime, seedTime);
    draft.lastTime = Math.max(draft.lastTime ?? seedTime, seedTime);
    dependencySourceIds.forEach(id => draft.sourceDependencyIds.add(id));
    for (const dependencySourceId of dependencySourceIds) {
      sourceLinks.set(`${seed.sourceId}-${dependencySourceId}-source-dependency`, {
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seed.time,
        typeName: seed.typeName,
        fromSourceId: seed.sourceId,
        toSourceId: dependencySourceId,
        kind: 'source-dependency',
      });
    }

    const peerAddress = paramsSnapshot.peerAddress;
    if (peerAddress) draft.peerAddresses.add(peerAddress);

    const pool = paramsSnapshot.pool;
    if (pool) {
      draft.socketPools.add(pool);
      socketPools.add(pool);
    }
    const impactKind = classifySocketImpact(seed.typeName);
    const requestScoped = dependencySourceIds.length > 0 || /URL_REQUEST/i.test(seed.sourceTypeName) || /URL_REQUEST/i.test(seed.typeName);
    const baseSummary = [
      seed.typeName,
      peerAddress ? `peer=${peerAddress}` : undefined,
      pool ? `pool=${pool}` : undefined,
      dependencySourceIds.length ? `sourceDependencies=${dependencySourceIds.join(',')}` : undefined,
    ].filter(Boolean).join('；');
    impactSummaries.push({
      sourceId: seed.sourceId,
      eventId: seed.eventId,
      byteStart: seed.byteStart,
      byteEnd: seed.byteEnd,
      time: seed.time,
      typeName: seed.typeName,
      kind: impactKind,
      peerAddress,
      socketPools: pool ? [pool] : undefined,
      sourceDependencyIds: dependencySourceIds,
      requestScoped,
      summary: baseSummary,
      unresolvedReason: requestScoped ? undefined : '缺少 source_dependency 或 URL_REQUEST 锚点；peer address/connect/stall 只能作为连接层候选线索。',
    });

    if (
      upperType === 'TCP_CONNECT' ||
      upperType === 'SOCKET_CONNECT' ||
      upperType.startsWith('TRANSPORT_CONNECT') ||
      upperType.endsWith('_CONNECT_ATTEMPT') ||
      upperType === 'TCP_CONNECT_ATTEMPT'
    ) {
      draft.connectCount += 1;
      connectCount += 1;
    }
    if (upperType.includes('SSL_') || upperType.includes('TLS_')) {
      draft.tlsCount += 1;
      tlsCount += 1;
    }
    if (upperType.includes('STALL') || upperType.includes('TIMEOUT')) {
      draft.stallCount += 1;
      stallCount += 1;
    }

    const error = paramsSnapshot.error;
    if (error !== undefined) {
      draft.errorCount += 1;
      errors.push({
        eventId: seed.eventId,
        sourceId: seed.sourceId,
        typeName: seed.typeName,
        error,
        details: paramsSnapshot.details,
        peerAddress,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seedTime,
        sourceDependencyIds: dependencySourceIds,
      });
      impactSummaries.push({
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seedTime,
        typeName: seed.typeName,
        kind: 'error',
        peerAddress,
        socketPools: pool ? [pool] : undefined,
        error,
        details: paramsSnapshot.details,
        sourceDependencyIds: dependencySourceIds,
        requestScoped,
        summary: [
          seed.typeName,
          peerAddress ? `peer=${peerAddress}` : undefined,
          pool ? `pool=${pool}` : undefined,
          `error=${error}`,
          dependencySourceIds.length ? `sourceDependencies=${dependencySourceIds.join(',')}` : undefined,
        ].filter(Boolean).join('；'),
        unresolvedReason: requestScoped ? undefined : '缺少 source_dependency 或 URL_REQUEST 锚点；socket error 只能作为连接层错误候选线索。',
      });
    }
    sockets.set(seed.sourceId, draft);
  };

  const finish = (): SocketsStateView => {
    const view: SocketsStateView = {
      sockets: Array.from(sockets.values()).map(socket => ({
        sourceId: socket.sourceId,
        sourceTypeName: socket.sourceTypeName,
        eventCount: socket.eventCount,
        connectCount: socket.connectCount,
        tlsCount: socket.tlsCount,
        stallCount: socket.stallCount,
        errorCount: socket.errorCount,
        peerAddresses: Array.from(socket.peerAddresses),
        socketPools: Array.from(socket.socketPools),
        firstEventId: socket.firstEventId,
        lastEventId: socket.lastEventId,
        firstByteStart: socket.firstByteStart,
        lastByteEnd: socket.lastByteEnd,
        firstTime: socket.firstTime,
        lastTime: socket.lastTime,
        sourceDependencyIds: Array.from(socket.sourceDependencyIds),
      })),
      sourceLinks: Array.from(sourceLinks.values()),
      errors,
      impactSummaries,
      requestScopedCandidateCount: impactSummaries.filter(item => item.requestScoped).length,
      lazyParamsStats: {
        probeAttemptedEvents,
        probeSatisfiedEvents,
        fallbackParamEvents,
        earlyReducerEvents,
      },
      eventCount,
      connectCount,
      tlsCount,
      stallCount,
      socketPoolCount: socketPools.size,
      evidenceGaps: [],
    };
    if (view.eventCount === 0) {
      view.evidenceGaps.push('未发现 Socket / TCP / TLS 事件；不代表没有建立连接，只表示当前 Dataset 未捕获连接层事件。');
    } else {
      view.evidenceGaps.push('Socket / TLS 事件是连接层事实，不能单独把 peer address、connect error 或候选 IP 当成请求根因。');
    }
    if (view.errors.length > 0 || view.stallCount > 0) {
      view.evidenceGaps.push('发现 connect error / stall / timeout 时，仍需结合请求 source chain、DNS、代理和协议回退判断影响范围。');
    }
    if (view.impactSummaries.some(item => !item.requestScoped)) {
      view.evidenceGaps.push('部分 Socket impact 只有连接层锚点，缺少 source_dependency 或 URL_REQUEST 关联；只能作为连接层候选线索。');
    }
    if (view.sourceLinks.length === 0 && view.eventCount > 0) {
      view.evidenceGaps.push('未发现 Socket 显式 source dependency 边；连接层影响范围不能用 peer address 或时间邻近直接外推。');
    }
    return view;
  };

  return { accept, finish };
}
