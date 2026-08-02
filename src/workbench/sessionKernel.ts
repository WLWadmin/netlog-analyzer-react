import {
  WORKBENCH_SCHEMA_VERSION,
  type CapabilityMissingResponse,
  type CreateSessionRequest,
  type QueryEventDetailRequest,
  type QueryFlameChartRequest,
  type QueryCallTreeRequest,
  type QueryBottomUpRequest,
  type QueryEventLogRequest,
  type QuerySearchRequest,
  type QuerySelectionRequest,
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
import {
  CpuQueryCancelled,
  CpuQueryTimeout,
  type CpuQueryInput,
} from './cpuProfileStore';
import type { TraceEngineAdapter, TraceEngineSessionData } from './traceEngineAdapter';
import { MinimalTraceEngineAdapter } from './traceEngineAdapter';
import {
  TimelineQueryCancelled,
  TimelineQueryTimeout,
} from './timelineColumnarStore';
import type {
  CrossSourceRequest,
} from './crossSourceProtocol';
import { CrossSourceStore } from './crossSourceStore';
import {
  isTraceCrossSourceEnabled,
  isTraceStage5Enabled,
  isTraceStage6Enabled,
} from './featureFlag';
import { readTraceFileForWorker } from '../parsers/trace/readTraceFile';

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

function deltaPercent(current: number, baseline: number): number | undefined {
  if (baseline === 0) return current === 0 ? 0 : undefined;
  return Number((((current - baseline) / baseline) * 100).toFixed(2));
}

export class WorkbenchSessionKernel {
  private descriptor?: WorkbenchSessionDescriptor;
  private sessionData?: TraceEngineSessionData;
  private state: WorkbenchSessionState = 'released';
  private revision = 0;
  private readonly activeQueries = new Map<string, QueryToken>();
  private crossSource?: CrossSourceStore;
  private comparisonBaseline?: {
    adapter: MinimalTraceEngineAdapter;
    data: TraceEngineSessionData;
    sourceBytes: number;
  };
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
      case 'query-selection':
        return this.querySelection(request);
      case 'query-flame-chart':
        return this.queryCpu(request, 'flame');
      case 'query-call-tree':
        return this.queryCpu(request, 'call-tree');
      case 'query-bottom-up':
        return this.queryCpu(request, 'bottom-up');
      case 'query-event-log':
      case 'query-search':
        return this.queryEventList(request);
      case 'query-event-detail':
        return this.queryEventDetail(request);
      case 'query-capabilities':
        return this.queryCapabilities(request);
      case 'query-evidence':
        return this.queryEvidence(request);
      case 'query-screenshot-index':
        return this.queryScreenshotIndex(request);
      case 'query-screenshot':
        return this.queryScreenshot(request);
      case 'cancel-query':
        return this.cancelQuery(request);
      case 'release-session':
        return this.releaseSession(request);
      case 'add-source':
      case 'replace-source':
      case 'add-comparison-baseline':
        return structuredError(
          request.requestId,
          'worker-failed',
          'Source file payload was not prepared by the Worker',
          true,
          request,
        );
      case 'remove-source':
      case 'query-sources':
      case 'query-alignment':
      case 'query-correlation':
      case 'query-evidence-graph':
      case 'query-insights':
        return this.dispatchCrossSource(request);
      case 'remove-comparison-baseline':
        return this.removeComparisonBaseline(request);
      case 'query-trace-comparison':
        return this.queryTraceComparison(request);
      case 'query-advanced-analysis':
        return this.queryAdvancedAnalysis(request);
    }
  }

  async dispatchSourceFile(
    request: Extract<
      WorkbenchRequest,
      { type: 'add-source' | 'replace-source' | 'add-comparison-baseline' }
    >,
    file: File,
  ): Promise<WorkbenchResponse> {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (request.type === 'add-comparison-baseline') {
      return this.addComparisonBaseline(request, file);
    }
    if (!this.crossSource || !isTraceCrossSourceEnabled()) {
      return structuredError(
        request.requestId,
        'unsupported-capability',
        'Cross-source analysis is disabled',
        true,
        request,
      );
    }
    const store = this.crossSource;
    try {
      const result = await store.addSource(
        request.expectedKind,
        file,
        request.type === 'replace-source' ? request.replacedSourceId : undefined,
      );
      if (
        this.crossSource !== store
        || !this.sessionData
        || !this.descriptor
        || this.state === 'released'
        || this.state === 'failed'
        || this.descriptor.sessionRevision !== request.sessionRevision
      ) {
        store.release();
        return structuredError(
          request.requestId,
          'session-released',
          'Source operation completed after the Workbench session changed',
          false,
          request,
        );
      }
      this.bumpSourceRevision();
      return {
        type: 'source-change-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: this.descriptor!.sessionId,
        sessionRevision: this.descriptor!.sessionRevision,
        sourceRevision: this.crossSource.getSourceRevision(),
        operation: result.operation,
        sources: this.crossSource.getSources(),
        revokedEdgeCount: result.revokedEdgeCount,
        revokedFindingCount: result.revokedFindingCount,
      };
    } catch {
      return structuredError(
        request.requestId,
        'worker-failed',
        'Source parsing or indexing failed; stable sources were preserved',
        true,
        request,
      );
    }
  }

  private async addComparisonBaseline(
    request: Extract<WorkbenchRequest, { type: 'add-comparison-baseline' }>,
    file: File,
  ): Promise<WorkbenchResponse> {
    if (!isTraceStage5Enabled()) {
      return structuredError(
        request.requestId,
        'unsupported-capability',
        'Stage 5 Trace comparison is disabled',
        true,
        request,
      );
    }
    let adapter: MinimalTraceEngineAdapter | undefined;
    try {
      const parsed = await readTraceFileForWorker(file, {
        hint: 'trace',
        isCancelled: () => this.state === 'released' || this.state === 'failed',
        yieldControl: this.yieldControl,
        onProgress: () => undefined,
      });
      if (parsed.kind !== 'trace') throw new Error('Baseline is not a Trace');
      adapter = new MinimalTraceEngineAdapter(parsed.trace, {
        encoding: parsed.intake.encoding,
        jsonBytes: parsed.intake.jsonBytes,
        skippedEventCount: parsed.skippedEventCount,
        warnings: parsed.intake.warnings,
      });
      await adapter.analyze({
        isCancelled: () => this.state === 'released' || this.state === 'failed',
        yieldControl: this.yieldControl,
        onProgress: () => undefined,
      });
      const data = await adapter.buildSessionData({
        isCancelled: () => this.state === 'released' || this.state === 'failed',
        yieldControl: this.yieldControl,
        onProgress: () => undefined,
      });
      if (
        !this.sessionData
        || !this.descriptor
        || this.state === 'released'
        || this.state === 'failed'
        || this.descriptor.sessionRevision !== request.sessionRevision
      ) {
        adapter.release();
        adapter = undefined;
        return structuredError(
          request.requestId,
          'session-released',
          'Comparison baseline completed after the session changed',
          false,
          request,
        );
      }
      this.comparisonBaseline?.adapter.release();
      this.comparisonBaseline = { adapter, data, sourceBytes: file.size };
      adapter = undefined;
      this.bumpSourceRevision();
      return {
        type: 'comparison-baseline-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: this.descriptor.sessionId,
        sessionRevision: this.descriptor.sessionRevision,
        operation: 'added',
        baselineAvailable: true,
        sourceBytes: file.size,
        eventCount: data.timeline.getStats().eventCount,
        limitations: [
          '基线仅保留在当前 Worker 会话内，不记录文件名、路径或标识值。',
        ],
      };
    } catch {
      adapter?.release();
      return structuredError(
        request.requestId,
        'worker-failed',
        'Baseline Trace parsing or indexing failed; existing baseline was preserved',
        true,
        request,
      );
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
    const timelineStats = this.sessionData.timeline.getStats();
    this.descriptor = {
      ...sessionRef,
      state: this.state,
      source: this.source,
      capabilities,
      missingCapabilities,
      range: this.sessionData.timeline.getRange(),
      eventCount: timelineStats.eventCount,
      trackEventCounts: timelineStats.trackEventCounts,
      screenshotCount: evidenceStats.screenshotCount,
    };
    if (isTraceCrossSourceEnabled()) {
      this.crossSource = new CrossSourceStore(
        this.source.sourceId,
        this.adapter.getRequestFacts(),
        this.adapter.getMetadata().jsonBytes,
        this.sessionData.timeline.getEvidenceEntities(),
      );
    }
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
        balanceByTrack: request.balanceByTrack,
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
        lod: result.lod,
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

  private async querySelection(
    request: QuerySelectionRequest,
  ): Promise<WorkbenchResponse> {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (
      !Number.isFinite(request.range.startUs)
      || !Number.isFinite(request.range.endUs)
      || request.range.startUs > request.range.endUs
    ) {
      return structuredError(
        request.requestId,
        'invalid-range',
        'Selection range is invalid',
        true,
        request,
      );
    }
    const token: QueryToken = { cancelled: false };
    this.activeQueries.set(request.requestId, token);
    try {
      const result = await this.sessionData!.timeline.summarizeSelection(
        request.range,
        {
          isCancelled: () => token.cancelled,
          timeoutMs: this.queryTimeoutMs,
          now: this.now,
          yieldControl: this.yieldControl,
          yieldInterval: this.queryYieldInterval,
        },
      );
      return {
        type: 'selection-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        ...result,
      };
    } catch (error) {
      if (error instanceof TimelineQueryCancelled) {
        return structuredError(
          request.requestId,
          'query-cancelled',
          'Selection query was cancelled',
          true,
          request,
        );
      }
      if (error instanceof TimelineQueryTimeout) {
        return structuredError(
          request.requestId,
          'query-timeout',
          'Selection query timed out',
          true,
          request,
        );
      }
      return structuredError(
        request.requestId,
        'worker-failed',
        'Selection query failed',
        true,
        request,
      );
    } finally {
      this.activeQueries.delete(request.requestId);
    }
  }

  private async queryCpu(
    request: QueryFlameChartRequest | QueryCallTreeRequest | QueryBottomUpRequest,
    kind: 'flame' | 'call-tree' | 'bottom-up',
  ): Promise<WorkbenchResponse> {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!session.capabilities.includes('cpu-profile')) {
      return capabilityMissing(
        request.requestId,
        request,
        'cpu-profile',
        '当前 Trace 未提供 CPU Profile，保留顶层任务但不生成调用栈。',
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
        'CPU analysis range and limit are invalid',
        true,
        request,
      );
    }
    const token: QueryToken = { cancelled: false };
    this.activeQueries.set(request.requestId, token);
    const input: CpuQueryInput = {
      range: request.range,
      sort: request.sort,
      limit: request.limit,
      continuation: request.continuation,
    };
    const execution = {
      isCancelled: () => token.cancelled,
      timeoutMs: this.queryTimeoutMs,
      now: this.now,
      yieldControl: this.yieldControl,
      yieldInterval: this.queryYieldInterval,
    };
    try {
      if (kind === 'flame') {
        const result = await this.sessionData!.cpuProfile.queryFlameChart(input, execution);
        if (result.capability === 'missing') {
          return capabilityMissing(
            request.requestId,
            request,
            'cpu-profile',
            '当前 Trace 未提供可用 CPU 采样。',
          );
        }
        const capability = result.capability;
        return {
          type: 'flame-chart-result',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          range: result.range,
          frames: result.frames,
          truncation: result.truncation,
          limitations: result.limitations,
          capability,
        };
      }
      const result = kind === 'call-tree'
        ? await this.sessionData!.cpuProfile.queryCallTree(input, execution)
        : await this.sessionData!.cpuProfile.queryBottomUp(input, execution);
      if (result.capability === 'missing') {
        return capabilityMissing(
          request.requestId,
          request,
          'cpu-profile',
          '当前 Trace 未提供可用 CPU 采样。',
        );
      }
      const common = {
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        range: result.range,
        nodes: result.nodes,
        truncation: result.truncation,
        limitations: result.limitations,
        capability: result.capability,
      };
      return kind === 'call-tree'
        ? { type: 'call-tree-result', ...common }
        : { type: 'bottom-up-result', ...common };
    } catch (error) {
      if (error instanceof CpuQueryCancelled) {
        return structuredError(
          request.requestId,
          'query-cancelled',
          'CPU analysis query was cancelled',
          true,
          request,
        );
      }
      if (error instanceof CpuQueryTimeout) {
        return structuredError(
          request.requestId,
          'query-timeout',
          'CPU analysis query timed out',
          true,
          request,
        );
      }
      return structuredError(
        request.requestId,
        'worker-failed',
        'CPU analysis query failed',
        true,
        request,
      );
    } finally {
      this.activeQueries.delete(request.requestId);
    }
  }

  private async queryEventList(
    request: QueryEventLogRequest | QuerySearchRequest,
  ): Promise<WorkbenchResponse> {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
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
        'Event list range and limit are invalid',
        true,
        request,
      );
    }
    const token: QueryToken = { cancelled: false };
    this.activeQueries.set(request.requestId, token);
    try {
      const result = await this.sessionData!.timeline.queryEventLog({
        range: request.range,
        limit: request.limit,
        continuation: request.continuation,
        filters: request.filters,
        ...(request.type === 'query-search' ? { query: request.query } : {}),
      }, {
        isCancelled: () => token.cancelled,
        timeoutMs: this.queryTimeoutMs,
        now: this.now,
        yieldControl: this.yieldControl,
        yieldInterval: this.queryYieldInterval,
      });
      return request.type === 'query-search'
        ? {
            type: 'search-result',
            schemaVersion: WORKBENCH_SCHEMA_VERSION,
            requestId: request.requestId,
            sessionId: request.sessionId,
            sessionRevision: request.sessionRevision,
            range: request.range,
            query: request.query,
            events: result.events,
            currentIndex: result.events.length > 0 ? 1 : 0,
            truncation: result.truncation,
          }
        : {
            type: 'event-log-result',
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
          'Event list query was cancelled',
          true,
          request,
        );
      }
      if (error instanceof TimelineQueryTimeout) {
        return structuredError(
          request.requestId,
          'query-timeout',
          'Event list query timed out',
          true,
          request,
        );
      }
      return structuredError(
        request.requestId,
        'worker-failed',
        'Event list query failed',
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
        ...(event.status ? { status: event.status } : {}),
        ...(event.parentSourceIndex === undefined
          ? {}
          : { parentId: `trace:timeline:${event.parentSourceIndex}` }),
        ...(event.initiatorSourceIndex === undefined
          ? {}
          : { initiatorId: `trace:timeline:${event.initiatorSourceIndex}` }),
        childIds: this.sessionData!.timeline.childIds(request.eventId),
        evidenceIds: event.evidenceIds,
      },
    };
  }

  private dispatchCrossSource(
    request: Exclude<CrossSourceRequest, { type: 'add-source' | 'replace-source' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!this.crossSource || !isTraceCrossSourceEnabled()) {
      return structuredError(
        request.requestId,
        'unsupported-capability',
        'Cross-source analysis is disabled',
        true,
        request,
      );
    }
    if (request.type === 'query-insights' && !isTraceStage5Enabled()) {
      return structuredError(
        request.requestId,
        'unsupported-capability',
        'Stage 5 Insights is disabled',
        true,
        request,
      );
    }
    const base = {
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: this.descriptor!.sessionId,
      sessionRevision: this.descriptor!.sessionRevision,
      sourceRevision: this.crossSource.getSourceRevision(),
    };
    if (request.type === 'remove-source') {
      let revoked: { revokedEdgeCount: number; revokedFindingCount: number };
      try {
        revoked = this.crossSource.removeSource(request.sourceId);
      } catch {
        return structuredError(
          request.requestId,
          'unsupported-capability',
          'Only an existing HAR or NetLog source can be removed',
          true,
          request,
        );
      }
      this.bumpSourceRevision();
      return {
        ...base,
        type: 'source-change-result',
        sessionRevision: this.descriptor!.sessionRevision,
        sourceRevision: this.crossSource.getSourceRevision(),
        operation: 'removed',
        sources: this.crossSource.getSources(),
        ...revoked,
      };
    }
    if (request.type === 'query-sources') {
      return { ...base, type: 'sources-result', sources: this.crossSource.getSources() };
    }
    if (request.type === 'query-alignment') {
      return {
        ...base,
        type: 'alignment-result',
        alignments: this.crossSource.getAlignments().slice(0, request.limit),
      };
    }
    if (request.type === 'query-correlation') {
      const result = this.crossSource.getCorrelations(request.limit, request.entityId);
      return {
        ...base,
        type: 'correlation-result',
        candidates: result.candidates,
        entities: result.entities,
        truncation: {
          truncated: result.totalMatched > result.candidates.length,
          totalMatched: result.totalMatched,
          returnedCount: result.candidates.length,
        },
      };
    }
    if (request.type === 'query-insights') {
      const result = this.crossSource.getInsights(request.range, request.limit);
      return {
        ...base,
        type: 'insights-result',
        range: request.range,
        insights: result.insights,
        ...(result.emptyReason ? { emptyReason: result.emptyReason } : {}),
        limitations: [
          ...result.limitations,
          ...session.missingCapabilities.map(item => (
            `${item.capability} 能力缺失：${item.reason}`
          )),
        ],
        truncation: {
          truncated: result.totalMatched > result.insights.length,
          totalMatched: result.totalMatched,
          returnedCount: result.insights.length,
        },
      };
    }
    const graph = this.crossSource.getEvidenceGraph(
      request.limit,
      request.selectedEntityId,
      request.range,
    );
    return {
      ...base,
      type: 'evidence-graph-result',
      nodes: graph.nodes,
      edges: graph.edges,
      limitations: graph.limitations,
      truncation: {
        truncated: graph.totalMatched > graph.nodes.length + graph.edges.length,
        totalMatched: graph.totalMatched,
        returnedCount: graph.nodes.length + graph.edges.length,
      },
    };
  }

  private bumpSourceRevision(): void {
    this.revision += 1;
    if (this.descriptor) {
      this.descriptor = {
        ...this.descriptor,
        sessionRevision: this.revision,
      };
    }
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

  private queryAdvancedAnalysis(
    request: Extract<WorkbenchRequest, { type: 'query-advanced-analysis' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!isTraceStage6Enabled() || !this.sessionData?.advanced) {
      return structuredError(
        request.requestId,
        'unsupported-capability',
        'Stage 6 advanced analysis is disabled',
        true,
        request,
      );
    }
    const advanced = this.sessionData.advanced;
    if (request.capability === 'layout-shifts') {
      const analysis = advanced.queryLayoutShifts(request.range);
      return {
        type: 'advanced-analysis-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        capability: request.capability,
        ...analysis,
      };
    }
    if (request.capability === 'animation-composition') {
      const analysis = advanced.queryAnimationComposition(request.range);
      return {
        type: 'advanced-analysis-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        capability: request.capability,
        ...analysis,
      };
    }
    if (request.capability === 'memory-trend') {
      const analysis = advanced.queryMemoryTrend(request.range);
      return {
        type: 'advanced-analysis-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        capability: request.capability,
        ...analysis,
      };
    }
    if (request.capability === 'gpu-raster') {
      const analysis = advanced.queryGpuRaster(request.range);
      return {
        type: 'advanced-analysis-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        capability: request.capability,
        ...analysis,
      };
    }
    const result = (() => {
      switch (request.capability) {
        case 'custom-query':
          return {
            kind: 'custom-query' as const,
            supportedFields: [],
            supportedOperators: [],
          };
        case 'track-plugin':
          return {
            kind: 'track-plugin' as const,
            projectedEvents: [],
            maxEvents: 0,
          };
      }
    })();
    return {
      type: 'advanced-analysis-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      capability: request.capability,
      status: 'unavailable',
      evidenceIds: [],
      limitations: [
        `Trace does not provide verified ${request.capability} analysis evidence`,
      ],
      result,
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

  private queryScreenshotIndex(
    request: Extract<WorkbenchRequest, { type: 'query-screenshot-index' }>,
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
    const stats = this.sessionData!.evidence.getStats();
    return {
      type: 'screenshot-index-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      screenshots: this.sessionData!.evidence.getScreenshotSummaries(),
      rejectedCount: stats.rejectedScreenshotCount,
    };
  }

  private removeComparisonBaseline(
    request: Extract<WorkbenchRequest, { type: 'remove-comparison-baseline' }>,
  ): WorkbenchResponse {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!isTraceStage5Enabled()) {
      return structuredError(
        request.requestId,
        'unsupported-capability',
        'Stage 5 Trace comparison is disabled',
        true,
        request,
      );
    }
    this.comparisonBaseline?.adapter.release();
    this.comparisonBaseline = undefined;
    this.bumpSourceRevision();
    return {
      type: 'comparison-baseline-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: this.descriptor!.sessionId,
      sessionRevision: this.descriptor!.sessionRevision,
      operation: 'removed',
      baselineAvailable: false,
      limitations: [],
    };
  }

  private async queryTraceComparison(
    request: Extract<WorkbenchRequest, { type: 'query-trace-comparison' }>,
  ): Promise<WorkbenchResponse> {
    const session = this.resolveSession(request);
    if ('type' in session) return session;
    if (!isTraceStage5Enabled()) {
      return structuredError(
        request.requestId,
        'unsupported-capability',
        'Stage 5 Trace comparison is disabled',
        true,
        request,
      );
    }
    const baseline = this.comparisonBaseline;
    if (!baseline) {
      return structuredError(
        request.requestId,
        'unsupported-capability',
        'No local baseline Trace is loaded',
        true,
        request,
      );
    }
    const currentRange = session.range;
    const baselineCaptureRange = baseline.data.timeline.getRange();
    const currentCaptureDuration = currentRange.endUs - currentRange.startUs;
    const baselineCaptureDuration = (
      baselineCaptureRange.endUs - baselineCaptureRange.startUs
    );
    let status: Extract<
      WorkbenchResponse,
      { type: 'trace-comparison-result' }
    >['status'] = 'comparable';
    const limitations: string[] = [
      '时间范围按各 Trace 录制起点的相对偏移对齐，不代表跨设备绝对时钟校准。',
    ];
    if (!request.sameScenarioConfirmed) {
      status = 'sample-incomparable';
      limitations.push('尚未确认基线与当前 Trace 属于同一场景，禁止输出性能退化结论。');
    }
    if (currentCaptureDuration <= 0 || baselineCaptureDuration <= 0) {
      status = 'alignment-insufficient';
      limitations.push('至少一份 Trace 缺少可用录制时间范围。');
    }
    const offsetStart = request.range.startUs - currentRange.startUs;
    const offsetEnd = request.range.endUs - currentRange.startUs;
    const baselineRange = {
      startUs: baselineCaptureRange.startUs + offsetStart,
      endUs: baselineCaptureRange.startUs + offsetEnd,
    };
    if (
      baselineRange.startUs < baselineCaptureRange.startUs
      || baselineRange.endUs > baselineCaptureRange.endUs
    ) {
      status = 'alignment-insufficient';
      limitations.push('所选范围超出基线 Trace 的可对齐录制窗口。');
    }
    const currentStats = this.sessionData!.timeline.getStats();
    const baselineStats = baseline.data.timeline.getStats();
    const relevantTracks = ['main', 'rendering', 'interactions', 'frames'] as const;
    const unequalCapabilities = relevantTracks.filter(trackId => (
      Boolean(currentStats.trackEventCounts[trackId])
      !== Boolean(baselineStats.trackEventCounts[trackId])
    ));
    if (status === 'comparable' && unequalCapabilities.length > 0) {
      status = 'capability-mismatch';
      limitations.push(`能力不对等：${unequalCapabilities.join('、')}。`);
    }
    const durationRatio = Math.max(
      currentCaptureDuration / Math.max(1, baselineCaptureDuration),
      baselineCaptureDuration / Math.max(1, currentCaptureDuration),
    );
    const eventRatio = Math.max(
      currentStats.eventCount / Math.max(1, baselineStats.eventCount),
      baselineStats.eventCount / Math.max(1, currentStats.eventCount),
    );
    if (status === 'comparable' && (durationRatio > 2 || eventRatio > 4)) {
      status = 'sample-incomparable';
      limitations.push('录制时长或事件规模差异过大，禁止输出性能退化结论。');
    }
    const execution = {
      isCancelled: () => false,
      timeoutMs: this.queryTimeoutMs,
      now: this.now,
      yieldControl: this.yieldControl,
      yieldInterval: this.queryYieldInterval,
    };
    const [currentSummary, baselineSummary] = await Promise.all([
      this.sessionData!.timeline.summarizeSelection(request.range, execution),
      baseline.data.timeline.summarizeSelection(baselineRange, execution),
    ]);
    type ComparisonMetric = Extract<
      WorkbenchResponse,
      { type: 'trace-comparison-result' }
    >['metrics'][number]['metric'];
    const metricValues: Array<[ComparisonMetric, number, number]> = [
      ['matched-events', currentSummary.matchedCount, baselineSummary.matchedCount],
      [
        'warning-events',
        currentSummary.statusCounts.warning ?? 0,
        baselineSummary.statusCounts.warning ?? 0,
      ],
      ...relevantTracks.map((trackId): [ComparisonMetric, number, number] => ([
        trackId,
        currentSummary.trackCounts[trackId] ?? 0,
        baselineSummary.trackCounts[trackId] ?? 0,
      ])),
    ];
    const metrics = metricValues.map(([metric, current, baselineValue]) => {
      const delta = deltaPercent(current, baselineValue);
      return {
        metric,
        current,
        baseline: baselineValue,
        ...(delta === undefined ? {} : { deltaPercent: delta }),
      };
    });
    const warningDelta = deltaPercent(
      currentSummary.statusCounts.warning ?? 0,
      baselineSummary.statusCounts.warning ?? 0,
    );
    const regression = status !== 'comparable' || warningDelta === undefined
      ? 'unavailable' as const
      : warningDelta > 10
        ? 'regressed' as const
        : warningDelta < -10
          ? 'improved' as const
          : 'stable' as const;
    const currentEvidence = this.sessionData!.timeline.query({
      startUs: request.range.startUs,
      endUs: request.range.endUs,
      limit: 3,
    }).events.map(event => `current:${event.id}`);
    const baselineEvidence = baseline.data.timeline.query({
      startUs: baselineRange.startUs,
      endUs: baselineRange.endUs,
      limit: 3,
    }).events.map(event => `baseline:${event.id}`);
    return {
      type: 'trace-comparison-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      status,
      range: request.range,
      baselineRange,
      regression,
      metrics,
      evidenceIds: [...currentEvidence, ...baselineEvidence],
      limitations,
    };
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
    this.sessionData?.cpuProfile.release();
    this.crossSource?.release();
    this.crossSource = undefined;
    this.comparisonBaseline?.adapter.release();
    this.comparisonBaseline = undefined;
    this.sessionData = undefined;
    this.adapter.release();
  }
}
