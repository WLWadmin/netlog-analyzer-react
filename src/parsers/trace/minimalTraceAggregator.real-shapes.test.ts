import { MinimalTraceAggregator } from './minimalTraceAggregator';
import type { ChromiumTraceEvent, ChromiumTraceFile } from './types';

const intake = {
  encoding: 'plain-json' as const,
  jsonBytes: 1,
  skippedEventCount: 0,
  warnings: [],
};

function trace(events: unknown[]): ChromiumTraceFile {
  return { traceEvents: events as ChromiumTraceEvent[] };
}

async function aggregate(events: unknown[], options = {}) {
  return new MinimalTraceAggregator(intake, options).aggregate(trace(events), {
    isCancelled: () => false,
    onProgress: () => undefined,
  });
}

const context = [
  { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
  {
    name: 'TracingStartedInBrowser',
    ts: 0,
    args: {
      data: {
        frames: [{ frame: 'root', processId: 1, isOutermostMainFrame: true }],
      },
    },
  },
  {
    name: 'navigationStart',
    ts: 1,
    args: { data: { frame: 'root', navigationId: 'navigation-private' } },
  },
];

describe('MinimalTraceAggregator real Chromium event shapes', () => {
  it('pairs EventTiming async events whose end event has no args.data', async () => {
    const result = await aggregate([
      ...context,
      {
        name: 'EventTiming',
        ph: 'b',
        id: '0x1',
        scope: 'blink.user_timing',
        pid: 1,
        tid: 10,
        ts: 10_000,
        args: {
          data: {
            interactionId: 7,
            timeStamp: 5,
            processingStart: 8,
            processingEnd: 12,
            duration: 20,
          },
        },
      },
      {
        name: 'EventTiming',
        ph: 'e',
        id: '0x1',
        scope: 'blink.user_timing',
        pid: 1,
        tid: 10,
        ts: 30_000,
        args: {},
      },
      { name: 'capture-end', ts: 40_000 },
    ]);

    expect(result.facts.context.interactions).toEqual([
      expect.objectContaining({
        interactionId: 7,
        startUs: 10_000,
        inputDelayMs: 3,
        processingDurationMs: 4,
        presentationDelayMs: 13,
        totalLatencyMs: 20,
      }),
    ]);
  });

  it('derives frame intervals from instant DrawFrame events and retains dropped frames', async () => {
    const result = await aggregate([
      ...context,
      { name: 'DrawFrame', ph: 'I', pid: 1, tid: 10, ts: 10_000, args: { frameSeqId: 1 } },
      {
        name: 'Layout',
        ph: 'X',
        pid: 1,
        tid: 10,
        ts: 15_000,
        dur: 1_000,
        args: { beginData: { stackTrace: [{}] } },
      },
      { name: 'DroppedFrame', ph: 'I', pid: 1, tid: 10, ts: 20_000, args: { frameSeqId: 2 } },
      { name: 'DrawFrame', ph: 'I', pid: 1, tid: 10, ts: 30_000, args: { frameSeqId: 3 } },
      { name: 'capture-end', ts: 40_000 },
    ]);

    expect(result.facts.context.animationFrames).toHaveLength(3);
    expect(result.facts.context.animationFrames?.[0]).toEqual(expect.objectContaining({
      durationMs: 20,
      overBudget: true,
    }));
    expect(result.facts.context.animationFrameSummary).toEqual(expect.objectContaining({
      completeness: 'partial',
      totalCount: 3,
      droppedCount: 1,
      overBudgetCount: 1,
    }));
    expect(result.facts.context.forcedReflowClues).toEqual([
      expect.objectContaining({ confidence: 'observation', startUs: 15_000 }),
    ]);
  });

  it('merges ProfileChunk events emitted on a profiler thread', async () => {
    const result = await aggregate([
      ...context,
      {
        name: 'Profile',
        ph: 'P',
        id: 'private-profile',
        pid: 1,
        tid: 10,
        ts: 100,
        args: { data: { source: 'cpu-profile', startTime: 100 } },
      },
      {
        name: 'ProfileChunk',
        ph: 'P',
        id: 'private-profile',
        pid: 1,
        tid: 99,
        ts: 110,
        args: {
          data: {
            source: 'cpu-profile',
            cpuProfile: {
              nodes: [{
                id: 1,
                callFrame: {
                  functionName: 'work',
                  url: 'https://example.test/app.js?token=secret',
                },
              }],
              samples: [1],
            },
            timeDeltas: [10],
          },
        },
      },
      { name: 'capture-end', ts: 1_000 },
    ]);

    expect(result.facts.context.profiles?.[0]).toEqual(expect.objectContaining({
      sampleCount: 1,
      nodeCount: 1,
    }));
    expect(result.facts.context.cpuHotspots?.[0]).toEqual(expect.objectContaining({
      functionName: 'work',
      script: { origin: 'https://example.test', pathname: '/app.js' },
    }));
    expect(JSON.stringify(result.facts.context)).not.toContain('token=secret');
  });

  it('keeps long tasks after the shared complete-event cache reaches its limit', async () => {
    const result = await aggregate([
      ...context,
      { name: 'EvaluateScript', ph: 'X', pid: 1, tid: 10, ts: 10, dur: 1 },
      { name: 'FunctionCall', ph: 'X', pid: 1, tid: 10, ts: 20, dur: 1 },
      { name: 'RunTask', ph: 'X', pid: 1, tid: 10, ts: 1_000, dur: 80_000 },
      { name: 'capture-end', ts: 100_000 },
    ], { maxCandidatesPerKind: 2 });

    expect(result.facts.context.tasks).toEqual([
      expect.objectContaining({
        durationMs: 80,
        selfTimeConfidence: 'approximate',
        limitations: expect.arrayContaining(['complete-event-candidate-limit']),
      }),
    ]);
  });

  it('uses real ResourceTiming phases without exposing unsafe URL schemes', async () => {
    const result = await aggregate([
      ...context,
      {
        name: 'ResourceSendRequest',
        ph: 'I',
        pid: 1,
        tid: 10,
        ts: 1_000,
        args: {
          data: {
            frame: 'root',
            requestId: 'private-request',
            url: 'data:text/html,private-payload',
          },
        },
      },
      {
        name: 'ResourceReceiveResponse',
        ph: 'I',
        pid: 1,
        tid: 10,
        ts: 2_000,
        args: {
          data: {
            requestId: 'private-request',
            statusCode: 200,
            timing: {
              requestTime: 100,
              sendStart: 2,
              receiveHeadersEnd: 17,
            },
          },
        },
      },
      {
        name: 'ResourceFinish',
        ph: 'I',
        pid: 1,
        tid: 10,
        ts: 3_000,
        args: { data: { requestId: 'private-request', didFail: false } },
      },
      { name: 'capture-end', ts: 4_000 },
    ]);

    expect(result.facts.context.requests?.[0]).toEqual(expect.objectContaining({
      timing: expect.objectContaining({
        network: expect.objectContaining({
          durationMs: 15,
          domain: 'resource-timing-relative-ms',
        }),
      }),
    }));
    expect(result.facts.context.requests?.[0].url).toBeUndefined();
    expect(JSON.stringify(result.facts.context)).not.toContain('private-payload');
  });

  it('keeps only outermost milestones and the latest LCP candidate', async () => {
    const result = await aggregate([
      ...context,
      {
        name: 'MarkDOMContent',
        ph: 'I',
        pid: 1,
        tid: 10,
        ts: 10_000,
        args: { data: { frame: 'child', isOutermostMainFrame: false } },
      },
      {
        name: 'MarkDOMContent',
        ph: 'I',
        pid: 1,
        tid: 10,
        ts: 20_000,
        args: { data: { frame: 'root', isOutermostMainFrame: true } },
      },
      {
        name: 'largestContentfulPaint::Candidate',
        ph: 'R',
        pid: 1,
        tid: 10,
        ts: 30_000,
        args: { data: { navigationId: 'navigation-private', candidateIndex: 1 } },
      },
      {
        name: 'largestContentfulPaint::Candidate',
        ph: 'R',
        pid: 1,
        tid: 10,
        ts: 40_000,
        args: { data: { navigationId: 'navigation-private', candidateIndex: 2 } },
      },
      { name: 'capture-end', ts: 50_000 },
    ]);

    expect(result.facts.context.milestones?.filter(item => item.name === 'DCL')).toHaveLength(1);
    expect(result.facts.context.milestones?.filter(item => item.name === 'LCP')).toEqual([
      expect.objectContaining({ timestampUs: 40_000, candidate: true }),
    ]);
  });

  it('materializes bounded evidence referenced after the internal scan cache fills', async () => {
    const filler = Array.from({ length: 10_010 }, (_, index) => ({
      name: 'RunTask',
      ph: 'I',
      pid: 1,
      tid: 10,
      ts: 100 + index,
    }));
    const result = await aggregate([
      ...context,
      ...filler,
      {
        name: 'ResourceSendRequest',
        ph: 'I',
        pid: 1,
        tid: 10,
        ts: 20_000,
        args: {
          data: {
            frame: 'root',
            requestId: 'late-request',
            url: 'https://example.test/late',
          },
        },
      },
      { name: 'capture-end', ts: 30_000 },
    ], { maxEvidence: 20 });

    const requestEvidenceId = result.facts.context.requests?.[0].evidenceIds[0];
    expect(requestEvidenceId).toBeDefined();
    expect(result.facts.context.evidence.map(item => item.evidenceId)).toContain(
      requestEvidenceId,
    );
  });
});
