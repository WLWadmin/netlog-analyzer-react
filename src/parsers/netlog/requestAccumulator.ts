import { getNetErrorDescription } from './constants';
import type {
  ParsedEvent,
  RequestTimeline,
  URLRequest,
} from './parser';
import { getTerminalRequestNetError } from './requestNetError';
import {
  createStableSequenceFingerprint,
  netlogEventIdentity,
} from './stableFingerprint';
import { classifyLifecycleStage } from './requestLifecycle';
import { ChunkedNumericColumn } from '../../workers/chunkedNumericColumn';
import {
  extractDnsHostFromParams,
  normalizeDnsHostCandidate,
} from './dnsAnswerCandidates';

const REQUEST_EVENT_PREVIEW_LIMIT = 30;

interface CompactRequestEvent {
  eventIndex: number;
  time: number;
  type: number;
  typeName: string;
  sourceId: number;
  sourceType: number;
  sourceTypeName: string;
  phase: number;
  phaseName: string;
  dependencyId?: number;
  streamId?: number;
  host?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  resolvedIp?: string;
  remoteIp?: string;
  identityError?: number;
  terminalError?: number;
  address?: string;
  durationMs?: number;
}

class StringInterner {
  private readonly values = [''];
  private readonly ids = new Map<string, number>();

  add(value: string | undefined): number {
    if (!value) return 0;
    const existing = this.ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.values.length;
    this.values.push(value);
    this.ids.set(value, id);
    return id;
  }

  get(id: number | undefined): string | undefined {
    return id ? this.values[id] : undefined;
  }
}

class CompactRequestEventStore {
  private readonly strings = new StringInterner();
  private readonly time = new ChunkedNumericColumn(Float64Array);
  private readonly type = new ChunkedNumericColumn(Uint32Array);
  private readonly typeName = new ChunkedNumericColumn(Uint32Array);
  private readonly sourceId = new ChunkedNumericColumn(Uint32Array);
  private readonly sourceType = new ChunkedNumericColumn(Uint32Array);
  private readonly sourceTypeName = new ChunkedNumericColumn(Uint32Array);
  private readonly phase = new ChunkedNumericColumn(Uint8Array);
  private readonly phaseName = new ChunkedNumericColumn(Uint32Array);
  private readonly dependencyIds = new Map<number, number>();
  private readonly streamIds = new Map<number, number>();
  private readonly hosts = new Map<number, string>();
  private readonly methods = new Map<number, string>();
  private readonly statusCodes = new Map<number, number>();
  private readonly resolvedIps = new Map<number, string>();
  private readonly remoteIps = new Map<number, string>();
  private readonly identityErrors = new Map<number, number>();
  private readonly terminalErrors = new Map<number, number>();
  private readonly addresses = new Map<number, string>();
  private readonly durations = new Map<number, number>();

  get length(): number {
    return this.time.length;
  }

  push(fact: CompactRequestEvent): void {
    const eventIndex = this.time.length;
    this.time.push(fact.time);
    this.type.push(fact.type);
    this.typeName.push(this.strings.add(fact.typeName));
    this.sourceId.push(fact.sourceId);
    this.sourceType.push(fact.sourceType);
    this.sourceTypeName.push(this.strings.add(fact.sourceTypeName));
    this.phase.push(fact.phase);
    this.phaseName.push(this.strings.add(fact.phaseName));
    if (fact.dependencyId !== undefined) this.dependencyIds.set(eventIndex, fact.dependencyId);
    if (fact.streamId !== undefined) this.streamIds.set(eventIndex, fact.streamId);
    if (fact.host !== undefined) this.hosts.set(eventIndex, fact.host);
    if (fact.method !== undefined) this.methods.set(eventIndex, fact.method);
    if (fact.statusCode !== undefined) this.statusCodes.set(eventIndex, fact.statusCode);
    if (fact.resolvedIp !== undefined) this.resolvedIps.set(eventIndex, fact.resolvedIp);
    if (fact.remoteIp !== undefined) this.remoteIps.set(eventIndex, fact.remoteIp);
    if (fact.identityError !== undefined) this.identityErrors.set(eventIndex, fact.identityError);
    if (fact.terminalError !== undefined) this.terminalErrors.set(eventIndex, fact.terminalError);
    if (fact.address !== undefined) this.addresses.set(eventIndex, fact.address);
    if (fact.durationMs !== undefined) this.durations.set(eventIndex, fact.durationMs);
  }

