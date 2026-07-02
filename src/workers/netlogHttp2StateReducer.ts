import type { Http2StateView } from './netlogDatasetViews';

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
  streamSourceIds: Set<number>;
  hosts: Set<string>;
  protocols: Set<string>;
  goawayCount: number;
  rstStreamCount: number;
  windowUpdateCount: number;
  errorCount: number;
  firstEventId?: number;
  lastEventId?: number;
}

interface StreamDraft {
  sourceId: number;
  sessionSourceId?: number;
  streamId?: number;
  eventCount: number;
  hosts: Set<string>;
  errorCount: number;
  firstEventId?: number;
  lastEventId?: number;
}

function isHttp2Event(seed: EventSeed): boolean {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  return text.includes('HTTP2') || text.includes('HTTP/2');
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function addString(target: Set<string>, value?: string) {
  if (value) target.add(value);
}

function errorValue(params: Record<string, unknown> | undefined): number | string | undefined {
  const value = params?.net_error ?? params?.error_code ?? params?.error ?? params?.http2_error ?? params?.http2_error_code;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function detailValue(params: Record<string, unknown> | undefined): string | undefined {
  return firstString(params?.details, params?.description, params?.reason, params?.net_error_details);
}

export function createNetlogHttp2StateReducer() {
  const sessions = new Map<number, SessionDraft>();
  const streams = new Map<number, StreamDraft>();
  const streamToSession = new Map<number, number>();
  const errors: Http2StateView['errors'] = [];
  let eventCount = 0;
  let goawayCount = 0;
  let rstStreamCount = 0;
  let windowUpdateCount = 0;

  const ensureSession = (sourceId: number, eventId: number): SessionDraft => {
    const existing = sessions.get(sourceId);
    if (existing) return existing;
    const created: SessionDraft = {
      sourceId,
      eventCount: 0,
      streamSourceIds: new Set<number>(),
      hosts: new Set<string>(),
      protocols: new Set<string>(),
      goawayCount: 0,
      rstStreamCount: 0,
      windowUpdateCount: 0,
      errorCount: 0,
      firstEventId: eventId,
      lastEventId: eventId,
    };
    sessions.set(sourceId, created);
    return created;
  };

  const ensureStream = (sourceId: number, eventId: number): StreamDraft => {
    const existing = streams.get(sourceId);
    if (existing) return existing;
    const created: StreamDraft = {
      sourceId,
      eventCount: 0,
      hosts: new Set<string>(),
      errorCount: 0,
      firstEventId: eventId,
      lastEventId: eventId,
    };
    streams.set(sourceId, created);
    return created;
  };

  const accept = (seed: EventSeed) => {
    if (!isHttp2Event(seed)) return;
    eventCount += 1;
    const params = seed.params || {};
    const upperType = seed.typeName.toUpperCase();
    const upperSource = seed.sourceTypeName.toUpperCase();
    const isSession = upperSource.includes('HTTP2_SESSION');
    const isStream = upperSource.includes('HTTP2_STREAM') || upperType.includes('HTTP2_STREAM');
    const sessionSourceId = isSession
      ? seed.sourceId
      : firstNumber(params.session_id, params.sessionId, params.session_source_id, params.sessionSourceId) ?? streamToSession.get(seed.sourceId);
    const streamSourceId = isStream ? seed.sourceId : firstNumber(params.stream_source_id, params.streamSourceId);
    const streamId = firstNumber(params.stream_id, params.streamId, params.id);
    const host = firstString(params.host, params.hostname, params.origin, params.url, params.server_name);
    const protocol = firstString(params.protocol, params.alpn, params.negotiated_protocol);
    const error = errorValue(params);

    if (sessionSourceId !== undefined) {
      const session = ensureSession(sessionSourceId, seed.eventId);
      session.eventCount += 1;
      session.firstEventId = Math.min(session.firstEventId ?? seed.eventId, seed.eventId);
      session.lastEventId = Math.max(session.lastEventId ?? seed.eventId, seed.eventId);
      addString(session.hosts, host);
      addString(session.protocols, protocol);
      if (upperType.includes('GOAWAY')) {
        session.goawayCount += 1;
        goawayCount += 1;
      }
      if (upperType.includes('RST_STREAM') || upperType.includes('RESET_STREAM')) {
        session.rstStreamCount += 1;
        rstStreamCount += 1;
      }
      if (upperType.includes('WINDOW_UPDATE') || upperType.includes('UPDATE_RECV_WINDOW')) {
        session.windowUpdateCount += 1;
        windowUpdateCount += 1;
      }
      if (error !== undefined) {
        session.errorCount += 1;
      }
      sessions.set(sessionSourceId, session);
    } else {
      if (upperType.includes('GOAWAY')) goawayCount += 1;
      if (upperType.includes('RST_STREAM') || upperType.includes('RESET_STREAM')) rstStreamCount += 1;
      if (upperType.includes('WINDOW_UPDATE') || upperType.includes('UPDATE_RECV_WINDOW')) windowUpdateCount += 1;
    }

    if (streamSourceId !== undefined) {
      const stream = ensureStream(streamSourceId, seed.eventId);
      stream.eventCount += 1;
      stream.firstEventId = Math.min(stream.firstEventId ?? seed.eventId, seed.eventId);
      stream.lastEventId = Math.max(stream.lastEventId ?? seed.eventId, seed.eventId);
      stream.sessionSourceId = sessionSourceId ?? stream.sessionSourceId;
      stream.streamId = streamId ?? stream.streamId;
      addString(stream.hosts, host);
      if (error !== undefined) stream.errorCount += 1;
      streams.set(streamSourceId, stream);
      if (sessionSourceId !== undefined) {
        streamToSession.set(streamSourceId, sessionSourceId);
        ensureSession(sessionSourceId, seed.eventId).streamSourceIds.add(streamSourceId);
      }
    }

    if (error !== undefined) {
      errors.push({
        eventId: seed.eventId,
        sourceId: seed.sourceId,
        sessionSourceId,
        streamId,
        typeName: seed.typeName,
        error,
        details: detailValue(params),
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
      });
    }
  };

  const finish = (): Http2StateView => {
    const view: Http2StateView = {
      sessions: Array.from(sessions.values()).map(session => ({
        sourceId: session.sourceId,
        eventCount: session.eventCount,
        streamCount: session.streamSourceIds.size,
        hosts: Array.from(session.hosts),
        protocols: Array.from(session.protocols),
        goawayCount: session.goawayCount,
        rstStreamCount: session.rstStreamCount,
        windowUpdateCount: session.windowUpdateCount,
        errorCount: session.errorCount,
        firstEventId: session.firstEventId,
        lastEventId: session.lastEventId,
      })),
      streams: Array.from(streams.values()).map(stream => ({
        sourceId: stream.sourceId,
        sessionSourceId: stream.sessionSourceId,
        streamId: stream.streamId,
        eventCount: stream.eventCount,
        hosts: Array.from(stream.hosts),
        errorCount: stream.errorCount,
        firstEventId: stream.firstEventId,
        lastEventId: stream.lastEventId,
      })),
      errors,
      eventCount,
      goawayCount,
      rstStreamCount,
      windowUpdateCount,
      evidenceGaps: [],
    };
    if (view.eventCount === 0) {
      view.evidenceGaps.push('未发现 HTTP/2 事件；不代表浏览器或服务端不支持 HTTP/2，只表示当前 Dataset 未捕获相关事件。');
    } else {
      view.evidenceGaps.push('HTTP/2 使用状态是协议事实，不能单独作为请求失败或慢请求根因。');
    }
    if (view.errors.length > 0 || view.goawayCount > 0 || view.rstStreamCount > 0) {
      view.evidenceGaps.push('发现 HTTP/2 error / GOAWAY / RST_STREAM，请结合 raw event、服务端 ALPN、代理兼容性和协议回退判断影响。');
    }
    return view;
  };

  return { accept, finish };
}
