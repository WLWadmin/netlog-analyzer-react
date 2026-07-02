import type { QuicStateView } from './netlogDatasetViews';

interface EventSeed {
  eventId: number;
  byteStart: number;
  byteEnd: number;
  typeName: string;
  sourceId: number;
  sourceTypeName: string;
  params?: Record<string, unknown>;
}

interface SessionDraft {
  sourceId: number;
  eventCount: number;
  hosts: Set<string>;
  peerAddresses: Set<string>;
  versions: Set<string>;
  errorCount: number;
  firstEventId?: number;
  lastEventId?: number;
}

function isQuicEvent(seed: EventSeed): boolean {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  return text.includes('QUIC') || text.includes('HTTP3') || text.includes('HTTP_3') || text.includes('HTTP/3');
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function addString(target: Set<string>, value?: string) {
  if (value) target.add(value);
}

function errorValue(params: Record<string, unknown> | undefined): number | string | undefined {
  const value = params?.net_error ?? params?.error_code ?? params?.quic_error ?? params?.quic_error_code ?? params?.error;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function detailsValue(params: Record<string, unknown> | undefined): string | undefined {
  return firstString(params?.details, params?.reason, params?.description, params?.net_error_details);
}

export function createNetlogQuicStateReducer() {
  const sessions = new Map<number, SessionDraft>();
  const errors: QuicStateView['errors'] = [];
  let quicEventCount = 0;
  let http3EventCount = 0;

  const accept = (seed: EventSeed) => {
    if (!isQuicEvent(seed)) return;
    const upperType = seed.typeName.toUpperCase();
    const upperSource = seed.sourceTypeName.toUpperCase();
    if (upperType.includes('HTTP3') || upperType.includes('HTTP_3') || upperType.includes('HTTP/3') || upperSource.includes('HTTP3')) {
      http3EventCount += 1;
    } else {
      quicEventCount += 1;
    }

    const params = seed.params || {};
    const draft = sessions.get(seed.sourceId) || {
      sourceId: seed.sourceId,
      eventCount: 0,
      hosts: new Set<string>(),
      peerAddresses: new Set<string>(),
      versions: new Set<string>(),
      errorCount: 0,
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
    };
    draft.eventCount += 1;
    draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
    draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
    addString(draft.hosts, firstString(params.host, params.hostname, params.server_name, params.origin, params.url));
    addString(draft.peerAddresses, firstString(params.peer_address, params.peerAddress, params.address, params.remote_address, params.ip_endpoint));
    addString(draft.versions, firstString(params.version, params.quic_version, params.negotiated_version, params.alpn));

    const error = errorValue(params);
    if (error !== undefined) {
      draft.errorCount += 1;
      errors.push({
        eventId: seed.eventId,
        sourceId: seed.sourceId,
        typeName: seed.typeName,
        error,
        details: detailsValue(params),
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
      });
    }
    sessions.set(seed.sourceId, draft);
  };

  const finish = (): QuicStateView => {
    const view: QuicStateView = {
      sessions: Array.from(sessions.values()).map(session => ({
        sourceId: session.sourceId,
        eventCount: session.eventCount,
        hosts: Array.from(session.hosts),
        peerAddresses: Array.from(session.peerAddresses),
        versions: Array.from(session.versions),
        errorCount: session.errorCount,
        firstEventId: session.firstEventId,
        lastEventId: session.lastEventId,
      })),
      errors,
      eventCount: quicEventCount + http3EventCount,
      http3EventCount,
      quicEventCount,
      evidenceGaps: [],
    };
    if (view.eventCount === 0) {
      view.evidenceGaps.push('未发现 QUIC / HTTP3 事件；不代表浏览器或服务端不支持 QUIC，只表示当前 Dataset 未捕获相关事件。');
    } else {
      view.evidenceGaps.push('QUIC / HTTP3 使用状态是协议事实，不能单独作为请求失败或慢请求根因。');
    }
    if (view.errors.length > 0) {
      view.evidenceGaps.push('发现 QUIC / HTTP3 error，请结合对应 raw event、目标 host、网络环境和 HTTP 回退情况判断影响。');
    }
    return view;
  };

  return { accept, finish };
}
