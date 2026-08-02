import type { ChromiumTraceFile } from '../parsers/trace/types';
import { WORKBENCH_SCHEMA_VERSION } from './protocol';
import { WorkbenchSessionKernel } from './sessionKernel';
import { MinimalTraceEngineAdapter } from './traceEngineAdapter';

const trace: ChromiumTraceFile = {
  traceEvents: [
    {
      name: 'RunTask',
      cat: 'devtools.timeline',
      ph: 'X',
      ts: -100,
      dur: 150,
      pid: 1,
      tid: 10,
      args: { secret: '<REDACTED>' },
    },
    {
      name: 'Layout',
      cat: 'rendering',
      ph: 'X',
      ts: 10,
      dur: 5,
      pid: 1,
      tid: 10,
    },
    {
      name: 'Screenshot',
      ts: 20,
      args: { snapshot: 'AQIDBA==' },
    },
  ],
};

async function kernel(
  options: ConstructorParameters<typeof WorkbenchSessionKernel>[2] = {},
  input: ChromiumTraceFile = trace,
) {
  const adapter = new MinimalTraceEngineAdapter(
    { traceEvents: input.traceEvents.map(event => ({ ...event })) },
    {
      encoding: 'plain-json',
      jsonBytes: 100,
      skippedEventCount: 0,
      warnings: [],
    },
    { cancellationInterval: 1, indexYieldInterval: 1 },
  );
  await adapter.analyze({
    isCancelled: () => false,
    onProgress: () => undefined,
  });
  return new WorkbenchSessionKernel(adapter, {
    sourceId: 'trace-source',
    parserId: 'trace',
    fingerprint: 'trace:100:3',
  }, options);
}

async function createSession(subject: WorkbenchSessionKernel) {
  const response = await subject.dispatch({
    type: 'create-session',
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    requestId: 'create',
    source: {
      sourceId: 'trace-source',
      parserId: 'trace',
      fingerprint: 'trace:100:3',
    },
    requestedCapabilities: [
      'timeline-events',
      'event-detail',
      'raw-evidence',
      'screenshots',
      'cpu-profile',
    ],
  });
  expect(response.type).toBe('session-created');
  if (response.type !== 'session-created') throw new Error('session unavailable');
  return response;
}

