import { LatestViewportDispatcher, WorkbenchSpikeClientState } from './clientState';
import { WorkbenchSpikeKernel, type WorkbenchSpikeSource } from './kernel';
import {
  WORKBENCH_SPIKE_SCHEMA_VERSION,
  type CreateSessionRequest,
  type QueryViewportRequest,
  type SessionCreatedResponse,
  type ViewportResultResponse,
  type WorkbenchQueryErrorCode,
  type WorkbenchRequest,
  type WorkbenchResponse,
} from './protocol';
import {
  isWorkbenchBenchmarkWorkerRequest,
  isWorkbenchBenchmarkWorkerResponse,
  isWorkbenchRequest,
  isWorkbenchResponse,
} from './protocolGuards';

const sourceRef = {
  sourceId: 'source-1',
  parserId: 'trace' as const,
  fingerprint: 'sha256:synthetic',
};

function source(): WorkbenchSpikeSource {
  return {
    capabilities: ['timeline-events', 'event-detail'],
    missingCapabilities: [{
      capability: 'screenshots',
      reason: 'Synthetic source has no screenshot payload',
    }],
    blobUrls: ['blob:workbench-spike'],
    transferables: [new ArrayBuffer(16)],
    events: [
      {
        trackId: 'main',
        startUs: -100,
        durationUs: 150,
        depth: 0,
        category: 'task',
        name: 'long-task',
        evidenceIds: ['evidence-1'],
        privateDetail: {
          url: 'https://private.invalid/path?token=<REDACTED>',
          headers: { Authorization: '<REDACTED>' },
        },
      },
      {
        trackId: 'main',
        startUs: 10,
        durationUs: 5,
        depth: 1,
        category: 'script',
        name: 'child-task',
        parentSourceIndex: 0,
        evidenceIds: ['evidence-2'],
      },
      {
        trackId: 'network',
        startUs: 20,
        durationUs: 0,
        depth: 0,
        category: 'network',
        name: 'request',
        initiatorSourceIndex: 1,
      },
    ],
  };
}

function createRequest(requestId = 'create-1'): CreateSessionRequest {
  return {
    type: 'create-session',
    schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
    requestId,
    source: sourceRef,
    requestedCapabilities: ['timeline-events', 'event-detail', 'screenshots'],
  };
}

async function createSession(
  kernel: WorkbenchSpikeKernel,
  requestId = 'create-1',
): Promise<SessionCreatedResponse> {
  const response = await kernel.dispatch(createRequest(requestId));
  expect(response.type).toBe('session-created');
  if (response.type !== 'session-created') throw new Error('session was not created');
  return response;
}

function viewportRequest(
  session: SessionCreatedResponse,
  requestId: string,
  startUs = 0,
  endUs = 30,
  limit = 100,
): QueryViewportRequest {
  return {
    type: 'query-viewport',
    schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
    requestId,
    sessionId: session.sessionId,
    sessionRevision: session.sessionRevision,
    range: { startUs, endUs },
    limit,
  };
}

