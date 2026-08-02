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
      trackEventCounts: { main: 1 },
      screenshotCount: 0,
    },
  };
}

describe('TraceWorkbenchClient', () => {
  it('publishes real indexing work without exposing 100% before session commit', async () => {
    let resolveCreate: ((response: WorkbenchResponse) => void) | undefined;
    let requestId = '';
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, {
      dispatch: request => new Promise(resolve => {
        if (request.type === 'create-session') {
          requestId = request.requestId;
          resolveCreate = resolve;
        }
      }),
      close: jest.fn(),
    });
    const pending = client.createSession();
    client.handleProgress({
      type: 'progress',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId,
      sessionId: 'session-1',
      sessionRevision: 1,
      phase: 'indexing-events',
      unit: 'events',
      completed: 40,
      total: 100,
    });
    expect(client.getSnapshot().progress).toMatchObject({
      completed: 40,
      total: 100,
    });
    client.handleProgress({
      type: 'progress',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId,
      sessionId: 'session-1',
      sessionRevision: 1,
      phase: 'indexing-events',
      unit: 'events',
      completed: 100,
      total: 100,
    });
    expect(client.getSnapshot().progress?.completed).toBe(40);

    resolveCreate?.(sessionResponse(requestId));
    await pending;
    expect(client.getSnapshot().progress).toBeUndefined();
  });

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

  it('surfaces a missing CPU capability instead of leaving analysis views blank', async () => {
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, {
      dispatch: async request => {
        if (request.type === 'create-session') return sessionResponse(request.requestId);
        if (request.type === 'query-flame-chart') {
          return {
            type: 'capability-missing',
            schemaVersion: WORKBENCH_SCHEMA_VERSION,
            requestId: request.requestId,
            sessionId: request.sessionId,
            sessionRevision: request.sessionRevision,
            capability: 'cpu-profile',
            reason: '当前 Trace 未提供可用 CPU 采样。',
          };
        }
        throw new Error('unexpected request');
      },
      close: jest.fn(),
    });

    await client.createSession();
    await client.queryFlameChart({ startUs: 0, endUs: 100 });

    expect(client.getSnapshot().queryErrors.cpu).toMatchObject({
      error: {
        code: 'unsupported-capability',
        message: '当前 Trace 未提供可用 CPU 采样。',
        recoverable: true,
      },
    });
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

  it('commits local baseline revisions before comparison and removal', async () => {
    const requests: WorkbenchRequest[] = [];
    const dispatch = jest.fn(async (
      request: WorkbenchRequest,
    ): Promise<WorkbenchResponse> => {
      requests.push(request);
      if (request.type === 'create-session') return sessionResponse(request.requestId);
      if (request.type === 'query-trace-comparison') {
        return {
          type: 'trace-comparison-result',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          status: 'comparable',
          range: request.range,
          baselineRange: request.range,
          regression: 'stable',
          metrics: [],
          evidenceIds: [],
          limitations: [],
        };
      }
      if (request.type === 'remove-comparison-baseline') {
        return {
          type: 'comparison-baseline-result',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision + 1,
          operation: 'removed',
          baselineAvailable: false,
          limitations: [],
        };
      }
      throw new Error('unexpected request');
    });
    const dispatchSourceFile = jest.fn(async (
      request: Extract<
        WorkbenchRequest,
        { type: 'add-source' | 'replace-source' | 'add-comparison-baseline' }
      >,
    ): Promise<WorkbenchResponse> => ({
      type: 'comparison-baseline-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision + 1,
      operation: 'added',
      baselineAvailable: true,
      sourceBytes: 10,
      eventCount: 1,
      limitations: [],
    }));
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, { dispatch, dispatchSourceFile, close: jest.fn() });
    await client.createSession();

    await client.addComparisonBaseline(new File(['trace'], 'baseline.trace'));
    expect(client.getSnapshot().session?.sessionRevision).toBe(2);
    await client.queryTraceComparison({ startUs: 0, endUs: 100 });
    expect(requests.at(-1)).toMatchObject({
      type: 'query-trace-comparison',
      sessionRevision: 2,
    });
    expect(client.getSnapshot().comparison).toMatchObject({
      status: 'comparable',
      regression: 'stable',
    });

    await client.removeComparisonBaseline();
    expect(requests.at(-1)).toMatchObject({
      type: 'remove-comparison-baseline',
      sessionRevision: 2,
    });
    expect(client.getSnapshot()).toMatchObject({
      session: { sessionRevision: 3 },
      comparisonBaseline: { baselineAvailable: false },
      comparison: undefined,
    });
  });

  it('discards a late comparison response without replacing stable state', async () => {
    const pending: Array<{
      request: Extract<WorkbenchRequest, { type: 'query-trace-comparison' }>;
      resolve(response: WorkbenchResponse): void;
    }> = [];
    const dispatch = jest.fn((
      request: WorkbenchRequest,
    ): Promise<WorkbenchResponse> => {
      if (request.type === 'create-session') {
        return Promise.resolve(sessionResponse(request.requestId));
      }
      if (request.type === 'query-trace-comparison') {
        return new Promise(resolve => pending.push({ request, resolve }));
      }
      throw new Error('unexpected request');
    });
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, { dispatch, close: jest.fn() });
    await client.createSession();

    const first = client.queryTraceComparison({ startUs: 0, endUs: 10 }, true);
    const second = client.queryTraceComparison({ startUs: 10, endUs: 20 }, true);
    const response = (
      item: typeof pending[number],
      regression: 'stable' | 'improved',
    ): WorkbenchResponse => ({
      type: 'trace-comparison-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: item.request.requestId,
      sessionId: item.request.sessionId,
      sessionRevision: item.request.sessionRevision,
      status: 'comparable',
      range: item.request.range,
      baselineRange: item.request.range,
      regression,
      metrics: [],
      evidenceIds: [],
      limitations: [],
    });

    pending[1].resolve(response(pending[1], 'improved'));
    await second;
    pending[0].resolve(response(pending[0], 'stable'));
    await first;

    expect(client.getSnapshot().comparison).toMatchObject({
      range: { startUs: 10, endUs: 20 },
      regression: 'improved',
    });
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

  it('uses latest-wins for selection queries and discards a late selection result', async () => {
    const selectionResolvers: Array<(response: WorkbenchResponse) => void> = [];
    const requests: WorkbenchRequest[] = [];
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, {
      dispatch: request => {
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
        return new Promise(resolve => selectionResolvers.push(resolve));
      },
      close: jest.fn(),
    });
    await client.createSession();
    const first = client.querySelection({ startUs: 0, endUs: 10 });
    const latest = client.querySelection({ startUs: 20, endUs: 30 });
    const firstRequest = requests.find(
      (request): request is Extract<WorkbenchRequest, { type: 'query-selection' }> => (
        request.type === 'query-selection'
      ),
    );
    if (!firstRequest) throw new Error('missing selection request');
    selectionResolvers.shift()?.({
      type: 'selection-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: firstRequest.requestId,
      sessionId: firstRequest.sessionId,
      sessionRevision: firstRequest.sessionRevision,
      range: firstRequest.range,
      matchedCount: 1,
      trackCounts: { main: 1 },
      statusCounts: { normal: 1 },
      truncation: { truncated: false, countedCount: 1, totalMatched: 1 },
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (requests.filter(request => request.type === 'query-selection').length === 2) break;
      await Promise.resolve();
    }
    const selectionRequests = requests.filter(
      (request): request is Extract<WorkbenchRequest, { type: 'query-selection' }> => (
        request.type === 'query-selection'
      ),
    );
    const latestRequest = selectionRequests[1];
    selectionResolvers.shift()?.({
      type: 'selection-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: latestRequest.requestId,
      sessionId: latestRequest.sessionId,
      sessionRevision: latestRequest.sessionRevision,
      range: latestRequest.range,
      matchedCount: 2,
      trackCounts: { rendering: 2 },
      statusCounts: { warning: 2 },
      truncation: { truncated: false, countedCount: 2, totalMatched: 2 },
    });
    await Promise.all([first, latest]);

    expect(client.getSnapshot().selection).toMatchObject({
      range: { startUs: 20, endUs: 30 },
      matchedCount: 2,
    });
    expect(client.getSnapshot().discardedResponseCount).toBe(1);
    expect(client.getSelectionQueueStats()).toMatchObject({
      maxQueueDepth: 2,
      cancelledRequestCount: 1,
    });
  });

  it('rejects a stale advanced result instead of returning it to the panel', async () => {
    const requests: Array<Extract<
      WorkbenchRequest,
      { type: 'query-advanced-analysis' }
    >> = [];
    const resolvers: Array<(response: WorkbenchResponse) => void> = [];
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, {
      dispatch: request => {
        if (request.type === 'create-session') {
          return Promise.resolve(sessionResponse(request.requestId));
        }
        if (request.type !== 'query-advanced-analysis') {
          throw new Error('unexpected request');
        }
        requests.push(request);
        return new Promise(resolve => resolvers.push(resolve));
      },
      close: jest.fn(),
    });
    await client.createSession();
    const first = client.queryAdvancedAnalysis(
      'layout-shifts',
      { startUs: 0, endUs: 10 },
    );
    const latest = client.queryAdvancedAnalysis(
      'layout-shifts',
      { startUs: 20, endUs: 30 },
    );
    const response = (index: number): WorkbenchResponse => ({
      type: 'advanced-analysis-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: requests[index].requestId,
      sessionId: requests[index].sessionId,
      sessionRevision: requests[index].sessionRevision,
      capability: 'layout-shifts',
      status: 'unavailable',
      evidenceIds: [],
      limitations: ['没有明确 LayoutShift 事件。'],
      result: { kind: 'layout-shifts', clusters: [] },
    });
    resolvers[1](response(1));
    await expect(latest).resolves.toMatchObject({
      type: 'advanced-analysis-result',
      capability: 'layout-shifts',
    });
    resolvers[0](response(0));
    await expect(first).rejects.toThrow('response is stale');
    expect(client.getSnapshot().discardedResponseCount).toBe(1);
  });

  it('uses an independent latest-request channel for declarative queries', async () => {
    const requests: Array<Extract<
      WorkbenchRequest,
      { type: 'query-custom-events' }
    >> = [];
    const resolvers: Array<(response: WorkbenchResponse) => void> = [];
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, {
      dispatch: request => {
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
        if (request.type !== 'query-custom-events') {
          throw new Error('unexpected request');
        }
        requests.push(request);
        return new Promise(resolve => resolvers.push(resolve));
      },
      close: jest.fn(),
    });
    await client.createSession();
    const query = {
      clauses: [{ field: 'name' as const, operator: 'contains' as const, value: 'Task' }],
    };
    const first = client.queryCustomEvents({ startUs: 0, endUs: 10 }, query);
    const latest = client.queryCustomEvents({ startUs: 20, endUs: 30 }, query);
    await Promise.resolve();
    const response = (
      request: typeof requests[number],
    ): WorkbenchResponse => ({
      type: 'custom-query-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      range: request.range,
      events: [],
      evidenceIds: [],
      limitations: ['匹配数量不表示性能问题或根因。'],
      truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
    });

    resolvers[0](response(requests[0]));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (requests.length === 2) break;
      await Promise.resolve();
    }
    resolvers[1](response(requests[1]));
    await Promise.all([first, latest]);

    expect(client.getSnapshot().customQuery?.range).toEqual({
      startUs: 20,
      endUs: 30,
    });
    expect(client.getSnapshot().discardedResponseCount).toBe(1);
  });

  it('discards stale projected track responses on the per-plugin channel', async () => {
    const requests: Array<Extract<
      WorkbenchRequest,
      { type: 'query-track-plugin' }
    >> = [];
    const resolvers: Array<(response: WorkbenchResponse) => void> = [];
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, {
      dispatch: request => {
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
        if (request.type !== 'query-track-plugin') {
          throw new Error('unexpected request');
        }
        requests.push(request);
        return new Promise(resolve => resolvers.push(resolve));
      },
      close: jest.fn(),
    });
    await client.createSession();
    const first = client.queryTrackPlugin(
      'layout-watch',
      { startUs: 0, endUs: 10 },
    );
    const latest = client.queryTrackPlugin(
      'layout-watch',
      { startUs: 20, endUs: 30 },
    );
    const response = (
      request: typeof requests[number],
    ): WorkbenchResponse => ({
      type: 'track-plugin-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
      sessionRevision: request.sessionRevision,
      operation: 'refreshed',
      plugin: {
        pluginId: 'layout-watch',
        label: 'Layout Watch',
        trackId: 'plugin:layout-watch',
      },
      range: request.range,
      projectedEvents: [],
      evidenceIds: [],
      limitations: [],
      truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
    });

    resolvers[0](response(requests[0]));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (requests.length === 2) break;
      await Promise.resolve();
    }
    resolvers[1](response(requests[1]));
    await Promise.all([first, latest]);

    expect(client.getSnapshot().discardedResponseCount).toBe(1);
  });

  it('keeps a track plugin query error local to the plugin panel', async () => {
    const client = new TraceWorkbenchClient({
      sourceId: 'source',
      parserId: 'trace',
      fingerprint: 'trace:1:1',
    }, {
      dispatch: request => {
        if (request.type === 'create-session') {
          return Promise.resolve(sessionResponse(request.requestId));
        }
        if (request.type !== 'query-track-plugin') {
          throw new Error('unexpected request');
        }
        return Promise.resolve({
          type: 'structured-error',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          error: {
            code: 'query-timeout',
            message: 'plugin query timed out',
            recoverable: true,
          },
        });
      },
      close: jest.fn(),
    });
    await client.createSession();

    await client.queryTrackPlugin('layout-watch', { startUs: 0, endUs: 10 });

    expect(client.getSnapshot().lastError).toBeUndefined();
    expect(client.getSnapshot().queryErrors).toEqual({});
  });
});
