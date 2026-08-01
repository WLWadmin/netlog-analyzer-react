import {
  LatestSelectionDispatcher,
  LatestViewportDispatcher,
} from './clientState';
import {
  WORKBENCH_SCHEMA_VERSION,
  type EvidenceResultResponse,
  type EventDetailResultResponse,
  type QueryViewportRequest,
  type QuerySelectionRequest,
  type ScreenshotIndexResultResponse,
  type ScreenshotResultResponse,
  type SelectionResultResponse,
  type StructuredErrorResponse,
  type ViewportResultResponse,
  type WorkbenchRequest,
  type WorkbenchProgressResponse,
  type WorkbenchResponse,
  type WorkbenchSessionDescriptor,
  type WorkbenchSourceRef,
} from './protocol';

export interface TraceWorkbenchClientSnapshot {
  status: 'available' | 'creating' | 'ready' | 'degraded' | 'released' | 'failed';
  session?: WorkbenchSessionDescriptor;
  viewport?: ViewportResultResponse;
  selection?: SelectionResultResponse;
  eventDetail?: EventDetailResultResponse;
  evidence?: EvidenceResultResponse;
  screenshotIndex?: ScreenshotIndexResultResponse;
  screenshot?: ScreenshotResultResponse;
  progress?: WorkbenchProgressResponse;
  lastError?: StructuredErrorResponse;
  queryErrors: Partial<Record<
    'viewport' | 'selection' | 'event-detail' | 'evidence' | 'screenshot-index' | 'screenshot',
    StructuredErrorResponse
  >>;
  discardedResponseCount: number;
}

interface TraceWorkbenchTransport {
  dispatch(request: WorkbenchRequest): Promise<WorkbenchResponse>;
  close(): void;
}

type Listener = () => void;

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

  private cancelActive(request: QueryViewportRequest | QuerySelectionRequest): void {
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
      !session
      || !('sessionId' in response)
      || response.sessionId !== session.sessionId
      || response.sessionRevision !== session.sessionRevision
    ) {
      this.discard();
      return false;
    }
    const channel = response.type === 'viewport-result'
      ? 'viewport'
      : response.type === 'selection-result'
        ? 'selection'
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
    } else if (response.type === 'event-detail-result') {
      this.updateSuccess('event-detail', { eventDetail: response });
    } else if (response.type === 'evidence-result') {
      this.updateSuccess('evidence', { evidence: response });
    } else if (response.type === 'screenshot-index-result') {
      this.updateSuccess('screenshot-index', { screenshotIndex: response });
    } else if (response.type === 'screenshot-result') {
      this.updateSuccess('screenshot', { screenshot: response });
    } else if (response.type === 'structured-error') {
      const errorChannel = [...this.latestRequestIds.entries()]
        .find(([, requestId]) => requestId === response.requestId)?.[0];
      if (
        errorChannel === 'viewport'
        || errorChannel === 'selection'
        || errorChannel === 'event-detail'
        || errorChannel === 'evidence'
        || errorChannel === 'screenshot-index'
        || errorChannel === 'screenshot'
      ) {
        this.update({
          ...this.snapshot,
          queryErrors: {
            ...this.snapshot.queryErrors,
            [errorChannel]: response,
          },
        });
      } else {
        this.update({ ...this.snapshot, lastError: response });
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

  private failAndClose(lastError?: StructuredErrorResponse): void {
    if (!this.closed) {
      this.closed = true;
      this.latestRequestIds.clear();
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