describe('WorkbenchSessionKernel', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
    delete process.env.REACT_APP_ENABLE_TRACE_TIMELINE;
    delete process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS;
    delete process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE;
  });

  it('rejects a concurrent create request instead of building the index twice', async () => {
    const subject = await kernel({ yieldControl: () => Promise.resolve() });
    const request = {
      type: 'create-session' as const,
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      source: {
        sourceId: 'trace-source',
        parserId: 'trace' as const,
        fingerprint: 'trace:100:3',
      },
      requestedCapabilities: ['timeline-events' as const],
    };

    const first = subject.dispatch({ ...request, requestId: 'create-first' });
    const second = await subject.dispatch({ ...request, requestId: 'create-second' });

    expect(second).toMatchObject({
      type: 'structured-error',
      error: { recoverable: true },
    });
    await expect(first).resolves.toMatchObject({ type: 'session-created' });
  });

  it('creates a deterministic degraded session and queries timeline, evidence and screenshot', async () => {
    const subject = await kernel();
    const progress: string[] = [];
    const created = await subject.dispatch({
      type: 'create-session',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'create',
      source: {
        sourceId: 'trace-source',
        parserId: 'trace',
        fingerprint: 'trace:100:3',
      },
      requestedCapabilities: [
        'timeline-events',
        'event-detail',
        'raw-evidence',
        'screenshots',
        'cpu-profile',
      ],
    }, update => progress.push(`${update.phase}:${update.completed}`));
    expect(created.type).toBe('session-created');
    if (created.type !== 'session-created') return;
    expect(created.session).toMatchObject({
      state: 'degraded',
      eventCount: 2,
      screenshotCount: 1,
      trackEventCounts: {
        main: 1,
        rendering: 1,
      },
      missingCapabilities: [
        expect.objectContaining({ capability: 'cpu-profile' }),
      ],
    });
    expect(progress).toEqual(expect.arrayContaining([
      'indexing-events:0',
      'indexing-events:3',
    ]));

    const viewport = await subject.dispatch({
      type: 'query-viewport',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'viewport',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      range: { startUs: 0, endUs: 12 },
      limit: 10,
    });
    expect(viewport.type).toBe('viewport-result');
    if (viewport.type !== 'viewport-result') return;
    expect(viewport.events.map(event => event.name)).toEqual(['RunTask', 'Layout']);

    const selection = await subject.dispatch({
      type: 'query-selection',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'selection',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      range: { startUs: 0, endUs: 12 },
    });
    expect(selection).toMatchObject({
      type: 'selection-result',
      range: { startUs: 0, endUs: 12 },
      matchedCount: 2,
      trackCounts: { main: 1, rendering: 1 },
      statusCounts: { normal: 1, unmarked: 1 },
      truncation: {
        truncated: false,
        countedCount: 2,
        totalMatched: 2,
      },
    });

    const detail = await subject.dispatch({
      type: 'query-event-detail',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'detail',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      eventId: viewport.events[0].id,
    });
    expect(detail.type).toBe('event-detail-result');
    expect(JSON.stringify(detail)).not.toMatch(/args|secret|traceEvents/);

    const evidence = await subject.dispatch({
      type: 'query-evidence',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'evidence',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      evidenceId: 'trace:event:0',
    });
    expect(evidence.type).toBe('evidence-result');
    expect(JSON.stringify(evidence)).not.toMatch(/args|secret|traceEvents/);

    const screenshotIndex = await subject.dispatch({
      type: 'query-screenshot-index',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'screenshot-index',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
    });
    expect(screenshotIndex).toMatchObject({
      type: 'screenshot-index-result',
      screenshots: [{
        screenshotId: 'trace:screenshot:2',
        evidenceId: 'trace:event:2',
        timestampUs: 20,
        encodedBytes: 4,
        decodedBytes: 64,
      }],
      rejectedCount: 0,
    });
    expect(JSON.stringify(screenshotIndex)).not.toMatch(/bytes|AQIDBA/);

    const screenshot = await subject.dispatch({
      type: 'query-screenshot',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'screenshot',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      screenshotId: 'trace:screenshot:2',
    });
    expect(screenshot).toMatchObject({
      type: 'screenshot-result',
      screenshot: {
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    });
  });

  it('queries bounded CPU views through the versioned session protocol', async () => {
    const subject = await kernel({}, {
      traceEvents: [
        {
          name: 'Profile',
          ts: 100,
          pid: 1,
          tid: 10,
          id: 'p',
          args: { data: { startTime: 100 } },
        },
        {
          name: 'ProfileChunk',
          ts: 110,
          pid: 1,
          tid: 99,
          id: 'p',
          args: { data: {
            cpuProfile: {
              nodes: [
                { id: 1, callFrame: { functionName: '(root)' }, children: [2] },
                { id: 2, callFrame: { functionName: 'work' } },
              ],
              samples: [2, 2],
            },
            timeDeltas: [10, 20],
          } },
        },
      ],
    });
    const created = await createSession(subject);
    const callTree = await subject.dispatch({
      type: 'query-call-tree',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'call-tree',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      range: { startUs: 100, endUs: 130 },
      sort: 'total-time',
      limit: 10,
    });

    expect(callTree).toMatchObject({
      type: 'call-tree-result',
      capability: 'available',
      nodes: expect.arrayContaining([
        expect.objectContaining({
          functionName: 'work',
          selfTimeUs: 30,
          sampleHits: 2,
        }),
      ]),
    });
    expect(JSON.stringify(callTree)).not.toMatch(/timeDeltas|children|args/);
  });

  it('increments the session revision and revokes stale cross-source queries', async () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE = '1';
    const subject = await kernel();
    const created = await createSession(subject);
    const added = await subject.dispatchSourceFile({
      type: 'add-source',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'add-har',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      sourceToken: 'prepared-har',
      expectedKind: 'har',
    }, new File([JSON.stringify({
      log: {
        creator: { name: 'synthetic' },
        entries: [{
          startedDateTime: '2026-08-02T00:00:00.000Z',
          time: 10,
          request: {
            method: 'GET',
            url: 'https://example.test/path?token=<REDACTED>',
            headers: [],
            queryString: [],
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [],
            content: { size: 0, mimeType: 'text/plain' },
          },
          timings: {
            blocked: 0, dns: 0, connect: 0, ssl: 0,
            send: 1, wait: 8, receive: 1,
          },
        }],
      },
    })], 'synthetic.har'));

    expect(added).toMatchObject({
      type: 'source-change-result',
      operation: 'added',
      sessionRevision: created.sessionRevision + 1,
      sourceRevision: 1,
    });
    const stale = await subject.dispatch({
      type: 'query-sources',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'stale-sources',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
    });
    expect(stale).toMatchObject({
      type: 'structured-error',
      error: { code: 'session-released' },
    });
    if (added.type !== 'source-change-result') return;
    const har = added.sources.find(source => source.kind === 'har')!;
    const removed = await subject.dispatch({
      type: 'remove-source',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'remove-har',
      sessionId: added.sessionId,
      sessionRevision: added.sessionRevision,
      sourceId: har.sourceId,
    });
    expect(removed).toMatchObject({
      type: 'source-change-result',
      operation: 'removed',
      sessionRevision: added.sessionRevision + 1,
      sources: [expect.objectContaining({ kind: 'trace' })],
    });
  });

  it('does not revive a source store when release wins an in-flight source read', async () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE = '1';
    const subject = await kernel();
    const created = await createSession(subject);
    let finishRead: ((value: string) => void) | undefined;
    const file = {
      size: 100,
      text: () => new Promise<string>(resolve => {
        finishRead = resolve;
      }),
    } as File;
    const pending = subject.dispatchSourceFile({
      type: 'add-source',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'slow-har',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      sourceToken: 'slow-har-token',
      expectedKind: 'har',
    }, file);
    await Promise.resolve();
    const released = await subject.dispatch({
      type: 'release-session',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'release-during-source',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
    });
    finishRead?.(JSON.stringify({
      log: { creator: { name: 'synthetic' }, entries: [] },
    }));

    expect(released.type).toBe('session-released');
    await expect(pending).resolves.toMatchObject({
      type: 'structured-error',
      error: { code: 'session-released' },
    });
    expect(subject.getResourceStats().state).toBe('released');
  });

  it('increments revisions, rejects stale requests and releases all resources', async () => {
    const subject = await kernel();
    const first = await createSession(subject);
    const released = await subject.dispatch({
      type: 'release-session',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'release',
      sessionId: first.sessionId,
      sessionRevision: first.sessionRevision,
    });
    expect(released).toMatchObject({
      type: 'session-released',
      releasedBufferCount: 1,
    });
    expect(subject.getResourceStats()).toEqual({
      state: 'released',
      eventCount: 0,
      evidenceCount: 0,
      screenshotCount: 0,
      activeQueryCount: 0,
    });
    const stale = await subject.dispatch({
      type: 'query-viewport',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'stale',
      sessionId: first.sessionId,
      sessionRevision: first.sessionRevision,
      range: { startUs: 0, endUs: 1 },
      limit: 10,
    });
    expect(stale).toMatchObject({
      type: 'structured-error',
      error: { code: 'session-released' },
    });
  });

  it('cancels only the target query and keeps the session ready', async () => {
    let resume: (() => void) | undefined;
    let blockQuery = false;
    const subject = await kernel({
      queryYieldInterval: 1,
      yieldControl: () => blockQuery
        ? new Promise(resolve => {
            resume = resolve;
          })
        : Promise.resolve(),
    });
    const created = await createSession(subject);
    blockQuery = true;
    const pending = subject.dispatch({
      type: 'query-viewport',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'slow-query',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      range: { startUs: -100, endUs: 30 },
      limit: 10,
    });
    await Promise.resolve();
    const control = await subject.dispatch({
      type: 'cancel-query',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'cancel',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      targetRequestId: 'slow-query',
    });
    expect(control.type).toBe('query-cancelled');
    resume?.();
    expect(await pending).toMatchObject({
      type: 'structured-error',
      error: { code: 'query-cancelled' },
    });
    expect(subject.getResourceStats().state).toBe('degraded');
  });

  it('times out only the target query and preserves session resources', async () => {
    let now = 0;
    const subject = await kernel({
      queryYieldInterval: 1,
      queryTimeoutMs: 1,
      now: () => ++now,
    });
    const created = await createSession(subject);
    const response = await subject.dispatch({
      type: 'query-viewport',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'timeout',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      range: { startUs: -100, endUs: 30 },
      limit: 10,
    });

    expect(response).toMatchObject({
      type: 'structured-error',
      error: { code: 'query-timeout', recoverable: true },
    });
    expect(subject.getResourceStats()).toMatchObject({
      state: 'degraded',
      eventCount: 2,
      activeQueryCount: 0,
    });
  });

  it('releases indexes and evidence when the Worker fails', async () => {
    const subject = await kernel();
    await createSession(subject);
    subject.fail();

    expect(subject.getResourceStats()).toEqual({
      state: 'failed',
      eventCount: 0,
      evidenceCount: 0,
      screenshotCount: 0,
      activeQueryCount: 0,
    });
  });
});
