import type { Http2StateView } from './netlogDatasetViews';

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
  streamSourceIds: Set<number>;
  hosts: Set<string>;
  protocols: Set<string>;
  goawayCount: number;
  rstStreamCount: number;
  windowUpdateCount: number;
  errorCount: number;
  firstEventId?: number;
  lastEventId?: number;
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
  sourceDependencyIds: Set<number>;
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
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
  sourceDependencyIds: Set<number>;
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

function detailValue(params: Record<string, unknown> | undefined): string | undefined {
  return firstString(params?.details, params?.description, params?.reason, params?.net_error_details);
}

export function createNetlogHttp2StateReducer() {
  const sessions = new Map<number, SessionDraft>();
  const streams = new Map<number, StreamDraft>();
  const streamToSession = new Map<number, number>();
  const errors: Http2StateView['errors'] = [];
  const sourceLinks = new Map<string, Http2StateView['sourceLinks'][number]>();
  let eventCount = 0;
  let goawayCount = 0;
  let rstStreamCount = 0;
  let windowUpdateCount = 0;

  const ensureSession = (sourceId: number, seed: EventSeed): SessionDraft => {
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
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seed.time ?? 0,
      lastTime: seed.time ?? 0,
      sourceDependencyIds: new Set<number>(),
    };
    sessions.set(sourceId, created);
    return created;
  };

  const ensureStream = (sourceId: number, seed: EventSeed): StreamDraft => {
    const existing = streams.get(sourceId);
    if (existing) return existing;
    const created: StreamDraft = {
      sourceId,
      eventCount: 0,
      hosts: new Set<string>(),
      errorCount: 0,
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seed.time ?? 0,
      lastTime: seed.time ?? 0,
      sourceDependencyIds: new Set<number>(),
    };
    streams.set(sourceId, created);
    return created;
  };

  const accept = (seed: EventSeed) => {
    if (!isHttp2Event(seed)) return;
    eventCount += 1;
    const params = seed.params || {};
    const seedTime = seed.time ?? 0;
    const upperType = seed.typeName.toUpperCase();
    const upperSource = seed.sourceTypeName.toUpperCase();
    const isSession = upperSource.includes('HTTP2_SESSION');
    const isStream = upperSource.includes('HTTP2_STREAM') || upperType.includes('HTTP2_STREAM');
    const dependencySourceIds = extractDependencySourceIds(params).filter(id => id !== seed.sourceId);
    const sessionSourceId = isSession
      ? seed.sourceId
      : firstNumber(params.session_id, params.sessionId, params.session_source_id, params.sessionSourceId) ??
        streamToSession.get(seed.sourceId) ??
        dependencySourceIds.find(id => sessions.has(id));
    const streamSourceId = isStream ? seed.sourceId : firstNumber(params.stream_source_id, params.streamSourceId);
    const streamId = firstNumber(params.stream_id, params.streamId, params.id);
    const host = firstString(params.host, params.hostname, params.origin, params.url, params.server_name);
    const protocol = firstString(params.protocol, params.alpn, params.negotiated_protocol);
    const error = errorValue(params);
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

    if (sessionSourceId !== undefined) {
      const session = ensureSession(sessionSourceId, seed);
      session.eventCount += 1;
      session.firstEventId = Math.min(session.firstEventId ?? seed.eventId, seed.eventId);
      session.lastEventId = Math.max(session.lastEventId ?? seed.eventId, seed.eventId);
      session.firstByteStart = Math.min(session.firstByteStart ?? seed.byteStart, seed.byteStart);
      session.lastByteEnd = Math.max(session.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
      session.firstTime = Math.min(session.firstTime ?? seedTime, seedTime);
      session.lastTime = Math.max(session.lastTime ?? seedTime, seedTime);
      addString(session.hosts, host);
      addString(session.protocols, protocol);
      dependencySourceIds.forEach(id => session.sourceDependencyIds.add(id));
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
      const stream = ensureStream(streamSourceId, seed);
      stream.eventCount += 1;
      stream.firstEventId = Math.min(stream.firstEventId ?? seed.eventId, seed.eventId);
      stream.lastEventId = Math.max(stream.lastEventId ?? seed.eventId, seed.eventId);
      stream.firstByteStart = Math.min(stream.firstByteStart ?? seed.byteStart, seed.byteStart);
      stream.lastByteEnd = Math.max(stream.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
      stream.firstTime = Math.min(stream.firstTime ?? seedTime, seedTime);
      stream.lastTime = Math.max(stream.lastTime ?? seedTime, seedTime);
      stream.sessionSourceId = sessionSourceId ?? stream.sessionSourceId;
      stream.streamId = streamId ?? stream.streamId;
      addString(stream.hosts, host);
      dependencySourceIds.forEach(id => stream.sourceDependencyIds.add(id));
      if (error !== undefined) stream.errorCount += 1;
      streams.set(streamSourceId, stream);
      if (sessionSourceId !== undefined) {
        streamToSession.set(streamSourceId, sessionSourceId);
        ensureSession(sessionSourceId, seed).streamSourceIds.add(streamSourceId);
        const linkKey = `${streamSourceId}-${sessionSourceId}-stream-session`;
        if (!sourceLinks.has(linkKey)) {
          sourceLinks.set(linkKey, {
            sourceId: seed.sourceId,
            eventId: seed.eventId,
            byteStart: seed.byteStart,
            byteEnd: seed.byteEnd,
            time: seed.time,
            typeName: seed.typeName,
            fromSourceId: streamSourceId,
            toSourceId: sessionSourceId,
            kind: 'stream-session',
          });
        }
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
        time: seedTime,
        sourceDependencyIds: dependencySourceIds,
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
        firstByteStart: session.firstByteStart,
        lastByteEnd: session.lastByteEnd,
        firstTime: session.firstTime,
        lastTime: session.lastTime,
        sourceDependencyIds: Array.from(session.sourceDependencyIds),
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
        firstByteStart: stream.firstByteStart,
        lastByteEnd: stream.lastByteEnd,
        firstTime: stream.firstTime,
        lastTime: stream.lastTime,
        sourceDependencyIds: Array.from(stream.sourceDependencyIds),
      })),
      sourceLinks: Array.from(sourceLinks.values()),
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
    if (view.streams.some(stream => stream.sessionSourceId === undefined)) {
      view.evidenceGaps.push('存在未关联到 HTTP/2 session 的 stream；不能用相同 host 或相近时间直接推断影响范围。');
    }
    if (view.sourceLinks.length === 0 && view.eventCount > 0) {
      view.evidenceGaps.push('未发现 HTTP/2 显式 source dependency 边；session/stream 影响范围仅限已解析字段。');
    }
    return view;
  };

  return { accept, finish };
}
