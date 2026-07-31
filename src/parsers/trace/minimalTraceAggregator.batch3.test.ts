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

async function aggregate(events: unknown[], maxFactsPerKind = 100) {
  return new MinimalTraceAggregator(intake, { maxFactsPerKind }).aggregate(trace(events), {
    isCancelled: () => false,
    onProgress: () => undefined,
  });
}

const contextEvents = [
  { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
  { name: 'TracingStartedInBrowser', ts: 0, args: { data: { frames: [
    { frame: 'root', processId: 1, isOutermostMainFrame: true },
  ] } } },
  { name: 'navigationStart', ts: 100, args: { data: { frame: 'root', navigationId: 'nav-1' } } },
];

describe('MinimalTraceAggregator Batch 3 collectors', () => {
  it('collects standard-path request, task, profile, milestone, frame, rendering and interaction facts', async () => {
    const result = await aggregate([
      ...contextEvents,
      { name: 'ResourceSendRequest', ts: 110, pid: 1, tid: 10, args: { data: {
        requestId: 'req-1', url: 'https://example.test/app.js?token=secret',
        requestMethod: 'GET', resourceType: 'Script', navigationId: 'nav-1',
      } } },
      { name: 'ResourceReceiveResponse', ts: 130, args: { data: {
        requestId: 'req-1', statusCode: 404, protocol: 'h2', fromCache: false,
      } } },
      { name: 'ResourceFinish', ts: 140, args: { data: { requestId: 'req-1', didFail: true } } },
      { name: 'RunTask', ph: 'X', ts: 150, dur: 60_000, pid: 1, tid: 10 },
      { name: 'EvaluateScript', ph: 'X', ts: 160, dur: 20_000, pid: 1, tid: 10 },
      { name: 'Profile', ts: 220, pid: 1, tid: 10, id: 'profile-1', args: { data: { startTime: 220 } } },
      { name: 'ProfileChunk', ts: 230, pid: 1, tid: 10, id: 'profile-1', args: { data: {
        cpuProfile: {
          nodes: [{ id: 7, callFrame: { functionName: 'work', url: 'https://example.test/a.js?key=secret' } }],
          samples: [7, 7],
        },
        timeDeltas: [10, 20],
      } } },
      { name: 'firstContentfulPaint', ts: 250, pid: 1, tid: 10, args: { data: { frame: 'root' } } },
      { name: 'DrawFrame', ph: 'X', ts: 70_000, dur: 20_000, pid: 1, tid: 10, args: { data: { frame: 'root', dropped: true } } },
      { name: 'Layout', ph: 'X', ts: 90_000, dur: 5_000, pid: 1, tid: 10, args: { data: { frame: 'root' } } },
      { name: 'EventTiming', ts: 100_000, pid: 1, tid: 10, args: { data: {
        interactionId: 42, eventStart: 100_000, processingStart: 100_010,
        processingEnd: 100_030, interactionEnd: 100_060,
      } } },
      { name: 'capture-end', ts: 120_000 },
    ]);
    const facts = result.facts.context;

    expect(facts.requests![0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^trace:request:trace:navigation:event:2:request:/),
      navigationKey: 'trace:navigation:event:2',
      url: { origin: 'https://example.test', pathname: '/app.js' },
      statusCode: 404,
      result: 'http-error',
      resultConfidence: 'high',
    }));
    expect(facts.tasks![0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^trace:task:1:10:150:event:\d+$/), durationMs: 60, selfTimeMs: 40,
      blockingContributionMs: 10,
    }));
    expect(facts.evidence.map(item => item.evidenceId)).toEqual(
      expect.arrayContaining(facts.tasks![0].evidenceIds),
    );
    expect(facts.profiles![0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^trace:profile:1:10:profile:/), nodeCount: 1, sampleCount: 2,
    }));
    expect(facts.milestones![0]).toEqual(expect.objectContaining({
      navigationKey: 'trace:navigation:event:2', name: 'FCP', relativeUs: 150,
    }));
    expect(facts.animationFrames![0]).toEqual(expect.objectContaining({ durationMs: 20, dropped: true }));
    expect(facts.rendering![0]).toEqual(expect.objectContaining({ name: 'Layout', durationMs: 5 }));
    expect(facts.interactions![0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^trace:interaction:42:1:100000:event:\d+$/), inputDelayMs: 0.01,
      processingDurationMs: 0.02, presentationDelayMs: 0.03, totalLatencyMs: 0.06,
    }));
    const factLists = [
      facts.requests, facts.tasks, facts.profiles, facts.milestones,
      facts.animationFrames, facts.rendering, facts.interactions,
      facts.cpuHotspots, facts.forcedReflowClues,
    ];
    const factIds = factLists.flatMap(list => list?.map(item => item.id) ?? []);
    expect(factIds.every(id => /:event:\d+/.test(id))).toBe(true);
    expect(JSON.stringify(result.facts)).not.toMatch(/token=secret|key=secret|callFrame|headers|args/);
  });

  it('bounds every fact kind and keeps IDs deterministic', async () => {
    const events = [
      ...contextEvents,
      ...[0, 1, 2].flatMap(index => [
        { name: 'RunTask', ph: 'X', ts: 200 + index * 100_000, dur: 60_000, pid: 1, tid: 10 },
        { name: 'Layout', ph: 'X', ts: 210 + index * 100_000, dur: 1_000, pid: 1, tid: 10 },
      ]),
      { name: 'capture-end', ts: 400_000 },
    ];
    const first = await aggregate(events, 2);
    const second = await aggregate(events, 2);

    expect(first).toEqual(second);
    expect(first.facts.context.tasks!).toHaveLength(2);
    expect(first.facts.context.rendering!).toHaveLength(2);
    expect(first.facts.context.factCounts!.tasks).toEqual({ total: 3, returned: 2, truncated: true });
    expect(first.facts.context.factCounts!.rendering).toEqual({ total: 3, returned: 2, truncated: true });
    expect(first.warnings).toContain('TRACE_FACTS_TRUNCATED');
  });

  it('skips non-standard nested variants and incomplete profile tails with fixed warnings', async () => {
    const result = await aggregate([
      ...contextEvents,
      { name: 'ResourceSendRequest', ts: 110, args: { data: { nested: { requestId: 'private-request' } } } },
      { name: 'EventTiming', ts: 120, args: { data: { nested: {
        interactionId: 9, eventStart: 120, processingStart: 130, processingEnd: 140, interactionEnd: 150,
      } } } },
      { name: 'Profile', ts: 130, pid: 1, tid: 10, id: 'p', args: { data: { startTime: 130 } } },
      { name: 'ProfileChunk', ts: 140, pid: 1, tid: 10, id: 'p', args: { data: {
        cpuProfile: { nodes: [{ id: 1 }], samples: [1, 1] }, timeDeltas: [10],
      } } },
      { name: 'capture-end', ts: 200 },
    ]);

    expect(result.facts.context.requests!).toEqual([]);
    expect(result.facts.context.interactions!).toEqual([]);
    expect(result.facts.context.profiles![0].sampleCount).toBe(1);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'TRACE_BATCH3_EVENT_SHAPE_UNSUPPORTED',
      'TRACE_PROFILE_CHUNK_TAIL_INCOMPLETE',
    ]));
  });
});
