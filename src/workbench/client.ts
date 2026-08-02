import {
  LatestCpuDispatcher,
  LatestCustomQueryDispatcher,
  LatestEventLogDispatcher,
  LatestSelectionDispatcher,
  LatestSearchDispatcher,
  LatestTrackPluginDispatcher,
  LatestViewportDispatcher,
} from './clientState';
import {
  type AdvancedAnalysisResultResponse,
  type BottomUpResultResponse,
  type CallTreeResultResponse,
  type CustomQueryResultResponse,
  type EventLogResultResponse,
  type FlameChartResultResponse,
  WORKBENCH_SCHEMA_VERSION,
  type EvidenceResultResponse,
  type EventDetailResultResponse,
  type QueryAdvancedAnalysisRequest,
  type QueryCustomEventsRequest,
  type QueryViewportRequest,
  type QuerySelectionRequest,
  type QueryBottomUpRequest,
  type QueryCallTreeRequest,
  type QueryEventLogRequest,
  type QueryFlameChartRequest,
  type QuerySearchRequest,
  type QueryTrackPluginRequest,
  type InstallTrackPluginRequest,
  type RemoveTrackPluginRequest,
  type ScreenshotIndexResultResponse,
  type ScreenshotResultResponse,
  type SelectionResultResponse,
  type SearchResultResponse,
  type StructuredErrorResponse,
  type ViewportResultResponse,
  type WorkbenchRequest,
  type WorkbenchProgressResponse,
  type WorkbenchCustomQuery,
  type WorkbenchTrackPluginManifest,
  type WorkbenchResponse,
  type WorkbenchSessionDescriptor,
  type WorkbenchSourceRef,
} from './protocol';
import type {
  CrossSourceRequest,
  CrossSourceResponse,
} from './crossSourceProtocol';

export interface TraceWorkbenchClientSnapshot {
  status: 'available' | 'creating' | 'ready' | 'degraded' | 'released' | 'failed';
  session?: WorkbenchSessionDescriptor;
  viewport?: ViewportResultResponse;
  selection?: SelectionResultResponse;
  flameChart?: FlameChartResultResponse;
  callTree?: CallTreeResultResponse;
  bottomUp?: BottomUpResultResponse;
  eventLog?: EventLogResultResponse;
  search?: SearchResultResponse;
  customQuery?: CustomQueryResultResponse;
  sources?: Extract<CrossSourceResponse, { type: 'sources-result' | 'source-change-result' }>;
  alignments?: Extract<CrossSourceResponse, { type: 'alignment-result' }>;
  correlations?: Extract<CrossSourceResponse, { type: 'correlation-result' }>;
  evidenceGraph?: Extract<CrossSourceResponse, { type: 'evidence-graph-result' }>;
  insights?: Extract<CrossSourceResponse, { type: 'insights-result' }>;
  comparisonBaseline?: Extract<WorkbenchResponse, { type: 'comparison-baseline-result' }>;
  comparison?: Extract<WorkbenchResponse, { type: 'trace-comparison-result' }>;
  eventDetail?: EventDetailResultResponse;
  evidence?: EvidenceResultResponse;
  screenshotIndex?: ScreenshotIndexResultResponse;
  screenshot?: ScreenshotResultResponse;
  progress?: WorkbenchProgressResponse;
  lastError?: StructuredErrorResponse;
  queryErrors: Partial<Record<
    'viewport'
    | 'selection'
    | 'cpu'
    | 'event-log'
    | 'search'
    | 'custom-query'
    | 'cross-source'
    | 'insights'
    | 'comparison'
    | 'event-detail'
    | 'evidence'
    | 'screenshot-index'
    | 'screenshot',
    StructuredErrorResponse
  >>;
  discardedResponseCount: number;
}

interface TraceWorkbenchTransport {
  dispatch(request: WorkbenchRequest): Promise<WorkbenchResponse>;
  dispatchSourceFile?(
    request: Extract<
      WorkbenchRequest,
      { type: 'add-source' | 'replace-source' | 'add-comparison-baseline' }
    >,
    file: File,
  ): Promise<WorkbenchResponse>;
  close(): void;
}

