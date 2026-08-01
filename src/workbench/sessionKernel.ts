import {
  WORKBENCH_SCHEMA_VERSION,
  type CapabilityMissingResponse,
  type CreateSessionRequest,
  type QueryEventDetailRequest,
  type QueryViewportRequest,
  type StructuredErrorResponse,
  type WorkbenchCapability,
  type WorkbenchProgressResponse,
  type WorkbenchRequest,
  type WorkbenchResponse,
  type WorkbenchSessionDescriptor,
  type WorkbenchSessionRef,
  type WorkbenchSessionState,
  type WorkbenchSourceRef,
} from './protocol';
import type { TraceEngineAdapter, TraceEngineSessionData } from './traceEngineAdapter';
import {
  TimelineQueryCancelled,
  TimelineQueryTimeout,
} from './timelineColumnarStore';

interface QueryToken {
  cancelled: boolean;
}

export interface WorkbenchSessionKernelOptions {
  queryTimeoutMs?: number;
  queryYieldInterval?: number;
  now?: () => number;
  yieldControl?: () => Promise<void>;
}

let sessionSequence = 0;

function structuredError(
  requestId: string,
  code: StructuredErrorResponse['error']['code'],
  message: string,
  recoverable: boolean,
  session?: WorkbenchSessionRef,
): StructuredErrorResponse {
  return {
    type: 'structured-error',
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
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
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    requestId,
    sessionId: session.sessionId,
    sessionRevision: session.sessionRevision,
    capability,
    reason,
  };
}

export class WorkbenchSessionKernel {
  private descriptor?: WorkbenchSessionDescriptor;
  private sessionData?: TraceEngineSessionData;
  private state: WorkbenchSessionState = 'released';
  private revision = 0;
  private readonly activeQueries = new Map<string, QueryToken>();
  private readonly now: () => number;
  private readonly yieldControl: () => Promise<void>;
  private readonly queryTimeoutMs: number;
  private readonly queryYieldInterval: number;

