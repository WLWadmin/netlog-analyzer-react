import type { ChromiumTraceFile } from '../parsers/trace/types';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextDecoder as NodeTextDecoder } from 'util';
import { WORKBENCH_SCHEMA_VERSION } from './protocol';
import { WorkbenchSessionKernel } from './sessionKernel';
import { isWorkbenchResponse } from './spike/protocolGuards';
import { MinimalTraceEngineAdapter } from './traceEngineAdapter';

beforeAll(() => {
  Object.defineProperty(global, 'ReadableStream', {
    configurable: true,
    value: NodeReadableStream,
  });
  Object.defineProperty(global, 'TextDecoder', {
    configurable: true,
    value: NodeTextDecoder,
  });
});

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
      'rendering',
    ],
  });
  expect(response.type).toBe('session-created');
  if (response.type !== 'session-created') throw new Error('session unavailable');
  return response;
}

function enableStage5() {
  process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
  process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
  process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
  process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE = '1';
  process.env.REACT_APP_ENABLE_TRACE_STAGE5 = '1';
}

function enableStage6() {
  enableStage5();
  process.env.REACT_APP_ENABLE_TRACE_STAGE6 = '1';
}

async function addBaseline(
  subject: WorkbenchSessionKernel,
  session: { sessionId: string; sessionRevision: number },
  input: ChromiumTraceFile,
) {
  return subject.dispatchSourceFile({
    type: 'add-comparison-baseline',
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    requestId: `baseline-${session.sessionRevision}`,
    sessionId: session.sessionId,
    sessionRevision: session.sessionRevision,
    sourceToken: `baseline-token-${session.sessionRevision}`,
  }, new File(
    [JSON.stringify(input)],
    '/private/example-sensitive-name.trace',
    { type: 'application/json' },
  ));
}