type Listener = () => void;
type CrossSourceQueryInput =
  | { type: 'query-sources'; requestId: string }
  | { type: 'query-alignment'; requestId: string; limit: number }
  | { type: 'query-correlation'; requestId: string; entityId?: string; limit: number }
  | {
    type: 'query-evidence-graph';
    requestId: string;
    range?: { startUs: number; endUs: number };
    selectedEntityId?: string;
    limit: number;
  }
  | {
    type: 'query-insights';
    requestId: string;
    range: { startUs: number; endUs: number };
    limit: number;
  };

export class TraceWorkbenchClient {
  private snapshot: TraceWorkbenchClientSnapshot = {
    status: 'available',
    queryErrors: {},
    discardedResponseCount: 0,
  };
  private readonly listeners = new Set<Listener>();
  private readonly latestRequestIds = new Map<string, string>();
  private requestSequence = 0;
  private pendingCreateRequestId?: string;
  private closed = false;
  private readonly viewportDispatcher: LatestViewportDispatcher;
  private readonly selectionDispatcher: LatestSelectionDispatcher;
  private readonly cpuDispatcher: LatestCpuDispatcher;
  private readonly eventLogDispatcher: LatestEventLogDispatcher;
  private readonly searchDispatcher: LatestSearchDispatcher;
  private readonly customQueryDispatcher: LatestCustomQueryDispatcher;
  private readonly trackPluginDispatchers = new Map<
    string,
    LatestTrackPluginDispatcher
  >();

  constructor(
    private readonly source: WorkbenchSourceRef,
    private readonly transport: TraceWorkbenchTransport,
  ) {
    this.viewportDispatcher = new LatestViewportDispatcher(
      request => this.executeViewport(request),
      request => this.cancelActive(request),
    );
    this.selectionDispatcher = new LatestSelectionDispatcher(
      request => this.executeSelection(request),
      request => this.cancelActive(request),
    );
    this.cpuDispatcher = new LatestCpuDispatcher(
      request => this.executeAnalysis(request),
      request => this.cancelActive(request),
    );
    this.eventLogDispatcher = new LatestEventLogDispatcher(
      request => this.executeAnalysis(request),
      request => this.cancelActive(request),
    );
    this.searchDispatcher = new LatestSearchDispatcher(
      request => this.executeAnalysis(request),
      request => this.cancelActive(request),
    );
    this.customQueryDispatcher = new LatestCustomQueryDispatcher(
      request => this.executeAnalysis(request),
      request => this.cancelActive(request),
    );
  }

  getSnapshot(): TraceWorkbenchClientSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createSession(): Promise<WorkbenchSessionDescriptor> {
    if (this.closed || this.snapshot.status !== 'available') {
      throw new Error('Workbench session creation is unavailable');
    }
    this.update({ ...this.snapshot, status: 'creating', lastError: undefined });
    const requestId = this.nextRequestId('create');
    this.pendingCreateRequestId = requestId;
    let response: WorkbenchResponse;
    try {
      response = await this.transport.dispatch({
        type: 'create-session',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId,
        source: this.source,
        requestedCapabilities: [
          'timeline-events',
          'event-detail',
          'raw-evidence',
          'cpu-profile',
          'network',
          'rendering',
          'interactions',
          'frames',
          'screenshots',
        ],
      });
    } catch (error) {
      if (!this.closed) this.failAndClose();
      throw error;
    }
    if (response.type !== 'session-created') {
      this.failAndClose(response.type === 'structured-error' ? response : undefined);
      throw new Error('Workbench session could not be created');
    }
    this.latestRequestIds.clear();
    this.pendingCreateRequestId = undefined;
    this.update({
      status: response.session.state === 'degraded' ? 'degraded' : 'ready',
      session: response.session,
      queryErrors: {},
      discardedResponseCount: this.snapshot.discardedResponseCount,
    });
    return response.session;
  }