describe('Workbench stage 0 protocol and query spike', () => {
  it('uses an exhaustive discriminated request protocol', () => {
    const requestNames: WorkbenchRequest['type'][] = [
      'create-session',
      'query-viewport',
      'query-event-detail',
      'query-capabilities',
      'query-evidence',
      'query-screenshot',
      'cancel-query',
      'release-session',
    ];
    const errorCodes: WorkbenchQueryErrorCode[] = [
      'unsupported-capability',
      'invalid-range',
      'query-cancelled',
      'query-timeout',
      'result-truncated',
      'session-released',
      'worker-failed',
    ];

    expect(new Set(requestNames).size).toBe(8);
    expect(new Set(errorCodes).size).toBe(7);
  });

  it('rejects malformed or unknown cross-thread requests without coercion', () => {
    expect(isWorkbenchRequest(createRequest())).toBe(true);
    expect(isWorkbenchRequest({
      ...createRequest(),
      schemaVersion: 2,
    })).toBe(false);
    expect(isWorkbenchRequest({
      ...createRequest(),
      requestedCapabilities: ['unknown-capability'],
    })).toBe(false);
    expect(isWorkbenchRequest({
      ...viewportRequest({
        sessionId: 'session',
        sessionRevision: 1,
      } as SessionCreatedResponse, 'query'),
      limit: '100',
    })).toBe(false);
    expect(isWorkbenchRequest({
      type: 'unbounded-query',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'unknown',
    })).toBe(false);
    expect(isWorkbenchBenchmarkWorkerRequest(null)).toBe(false);
    expect(isWorkbenchBenchmarkWorkerRequest({
      type: 'prepare-workbench-benchmark',
      requestId: 'invalid-size',
      eventCount: 99,
    })).toBe(false);
    expect(isWorkbenchRequest({
      type: 'query-flame-chart',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'flame',
      sessionId: 'session',
      sessionRevision: 1,
      range: { startUs: 0, endUs: 100 },
      sort: 'start-time',
      limit: 200,
    })).toBe(true);
    expect(isWorkbenchRequest({
      type: 'query-search',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'search',
      sessionId: 'session',
      sessionRevision: 1,
      range: { startUs: 0, endUs: 100 },
      sort: 'start-time',
      limit: '200',
      query: 'Layout',
    })).toBe(false);
  });

  it('rejects malformed Worker responses before client state sees them', () => {
    const response = viewportResponse({
      type: 'query-viewport',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'viewport',
      sessionId: 'session',
      sessionRevision: 1,
      range: { startUs: 0, endUs: 10 },
      limit: 10,
    });
    expect(isWorkbenchResponse(response)).toBe(true);
    expect(isWorkbenchResponse({
      ...response,
      truncation: {
        ...response.truncation,
        returnedCount: 1,
      },
    })).toBe(false);
    expect(isWorkbenchResponse({
      ...response,
      sessionRevision: '1',
    })).toBe(false);
    expect(isWorkbenchBenchmarkWorkerResponse({
      type: 'workbench-response',
      response,
      workerElapsedMs: 1,
      uiTransferBytes: 10,
    })).toBe(true);
    expect(isWorkbenchBenchmarkWorkerResponse({
      type: 'workbench-response',
      response: { ...response, events: [{ privateDetail: 'leak' }] },
      workerElapsedMs: 1,
      uiTransferBytes: 10,
    })).toBe(false);
    expect(isWorkbenchResponse({
      type: 'session-created',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'create-invalid-state',
      sessionId: 'session',
      sessionRevision: 1,
      session: {
        sessionId: 'session',
        sessionRevision: 1,
        state: 'failed',
        source: sourceRef,
        capabilities: [],
        missingCapabilities: [],
        range: { startUs: 0, endUs: 0 },
        eventCount: 0,
        screenshotCount: 0,
      },
    })).toBe(false);
    expect(isWorkbenchResponse({
      type: 'call-tree-result',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'call-tree',
      sessionId: 'session',
      sessionRevision: 1,
      range: { startUs: 0, endUs: 100 },
      capability: 'available',
      limitations: [],
      nodes: [{
        id: 'node-1',
        nodeId: 1,
        functionName: 'work',
        selfTimeUs: 20,
        totalTimeUs: 10,
        sampleHits: 1,
        depth: 0,
        evidenceIds: ['trace:event:1'],
      }],
      truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
    })).toBe(false);
    expect(isWorkbenchResponse({
      type: 'event-log-result',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'event-log',
      sessionId: 'session',
      sessionRevision: 1,
      range: { startUs: 0, endUs: 100 },
      events: [{
        id: 'trace:timeline:1',
        trackId: 'main',
        startUs: 0,
        durationUs: 10,
        depth: 0,
        category: 'main-thread',
        name: 'RunTask',
        args: { secret: '<REDACTED>' },
      }],
      truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
    })).toBe(false);
    expect(isWorkbenchResponse({
      type: 'search-result',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'search',
      sessionId: 'session',
      sessionRevision: 1,
      range: { startUs: 0, endUs: 100 },
      query: 'task',
      events: [],
      currentIndex: 0,
      truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
      rawEvents: [],
    })).toBe(false);
  });


  it('returns every event intersecting the viewport, including long events that start outside it', async () => {
    const kernel = new WorkbenchSpikeKernel({ resolveSource: () => source() });
    const session = await createSession(kernel);
    const response = await kernel.dispatch(viewportRequest(session, 'viewport-1', 0, 12));

    expect(response.type).toBe('viewport-result');
    if (response.type !== 'viewport-result') return;
    expect(response.events.map(event => event.name)).toEqual(['long-task', 'child-task']);
  });

  it('exposes explicit truncation and continuation semantics', async () => {
    const kernel = new WorkbenchSpikeKernel({ resolveSource: () => source() });
    const session = await createSession(kernel);
    const first = await kernel.dispatch(viewportRequest(session, 'viewport-1', -100, 30, 2));

    expect(first.type).toBe('viewport-result');
    if (first.type !== 'viewport-result') return;
    expect(first.truncation).toEqual({
      truncated: true,
      returnedCount: 2,
      totalMatched: 3,
      continuation: {
        afterStartUs: 10,
        afterEventId: first.events[1].id,
      },
    });
    const second = await kernel.dispatch({
      ...viewportRequest(session, 'viewport-2', -100, 30, 2),
      continuation: first.truncation.continuation,
    });
    expect(second.type).toBe('viewport-result');
    if (second.type !== 'viewport-result') throw new Error('second page was not returned');
    expect(second.events.map(event => event.name)).toEqual(['request']);
    expect(second.truncation.truncated).toBe(false);
  });

  it('returns a structured truncation error when a complete result is required', async () => {
    const kernel = new WorkbenchSpikeKernel({ resolveSource: () => source() });
    const session = await createSession(kernel);
    const response = await kernel.dispatch({
      ...viewportRequest(session, 'complete-result', -100, 30, 2),
      allowTruncation: false,
    });

    expect(response).toMatchObject({
      type: 'structured-error',
      error: {
        code: 'result-truncated',
        recoverable: true,
      },
    });
  });

  it('reports capability missing while preserving a degraded session', async () => {
    const limitedSource = source();
    limitedSource.capabilities = ['timeline-events'];
    const kernel = new WorkbenchSpikeKernel({ resolveSource: () => limitedSource });
    const session = await createSession(kernel);

    expect(session.session.state).toBe('degraded');
    expect(session.session.missingCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'event-detail' }),
      expect.objectContaining({ capability: 'screenshots' }),
    ]));
    const response = await kernel.dispatch({
      type: 'query-event-detail',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'missing-detail',
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      eventId: 'event-000000',
    });
    expect(response).toMatchObject({
      type: 'capability-missing',
      capability: 'event-detail',
    });
  });

  it('returns query-timeout without releasing the session', async () => {
    let now = 0;
    const kernel = new WorkbenchSpikeKernel({
      resolveSource: () => source(),
      now: () => ++now,
      queryTimeoutMs: 1,
    });
    const session = await createSession(kernel);
    const response = await kernel.dispatch(
      viewportRequest(session, 'timed-out-query', -100, 30),
    );

    expect(response).toMatchObject({
      type: 'structured-error',
      error: {
        code: 'query-timeout',
        recoverable: true,
      },
    });
    expect(kernel.getResourceStats().sessionCount).toBe(1);
  });

  it('returns only allowlisted event detail and deterministic IDs', async () => {
    const firstKernel = new WorkbenchSpikeKernel({ resolveSource: () => source() });
    const secondKernel = new WorkbenchSpikeKernel({ resolveSource: () => source() });
    const firstSession = await createSession(firstKernel, 'first-create');
    const secondSession = await createSession(secondKernel, 'second-create');
    const firstViewport = await firstKernel.dispatch(viewportRequest(firstSession, 'first-query'));
    const secondViewport = await secondKernel.dispatch(viewportRequest(secondSession, 'second-query'));

    expect(firstViewport.type).toBe('viewport-result');
    expect(secondViewport.type).toBe('viewport-result');
    if (firstViewport.type !== 'viewport-result' || secondViewport.type !== 'viewport-result') return;
    expect(firstViewport.events).toEqual(secondViewport.events);

    const detail = await firstKernel.dispatch({
      type: 'query-event-detail',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'detail-1',
      sessionId: firstSession.sessionId,
      sessionRevision: firstSession.sessionRevision,
      eventId: firstViewport.events[0].id,
    });
    expect(detail.type).toBe('event-detail-result');
    expect(JSON.stringify(detail)).not.toMatch(
      /private\.invalid|Authorization|token|privateDetail|traceEvents|args/,
    );
  });

  it('cancels one query without changing the last stable viewport result', async () => {
    let resumeQuery: (() => void) | undefined;
    const kernel = new WorkbenchSpikeKernel({
      resolveSource: () => source(),
      queryYieldInterval: 1,
      yieldControl: () => new Promise(resolve => {
        resumeQuery = resolve;
      }),
    });
    const session = await createSession(kernel);

    const client = new WorkbenchSpikeClientState();
    client.activateSession(session.session);
    const stableResponse = await kernel.dispatch(viewportRequest(session, 'stable-query', 1_000, 1_001));
    client.markLatest('viewport', 'stable-query');
    expect(client.accept(stableResponse)).toBe(true);

    const pendingRequest = viewportRequest(session, 'cancelled-query', -100, 30);
    client.markLatest('viewport', pendingRequest.requestId);
    const pending = kernel.dispatch(pendingRequest);
    await Promise.resolve();
    const cancelResponse = await kernel.dispatch({
      type: 'cancel-query',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'cancel-control',
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      targetRequestId: pendingRequest.requestId,
    });
    expect(cancelResponse.type).toBe('query-cancelled');
    resumeQuery?.();
    const cancelled = await pending;
    expect(cancelled).toMatchObject({
      type: 'structured-error',
      error: { code: 'query-cancelled' },
    });
    expect(client.getSnapshot().viewport?.requestId).toBe('stable-query');
  });

  it('rejects stale session, revision, and request responses', async () => {
    const kernel = new WorkbenchSpikeKernel({ resolveSource: () => source() });
    const first = await createSession(kernel, 'create-first');
    const second = await createSession(kernel, 'create-second');
    const client = new WorkbenchSpikeClientState();
    client.activateSession(second.session);
    client.markLatest('viewport', 'current-query');

    const oldSessionResponse = await kernel.dispatch(viewportRequest(first, 'old-session-query'));
    expect(client.accept(oldSessionResponse)).toBe(false);

    const staleRevision = await kernel.dispatch({
      ...viewportRequest(second, 'stale-revision-query'),
      sessionRevision: second.sessionRevision - 1,
    });
    expect(staleRevision).toMatchObject({
      type: 'structured-error',
      error: { code: 'session-released' },
    });
    expect(client.accept(staleRevision)).toBe(false);

    const oldRequest = await kernel.dispatch(viewportRequest(second, 'old-request'));
    expect(client.accept(oldRequest)).toBe(false);
    const current = await kernel.dispatch(viewportRequest(second, 'current-query'));
    expect(client.accept(current)).toBe(true);
    expect(client.getSnapshot().discardedResponseCount).toBe(3);
  });

  it('rejects a stale structured query error from the current session', async () => {
    const kernel = new WorkbenchSpikeKernel({ resolveSource: () => source() });
    const session = await createSession(kernel);
    const client = new WorkbenchSpikeClientState();
    client.activateSession(session.session);
    client.markLatest('viewport', 'current-query');

    const staleError = await kernel.dispatch({
      ...viewportRequest(session, 'stale-query'),
      range: { startUs: 10, endUs: 0 },
    });
    expect(staleError).toMatchObject({
      type: 'structured-error',
      error: { code: 'invalid-range' },
    });
    expect(client.accept(staleError)).toBe(false);
    expect(client.getSnapshot().lastError).toBeUndefined();
    expect(client.getSnapshot().discardedResponseCount).toBe(1);
  });

  it('releases indexes, queries, blob URLs, and transferable references', async () => {
    const revoked: string[] = [];
    const kernel = new WorkbenchSpikeKernel({
      resolveSource: () => source(),
      revokeBlobUrl: url => revoked.push(url),
    });
    const session = await createSession(kernel);
    expect(kernel.getResourceStats()).toEqual({
      sessionCount: 1,
      activeQueryCount: 0,
      blobUrlCount: 1,
      transferableCount: 1,
    });

    const released = await kernel.dispatch({
      type: 'release-session',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'release-1',
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
    });
    expect(released).toMatchObject({
      type: 'session-released',
      revokedBlobUrlCount: 1,
    });
    expect(revoked).toEqual(['blob:workbench-spike']);
    expect(kernel.getResourceStats()).toEqual({
      sessionCount: 0,
      activeQueryCount: 0,
      blobUrlCount: 0,
      transferableCount: 0,
    });

    const afterRelease = await kernel.dispatch(viewportRequest(session, 'after-release'));
    expect(afterRelease).toMatchObject({
      type: 'structured-error',
      error: { code: 'session-released' },
    });
  });

  it('releases all sessions after a worker failure', async () => {
    const kernel = new WorkbenchSpikeKernel({ resolveSource: () => source() });
    await createSession(kernel);
    kernel.failWorker();
    expect(kernel.getResourceStats().sessionCount).toBe(0);
  });

  it('bounds high-frequency viewport work to one active and one latest pending request', async () => {
    const resolvers: Array<(response: WorkbenchResponse) => void> = [];
    const executed: string[] = [];
    const cancelled: string[] = [];
    const execute = jest.fn((request: QueryViewportRequest) => {
      executed.push(request.requestId);
      return new Promise<WorkbenchResponse>(resolve => resolvers.push(resolve));
    });
    const dispatcher = new LatestViewportDispatcher(
      execute,
      request => cancelled.push(request.requestId),
    );
    const fakeSession = {
      type: 'session-created',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'create',
      sessionId: 'session',
      sessionRevision: 1,
      session: {} as SessionCreatedResponse['session'],
    } satisfies SessionCreatedResponse;
    const requests = ['q1', 'q2', 'q3', 'q4'].map(requestId => (
      viewportRequest(fakeSession, requestId)
    ));
    const promises = requests.map(request => dispatcher.submit(request));

    expect(executed).toEqual(['q1']);
    expect(dispatcher.getStats()).toEqual({
      maxQueueDepth: 2,
      cancelledRequestCount: 1,
      droppedPendingRequestCount: 2,
    });
    expect(cancelled).toEqual(['q1']);
    resolvers.shift()?.(viewportResponse(requests[0]));
    await Promise.resolve();
    await Promise.resolve();
    expect(executed).toEqual(['q1', 'q4']);
    resolvers.shift()?.(viewportResponse(requests[3]));
    await Promise.all(promises);
  });
});

function viewportResponse(request: QueryViewportRequest): ViewportResultResponse {
  return {
    type: 'viewport-result',
    schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
    requestId: request.requestId,
    sessionId: request.sessionId,
    sessionRevision: request.sessionRevision,
    range: request.range,
    events: [],
    truncation: {
      truncated: false,
      returnedCount: 0,
      totalMatched: 0,
    },
  };
}
