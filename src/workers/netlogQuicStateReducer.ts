import type { QuicStateView } from './netlogDatasetViews';

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

interface SessionDraft {
  sourceId: number;
  eventCount: number;
  hosts: Set<string>;
  peerAddresses: Set<string>;
  versions: Set<string>;
  errorCount: number;
  firstEventId?: number;
  lastEventId?: number;
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
  handshakeEventCount: number;
  versionNegotiationEventCount: number;
  migrationEventCount: number;
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

function classifyStateEvent(typeName: string): QuicStateView['stateEvents'][number]['kind'] | undefined {
  const upper = typeName.toUpperCase();
  if (upper.includes('VERSION') || upper.includes('NEGOTIATION')) return 'version-negotiation';
  if (upper.includes('MIGRATION') || upper.includes('PATH_VALIDATION') || upper.includes('NETWORK_CHANGED')) return 'migration';
  if (upper.includes('HANDSHAKE') || upper.includes('CRYPTO') || upper.includes('CONNECTED')) return 'handshake';
  return undefined;
}

function isRequestScoped(seed: EventSeed): boolean {
  return /URL_REQUEST/i.test(seed.typeName) || /URL_REQUEST/i.test(seed.sourceTypeName);
}

export function createNetlogQuicStateReducer() {
  const sessions = new Map<number, SessionDraft>();
  const errors: QuicStateView['errors'] = [];
  const stateEvents: QuicStateView['stateEvents'] = [];
  const impactSummaries: QuicStateView['impactSummaries'] = [];
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
    const seedTime = seed.time ?? 0;
    const draft = sessions.get(seed.sourceId) || {
      sourceId: seed.sourceId,
      eventCount: 0,
      hosts: new Set<string>(),
      peerAddresses: new Set<string>(),
      versions: new Set<string>(),
      errorCount: 0,
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seedTime,
      lastTime: seedTime,
      handshakeEventCount: 0,
      versionNegotiationEventCount: 0,
      migrationEventCount: 0,
    };
    draft.eventCount += 1;
    draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
    draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
    draft.firstByteStart = Math.min(draft.firstByteStart ?? seed.byteStart, seed.byteStart);
    draft.lastByteEnd = Math.max(draft.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
    draft.firstTime = Math.min(draft.firstTime ?? seedTime, seedTime);
    draft.lastTime = Math.max(draft.lastTime ?? seedTime, seedTime);
    const host = firstString(params.host, params.hostname, params.server_name, params.origin, params.url);
    addString(draft.hosts, host);
    const peerAddress = firstString(params.peer_address, params.peerAddress, params.address, params.remote_address, params.ip_endpoint);
    const version = firstString(params.version, params.quic_version, params.negotiated_version, params.alpn);
    addString(draft.peerAddresses, peerAddress);
    addString(draft.versions, version);

    const stateKind = classifyStateEvent(seed.typeName);
    if (stateKind) {
      if (stateKind === 'handshake') draft.handshakeEventCount += 1;
      if (stateKind === 'version-negotiation') draft.versionNegotiationEventCount += 1;
      if (stateKind === 'migration') draft.migrationEventCount += 1;
      stateEvents.push({
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seedTime,
        typeName: seed.typeName,
        kind: stateKind,
        version,
        peerAddress,
        summary: [seed.typeName, version ? `version=${version}` : undefined, peerAddress ? `peer=${peerAddress}` : undefined].filter(Boolean).join('；'),
      });
      const requestScoped = isRequestScoped(seed);
      impactSummaries.push({
        sourceId: seed.sourceId,
        sessionSourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seedTime,
        typeName: seed.typeName,
        kind: stateKind,
        host,
        peerAddress,
        version,
        requestScoped,
        summary: [
          seed.typeName,
          host ? `host=${host}` : undefined,
          version ? `version=${version}` : undefined,
          peerAddress ? `peer=${peerAddress}` : undefined,
        ].filter(Boolean).join('；'),
        unresolvedReason: requestScoped ? undefined : '缺少 URL_REQUEST/source 级 QUIC 锚点；只能作为协议状态或候选线索。',
      });
    }

    const error = errorValue(params);
    if (error !== undefined) {
      const requestScoped = isRequestScoped(seed);
      draft.errorCount += 1;
      errors.push({
        eventId: seed.eventId,
        sourceId: seed.sourceId,
        typeName: seed.typeName,
        error,
        details: detailsValue(params),
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seedTime,
      });
      impactSummaries.push({
        sourceId: seed.sourceId,
        sessionSourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seedTime,
        typeName: seed.typeName,
        kind: 'error',
        host,
        peerAddress,
        version,
        error,
        details: detailsValue(params),
        requestScoped,
        summary: [
          seed.typeName,
          host ? `host=${host}` : undefined,
          peerAddress ? `peer=${peerAddress}` : undefined,
          version ? `version=${version}` : undefined,
          `error=${error}`,
        ].filter(Boolean).join('；'),
        unresolvedReason: requestScoped ? undefined : '缺少 URL_REQUEST/source 级 QUIC 错误锚点；只能作为协议错误候选线索。',
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
        firstByteStart: session.firstByteStart,
        lastByteEnd: session.lastByteEnd,
        firstTime: session.firstTime,
        lastTime: session.lastTime,
        handshakeEventCount: session.handshakeEventCount,
        versionNegotiationEventCount: session.versionNegotiationEventCount,
        migrationEventCount: session.migrationEventCount,
      })),
      stateEvents,
      impactSummaries,
      requestScopedCandidateCount: impactSummaries.filter(item => item.requestScoped).length,
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
    if (view.impactSummaries.some(item => !item.requestScoped)) {
      view.evidenceGaps.push('部分 QUIC / HTTP3 impact 只有协议 session 锚点，缺少 URL_REQUEST 关联；只能作为协议候选线索。');
    }
    if (view.eventCount > 0 && view.stateEvents.length === 0) {
      view.evidenceGaps.push('未发现 QUIC handshake、version negotiation 或 migration trace；只能说明存在 QUIC/HTTP3 事件，不能推断协议协商过程。');
    }
    return view;
  };

  return { accept, finish };
}