  at(
    eventIndex: number,
    target = {} as CompactRequestEvent,
  ): CompactRequestEvent {
    target.eventIndex = eventIndex;
    target.time = this.time.at(eventIndex) || 0;
    target.type = this.type.at(eventIndex) || 0;
    target.typeName = this.strings.get(this.typeName.at(eventIndex)) || '';
    target.sourceId = this.sourceId.at(eventIndex) || 0;
    target.sourceType = this.sourceType.at(eventIndex) || 0;
    target.sourceTypeName = this.strings.get(this.sourceTypeName.at(eventIndex)) || '';
    target.phase = this.phase.at(eventIndex) || 0;
    target.phaseName = this.strings.get(this.phaseName.at(eventIndex)) || '';
    target.dependencyId = this.dependencyIds.get(eventIndex);
    target.streamId = this.streamIds.get(eventIndex);
    target.host = this.hosts.get(eventIndex);
    target.url = undefined;
    target.method = this.methods.get(eventIndex);
    target.statusCode = this.statusCodes.get(eventIndex);
    target.resolvedIp = this.resolvedIps.get(eventIndex);
    target.remoteIp = this.remoteIps.get(eventIndex);
    target.identityError = this.identityErrors.get(eventIndex);
    target.terminalError = this.terminalErrors.get(eventIndex);
    target.address = this.addresses.get(eventIndex);
    target.durationMs = this.durations.get(eventIndex);
    return target;
  }
}

interface RequestTimelineState {
  dnsStart?: number;
  dnsEnd?: number;
  connectStart?: number;
  connectEnd?: number;
  sslStart?: number;
  sslEnd?: number;
  sendStart?: number;
  sendEnd?: number;
  headersStart?: number;
  headersEnd?: number;
  bodyEnd?: number;
}

export interface RequestAccumulatorOutput {
  requests: URLRequest[];
  connectionFailures: Array<{
    requestId?: number;
    url: string;
    error: number;
    time: number;
  }>;
}

export interface RequestAccumulatorOptions {
  requestEventPreviewLimit?: number;
  onRequestEvent?: (request: URLRequest, eventIndex: number) => void;
}

function parseHeaders(headers: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  const lines = Array.isArray(headers)
    ? headers.map(String)
    : typeof headers === 'string'
      ? headers.split(/\r?\n/)
      : Object.entries(headers as Record<string, unknown>)
          .map(([key, value]) => `${key}: ${String(value)}`);
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    result[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim();
  }
  return result;
}

function streamId(params: Record<string, unknown>): number | undefined {
  const value = Number(params.stream_id ?? params.streamId ?? params.spdy_stream_id);
  return Number.isFinite(value) ? value : undefined;
}

function compactEvent(event: ParsedEvent, eventIndex: number): CompactRequestEvent {
  const params = event.params || {};
  const dependencyId = Number(params.source_dependency?.id);
  const headers = parseHeaders(params.headers);
  const statusCode = Number(params.status_code);
  const durationMs = Number(params.duration_ms);
  const eventStreamId = streamId(params);
  const host = extractDnsHostFromParams(params);
  const identityError = Number(params.net_error ?? params.error_code ?? 0);
  const terminalError = getTerminalRequestNetError(event);
  return {
    eventIndex,
    time: event.time,
    type: event.type,
    typeName: event.typeName,
    sourceId: event.source.id,
    sourceType: event.source.type,
    sourceTypeName: event.source.typeName,
    phase: event.phase,
    phaseName: event.phaseName,
    ...(Number.isFinite(dependencyId) && dependencyId > 0 ? { dependencyId } : {}),
    ...(eventStreamId !== undefined ? { streamId: eventStreamId } : {}),
    ...(host ? { host } : {}),
    ...(typeof params.url === 'string' ? { url: params.url } : {}),
    ...(typeof params.method === 'string' ? { method: params.method } : {}),
    ...(Number.isFinite(statusCode) ? { statusCode } : {}),
    ...(headers['x-response-cinfo'] || headers['x-tt-cip'] || headers['x-lsc-source-ip']
      ? { resolvedIp: headers['x-response-cinfo'] || headers['x-tt-cip'] || headers['x-lsc-source-ip'] }
      : {}),
    ...(headers['x-response-sinfo'] ? { remoteIp: headers['x-response-sinfo'] } : {}),
    ...(identityError !== 0 ? { identityError } : {}),
    ...(terminalError !== null
      ? { terminalError }
      : {}),
    ...(typeof params.address === 'string' ? { address: params.address } : {}),
    ...(Number.isFinite(durationMs) ? { durationMs } : {}),
  };
}

