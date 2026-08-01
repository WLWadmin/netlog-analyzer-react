import type {
  EventDetailResultResponse,
  QuerySelectionRequest,
  QueryViewportRequest,
  StructuredErrorResponse,
  ViewportResultResponse,
  WorkbenchResponse,
  WorkbenchSessionDescriptor,
} from './protocol';

type QueryChannel = 'viewport' | 'event-detail';

export interface WorkbenchSpikeClientSnapshot {
  session?: WorkbenchSessionDescriptor;
  viewport?: ViewportResultResponse;
  eventDetail?: EventDetailResultResponse;
  lastError?: StructuredErrorResponse;
  discardedResponseCount: number;
}

export class WorkbenchSpikeClientState {
  private snapshot: WorkbenchSpikeClientSnapshot = {
    discardedResponseCount: 0,
  };
  private readonly latestRequestIds = new Map<QueryChannel, string>();

  getSnapshot(): WorkbenchSpikeClientSnapshot {
    return this.snapshot;
  }

  activateSession(session: WorkbenchSessionDescriptor): void {
    this.latestRequestIds.clear();
    this.snapshot = {
      session,
      discardedResponseCount: this.snapshot.discardedResponseCount,
    };
  }

  markLatest(channel: QueryChannel, requestId: string): void {
    this.latestRequestIds.set(channel, requestId);
  }

  accept(response: WorkbenchResponse): boolean {
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

    if (
      response.type === 'viewport-result'
      && this.latestRequestIds.get('viewport') !== response.requestId
    ) {
      this.discard();
      return false;
    }
    if (
      response.type === 'event-detail-result'
      && this.latestRequestIds.get('event-detail') !== response.requestId
    ) {
      this.discard();
      return false;
    }
    if (
      (
        response.type === 'structured-error'
        || response.type === 'capability-missing'
        || (response.type === 'progress' && response.phase === 'querying-events')
      )
      && ![...this.latestRequestIds.values()].includes(response.requestId)
    ) {
      this.discard();
      return false;
    }

    if (response.type === 'viewport-result') {
      this.snapshot = { ...this.snapshot, viewport: response, lastError: undefined };
    } else if (response.type === 'event-detail-result') {
      this.snapshot = { ...this.snapshot, eventDetail: response, lastError: undefined };
    } else if (response.type === 'structured-error') {
      this.snapshot = { ...this.snapshot, lastError: response };
    } else if (response.type === 'session-released') {
      this.latestRequestIds.clear();
      this.snapshot = {
        discardedResponseCount: this.snapshot.discardedResponseCount,
      };
    }
    return true;
  }

  private discard(): void {
    this.snapshot = {
      ...this.snapshot,
      discardedResponseCount: this.snapshot.discardedResponseCount + 1,
    };
  }
}

type LatestQueryRequest = QueryViewportRequest | QuerySelectionRequest;

interface PendingQuery<TRequest extends LatestQueryRequest> {
  request: TRequest;
  resolve: (response: WorkbenchResponse | undefined) => void;
  reject: (error: unknown) => void;
}

export interface LatestViewportDispatcherStats {
  maxQueueDepth: number;
  cancelledRequestCount: number;
  droppedPendingRequestCount: number;
}

export class LatestQueryDispatcher<TRequest extends LatestQueryRequest> {
  private active?: PendingQuery<TRequest>;
  private pending?: PendingQuery<TRequest>;
  private activeCancelRequested = false;
  private stats: LatestViewportDispatcherStats = {
    maxQueueDepth: 0,
    cancelledRequestCount: 0,
    droppedPendingRequestCount: 0,
  };

  constructor(
    private readonly execute: (request: TRequest) => Promise<WorkbenchResponse>,
    private readonly cancel: (request: TRequest) => void,
  ) {}

  submit(request: TRequest): Promise<WorkbenchResponse | undefined> {
    return new Promise((resolve, reject) => {
      const next = { request, resolve, reject };
      if (!this.active) {
        this.start(next);
        return;
      }

      if (this.pending) {
        this.pending.resolve(undefined);
        this.stats.droppedPendingRequestCount += 1;
      }
      this.pending = next;
      this.stats.maxQueueDepth = Math.max(this.stats.maxQueueDepth, 2);
      if (!this.activeCancelRequested) {
        this.activeCancelRequested = true;
        this.cancel(this.active.request);
        this.stats.cancelledRequestCount += 1;
      }
    });
  }

  getStats(): LatestViewportDispatcherStats {
    return { ...this.stats };
  }

  private start(entry: PendingQuery<TRequest>): void {
    this.active = entry;
    this.activeCancelRequested = false;
    this.stats.maxQueueDepth = Math.max(this.stats.maxQueueDepth, 1);
    this.execute(entry.request).then(
      response => entry.resolve(response),
      error => entry.reject(error),
    ).finally(() => {
      if (this.active !== entry) return;
      this.active = undefined;
      const pending = this.pending;
      this.pending = undefined;
      if (pending) this.start(pending);
    });
  }
}

export class LatestViewportDispatcher
  extends LatestQueryDispatcher<QueryViewportRequest> {}

export class LatestSelectionDispatcher
  extends LatestQueryDispatcher<QuerySelectionRequest> {}
