import { MinimalTraceAggregator } from './minimalTraceAggregator';
import type { ChromiumTraceEvent, ChromiumTraceFile } from './types';

const intake = {
  encoding: 'plain-json' as const,
  jsonBytes: 1024,
  skippedEventCount: 0,
  warnings: [],
};

function trace(events: unknown[]): ChromiumTraceFile {
  return { traceEvents: events as ChromiumTraceEvent[] };
}

async function aggregate(events: unknown[]) {
  return new MinimalTraceAggregator(intake).aggregate(trace(events), {
    isCancelled: () => false,
    onProgress: () => undefined,
  });
}

const context = [
  { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
  { ph: 'M', name: 'thread_name', pid: 1, tid: 11, args: { name: 'WorkerThread' } },
  { name: 'TracingStartedInBrowser', ts: 0, args: { data: { frames: [
    { frame: 'root', processId: 1, isOutermostMainFrame: true },
  ] } } },
  { name: 'navigationStart', ts: 100, args: { data: { frame: 'root', navigationId: 'nav-1' } } },
];

describe('MinimalTraceAggregator collector gap matrix', () => {
  it('keeps complete request chains, timestamped keys and dispatch limitations', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 1_000, args: { data: {
        requestId: 'parent', url: 'https://example.test/document', navigationId: 'nav-1',
      } } },
      { name: 'ResourceFinish', ts: 2_000, args: { data: { requestId: 'parent', didFail: false } } },
      { name: 'ResourceSendRequest', ts: 3_000, args: { data: {
        requestId: 'req', url: 'https://example.test/a', navigationId: 'nav-1',
        initiatorRequestId: 'parent',
      } } },
      { name: 'ResourceReceivedData', ts: 3_500, args: { data: { requestId: 'req', encodedDataLength: 12 } } },
      { name: 'ResourceReceiveResponse', ts: 4_000, args: { data: { requestId: 'req', statusCode: 302 } } },
      { name: 'ResourceSendRequest', ts: 5_000, args: { data: {
        requestId: 'req', url: 'https://example.test/b', navigationId: 'nav-1',
        initiatorRequestId: 'parent',
      } } },
      { name: 'ResourceFail', ts: 6_000, args: { data: { requestId: 'req', cancelled: true } } },
      { name: 'ResourceSendRequest', ts: 7_000, args: { data: {
        requestId: 'dispatch', url: 'https://example.test/api', navigationId: 'nav-1',
        calibratedNetworkResponseMs: 10, rendererResponseEventMs: 30,
        networkTimeDomain: 'renderer-1', rendererTimeDomain: 'renderer-1', traceTimeDomain: 'renderer-1',
      } } },
      { name: 'RunTask', ph: 'X', ts: 15_000, dur: 10_000, pid: 1, tid: 10 },
      { name: 'ResourceFinish', ts: 31_000, args: { data: { requestId: 'dispatch', didFail: false } } },
      { name: 'ResourceSendRequest', ts: 32_000, args: { data: {
        requestId: 'uncalibrated', url: 'https://example.test/api2', navigationId: 'nav-1',
        calibratedNetworkResponseMs: 32, rendererResponseEventMs: 40,
      } } },
      { name: 'capture-end', ts: 100_000 },
    ]);
    const requests = result.facts.context.requests!;
    const redirects = requests.filter(item => item.redirectIndex > 0 || item.url?.pathname === '/a');

    expect(redirects).toHaveLength(2);
    expect(redirects.every(item => !item.id.includes(':req:'))).toBe(true);
    expect(redirects[0].redirectNextRequestId).toBe(redirects[1].id);
    expect(redirects[1].redirectPreviousRequestId).toBe(redirects[0].id);
    expect(redirects[0]).toEqual(expect.objectContaining({
      initiatorRequestId: expect.stringMatching(/:request:4:0:1000:event:4$/),
      dataEventCount: 1,
      encodedDataLength: 12,
    }));
    expect(redirects[1].result).toBe('cancelled');
    expect(redirects[1].evidenceIds.length).toBeGreaterThanOrEqual(2);
    expect(requests.find(item => item.url?.pathname === '/api')?.dispatch).toEqual({
      dispatchWaitMs: 20,
      mainThreadOverlapMs: 10,
    });
    expect(requests.find(item => item.url?.pathname === '/api2')?.limitations)
      .toContain('dispatch-time-domain-unavailable');
  });

  it('restricts tasks to navigation renderer main spans and marks incomplete phases approximate', async () => {
    const result = await aggregate([
      ...context,
      { name: 'RunTask', ph: 'X', ts: 1_000, dur: 60_000, pid: 1, tid: 11 },
      { name: 'RunTask', ph: 'X', ts: 70_000, dur: 60_000, pid: 1, tid: 10 },
      { name: 'EvaluateScript', ph: 'B', ts: 80_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 150_000 },
    ]);

    expect(result.facts.context.tasks).toHaveLength(1);
    expect(result.facts.context.tasks![0]).toEqual(expect.objectContaining({
      threadId: 10,
      selfTimeConfidence: 'approximate',
    }));
    expect(result.facts.context.tasks![0].limitations).toContain('incomplete-phase-pairing');
  });

  it('attributes profile samples, frame budget, forced clues and paired interactions', async () => {
    const result = await aggregate([
      ...context,
      { name: 'RunTask', ph: 'X', ts: 10_000, dur: 60_000, pid: 1, tid: 10 },
      { name: 'Profile', ts: 10_000, pid: 1, tid: 10, id: 'p', args: { data: { startTime: 10_000 } } },
      { name: 'ProfileChunk', ts: 11_000, pid: 1, tid: 10, id: 'p', args: { data: {
        cpuProfile: {
          nodes: [{ id: 7, callFrame: { functionName: 'work', url: 'https://example.test/app.js?secret=x', lineNumber: 4, columnNumber: 2 } }],
          samples: [7, 7],
        },
        timeDeltas: [10_000, 10_000],
      } } },
      { name: 'Layout', ph: 'X', ts: 20_000, dur: 10_000, pid: 1, tid: 10, args: { data: { invalidationTracking: [{}] } } },
      { name: 'ForcedReflow', ph: 'X', ts: 25_000, dur: 1_000, pid: 1, tid: 10 },
      { name: 'DrawFrame', ph: 'X', ts: 70_000, dur: 20_000, pid: 1, tid: 10 },
      { name: 'EventTiming', ph: 'b', ts: 1_000, pid: 1, tid: 10, args: { data: {
        interactionId: 42, eventStart: 1_000, processingStart: 2_000,
      } } },
      { name: 'EventTiming', ph: 'e', ts: 90_000, pid: 1, tid: 10, args: { data: {
        interactionId: 42, processingEnd: 60_000, interactionEnd: 90_000,
      } } },
      { name: 'capture-end', ts: 100_000 },
    ]);
    const facts = result.facts.context;

    expect(facts.cpuHotspots![0]).toEqual(expect.objectContaining({
      functionName: 'work',
      script: { origin: 'https://example.test', pathname: '/app.js' },
      sampleCount: 2,
      navigationKey: 'trace:navigation:event:3',
      taskIds: [expect.stringMatching(/^trace:task:1:10:10000:event:\d+$/)],
    }));
    expect(facts.animationFrames![0]).toEqual(expect.objectContaining({
      budgetMs: 16.7,
      overBudget: true,
    }));
    expect(facts.forcedReflowClues![0]).toEqual(expect.objectContaining({
      confidence: 'explicit',
      taskId: expect.stringMatching(/^trace:task:1:10:10000:event:\d+$/),
    }));
    expect(facts.interactions![0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^trace:interaction:42:1:1000:event:\d+$/),
      taskIds: [expect.stringMatching(/^trace:task:1:10:10000:event:\d+$/)],
      renderingEventIds: expect.arrayContaining([expect.stringContaining(':Layout')]),
      frameIds: [expect.stringMatching(/^trace:frame:1:10:70000:event:\d+$/)],
    }));
    expect(facts.interactions![0].evidenceIds).toHaveLength(2);
    expect(JSON.stringify(facts.cpuHotspots)).not.toContain('secret=x');
  });

  it('accepts complete single EventTiming events and does not guess other phases', async () => {
    const result = await aggregate([
      ...context,
      { name: 'EventTiming', ph: 'X', ts: 1_000, pid: 1, tid: 10, args: { data: {
        interactionId: 1, eventStart: 1_000, processingStart: 2_000,
        processingEnd: 3_000, interactionEnd: 4_000,
      } } },
      { name: 'EventTiming', ph: 'B', ts: 5_000, args: { data: {
        interactionId: 2, eventStart: 5_000, processingStart: 6_000,
      } } },
      { name: 'capture-end', ts: 10_000 },
    ]);

    expect(result.facts.context.interactions).toHaveLength(1);
    expect(result.warnings).toContain('TRACE_BATCH3_EVENT_SHAPE_UNSUPPORTED');
  });
});
