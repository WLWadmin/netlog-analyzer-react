import {
  WORKBENCH_SPIKE_SCHEMA_VERSION,
  type CapabilityMissingResponse,
  type CreateSessionRequest,
  type QueryEventDetailRequest,
  type QueryViewportRequest,
  type StructuredErrorResponse,
  type WorkbenchCapability,
  type WorkbenchEventDetailDto,
  type WorkbenchProgressResponse,
  type WorkbenchRequest,
  type WorkbenchResponse,
  type WorkbenchSessionDescriptor,
  type WorkbenchSessionRef,
  type WorkbenchTimelineEventDto,
} from './protocol';

export interface WorkbenchSpikeSourceEvent {
  trackId: string;
  startUs: number;
  durationUs: number;
  depth: number;
  category: string;
  name: string;
  parentSourceIndex?: number;
  initiatorSourceIndex?: number;
  evidenceIds?: string[];
  privateDetail?: unknown;
}

export interface WorkbenchSpikeSource {
  events: WorkbenchSpikeSourceEvent[];
  capabilities: WorkbenchCapability[];
  missingCapabilities?: Array<{
    capability: WorkbenchCapability;
    reason: string;
  }>;
  blobUrls?: string[];
  transferables?: ArrayBuffer[];
}

export interface WorkbenchSpikeKernelOptions {
  resolveSource(sourceId: string): WorkbenchSpikeSource | undefined;
  revokeBlobUrl?(url: string): void;
  queryTimeoutMs?: number;
  queryYieldInterval?: number;
  now?: () => number;
  yieldControl?: () => Promise<void>;
}

interface IndexedEvent {
  sourceIndex: number;
  dto: WorkbenchTimelineEventDto;
  detail: WorkbenchEventDetailDto;
  endUs: number;
}

interface QueryToken {
  cancelled: boolean;
}

interface WorkbenchSpikeSession {
  descriptor: WorkbenchSessionDescriptor;
  events: IndexedEvent[];
  prefixMaxEndUs: number[];
  eventById: Map<string, IndexedEvent>;
  activeQueries: Map<string, QueryToken>;
  blobUrls: string[];
  transferables: ArrayBuffer[];
}

