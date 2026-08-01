import { LatestViewportDispatcher } from './clientState';
import {
  WORKBENCH_SCHEMA_VERSION,
  type EvidenceResultResponse,
  type EventDetailResultResponse,
  type QueryViewportRequest,
  type ScreenshotResultResponse,
  type StructuredErrorResponse,
  type ViewportResultResponse,
  type WorkbenchRequest,
  type WorkbenchResponse,
  type WorkbenchSessionDescriptor,
  type WorkbenchSourceRef,
} from './protocol';

export interface TraceWorkbenchClientSnapshot {
  status: 'available' | 'creating' | 'ready' | 'degraded' | 'released' | 'failed';
  session?: WorkbenchSessionDescriptor;
  viewport?: ViewportResultResponse;
  eventDetail?: EventDetailResultResponse;
  evidence?: EvidenceResultResponse;
  screenshot?: ScreenshotResultResponse;
  lastError?: StructuredErrorResponse;
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
    discardedResponseCount: 0,
  };
  private readonly listeners = new Set<Listener>();
  private readonly latestRequestIds = new Map<string, string>();
  private requestSequence = 0;
  private closed = false;
  private readonly viewportDispatcher: LatestViewportDispatcher;

  constructor(
    private readonly source: WorkbenchSourceRef,
    private readonly transport: TraceWorkbenchTransport,
  ) {
    this.viewportDispatcher = new LatestViewportDispatcher(
      request => this.executeViewport(request),
      request => {
        void this.transport.dispatch({
          type: 'cancel-query',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: this.nextRequestId('cancel'),
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          targetRequestId: request.requestId,
        }).catch(() => undefined);
      },
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
    let response: WorkbenchResponse;
    try {
      response = await this.transport.dispatch({
        type: 'create-session',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: this.nextRequestId('create'),
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
    this.update({
      status: response.session.state === 'degraded' ? 'degraded' : 'ready',
      session: response.session,
      discardedResponseCount: this.snapshot.discardedResponseCount,
    });
    return response.session;
  }

  queryViewport(
    range: { startUs: number; endUs: number },
    limit = 2_000,
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
    };
    this.latestRequestIds.set('viewport', request.requestId);
    return this.viewportDispatcher.submit(request);
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
      this.transport.close();
      this.update({
        status: 'released',
        discardedResponseCount: this.snapshot.discardedResponseCount,
      });
    }
  }

  fail(): void {
    if (this.closed) return;
    this.closed = true;
    this.latestRequestIds.clear();
    this.update({
      ...this.snapshot,
      status: 'failed',
    });
  }

  getQueueStats() {
    return this.viewportDispatcher.getStats();
  }

  private async executeViewport(request: QueryViewportRequest): Promise<WorkbenchResponse> {
    const response = await this.transport.dispatch(request);
    this.accept(response);
    return response;
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
      : response.type === 'event-detail-result'
        ? 'event-detail'
        : response.type === 'evidence-result'
          ? 'evidence'
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
      this.update({ ...this.snapshot, viewport: response, lastError: undefined });
    } else if (response.type === 'event-detail-result') {
      this.update({ ...this.snapshot, eventDetail: response, lastError: undefined });
    } else if (response.type === 'evidence-result') {
      this.update({ ...this.snapshot, evidence: response, lastError: undefined });
    } else if (response.type === 'screenshot-result') {
      this.update({ ...this.snapshot, screenshot: response, lastError: undefined });
    } else if (response.type === 'structured-error') {
      this.update({ ...this.snapshot, lastError: response });
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
      this.transport.close();
    }
    this.update({
      status: 'failed',
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
}