function parsedPreview(fact: CompactRequestEvent): ParsedEvent {
  return {
    time: fact.time,
    type: fact.type,
    typeName: fact.typeName,
    source: {
      id: fact.sourceId,
      type: fact.sourceType,
      typeName: fact.sourceTypeName,
    },
    phase: fact.phase,
    phaseName: fact.phaseName,
    params: {
      ...(fact.method ? { method: fact.method } : {}),
      ...(fact.statusCode !== undefined ? { status_code: fact.statusCode } : {}),
      ...(fact.streamId !== undefined ? { stream_id: fact.streamId } : {}),
      ...(fact.host ? { host: fact.host } : {}),
      ...(fact.identityError !== undefined ? { net_error: fact.identityError } : {}),
      ...(fact.address ? { address: fact.address } : {}),
      ...(fact.durationMs !== undefined ? { duration_ms: fact.durationMs } : {}),
    },
  };
}

const eventKeyBuffer = new ArrayBuffer(8);
const eventKeyView = new DataView(eventKeyBuffer);

function hashEventKey(
  requestId: number,
  fact: CompactRequestEvent,
): number {
  let hash = 0x811c9dc5;
  const acceptByte = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const value of [requestId, fact.type, fact.phase, fact.sourceId]) {
    eventKeyView.setFloat64(0, value);
    for (let offset = 0; offset < 8; offset += 1) {
      acceptByte(eventKeyView.getUint8(offset));
    }
  }
  eventKeyView.setFloat64(0, fact.time);
  for (let offset = 0; offset < 8; offset += 1) {
    acceptByte(eventKeyView.getUint8(offset));
  }
  return hash;
}

function sameEventKey(
  left: CompactRequestEvent,
  right: CompactRequestEvent,
): boolean {
  return left.type === right.type
    && left.phase === right.phase
    && (
      left.time === right.time
      || (Number.isNaN(left.time) && Number.isNaN(right.time))
    )
    && left.sourceId === right.sourceId;
}

function isDns(fact: CompactRequestEvent): boolean {
  return fact.sourceTypeName.includes('HOST_RESOLVER')
    || fact.typeName.includes('DNS_');
}

function isConnect(fact: CompactRequestEvent): boolean {
  return fact.typeName.includes('TCP_')
    || fact.typeName.includes('SOCKET_')
    || fact.typeName.includes('TRANSPORT_CONNECT_');
}

function isSsl(fact: CompactRequestEvent): boolean {
  return fact.typeName.includes('SSL_') || fact.typeName.includes('TLS_');
}

function buildTimeline(
  request: URLRequest,
  state: RequestTimelineState,
): RequestTimeline {
  const timeline: RequestTimeline = {};
  if (state.dnsStart !== undefined && state.dnsEnd !== undefined) {
    timeline.dns = {
      start: state.dnsStart,
      end: state.dnsEnd,
      duration: state.dnsEnd - state.dnsStart,
    };
  }
  if (state.connectStart !== undefined && state.connectEnd !== undefined) {
    timeline.connect = {
      start: state.connectStart,
      end: state.connectEnd,
      duration: state.connectEnd - state.connectStart,
    };
  }
  if (state.sslStart !== undefined && state.sslEnd !== undefined) {
    timeline.ssl = {
      start: state.sslStart,
      end: state.sslEnd,
      duration: state.sslEnd - state.sslStart,
    };
  }
  const sendStart = state.sendStart || request.startTime;
  const sendEnd = state.sendEnd
    || state.headersStart
    || state.connectEnd
    || state.sslEnd;
  if (sendEnd !== undefined) {
    timeline.send = {
      start: sendStart,
      end: sendEnd,
      duration: sendEnd - sendStart,
    };
  }
  const waitStart = sendEnd || state.connectEnd || state.sslEnd;
  const waitEnd = state.headersEnd || state.headersStart;
  if (waitStart !== undefined && waitEnd !== undefined && waitEnd > waitStart) {
    timeline.wait = {
      start: waitStart,
      end: waitEnd,
      duration: waitEnd - waitStart,
    };
  }
  const downloadStart = state.headersEnd || state.headersStart;
  const downloadEnd = state.bodyEnd || request.endTime;
  if (
    downloadStart !== undefined
    && downloadEnd !== undefined
    && downloadEnd > downloadStart
  ) {
    timeline.download = {
      start: downloadStart,
      end: downloadEnd,
      duration: downloadEnd - downloadStart,
    };
  }
  return timeline;
}