describe('WorkbenchSessionKernel', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
    delete process.env.REACT_APP_ENABLE_TRACE_TIMELINE;
    delete process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS;
    delete process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE;
    delete process.env.REACT_APP_ENABLE_TRACE_STAGE5;
    delete process.env.REACT_APP_ENABLE_TRACE_STAGE6;
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
    expect(isWorkbenchResponse(viewport)).toBe(true);
    const sampledViewport = await subject.dispatch({
      type: 'query-viewport',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'sampled-viewport',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      range: { startUs: 0, endUs: 12 },
      limit: 1,
      balanceByTrack: true,
    });
    expect(sampledViewport).toMatchObject({
      type: 'viewport-result',
      lod: { mode: 'sampled' },
      truncation: { truncated: true },
    });
    expect(isWorkbenchResponse(sampledViewport)).toBe(true);

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

  it('compares a local baseline with white-list summaries and removes it atomically', async () => {
    enableStage5();
    const subject = await kernel();
    const created = await createSession(subject);
    const added = await addBaseline(subject, created, trace);

    expect(added).toMatchObject({
      type: 'comparison-baseline-result',
      operation: 'added',
      baselineAvailable: true,
      sessionRevision: created.sessionRevision + 1,
      eventCount: 2,
    });
    expect(JSON.stringify(added)).not.toMatch(
      /example-sensitive-name|private|fingerprint|fileName|sourceToken/,
    );
    if (added.type !== 'comparison-baseline-result') return;
    const compared = await subject.dispatch({
      type: 'query-trace-comparison',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'compare',
      sessionId: added.sessionId,
      sessionRevision: added.sessionRevision,
      range: created.session.range,
      sameScenarioConfirmed: true,
    });
    expect(compared).toMatchObject({
      type: 'trace-comparison-result',
      status: 'comparable',
      regression: 'stable',
      metrics: expect.arrayContaining([
        expect.objectContaining({
          metric: 'matched-events',
          current: 2,
          baseline: 2,
          deltaPercent: 0,
        }),
      ]),
      evidenceIds: expect.arrayContaining([
        expect.stringMatching(/^current:/),
        expect.stringMatching(/^baseline:/),
      ]),
    });
    const removed = await subject.dispatch({
      type: 'remove-comparison-baseline',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'remove-baseline',
      sessionId: added.sessionId,
      sessionRevision: added.sessionRevision,
    });
    expect(removed).toMatchObject({
      type: 'comparison-baseline-result',
      operation: 'removed',
      baselineAvailable: false,
      sessionRevision: added.sessionRevision + 1,
    });
    if (removed.type !== 'comparison-baseline-result') return;
    await expect(subject.dispatch({
      type: 'query-trace-comparison',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'compare-after-remove',
      sessionId: removed.sessionId,
      sessionRevision: removed.sessionRevision,
      range: created.session.range,
      sameScenarioConfirmed: true,
    })).resolves.toMatchObject({
      type: 'structured-error',
      error: { code: 'unsupported-capability' },
    });
  });

  it('releases a baseline adapter when indexing fails before commit', async () => {
    enableStage5();
    const subject = await kernel();
    const created = await createSession(subject);
    const buildSessionData = jest.spyOn(
      MinimalTraceEngineAdapter.prototype,
      'buildSessionData',
    ).mockRejectedValueOnce(new Error('synthetic baseline indexing failure'));
    const release = jest.spyOn(MinimalTraceEngineAdapter.prototype, 'release');
    try {
      await expect(addBaseline(subject, created, trace)).resolves.toMatchObject({
        type: 'structured-error',
        error: { code: 'worker-failed', recoverable: true },
      });
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      buildSessionData.mockRestore();
      release.mockRestore();
    }
  });

  it('keeps comparison operations disabled without changing the session revision', async () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE = '1';
    const subject = await kernel();
    const created = await createSession(subject);

    await expect(subject.dispatch({
      type: 'remove-comparison-baseline',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'remove-disabled-baseline',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
    })).resolves.toMatchObject({
      type: 'structured-error',
      sessionRevision: created.sessionRevision,
      error: { code: 'unsupported-capability' },
    });
    await expect(subject.dispatch({
      type: 'query-trace-comparison',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'query-disabled-comparison',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      range: created.session.range,
      sameScenarioConfirmed: true,
    })).resolves.toMatchObject({
      type: 'structured-error',
      sessionRevision: created.sessionRevision,
      error: { code: 'unsupported-capability' },
    });
    await expect(subject.dispatch({
      type: 'query-viewport',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'viewport-after-disabled-comparison',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      range: created.session.range,
      limit: 10,
    })).resolves.toMatchObject({ type: 'viewport-result' });
  });

  it('requires same-scenario confirmation before permitting a comparison conclusion', async () => {
    enableStage5();
    const subject = await kernel();
    const created = await createSession(subject);
    const added = await addBaseline(subject, created, trace);
    if (added.type !== 'comparison-baseline-result') {
      throw new Error('baseline unavailable');
    }

    const compared = await subject.dispatch({
      type: 'query-trace-comparison',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'compare-without-scenario-confirmation',
      sessionId: added.sessionId,
      sessionRevision: added.sessionRevision,
      range: created.session.range,
      sameScenarioConfirmed: false,
    });

    expect(compared).toMatchObject({
      type: 'trace-comparison-result',
      status: 'sample-incomparable',
      regression: 'unavailable',
      limitations: expect.arrayContaining([
        expect.stringContaining('尚未确认基线与当前 Trace 属于同一场景'),
      ]),
    });
  });

  it.each([
    {
      name: '校时不足',
      status: 'alignment-insufficient',
      baseline: trace,
      range: { startUs: 0, endUs: 1_000_000 },
    },
    {
      name: '能力不对等',
      status: 'capability-mismatch',
      baseline: {
        traceEvents: trace.traceEvents.filter(event => event.name !== 'Layout'),
      },
      range: undefined,
    },
    {
      name: '样本不可比',
      status: 'sample-incomparable',
      baseline: {
        traceEvents: Array.from({ length: 6 }, (_, index) => (
          trace.traceEvents
            .filter(event => event.name !== 'Screenshot')
            .map(event => ({
              ...event,
              ts: (typeof event.ts === 'number' ? event.ts : 0) + index * 20,
            }))
        )).flat(),
      },
      range: undefined,
    },
  ])('blocks regression conclusions when comparison is $name', async ({
    status,
    baseline,
    range,
  }) => {
    enableStage5();
    const subject = await kernel();
    const created = await createSession(subject);
    const added = await addBaseline(subject, created, baseline);
    if (added.type !== 'comparison-baseline-result') {
      throw new Error('baseline unavailable');
    }
    const compared = await subject.dispatch({
      type: 'query-trace-comparison',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: `compare-${status}`,
      sessionId: added.sessionId,
      sessionRevision: added.sessionRevision,
      range: range ?? created.session.range,
      sameScenarioConfirmed: true,
    });

    expect(compared).toMatchObject({
      type: 'trace-comparison-result',
      status,
      regression: 'unavailable',
    });
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

  it('returns explicit unavailable Stage 6 DTOs without exposing raw events', async () => {
    const subject = await kernel();
    const created = await createSession(subject);
    const capabilities = [
      'layout-shifts',
      'animation-composition',
      'memory-trend',
      'gpu-raster',
      'custom-query',
      'track-plugin',
    ] as const;

    const blocked = await subject.dispatch({
      type: 'query-advanced-analysis',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'advanced-disabled',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      capability: 'layout-shifts',
      range: { startUs: -100, endUs: 30 },
    });
    expect(blocked).toMatchObject({
      type: 'structured-error',
      error: { code: 'unsupported-capability' },
    });

    enableStage6();
    const enabledSubject = await kernel();
    const enabledSession = await createSession(enabledSubject);
    for (const capability of capabilities) {
      const response = await enabledSubject.dispatch({
        type: 'query-advanced-analysis',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: `advanced-${capability}`,
        sessionId: enabledSession.sessionId,
        sessionRevision: enabledSession.sessionRevision,
        capability,
        range: { startUs: -100, endUs: 30 },
      });

      expect(response).toMatchObject({
        type: 'advanced-analysis-result',
        capability,
        status: 'unavailable',
        evidenceIds: [],
        result: { kind: capability },
      });
      expect(isWorkbenchResponse(response)).toBe(true);
      expect(JSON.stringify(response)).not.toMatch(
        /"args"|"headers"|"snapshot"|"rawTrace"|"url"/i,
      );
    }
  });

  it('projects explicit LayoutShift evidence into a cluster and registered track', async () => {
    enableStage6();
    const subject = await kernel({}, {
      traceEvents: [{
        name: 'LayoutShift',
        cat: 'loading',
        ph: 'I',
        ts: 100,
        pid: 1,
        tid: 10,
        args: {
          data: {
            weighted_score_delta: 0.125,
            had_recent_input: false,
          },
        },
      }],
    });
    const created = await createSession(subject);

    expect(created.session.trackEventCounts).toEqual({ 'layout-shifts': 1 });
    expect(created.session.capabilities).toContain('rendering');
    const response = await subject.dispatch({
      type: 'query-advanced-analysis',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'layout-shifts',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      capability: 'layout-shifts',
      range: { startUs: 0, endUs: 1_000 },
    });
    expect(response).toMatchObject({
      type: 'advanced-analysis-result',
      status: 'available',
      result: {
        kind: 'layout-shifts',
        clusters: [{
          cumulativeScore: 0.125,
          memberEventIds: ['trace:timeline:0'],
          evidenceIds: ['trace:event:0'],
        }],
      },
    });
  });

  it('projects explicit compositor state without promoting overlap to attribution', async () => {
    enableStage6();
    const subject = await kernel({}, {
      traceEvents: [
        {
          name: 'CompositorAnimation',
          cat: 'cc,animation',
          ph: 'X',
          ts: 100,
          dur: 100,
          pid: 1,
          tid: 10,
        },
        {
          name: 'DrawFrame',
          cat: 'cc',
          ph: 'X',
          ts: 120,
          dur: 10,
          pid: 1,
          tid: 11,
        },
      ],
    });
    const created = await createSession(subject);

    expect(created.session.trackEventCounts).toMatchObject({ animations: 1 });
    const response = await subject.dispatch({
      type: 'query-advanced-analysis',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'animations',
      sessionId: created.sessionId,
      sessionRevision: created.sessionRevision,
      capability: 'animation-composition',
      range: { startUs: 0, endUs: 1_000 },
    });
    expect(response).toMatchObject({
      type: 'advanced-analysis-result',
      status: 'available',
      result: {
        kind: 'animation-composition',
        animations: [{
          state: 'composited',
          frameEventIds: ['trace:timeline:1'],
          evidenceIds: ['trace:event:0'],
        }],
      },
    });
    expect(JSON.stringify(response)).toMatch(/不证明动画导致/);
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
