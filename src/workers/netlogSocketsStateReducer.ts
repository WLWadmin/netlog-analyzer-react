import type { SocketsStateView } from './netlogDatasetViews';

interface EventSeed {
  eventId: number;
  byteStart: number;
  byteEnd: number;
  time?: number;
  typeName: string;
  sourceId: number;
  sourceTypeName: string;
  params?: Record<string, unknown>;
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
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
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

export function createNetlogSocketsStateReducer() {
  const sockets = new Map<number, SocketDraft>();
  const socketPools = new Set<string>();
  const errors: SocketsStateView['errors'] = [];
  const sourceLinks = new Map<string, SocketsStateView['sourceLinks'][number]>();
  let eventCount = 0;
  let connectCount = 0;
  let tlsCount = 0;
  let stallCount = 0;

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
    const seedTime = seed.time ?? 0;
    const upperType = seed.typeName.toUpperCase();
    const params = seed.params || {};
    const dependencySourceIds = extractDependencySourceIds(params).filter(id => id !== seed.sourceId);
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

    const peerAddress = firstString(params.peer_address, params.peerAddress, params.address, params.remote_address, params.ip_endpoint);
    if (peerAddress) draft.peerAddresses.add(peerAddress);

    const pool = firstString(params.group_name, params.groupName, params.pool_name, params.poolName, params.socket_pool, params.socketPool);
    if (pool) {
      draft.socketPools.add(pool);
      socketPools.add(pool);
    }

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

    const error = errorValue(params);
    if (error !== undefined) {
      draft.errorCount += 1;
      errors.push({
        eventId: seed.eventId,
        sourceId: seed.sourceId,
        typeName: seed.typeName,
        error,
        details: detailValue(params),
        peerAddress,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seedTime,
        sourceDependencyIds: dependencySourceIds,
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
    if (view.sourceLinks.length === 0 && view.eventCount > 0) {
      view.evidenceGaps.push('未发现 Socket 显式 source dependency 边；连接层影响范围不能用 peer address 或时间邻近直接外推。');
    }
    return view;
  };

  return { accept, finish };
}