export function createRequestAccumulator(options: RequestAccumulatorOptions = {}) {
  const requestEventPreviewLimit = options.requestEventPreviewLimit
    ?? REQUEST_EVENT_PREVIEW_LIMIT;
  const facts = new CompactRequestEventStore();
  const requests = new Map<number, URLRequest>();
  const requestSeeds = new Map<number, number>();
  const ownerGraph = new Map<number, Set<number>>();
  const dependencies = new Map<number, Set<number>>();
  const sourceTypeNames = new Map<number, string>();

  const link = (left: number, right: number) => {
    if (!ownerGraph.has(left)) ownerGraph.set(left, new Set());
    if (!ownerGraph.has(right)) ownerGraph.set(right, new Set());
    ownerGraph.get(left)!.add(right);
    ownerGraph.get(right)!.add(left);
    if (!dependencies.has(left)) dependencies.set(left, new Set());
    dependencies.get(left)!.add(right);
  };

  const accept = (event: ParsedEvent) => {
    const fact = compactEvent(event, facts.length);
    facts.push(fact);
    if (!sourceTypeNames.has(fact.sourceId)) {
      sourceTypeNames.set(fact.sourceId, fact.sourceTypeName);
    }
    if (fact.dependencyId) link(fact.sourceId, fact.dependencyId);
    if (
      fact.sourceTypeName === 'URL_REQUEST'
      && fact.url
      && !requests.has(fact.sourceId)
    ) {
      requestSeeds.set(fact.sourceId, fact.eventIndex);
      requests.set(fact.sourceId, {
        id: fact.sourceId,
        url: fact.url,
        method: fact.method || 'GET',
        startTime: fact.time,
        status: 'pending',
        events: [],
        eventCount: 0,
        timeline: {},
        resolvedIp: null,
        remoteIp: null,
      });
    }
  };

  const finish = (): RequestAccumulatorOutput => {
    const owners = new Map<number, Set<number>>();
    const requestIds = new Set(requests.keys());
    requestIds.forEach(requestId => owners.set(requestId, new Set([requestId])));
    const visitedSources = new Set<number>();
    for (const sourceId of ownerGraph.keys()) {
      if (requestIds.has(sourceId) || visitedSources.has(sourceId)) continue;
      const component: number[] = [];
      const adjacentRequests = new Set<number>();
      const queue = [sourceId];
      visitedSources.add(sourceId);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        component.push(current);
        for (const next of ownerGraph.get(current) || []) {
          if (requestIds.has(next)) {
            adjacentRequests.add(next);
          } else if (!visitedSources.has(next)) {
            visitedSources.add(next);
            queue.push(next);
          }
        }
      }
      component.forEach(componentSourceId => {
        owners.set(componentSourceId, new Set(adjacentRequests));
      });
    }
    const sourcesByRequest = new Map<number, number[]>();
    const requestsByDiagnosticSource = new Map<number, number[]>();
    for (const requestId of requests.keys()) {
      const queue = [requestId];
      const seen = new Set(queue);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        const requestIds = requestsByDiagnosticSource.get(current) || [];
        requestIds.push(requestId);
        requestsByDiagnosticSource.set(current, requestIds);
        for (const next of dependencies.get(current) || []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      sourcesByRequest.set(requestId, queue);
    }
    const lifecycleStates = new Map<
      number,
      Map<string, { start: number; end: number }>
    >();
    const lifecycleFact = {} as CompactRequestEvent;
    for (let eventIndex = 0; eventIndex < facts.length; eventIndex += 1) {
      const fact = facts.at(eventIndex, lifecycleFact);
      const stage = classifyLifecycleStage(parsedPreview(fact));
      for (const requestId of requestsByDiagnosticSource.get(fact.sourceId) || []) {
        if (!lifecycleStates.has(requestId)) lifecycleStates.set(requestId, new Map());
        const requestStages = lifecycleStates.get(requestId)!;
        const current = requestStages.get(stage);
        if (!current) {
          requestStages.set(stage, { start: fact.time, end: fact.time });
        } else {
          current.start = Math.min(current.start, fact.time);
          current.end = Math.max(current.end, fact.time);
        }
      }
    }

    const eventKeyBuckets = new Map<number, number | number[]>();
    const eventOwners = new ChunkedNumericColumn(Float64Array);
    for (let eventIndex = 0; eventIndex < facts.length; eventIndex += 1) {
      eventOwners.push(0);
    }
    const fingerprints = new Map<number, ReturnType<typeof createStableSequenceFingerprint>>();
    const streamIds = new Map<number, Set<number>>();
    const requestIdsByStreamId = new Map<number, Set<number>>();
    const requestIdsByHost = new Map<string, Set<number>>();
    for (const request of requests.values()) {
      const host = normalizeDnsHostCandidate(request.url);
      if (!host) continue;
      const requestIdsForHost = requestIdsByHost.get(host) || new Set<number>();
      requestIdsForHost.add(request.id);
      requestIdsByHost.set(host, requestIdsForHost);
    }
    const timelineStates = new Map<number, RequestTimelineState>();
    const protocolFlags = new Map<number, {
      quic: boolean;
      http2: boolean;
      ssl: boolean;
    }>();
    const connectionFailures: RequestAccumulatorOutput['connectionFailures'] = [];

    const appendRequestSequence = (
      request: URLRequest,
      fact: CompactRequestEvent,
    ) => {
      const hash = hashEventKey(request.id, fact);
      const bucket = eventKeyBuckets.get(hash);
      const isDuplicate = (candidateIndex: number) => (
          eventOwners.at(candidateIndex) === request.id
          && sameEventKey(facts.at(candidateIndex), fact)
      );
      if (
        (typeof bucket === 'number' && isDuplicate(bucket))
        || (Array.isArray(bucket) && bucket.some(isDuplicate))
      ) {
        return;
      }
      eventOwners.set(fact.eventIndex, request.id);
      if (bucket === undefined) {
        eventKeyBuckets.set(hash, fact.eventIndex);
      } else if (Array.isArray(bucket)) {
        bucket.push(fact.eventIndex);
      } else {
        eventKeyBuckets.set(hash, [bucket, fact.eventIndex]);
      }

      const preview = parsedPreview(fact);
      if (request.events.length < requestEventPreviewLimit) {
        request.events.push(preview);
      }
      options.onRequestEvent?.(request, fact.eventIndex);
      request.eventCount = (request.eventCount || 0) + 1;
      const fingerprint = fingerprints.get(request.id)
        || createStableSequenceFingerprint();
      fingerprint.accept(netlogEventIdentity(preview));
      fingerprints.set(request.id, fingerprint);
    };

    for (const [requestId, seedEventIndex] of requestSeeds) {
      const request = requests.get(requestId);
      if (request) appendRequestSequence(request, facts.at(seedEventIndex));
    }

    const resolveRequest = (fact: CompactRequestEvent): URLRequest | undefined => {
      if (fact.sourceTypeName === 'URL_REQUEST') return requests.get(fact.sourceId);
      let candidateIds = owners.get(fact.sourceId) || new Set<number>();
      if (candidateIds.size <= 1) {
        const requestId = candidateIds.values().next().value as number | undefined;
        return requestId === undefined ? undefined : requests.get(requestId);
      }
      const intersection = (
        left: Set<number>,
        right: Set<number> | undefined,
      ): Set<number> => {
        if (!right || right.size === 0) return new Set();
        const [smaller, larger] = left.size <= right.size
          ? [left, right]
          : [right, left];
        const result = new Set<number>();
        smaller.forEach(value => {
          if (larger.has(value)) result.add(value);
        });
        return result;
      };
      if (fact.streamId !== undefined) {
        const matches = intersection(
          candidateIds,
          requestIdsByStreamId.get(fact.streamId),
        );
        if (matches.size === 1) return requests.get(matches.values().next().value);
        if (matches.size > 1) candidateIds = matches;
      }
      if (fact.host) {
        const matches = intersection(candidateIds, requestIdsByHost.get(fact.host));
        if (matches.size === 1) return requests.get(matches.values().next().value);
        if (matches.size > 1) candidateIds = matches;
      }
      return candidateIds.size === 1
        ? requests.get(candidateIds.values().next().value)
        : undefined;
    };

    const analysisFact = {} as CompactRequestEvent;
    for (let eventIndex = 0; eventIndex < facts.length; eventIndex += 1) {
      const fact = facts.at(eventIndex, analysisFact);
      const request = resolveRequest(fact);
      if (!request) continue;
      appendRequestSequence(request, fact);

      if (fact.streamId !== undefined) {
        const ids = streamIds.get(request.id) || new Set<number>();
        ids.add(fact.streamId);
        streamIds.set(request.id, ids);
        const requestIdsForStream = requestIdsByStreamId.get(fact.streamId)
          || new Set<number>();
        requestIdsForStream.add(request.id);
        requestIdsByStreamId.set(fact.streamId, requestIdsForStream);
      }
      const flags = protocolFlags.get(request.id) || {
        quic: false,
        http2: false,
        ssl: false,
      };
      flags.quic = flags.quic
        || fact.typeName.includes('QUIC_')
        || fact.sourceTypeName.includes('QUIC');
      flags.http2 = flags.http2
        || fact.sourceTypeName === 'HTTP2_SESSION'
        || fact.typeName.includes('HTTP2_')
        || fact.typeName.includes('HTTP/2_');
      flags.ssl = flags.ssl
        || isSsl(fact)
        || fact.sourceTypeName === 'SSL_CONNECT_JOB'
        || fact.sourceTypeName === 'SSL_CONNECT';
      protocolFlags.set(request.id, flags);
      if (fact.method && fact.sourceTypeName === 'URL_REQUEST') {
        request.method = fact.method;
      }
      if (fact.phaseName === 'END') {
        request.endTime = Math.max(request.endTime || fact.time, fact.time);
        request.duration = request.endTime - request.startTime;
      }
      if (
        fact.typeName === 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS'
        || fact.typeName === 'HTTP_TRANSACTION_READ_HEADERS'
      ) {
        request.status = fact.statusCode ? String(fact.statusCode) : 'completed';
        request.statusCode = fact.statusCode ?? request.statusCode;
        request.resolvedIp = request.resolvedIp || fact.resolvedIp || null;
        request.remoteIp = request.remoteIp || fact.remoteIp || null;
      }
      if (fact.terminalError !== undefined) {
        request.error = fact.terminalError;
        request.errorDesc = getNetErrorDescription(fact.terminalError);
        request.status = 'error';
        if (!connectionFailures.some(failure => (
          failure.requestId === request.id
          && failure.error === fact.terminalError
        ))) {
          connectionFailures.push({
            requestId: request.id,
            url: request.url,
            error: fact.terminalError,
            time: fact.time,
          });
        }
      }

      const state = timelineStates.get(request.id) || {};
      if (isDns(fact)) {
        if (fact.phaseName === 'BEGIN') state.dnsStart = fact.time;
        if (fact.phaseName === 'END') state.dnsEnd = fact.time;
      }
      if (isConnect(fact)) {
        if (fact.phaseName === 'BEGIN') state.connectStart = fact.time;
        if (fact.phaseName === 'END') state.connectEnd = fact.time;
      }
      if (isSsl(fact)) {
        if (fact.phaseName === 'BEGIN') state.sslStart = fact.time;
        if (fact.phaseName === 'END') state.sslEnd = fact.time;
      }
      if (
        fact.typeName.includes('SEND_REQUEST_')
        || fact.typeName.includes('HTTP_TRANSACTION_SEND_')
      ) {
        if (fact.phaseName === 'BEGIN') state.sendStart = fact.time;
        if (fact.phaseName === 'END') state.sendEnd = fact.time;
      }
      if (
        fact.typeName.includes('READ_RESPONSE_HEADERS')
        || fact.typeName.includes('READ_HEADERS')
      ) {
        if (fact.phaseName === 'BEGIN') state.headersStart = fact.time;
        if (fact.phaseName === 'END') state.headersEnd = fact.time;
      }
      if (
        (fact.typeName.includes('READ_BODY') || fact.typeName.includes('READ_DATA'))
        && fact.phaseName === 'END'
      ) {
        state.bodyEnd = fact.time;
      }
      timelineStates.set(request.id, state);
    }

    const output = Array.from(requests.values());
    for (const request of output) {
      request.eventSequenceFingerprint = fingerprints.get(request.id)?.finish();
      request.relatedSourceIds = sourcesByRequest.get(request.id) || [request.id];
      request.relatedSourceTypeNames = Array.from(new Set(
        request.relatedSourceIds
          .map(sourceId => sourceTypeNames.get(sourceId))
          .filter((name): name is string => Boolean(name)),
      ));
      request.lifecycleStageDurations = Object.fromEntries(
        Array.from(lifecycleStates.get(request.id)?.entries() || [])
          .map(([stage, range]) => [stage, Math.max(0, range.end - range.start)]),
      );
      request.timeline = buildTimeline(request, timelineStates.get(request.id) || {});
      const flags = protocolFlags.get(request.id);
      if (flags?.quic) {
        request.protocol = 'QUIC';
      } else if (flags?.http2) {
        request.protocol = 'HTTP/2';
      }
    }

    return { requests: output, connectionFailures };
  };

  return { accept, finish };
}