  constructor(
    private readonly adapter: TraceEngineAdapter,
    private readonly source: WorkbenchSourceRef,
    options: WorkbenchSessionKernelOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.yieldControl = options.yieldControl
      ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
    this.queryTimeoutMs = options.queryTimeoutMs ?? 5_000;
    this.queryYieldInterval = options.queryYieldInterval ?? 2_048;
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
      case 'query-event-detail':
        return this.queryEventDetail(request);
      case 'query-capabilities':
        return this.queryCapabilities(request);
      case 'query-evidence':
        return this.queryEvidence(request);
      case 'query-screenshot':
        return this.queryScreenshot(request);
      case 'cancel-query':
        return this.cancelQuery(request);
      case 'release-session':
        return this.releaseSession(request);
    }
  }

  fail(): void {
    this.state = 'failed';
    this.releaseResources();
  }

  getResourceStats(): {
    state: WorkbenchSessionState;
    eventCount: number;
    evidenceCount: number;
    screenshotCount: number;
    activeQueryCount: number;
  } {
    return {
      state: this.state,
      eventCount: this.sessionData?.timeline.getStats().eventCount ?? 0,
      evidenceCount: this.sessionData?.evidence.getStats().evidenceCount ?? 0,
      screenshotCount: this.sessionData?.evidence.getStats().screenshotCount ?? 0,
      activeQueryCount: this.activeQueries.size,
    };
  }

  private async createSession(
    request: CreateSessionRequest,
    onProgress?: (progress: WorkbenchProgressResponse) => void,
  ): Promise<WorkbenchResponse> {
    if (
      request.source.sourceId !== this.source.sourceId
      || request.source.fingerprint !== this.source.fingerprint
    ) {
      return structuredError(
        request.requestId,
        'worker-failed',
        'Workbench source does not match the analyzed Trace',
        false,
      );
    }
    if (this.state === 'creating' || this.state === 'indexing-minimum') {
      return structuredError(
        request.requestId,
        'worker-failed',
        'Workbench session creation is already in progress',
        true,
      );
    }
    if (this.sessionData) {
      return structuredError(
        request.requestId,
        'worker-failed',
        'Workbench session already exists',
        true,
        this.descriptor,
      );
    }
    this.state = 'creating';
    this.revision += 1;
    const sessionRef = {
      sessionId: `trace-workbench-${++sessionSequence}`,
      sessionRevision: this.revision,
    };
    this.state = 'indexing-minimum';
    let finalIndexProgress: { completed: number; total: number } | undefined;
    try {
      this.sessionData = await this.adapter.buildSessionData({
        isCancelled: () => this.state === 'releasing' || this.state === 'failed',
        onProgress: progress => {
          if (progress.phase !== 'indexing-events') return;
          if (
            progress.completed !== undefined
            && progress.total !== undefined
            && progress.completed === progress.total
          ) {
            finalIndexProgress = {
              completed: progress.completed,
              total: progress.total,
            };
            return;
          }
          onProgress?.({
            type: 'progress',
            schemaVersion: WORKBENCH_SCHEMA_VERSION,
            requestId: request.requestId,
            ...sessionRef,
            phase: 'indexing-events',
            unit: progress.unit,
            completed: progress.completed ?? 0,
            total: progress.total ?? 0,
          });
        },
        yieldControl: this.yieldControl,
      });
    } catch {
      this.state = 'failed';
      this.releaseResources();
      return structuredError(
        request.requestId,
        'worker-failed',
        'Workbench minimum index could not be built',
        false,
        sessionRef,
      );
    }
    const capabilityStatus = this.adapter.getCapabilities();
    const capabilities = request.requestedCapabilities.filter(capability => (
      capability === 'raw-evidence'
      || capabilityStatus.some(item => (
        item.capability === capability && item.status === 'available'
      ))
    ));
    const missingCapabilities = request.requestedCapabilities
      .filter(capability => !capabilities.includes(capability))
      .map(capability => ({
        capability,
        reason: capabilityStatus.find(item => item.capability === capability)?.reason
          ?? 'Capability is unavailable',
      }));
    this.state = missingCapabilities.length > 0 ? 'degraded' : 'ready';
    const evidenceStats = this.sessionData.evidence.getStats();
    this.descriptor = {
      ...sessionRef,
      state: this.state,
      source: this.source,
      capabilities,
      missingCapabilities,
      range: this.sessionData.timeline.getRange(),
      eventCount: this.sessionData.timeline.getStats().eventCount,
      screenshotCount: evidenceStats.screenshotCount,
    };
    if (finalIndexProgress) {
      onProgress?.({
        type: 'progress',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        ...sessionRef,
        phase: 'indexing-events',
        unit: 'events',
        completed: finalIndexProgress.completed,
        total: finalIndexProgress.total,
      });
    }
    return {
      type: 'session-created',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      ...sessionRef,
      session: this.descriptor,
    };
  }

  private async queryViewport(
    request: QueryViewportRequest,
    onProgress?: (progress: WorkbenchProgressResponse) => void,
  ): Promise<WorkbenchResponse> {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!session.capabilities.includes('timeline-events')) {
      return capabilityMissing(
        request.requestId,
        request,
        'timeline-events',
        'Timeline events are unavailable',
      );
    }
    if (
      !Number.isFinite(request.range.startUs)
      || !Number.isFinite(request.range.endUs)
      || request.range.startUs > request.range.endUs
      || !Number.isInteger(request.limit)
      || request.limit < 1
    ) {
      return structuredError(
        request.requestId,
        'invalid-range',
        'Viewport range and limit are invalid',
        true,
        request,
      );
    }
    const token: QueryToken = { cancelled: false };
    this.activeQueries.set(request.requestId, token);
    try {
      const result = await this.sessionData!.timeline.queryAsync({
        startUs: request.range.startUs,
        endUs: request.range.endUs,
        limit: request.limit,
        continuation: request.continuation,
      }, {
        isCancelled: () => token.cancelled,
        timeoutMs: this.queryTimeoutMs,
        now: this.now,
        yieldControl: this.yieldControl,
        yieldInterval: this.queryYieldInterval,
        onProgress: (completed, total) => onProgress?.({
          type: 'progress',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          phase: 'querying-events',
          unit: 'events',
          completed,
          total,
        }),
      });
      if (result.truncation.truncated && request.allowTruncation === false) {
        return structuredError(
          request.requestId,
          'result-truncated',
          'Viewport result exceeds the requested limit',
          true,
          request,
        );
      }
      return {
        type: 'viewport-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        range: request.range,
        events: result.events,
        truncation: result.truncation,
      };
    } catch (error) {
      if (error instanceof TimelineQueryCancelled) {
        return structuredError(
          request.requestId,
          'query-cancelled',
          'Viewport query was cancelled',
          true,
          request,
        );
      }
      if (error instanceof TimelineQueryTimeout) {
        return structuredError(
          request.requestId,
          'query-timeout',
          'Viewport query timed out',
          true,
          request,
        );
      }
      return structuredError(
        request.requestId,
        'worker-failed',
        'Viewport query failed',
        true,
        request,
      );
    } finally {
      this.activeQueries.delete(request.requestId);
    }
  }

  private queryEventDetail(request: QueryEventDetailRequest): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!session.capabilities.includes('event-detail')) {
      return capabilityMissing(
        request.requestId,
        request,
        'event-detail',
        'Event detail is unavailable',
      );
    }
    const event = this.sessionData!.timeline.getInput(request.eventId);
    if (!event) {
      return structuredError(
        request.requestId,
        'invalid-range',
        'Event does not exist in this session',
        true,
        request,
      );
    }
    return {
      type: 'event-detail-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      detail: {
        id: request.eventId,
        trackId: event.trackId,
        startUs: event.startUs,
        durationUs: event.durationUs,
        depth: event.depth,
        category: event.category,
        name: event.name,
        ...(event.parentSourceIndex === undefined
          ? {}
          : { parentId: `trace:timeline:${event.parentSourceIndex}` }),
        ...(event.initiatorSourceIndex === undefined
          ? {}
          : { initiatorId: `trace:timeline:${event.initiatorSourceIndex}` }),
        evidenceIds: event.evidenceIds,
      },
    };
  }

  private queryCapabilities(
    request: Extract<WorkbenchRequest, { type: 'query-capabilities' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    return {
      type: 'capabilities-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      capabilities: session.capabilities,
      missingCapabilities: session.missingCapabilities,
    };
  }

  private queryEvidence(
    request: Extract<WorkbenchRequest, { type: 'query-evidence' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!session.capabilities.includes('raw-evidence')) {
      return capabilityMissing(
        request.requestId,
        request,
        'raw-evidence',
        'Raw evidence is unavailable',
      );
    }
    const evidence = this.sessionData!.evidence.getDetail(request.evidenceId);
    return evidence
      ? {
          type: 'evidence-result',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          evidence,
        }
      : structuredError(
          request.requestId,
          'invalid-range',
          'Evidence does not exist in this session',
          true,
          request,
        );
  }

  private queryScreenshot(
    request: Extract<WorkbenchRequest, { type: 'query-screenshot' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!session.capabilities.includes('screenshots')) {
      return capabilityMissing(
        request.requestId,
        request,
        'screenshots',
        'Screenshots are unavailable',
      );
    }
    const screenshot = this.sessionData!.evidence.getScreenshot(request.screenshotId);
    return screenshot
      ? {
          type: 'screenshot-result',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          screenshot,
        }
      : structuredError(
          request.requestId,
          'invalid-range',
          'Screenshot does not exist in this session',
          true,
          request,
        );
  }

  private cancelQuery(
    request: Extract<WorkbenchRequest, { type: 'cancel-query' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    const target = this.activeQueries.get(request.targetRequestId);
    if (target) target.cancelled = true;
    return {
      type: 'query-cancelled',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      targetRequestId: request.targetRequestId,
    };
  }

  private releaseSession(
    request: Extract<WorkbenchRequest, { type: 'release-session' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    this.state = 'releasing';
    const releasedRequestCount = this.activeQueries.size;
    const releasedBufferCount = this.sessionData!.evidence.getStats().screenshotCount;
    for (const token of this.activeQueries.values()) token.cancelled = true;
    this.releaseResources();
    this.state = 'released';
    return {
      type: 'session-released',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      releasedRequestCount,
      revokedBlobUrlCount: 0,
      releasedBufferCount,
    };
  }

  private resolveSession(
    request: WorkbenchSessionRef & { requestId: string },
  ): WorkbenchSessionDescriptor | StructuredErrorResponse {
    if (
      !this.descriptor
      || !this.sessionData
      || this.state === 'released'
      || this.state === 'failed'
    ) {
      return structuredError(
        request.requestId,
        'session-released',
        'Workbench session has been released',
        false,
        request,
      );
    }
    if (
      request.sessionId !== this.descriptor.sessionId
      || request.sessionRevision !== this.descriptor.sessionRevision
    ) {
      return structuredError(
        request.requestId,
        'session-released',
        'Workbench session reference is stale',
        false,
        request,
      );
    }
    return this.descriptor;
  }

  private releaseResources(): void {
    for (const token of this.activeQueries.values()) token.cancelled = true;
    this.activeQueries.clear();
    this.sessionData?.timeline.release();
    this.sessionData?.evidence.release();
    this.sessionData = undefined;
    this.adapter.release();
  }
}
