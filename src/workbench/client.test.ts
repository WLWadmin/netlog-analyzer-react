import { TraceWorkbenchClient } from './client';
import {
  WORKBENCH_SCHEMA_VERSION,
  type WorkbenchRequest,
  type WorkbenchResponse,
} from './protocol';

function sessionResponse(requestId: string): WorkbenchResponse {
  return {
    type: 'session-created',
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    requestId,
    sessionId: 'session-1',
    sessionRevision: 1,
    session: {
      sessionId: 'session-1',
      sessionRevision: 1,
      state: 'ready',
      source: {
        sourceId: 'source',
        parserId: 'trace',
        fingerprint: 'trace:1:1',
      },
      capabilities: ['timeline-events', 'event-detail', 'raw-evidence'],
      missingCapabilities: [],
      range: { startUs: 0, endUs: 100 },
      eventCount: 1,
      screenshotCount: 0,
    },
  };
}

describe('TraceWorkbenchClient', () => {
  it('closes the retained Worker when session creation cannot complete', async () => {
    const close = jest.fn();
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, {
      dispatch: jest.fn().mockRejectedValue(new Error('transport failed')),
      close,
    });

    await expect(client.createSession()).rejects.toThrow('transport failed');
    expect(client.getSnapshot().status).toBe('failed');
    expect(client.getSnapshot().session).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps stable viewport when a stale structured error arrives', async () => {
    let viewportCount = 0;
    const dispatch = jest.fn(async (request: WorkbenchRequest): Promise<WorkbenchResponse> => {
      if (request.type === 'create-session') return sessionResponse(request.requestId);
      if (request.type === 'query-viewport') {
        viewportCount += 1;
        if (viewportCount === 1) {
          return {
            type: 'viewport-result',
            schemaVersion: WORKBENCH_SCHEMA_VERSION,
            requestId: request.requestId,
            sessionId: request.sessionId,
            sessionRevision: request.sessionRevision,
            range: request.range,
            events: [],
            truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
          };
        }
        return {
          type: 'structured-error',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: 'stale-request',
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          error: {
            code: 'query-timeout',
            message: 'stale',
            recoverable: true,
          },
        };
      }
      throw new Error('unexpected request');
    });
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, { dispatch, close: jest.fn() });
    await client.createSession();
    await client.queryViewport({ startUs: 0, endUs: 10 });
    const stable = client.getSnapshot().viewport;
    await client.queryViewport({ startUs: 10, endUs: 20 });

    expect(client.getSnapshot().viewport).toBe(stable);
    expect(client.getSnapshot().lastError).toBeUndefined();
    expect(client.getSnapshot().discardedResponseCount).toBe(1);
  });

  it('sends at most one cancellation for the active viewport and bounds the queue', async () => {
    const resolvers: Array<(response: WorkbenchResponse) => void> = [];
    const requests: WorkbenchRequest[] = [];
    const dispatch = jest.fn((request: WorkbenchRequest): Promise<WorkbenchResponse> => {
      requests.push(request);
      if (request.type === 'create-session') {
        return Promise.resolve(sessionResponse(request.requestId));
      }
      if (request.type === 'cancel-query') {
        return Promise.resolve({
          type: 'query-cancelled',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          targetRequestId: request.targetRequestId,
        });
      }
      return new Promise(resolve => resolvers.push(resolve));
    });
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, { dispatch, close: jest.fn() });
    await client.createSession();
    const pending = [
      client.queryViewport({ startUs: 0, endUs: 10 }),
      client.queryViewport({ startUs: 10, endUs: 20 }),
      client.queryViewport({ startUs: 20, endUs: 30 }),
      client.queryViewport({ startUs: 30, endUs: 40 }),
    ];
    await Promise.resolve();
    expect(requests.filter(request => request.type === 'cancel-query')).toHaveLength(1);
    expect(client.getQueueStats()).toEqual({
      maxQueueDepth: 2,
      cancelledRequestCount: 1,
      droppedPendingRequestCount: 2,
    });

    const active = requests.find(request => request.type === 'query-viewport');
    if (!active || active.type !== 'query-viewport') throw new Error('missing active request');
    resolvers.shift()?.({
      type: 'structured-error',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: active.requestId,
      sessionId: active.sessionId,
      sessionRevision: active.sessionRevision,
      error: { code: 'query-cancelled', message: 'cancelled', recoverable: true },
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (requests.filter(request => request.type === 'query-viewport').length === 2) break;
      await Promise.resolve();
    }
    const viewportRequests = requests.filter(
      (request): request is Extract<WorkbenchRequest, { type: 'query-viewport' }> => (
        request.type === 'query-viewport'
      ),
    );
    const latest = viewportRequests[viewportRequests.length - 1];
    resolvers.shift()?.({
      type: 'viewport-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: latest.requestId,
      sessionId: latest.sessionId,
      sessionRevision: latest.sessionRevision,
      range: latest.range,
      events: [],
      truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
    });
    await Promise.all(pending);
  });
});
