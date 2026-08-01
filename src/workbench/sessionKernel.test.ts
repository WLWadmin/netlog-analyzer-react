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

async function kernel(options: ConstructorParameters<typeof WorkbenchSessionKernel>[2] = {}) {
  const adapter = new MinimalTraceEngineAdapter(
    { traceEvents: trace.traceEvents.map(event => ({ ...event })) },
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
      eventCount: 3,
      screenshotCount: 1,
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
      eventCount: 3,
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
