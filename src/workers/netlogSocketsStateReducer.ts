import type { SocketsStateView } from './netlogDatasetViews';

interface EventSeed {
  eventId: number;
  byteStart: number;
  byteEnd: number;
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

export function createNetlogSocketsStateReducer() {
  const sockets = new Map<number, SocketDraft>();
  const socketPools = new Set<string>();
  const errors: SocketsStateView['errors'] = [];
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
    };
    sockets.set(seed.sourceId, created);
    return created;
  };

  const accept = (seed: EventSeed) => {
    if (!isSocketEvent(seed)) return;
    eventCount += 1;
    const upperType = seed.typeName.toUpperCase();
    const params = seed.params || {};
    const draft = ensureSocket(seed);
    draft.eventCount += 1;
    draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
    draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);

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
      })),
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
    return view;
  };

  return { accept, finish };
}