const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_QUERY_YIELD_INTERVAL = 2_048;

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBoundByStart(events: IndexedEvent[], target: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (events[middle].dto.startUs <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sessionError(
  requestId: string,
  code: StructuredErrorResponse['error']['code'],
  message: string,
  recoverable: boolean,
  session?: WorkbenchSessionRef,
): StructuredErrorResponse {
  return {
    type: 'structured-error',
    schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
    requestId,
    ...(session
      ? {
          sessionId: session.sessionId,
          sessionRevision: session.sessionRevision,
        }
      : {}),
    error: { code, message, recoverable },
  };
}

function capabilityMissing(
  requestId: string,
  session: WorkbenchSessionRef,
  capability: WorkbenchCapability,
  reason: string,
): CapabilityMissingResponse {
  return {
    type: 'capability-missing',
    schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
    requestId,
    sessionId: session.sessionId,
    sessionRevision: session.sessionRevision,
    capability,
    reason,
  };
}

function eventId(sourceIndex: number): string {
  return `event-${sourceIndex.toString(36).padStart(6, '0')}`;
}

function validFiniteRange(startUs: number, endUs: number): boolean {
  return Number.isFinite(startUs) && Number.isFinite(endUs) && startUs <= endUs;
}

export class WorkbenchSpikeKernel {
  private readonly sessions = new Map<string, WorkbenchSpikeSession>();
  private readonly now: () => number;
  private readonly yieldControl: () => Promise<void>;
  private readonly queryTimeoutMs: number;
  private readonly queryYieldInterval: number;
  private sessionCounter = 0;

  constructor(private readonly options: WorkbenchSpikeKernelOptions) {
    this.now = options.now ?? (() => performance.now());
    this.yieldControl = options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.queryYieldInterval = options.queryYieldInterval ?? DEFAULT_QUERY_YIELD_INTERVAL;
  }

  async dispatch(
    request: WorkbenchRequest,
    onProgress?: (progress: WorkbenchProgressResponse) => void,
  ): Promise<WorkbenchResponse> {
    switch (request.type) {
      case 'create-session':
        return this.createSession(request, onProgress);
      case 'query-viewport':
        return this.queryViewport(request, onProgress);
      case 'query-selection':
        return capabilityMissing(
          request.requestId,
          request,
          'timeline-events',
          'Selection aggregation is unavailable in the stage 0 kernel',
        );
      case 'query-event-detail':
        return this.queryEventDetail(request);
      case 'query-capabilities':
        return this.queryCapabilities(request);
      case 'query-evidence':
        return capabilityMissing(
          request.requestId,
          request,
          'raw-evidence',
          'Raw evidence is unavailable in the stage 0 kernel',
        );
      case 'query-screenshot-index':
      case 'query-screenshot':
        return capabilityMissing(
          request.requestId,
          request,
          'screenshots',
          'Screenshots are unavailable in the stage 0 kernel',
        );
      case 'cancel-query':
        return this.cancelQuery(request);
      case 'release-session':
        return this.releaseSession(request);
    }
  }

  failWorker(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.disposeSession(sessionId);
    }
  }

  getResourceStats(): {
    sessionCount: number;
    activeQueryCount: number;
    blobUrlCount: number;
    transferableCount: number;
  } {
    let activeQueryCount = 0;
    let blobUrlCount = 0;
    let transferableCount = 0;
    for (const session of this.sessions.values()) {
      activeQueryCount += session.activeQueries.size;
      blobUrlCount += session.blobUrls.length;
      transferableCount += session.transferables.length;
    }
    return {
      sessionCount: this.sessions.size,
      activeQueryCount,
      blobUrlCount,
      transferableCount,
    };
  }

  private createSession(
    request: CreateSessionRequest,
    onProgress?: (progress: WorkbenchProgressResponse) => void,
  ): WorkbenchResponse {
    const source = this.options.resolveSource(request.source.sourceId);
    if (!source) {
      return sessionError(request.requestId, 'worker-failed', 'Workbench source is unavailable', false);
    }

    const sessionId = `workbench-spike-${++this.sessionCounter}`;
    const sessionRevision = 1;
    const sessionRef = { sessionId, sessionRevision };
    onProgress?.({
      type: 'progress',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: request.requestId,
      ...sessionRef,
      phase: 'indexing-events',
      unit: 'events',
      completed: 0,
      total: source.events.length,
    });

    const indexed = source.events.map((event, sourceIndex): IndexedEvent => {
      const id = eventId(sourceIndex);
      const dto: WorkbenchTimelineEventDto = {
        id,
        trackId: event.trackId,
        startUs: event.startUs,
        durationUs: Math.max(0, event.durationUs),
        depth: event.depth,
        category: event.category,
        name: event.name,
      };
      return {
        sourceIndex,
        dto,
        endUs: dto.startUs + dto.durationUs,
        detail: {
          ...dto,
          ...(event.parentSourceIndex === undefined
            ? {}
            : { parentId: eventId(event.parentSourceIndex) }),
          ...(event.initiatorSourceIndex === undefined
            ? {}
            : { initiatorId: eventId(event.initiatorSourceIndex) }),
          evidenceIds: [...(event.evidenceIds ?? [])],
        },
      };
    });
    indexed.sort((left, right) => (
      left.dto.startUs - right.dto.startUs
      || left.sourceIndex - right.sourceIndex
    ));

    const prefixMaxEndUs: number[] = [];
    let maxEndUs = Number.NEGATIVE_INFINITY;
    for (const event of indexed) {
      maxEndUs = Math.max(maxEndUs, event.endUs);
      prefixMaxEndUs.push(maxEndUs);
    }

    const startUs = indexed[0]?.dto.startUs ?? 0;
    const endUs = indexed.reduce((maximum, event) => Math.max(maximum, event.endUs), startUs);
    const capabilities = request.requestedCapabilities.filter(capability => (
      source.capabilities.includes(capability)
    ));
    const declaredMissing = source.missingCapabilities ?? [];
    const missingCapabilities = request.requestedCapabilities
      .filter(capability => !capabilities.includes(capability))
      .map(capability => declaredMissing.find(item => item.capability === capability) ?? {
        capability,
        reason: 'Source does not provide this capability',
      });
    const descriptor: WorkbenchSessionDescriptor = {
      ...sessionRef,
      state: missingCapabilities.length > 0 ? 'degraded' : 'ready',
      source: request.source,
      capabilities,
      missingCapabilities,
      range: { startUs, endUs },
      eventCount: indexed.length,
      trackEventCounts: indexed.reduce<Record<string, number>>((counts, event) => {
        counts[event.dto.trackId] = (counts[event.dto.trackId] ?? 0) + 1;
        return counts;
      }, {}),
      screenshotCount: 0,
    };
    this.sessions.set(sessionId, {
      descriptor,
      events: indexed,
      prefixMaxEndUs,
      eventById: new Map(indexed.map(event => [event.dto.id, event])),
      activeQueries: new Map(),
      blobUrls: [...(source.blobUrls ?? [])],
      transferables: [...(source.transferables ?? [])],
    });
    onProgress?.({
      type: 'progress',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: request.requestId,
      ...sessionRef,
      phase: 'indexing-events',
      unit: 'events',
      completed: indexed.length,
      total: indexed.length,
    });
    return {
      type: 'session-created',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: request.requestId,
      ...sessionRef,
      session: descriptor,
    };
  }

  private async queryViewport(
    request: QueryViewportRequest,
    onProgress?: (progress: WorkbenchProgressResponse) => void,
  ): Promise<WorkbenchResponse> {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!session.descriptor.capabilities.includes('timeline-events')) {
      return capabilityMissing(
        request.requestId,
        request,
        'timeline-events',
        'Timeline events are unavailable for this session',
      );
    }
    if (
      !validFiniteRange(request.range.startUs, request.range.endUs)
      || !Number.isInteger(request.limit)
      || request.limit < 1
    ) {
      return sessionError(
        request.requestId,
        'invalid-range',
        'Viewport range and limit are invalid',
        true,
        request,
      );
    }

    const token: QueryToken = { cancelled: false };
    session.activeQueries.set(request.requestId, token);
    const startedAt = this.now();
    const matched: IndexedEvent[] = [];
    const firstCandidate = lowerBound(session.prefixMaxEndUs, request.range.startUs);
    const lastCandidate = upperBoundByStart(session.events, request.range.endUs);
    let processed = 0;

    try {
      for (let index = firstCandidate; index < lastCandidate; index += 1) {
        if (token.cancelled) {
          return sessionError(
            request.requestId,
            'query-cancelled',
            'Viewport query was cancelled',
            true,
            request,
          );
        }
        if (this.now() - startedAt > this.queryTimeoutMs) {
          return sessionError(
            request.requestId,
            'query-timeout',
            'Viewport query timed out',
            true,
            request,
          );
        }
        const event = session.events[index];
        if (event.endUs >= request.range.startUs) matched.push(event);
        processed += 1;
        if (processed % this.queryYieldInterval === 0) {
          onProgress?.({
            type: 'progress',
            schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
            requestId: request.requestId,
            sessionId: request.sessionId,
            sessionRevision: request.sessionRevision,
            phase: 'querying-events',
            unit: 'events',
            completed: processed,
            total: Math.max(0, lastCandidate - firstCandidate),
          });
          await this.yieldControl();
        }
      }

      const continuationIndex = request.continuation
        ? matched.findIndex(event => (
            event.dto.startUs > request.continuation!.afterStartUs
            || (
              event.dto.startUs === request.continuation!.afterStartUs
              && event.dto.id > request.continuation!.afterEventId
            )
          ))
        : 0;
      const pageStart = continuationIndex < 0 ? matched.length : continuationIndex;
      const page = matched.slice(pageStart, pageStart + request.limit);
      const hasMore = pageStart + page.length < matched.length;
      const last = page[page.length - 1];
      if (hasMore && request.allowTruncation === false) {
        return sessionError(
          request.requestId,
          'result-truncated',
          'Viewport result exceeds the requested limit',
          true,
          request,
        );
      }
      return {
        type: 'viewport-result',
        schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        range: request.range,
        events: page.map(event => event.dto),
        truncation: {
          truncated: hasMore,
          returnedCount: page.length,
          totalMatched: matched.length,
          ...(hasMore && last
            ? {
                continuation: {
                  afterStartUs: last.dto.startUs,
                  afterEventId: last.dto.id,
                },
              }
            : {}),
        },
      };
    } finally {
      session.activeQueries.delete(request.requestId);
    }
  }

  private queryEventDetail(request: QueryEventDetailRequest): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!session.descriptor.capabilities.includes('event-detail')) {
      return capabilityMissing(
        request.requestId,
        request,
        'event-detail',
        'Event detail is unavailable for this session',
      );
    }
    const event = session.eventById.get(request.eventId);
    if (!event) {
      return sessionError(
        request.requestId,
        'invalid-range',
        'Event does not exist in this session',
        true,
        request,
      );
    }
    return {
      type: 'event-detail-result',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      detail: event.detail,
    };
  }

  private cancelQuery(
    request: Extract<WorkbenchRequest, { type: 'cancel-query' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    const target = session.activeQueries.get(request.targetRequestId);
    if (target) target.cancelled = true;
    return {
      type: 'query-cancelled',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      targetRequestId: request.targetRequestId,
    };
  }

  private queryCapabilities(
    request: Extract<WorkbenchRequest, { type: 'query-capabilities' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    return {
      type: 'capabilities-result',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      capabilities: session.descriptor.capabilities,
      missingCapabilities: session.descriptor.missingCapabilities,
    };
  }

  private releaseSession(
    request: Extract<WorkbenchRequest, { type: 'release-session' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    const releasedRequestCount = session.activeQueries.size;
    const revokedBlobUrlCount = session.blobUrls.length;
    const releasedBufferCount = session.transferables.length;
    this.disposeSession(request.sessionId);
    return {
      type: 'session-released',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      releasedRequestCount,
      revokedBlobUrlCount,
      releasedBufferCount,
    };
  }

  private resolveSession(
    request: WorkbenchSessionRef & { requestId: string },
  ): WorkbenchSpikeSession | StructuredErrorResponse {
    const session = this.sessions.get(request.sessionId);
    if (!session) {
      return sessionError(
        request.requestId,
        'session-released',
        'Workbench session has been released',
        false,
        request,
      );
    }
    if (session.descriptor.sessionRevision !== request.sessionRevision) {
      return sessionError(
        request.requestId,
        'session-released',
        'Workbench session revision is stale',
        false,
        request,
      );
    }
    return session;
  }

  private disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const token of session.activeQueries.values()) token.cancelled = true;
    for (const url of session.blobUrls) this.options.revokeBlobUrl?.(url);
    session.activeQueries.clear();
    session.eventById.clear();
    session.events.length = 0;
    session.prefixMaxEndUs.length = 0;
    session.blobUrls.length = 0;
    session.transferables.length = 0;
    this.sessions.delete(sessionId);
  }
}