  queryViewport(
    range: { startUs: number; endUs: number },
    limit = 2_000,
    balanceByTrack = false,
  ): Promise<WorkbenchResponse | undefined> {
    const session = this.requireSession();
    const request: QueryViewportRequest = {
      type: 'query-viewport',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('viewport'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      range,
      limit,
      ...(balanceByTrack ? { balanceByTrack: true } : {}),
    };
    this.latestRequestIds.set('viewport', request.requestId);
    return this.viewportDispatcher.submit(request);
  }

  querySelection(
    range: { startUs: number; endUs: number },
  ): Promise<WorkbenchResponse | undefined> {
    const session = this.requireSession();
    const request: QuerySelectionRequest = {
      type: 'query-selection',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('selection'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      range,
    };
    this.latestRequestIds.set('selection', request.requestId);
    return this.selectionDispatcher.submit(request);
  }

  queryFlameChart(
    range: { startUs: number; endUs: number },
    limit = 2_000,
  ): Promise<WorkbenchResponse | undefined> {
    return this.submitCpu({
      type: 'query-flame-chart',
      ...this.analysisRequest('flame', range, 'start-time', limit),
    });
  }

  queryCallTree(
    range: { startUs: number; endUs: number },
    sort: QueryCallTreeRequest['sort'] = 'total-time',
    limit = 500,
  ): Promise<WorkbenchResponse | undefined> {
    return this.submitCpu({
      type: 'query-call-tree',
      ...this.analysisRequest('call-tree', range, sort, limit),
    });
  }

  queryBottomUp(
    range: { startUs: number; endUs: number },
    sort: QueryBottomUpRequest['sort'] = 'self-time',
    limit = 500,
  ): Promise<WorkbenchResponse | undefined> {
    return this.submitCpu({
      type: 'query-bottom-up',
      ...this.analysisRequest('bottom-up', range, sort, limit),
    });
  }

  queryEventLog(
    range: { startUs: number; endUs: number },
    filters?: QueryEventLogRequest['filters'],
    continuation?: string,
  ): Promise<WorkbenchResponse | undefined> {
    const request: QueryEventLogRequest = {
      type: 'query-event-log',
      ...this.analysisRequest('event-log', range, 'start-time', 200),
      ...(filters ? { filters } : {}),
      ...(continuation ? { continuation } : {}),
    };
    this.latestRequestIds.set('event-log', request.requestId);
    return this.eventLogDispatcher.submit(request);
  }

  querySearch(
    range: { startUs: number; endUs: number },
    query: string,
    filters?: QuerySearchRequest['filters'],
  ): Promise<WorkbenchResponse | undefined> {
    const request: QuerySearchRequest = {
      type: 'query-search',
      ...this.analysisRequest('search', range, 'start-time', 200),
      query,
      ...(filters ? { filters } : {}),
    };
    this.latestRequestIds.set('search', request.requestId);
    return this.searchDispatcher.submit(request);
  }

  clearSearch(): void {
    this.latestRequestIds.set('search', this.nextRequestId('search-cleared'));
    const queryErrors = { ...this.snapshot.queryErrors };
    delete queryErrors.search;
    this.update({
      ...this.snapshot,
      search: undefined,
      queryErrors,
    });
  }

  queryCustomEvents(
    range: { startUs: number; endUs: number },
    query: WorkbenchCustomQuery,
    limit = 2_000,
    continuation?: string,
  ): Promise<WorkbenchResponse | undefined> {
    const session = this.requireSession();
    const request: QueryCustomEventsRequest = {
      type: 'query-custom-events',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('custom-query'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      range,
      query,
      limit,
      ...(continuation ? { continuation } : {}),
    };
    this.latestRequestIds.set('custom-query', request.requestId);
    return this.customQueryDispatcher.submit(request);
  }

  installTrackPlugin(
    range: { startUs: number; endUs: number },
    manifest: WorkbenchTrackPluginManifest,
  ): Promise<WorkbenchResponse | undefined> {
    const session = this.requireSession();
    const request: InstallTrackPluginRequest = {
      type: 'install-track-plugin',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId(`install-plugin-${manifest.pluginId}`),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      range,
      manifest,
    };
    return this.submitTrackPlugin(manifest.pluginId, request);
  }

  queryTrackPlugin(
    pluginId: string,
    range: { startUs: number; endUs: number },
  ): Promise<WorkbenchResponse | undefined> {
    const session = this.requireSession();
    const request: QueryTrackPluginRequest = {
      type: 'query-track-plugin',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId(`query-plugin-${pluginId}`),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      range,
      pluginId,
    };
    return this.submitTrackPlugin(pluginId, request);
  }

  async removeTrackPlugin(
    pluginId: string,
  ): Promise<WorkbenchResponse | undefined> {
    const session = this.requireSession();
    const request: RemoveTrackPluginRequest = {
      type: 'remove-track-plugin',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId(`remove-plugin-${pluginId}`),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      pluginId,
    };
    const response = await this.submitTrackPlugin(pluginId, request);
    if (
      response?.type === 'track-plugin-result'
      && response.operation === 'removed'
    ) {
      const channel = `track-plugin:${pluginId}`;
      if (this.latestRequestIds.get(channel) === request.requestId) {
        this.latestRequestIds.delete(channel);
        this.trackPluginDispatchers.delete(pluginId);
      }
    }
    return response;
  }

  async queryAdvancedAnalysis(
    capability: QueryAdvancedAnalysisRequest['capability'],
    range: QueryAdvancedAnalysisRequest['range'],
  ): Promise<AdvancedAnalysisResultResponse> {
    const session = this.requireSession();
    const request: QueryAdvancedAnalysisRequest = {
      type: 'query-advanced-analysis',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId(`advanced-${capability}`),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      capability,
      range,
    };
    const channel = `advanced-${capability}`;
    this.latestRequestIds.set(channel, request.requestId);
    const response = await this.transport.dispatch(request);
    if (!this.accept(response)) {
      throw new Error('Advanced analysis response is stale');
    }
    if (
      response.type !== 'advanced-analysis-result'
      || response.capability !== capability
    ) {
      throw new Error('Advanced analysis did not return the requested capability');
    }
    return response;
  }

  async addSource(file: File, kind: 'har' | 'netlog'): Promise<WorkbenchResponse> {
    return this.changeSource(file, kind);
  }

  async replaceSource(
    file: File,
    kind: 'har' | 'netlog',
    replacedSourceId: string,
  ): Promise<WorkbenchResponse> {
    return this.changeSource(file, kind, replacedSourceId);
  }

  async removeSource(sourceId: string): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    return this.executeLatest('cross-source', {
      type: 'remove-source',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('remove-source'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      sourceId,
    });
  }

  async querySources(): Promise<WorkbenchResponse> {
    return this.executeCrossSourceQuery({
      type: 'query-sources',
      requestId: this.nextRequestId('sources'),
    });
  }

  async queryAlignments(limit = 100): Promise<WorkbenchResponse> {
    return this.executeCrossSourceQuery({
      type: 'query-alignment',
      requestId: this.nextRequestId('alignment'),
      limit,
    });
  }

  async queryCorrelations(entityId?: string, limit = 500): Promise<WorkbenchResponse> {
    return this.executeCrossSourceQuery({
      type: 'query-correlation',
      requestId: this.nextRequestId('correlation'),
      ...(entityId ? { entityId } : {}),
      limit,
    });
  }

  async queryEvidenceGraph(
    input: {
      range?: { startUs: number; endUs: number };
      selectedEntityId?: string;
      limit?: number;
    } = {},
  ): Promise<WorkbenchResponse> {
    return this.executeCrossSourceQuery({
      type: 'query-evidence-graph',
      requestId: this.nextRequestId('evidence-graph'),
      ...(input.range ? { range: input.range } : {}),
      ...(input.selectedEntityId ? { selectedEntityId: input.selectedEntityId } : {}),
      limit: input.limit ?? 300,
    });
  }

  async queryInsights(
    range: { startUs: number; endUs: number },
    limit = 20,
  ): Promise<WorkbenchResponse> {
    return this.executeCrossSourceQuery({
      type: 'query-insights',
      requestId: this.nextRequestId('insights'),
      range,
      limit,
    });
  }

  async addComparisonBaseline(file: File): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    const request: Extract<WorkbenchRequest, { type: 'add-comparison-baseline' }> = {
      type: 'add-comparison-baseline',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('add-comparison-baseline'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      sourceToken: this.nextRequestId('comparison-source-token'),
    };
    if (!this.transport.dispatchSourceFile) {
      throw new Error('Comparison file transport is unavailable');
    }
    this.latestRequestIds.set('comparison', request.requestId);
    const response = await this.transport.dispatchSourceFile(request, file);
    this.accept(response);
    return response;
  }

  async removeComparisonBaseline(): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    return this.executeLatest('comparison', {
      type: 'remove-comparison-baseline',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('remove-comparison-baseline'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
    });
  }

  async queryTraceComparison(
    range: { startUs: number; endUs: number },
    sameScenarioConfirmed = false,
  ): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    return this.executeLatest('comparison', {
      type: 'query-trace-comparison',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('trace-comparison'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      range,
      sameScenarioConfirmed,
    });
  }

  async queryEventDetail(eventId: string): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    return this.executeLatest('event-detail', {
      type: 'query-event-detail',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('detail'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      eventId,
    });
  }

  async queryEvidence(evidenceId: string): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    return this.executeLatest('evidence', {
      type: 'query-evidence',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('evidence'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      evidenceId,
    });
  }

  async queryScreenshot(screenshotId: string): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    return this.executeLatest('screenshot', {
      type: 'query-screenshot',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('screenshot'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      screenshotId,
    });
  }

  async queryScreenshotIndex(): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    return this.executeLatest('screenshot-index', {
      type: 'query-screenshot-index',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('screenshot-index'),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const session = this.snapshot.session;
    try {
      if (session) {
        await this.transport.dispatch({
          type: 'release-session',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: this.nextRequestId('release'),
          sessionId: session.sessionId,
          sessionRevision: session.sessionRevision,
        });
      }
    } finally {
      this.latestRequestIds.clear();
      this.trackPluginDispatchers.clear();
      this.pendingCreateRequestId = undefined;
      this.transport.close();
      this.update({
        status: 'released',
        queryErrors: {},
        discardedResponseCount: this.snapshot.discardedResponseCount,
      });
    }
  }

  fail(): void {
    if (this.closed) return;
    this.closed = true;
    this.latestRequestIds.clear();
    this.trackPluginDispatchers.clear();
    this.pendingCreateRequestId = undefined;
    this.update({
      ...this.snapshot,
      status: 'failed',
    });
  }

  getQueueStats() {
    return this.viewportDispatcher.getStats();
  }

  getSelectionQueueStats() {
    return this.selectionDispatcher.getStats();
  }

  getAnalysisQueueStats() {
    return {
      cpu: this.cpuDispatcher.getStats(),
      eventLog: this.eventLogDispatcher.getStats(),
      search: this.searchDispatcher.getStats(),
    };
  }

  handleProgress(progress: WorkbenchProgressResponse): void {
    if (
      this.closed
      || this.snapshot.status !== 'creating'
      || progress.requestId !== this.pendingCreateRequestId
      || progress.completed >= progress.total
    ) {
      return;
    }
    this.update({ ...this.snapshot, progress });
  }

  private async executeViewport(request: QueryViewportRequest): Promise<WorkbenchResponse> {
    const response = await this.transport.dispatch(request);
    this.accept(response);
    return response;
  }

  private async executeSelection(request: QuerySelectionRequest): Promise<WorkbenchResponse> {
    const response = await this.transport.dispatch(request);
    this.accept(response);
    return response;
  }

  private async executeAnalysis(
    request:
      | QueryFlameChartRequest
      | QueryCallTreeRequest
      | QueryBottomUpRequest
      | QueryEventLogRequest
      | QuerySearchRequest
      | QueryCustomEventsRequest
      | InstallTrackPluginRequest
      | QueryTrackPluginRequest
      | RemoveTrackPluginRequest,
  ): Promise<WorkbenchResponse> {
    const response = await this.transport.dispatch(request);
    this.accept(response);
    return response;
  }

  private cancelActive(
    request:
      | QueryViewportRequest
      | QuerySelectionRequest
      | QueryFlameChartRequest
      | QueryCallTreeRequest
      | QueryBottomUpRequest
      | QueryEventLogRequest
      | QuerySearchRequest
      | QueryCustomEventsRequest
      | InstallTrackPluginRequest
      | QueryTrackPluginRequest
      | RemoveTrackPluginRequest,
  ): void {
    void this.transport.dispatch({
      type: 'cancel-query',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId('cancel'),
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      targetRequestId: request.requestId,
    }).catch(() => undefined);
  }

  private async executeLatest(
    channel: string,
    request: WorkbenchRequest,
  ): Promise<WorkbenchResponse> {
    this.latestRequestIds.set(channel, request.requestId);
    const response = await this.transport.dispatch(request);
    this.accept(response);
    return response;
  }

  private accept(response: WorkbenchResponse): boolean {
    const session = this.snapshot.session;
    if (
      session
      && (
        response.type === 'source-change-result'
        || response.type === 'comparison-baseline-result'
      )
      && response.sessionId === session.sessionId
      && response.sessionRevision === session.sessionRevision + 1
    ) {
      this.latestRequestIds.clear();
      this.updateSuccess(
        response.type === 'source-change-result' ? 'cross-source' : 'comparison',
        {
        session: { ...session, sessionRevision: response.sessionRevision },
        ...(response.type === 'source-change-result'
          ? {
              sources: response,
              alignments: undefined,
              correlations: undefined,
              evidenceGraph: undefined,
              insights: undefined,
            }
          : {
              comparisonBaseline: response,
              comparison: undefined,
            }),
        },
      );
      return true;
    }
    if (
      !session
      || !('sessionId' in response)
      || response.sessionId !== session.sessionId
      || response.sessionRevision !== session.sessionRevision
    ) {
      this.discard();
      return false;
    }
    const channel = response.type === 'advanced-analysis-result'
      ? `advanced-${response.capability}`
      : response.type === 'viewport-result'
        ? 'viewport'
      : response.type === 'selection-result'
        ? 'selection'
        : response.type === 'flame-chart-result'
          || response.type === 'call-tree-result'
          || response.type === 'bottom-up-result'
          ? 'cpu'
          : response.type === 'event-log-result'
            ? 'event-log'
            : response.type === 'search-result'
              ? 'search'
              : response.type === 'custom-query-result'
                ? 'custom-query'
                : response.type === 'track-plugin-result'
                  ? response.operation === 'removed'
                    ? `track-plugin:${response.pluginId}`
                    : `track-plugin:${response.plugin.pluginId}`
              : response.type === 'sources-result'
                || response.type === 'source-change-result'
                || response.type === 'alignment-result'
                || response.type === 'correlation-result'
                || response.type === 'evidence-graph-result'
                ? 'cross-source'
                : response.type === 'insights-result'
                  ? 'insights'
                  : response.type === 'comparison-baseline-result'
                    || response.type === 'trace-comparison-result'
                    ? 'comparison'
      : response.type === 'event-detail-result'
        ? 'event-detail'
        : response.type === 'evidence-result'
          ? 'evidence'
            : response.type === 'screenshot-index-result'
              ? 'screenshot-index'
          : response.type === 'screenshot-result'
            ? 'screenshot'
            : undefined;
    if (channel && this.latestRequestIds.get(channel) !== response.requestId) {
      this.discard();
      return false;
    }
    if (
      (response.type === 'structured-error' || response.type === 'capability-missing')
      && ![...this.latestRequestIds.values()].includes(response.requestId)
    ) {
      this.discard();
      return false;
    }
    if (response.type === 'viewport-result') {
      this.updateSuccess('viewport', { viewport: response });
    } else if (response.type === 'selection-result') {
      this.updateSuccess('selection', { selection: response });
    } else if (response.type === 'flame-chart-result') {
      this.updateSuccess('cpu', { flameChart: response });
    } else if (response.type === 'call-tree-result') {
      this.updateSuccess('cpu', { callTree: response });
    } else if (response.type === 'bottom-up-result') {
      this.updateSuccess('cpu', { bottomUp: response });
    } else if (response.type === 'event-log-result') {
      this.updateSuccess('event-log', { eventLog: response });
    } else if (response.type === 'search-result') {
      this.updateSuccess('search', { search: response });
    } else if (response.type === 'custom-query-result') {
      this.updateSuccess('custom-query', { customQuery: response });
    } else if (response.type === 'sources-result' || response.type === 'source-change-result') {
      this.updateSuccess('cross-source', { sources: response });
    } else if (response.type === 'alignment-result') {
      this.updateSuccess('cross-source', { alignments: response });
    } else if (response.type === 'correlation-result') {
      this.updateSuccess('cross-source', { correlations: response });
    } else if (response.type === 'evidence-graph-result') {
      this.updateSuccess('cross-source', { evidenceGraph: response });
    } else if (response.type === 'insights-result') {
      this.updateSuccess('insights', { insights: response });
    } else if (response.type === 'comparison-baseline-result') {
      this.updateSuccess('comparison', {
        comparisonBaseline: response,
        comparison: undefined,
      });
    } else if (response.type === 'trace-comparison-result') {
      this.updateSuccess('comparison', { comparison: response });
    } else if (response.type === 'event-detail-result') {
      this.updateSuccess('event-detail', { eventDetail: response });
    } else if (response.type === 'evidence-result') {
      this.updateSuccess('evidence', { evidence: response });
    } else if (response.type === 'screenshot-index-result') {
      this.updateSuccess('screenshot-index', { screenshotIndex: response });
    } else if (response.type === 'screenshot-result') {
      this.updateSuccess('screenshot', { screenshot: response });
    } else if (
      response.type === 'structured-error'
      || response.type === 'capability-missing'
    ) {
      const errorChannel = [...this.latestRequestIds.entries()]
        .find(([, requestId]) => requestId === response.requestId)?.[0];
      if (
        errorChannel === 'viewport'
        || errorChannel === 'selection'
        || errorChannel === 'cpu'
        || errorChannel === 'event-log'
        || errorChannel === 'search'
        || errorChannel === 'custom-query'
        || errorChannel === 'cross-source'
        || errorChannel === 'insights'
        || errorChannel === 'comparison'
        || errorChannel === 'event-detail'
        || errorChannel === 'evidence'
        || errorChannel === 'screenshot-index'
        || errorChannel === 'screenshot'
      ) {
        this.update({
          ...this.snapshot,
          queryErrors: {
            ...this.snapshot.queryErrors,
            [errorChannel]: response.type === 'structured-error'
              ? response
              : {
                  type: 'structured-error',
                  schemaVersion: WORKBENCH_SCHEMA_VERSION,
                  requestId: response.requestId,
                  sessionId: response.sessionId,
                  sessionRevision: response.sessionRevision,
                  error: {
                    code: 'unsupported-capability',
                    message: response.reason,
                    recoverable: true,
                  },
                },
          },
        });
      } else if (errorChannel?.startsWith('track-plugin:')) {
        // The panel owns plugin failures; the stable Workbench remains usable.
      } else {
        this.update({
          ...this.snapshot,
          lastError: response.type === 'structured-error'
            ? response
            : {
                type: 'structured-error',
                schemaVersion: WORKBENCH_SCHEMA_VERSION,
                requestId: response.requestId,
                sessionId: response.sessionId,
                sessionRevision: response.sessionRevision,
                error: {
                  code: 'unsupported-capability',
                  message: response.reason,
                  recoverable: true,
                },
              },
        });
      }
    }
    return true;
  }

  private requireSession(): WorkbenchSessionDescriptor {
    if (!this.snapshot.session || this.closed) {
      throw new Error('Workbench session is not ready');
    }
    return this.snapshot.session;
  }

  private analysisRequest(
    prefix: string,
    range: { startUs: number; endUs: number },
    sort: QueryFlameChartRequest['sort'],
    limit: number,
  ) {
    const session = this.requireSession();
    return {
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: this.nextRequestId(prefix),
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      range,
      sort,
      limit,
    } as const;
  }

  private submitCpu(
    request: QueryFlameChartRequest | QueryCallTreeRequest | QueryBottomUpRequest,
  ): Promise<WorkbenchResponse | undefined> {
    this.latestRequestIds.set('cpu', request.requestId);
    return this.cpuDispatcher.submit(request);
  }

  private submitTrackPlugin(
    pluginId: string,
    request:
      | InstallTrackPluginRequest
      | QueryTrackPluginRequest
      | RemoveTrackPluginRequest,
  ): Promise<WorkbenchResponse | undefined> {
    const channel = `track-plugin:${pluginId}`;
    let dispatcher = this.trackPluginDispatchers.get(pluginId);
    if (!dispatcher) {
      dispatcher = new LatestTrackPluginDispatcher(
        entry => this.executeTrackPlugin(entry),
        entry => this.cancelActive(entry),
      );
      this.trackPluginDispatchers.set(pluginId, dispatcher);
    }
    this.latestRequestIds.set(channel, request.requestId);
    return dispatcher.submit(request);
  }

  private async executeTrackPlugin(
    request:
      | InstallTrackPluginRequest
      | QueryTrackPluginRequest
      | RemoveTrackPluginRequest,
  ): Promise<WorkbenchResponse> {
    const response = await this.transport.dispatch(request);
    this.accept(response);
    return response;
  }

  private async changeSource(
    file: File,
    kind: 'har' | 'netlog',
    replacedSourceId?: string,
  ): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    const request: Extract<CrossSourceRequest, { type: 'add-source' | 'replace-source' }> =
      replacedSourceId
        ? {
            type: 'replace-source',
            schemaVersion: WORKBENCH_SCHEMA_VERSION,
            requestId: this.nextRequestId('replace-source'),
            sessionId: session.sessionId,
            sessionRevision: session.sessionRevision,
            sourceToken: this.nextRequestId('source-token'),
            expectedKind: kind,
            replacedSourceId,
          }
        : {
            type: 'add-source',
            schemaVersion: WORKBENCH_SCHEMA_VERSION,
            requestId: this.nextRequestId('add-source'),
            sessionId: session.sessionId,
            sessionRevision: session.sessionRevision,
            sourceToken: this.nextRequestId('source-token'),
            expectedKind: kind,
          };
    if (!this.transport.dispatchSourceFile) {
      throw new Error('Cross-source file transport is unavailable');
    }
    this.latestRequestIds.set('cross-source', request.requestId);
    const response = await this.transport.dispatchSourceFile(request, file);
    this.accept(response);
    return response;
  }

  private executeCrossSourceQuery(
    request: CrossSourceQueryInput,
  ): Promise<WorkbenchResponse> {
    const session = this.requireSession();
    return this.executeLatest(request.type === 'query-insights' ? 'insights' : 'cross-source', {
      ...request,
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
    } as CrossSourceRequest);
  }

  private failAndClose(lastError?: StructuredErrorResponse): void {
    if (!this.closed) {
      this.closed = true;
      this.latestRequestIds.clear();
      this.trackPluginDispatchers.clear();
      this.pendingCreateRequestId = undefined;
      this.transport.close();
    }
    this.update({
      status: 'failed',
      queryErrors: {},
      discardedResponseCount: this.snapshot.discardedResponseCount,
      ...(lastError ? { lastError } : {}),
    });
  }

  private nextRequestId(prefix: string): string {
    this.requestSequence += 1;
    return `${prefix}-${this.requestSequence}`;
  }

  private discard(): void {
    this.update({
      ...this.snapshot,
      discardedResponseCount: this.snapshot.discardedResponseCount + 1,
    });
  }

  private update(snapshot: TraceWorkbenchClientSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private updateSuccess(
    channel: keyof TraceWorkbenchClientSnapshot['queryErrors'],
    result: Partial<TraceWorkbenchClientSnapshot>,
  ): void {
    const queryErrors = { ...this.snapshot.queryErrors };
    delete queryErrors[channel];
    this.update({
      ...this.snapshot,
      ...result,
      queryErrors,
      lastError: undefined,
    });
  }
}
