import { MinimalTraceAggregator } from './minimalTraceAggregator';
import { Batch3FactCollector } from './traceFactCollectors';
import type { ChromiumTraceEvent, ChromiumTraceFile } from './types';

const intake = { encoding: 'plain-json' as const, jsonBytes: 1, skippedEventCount: 0, warnings: [] };
const trace = (events: unknown[]): ChromiumTraceFile => ({ traceEvents: events as ChromiumTraceEvent[] });
const context = [
  { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
  { name: 'TracingStartedInBrowser', ts: 0, args: { data: { frames: [
    { frame: 'root', processId: 1, isOutermostMainFrame: true },
  ] } } },
  { name: 'navigationStart', ts: 1, args: { data: { frame: 'root', navigationId: 'nav' } } },
];
async function aggregate(events: unknown[], options = {}) {
  return new MinimalTraceAggregator(intake, options).aggregate(trace(events), {
    isCancelled: () => false, onProgress: () => undefined,
  });
}

describe('MinimalTraceAggregator review regressions', () => {
  it('keeps true totals beyond the internal candidate cap and filters dangling links', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 10, args: { data: { requestId: 'secret-a', navigationId: 'nav', url: 'https://example.test/a' } } },
      { name: 'ResourceSendRequest', ts: 20, args: { data: { requestId: 'secret-a', navigationId: 'nav', url: 'https://example.test/b' } } },
      { name: 'ResourceSendRequest', ts: 30, args: { data: { requestId: 'secret-b', navigationId: 'nav', url: 'https://example.test/c' } } },
      { name: 'DrawFrame', ph: 'X', ts: 40, dur: 1_000, pid: 1, tid: 10 },
      { name: 'DrawFrame', ph: 'X', ts: 2_000, dur: 1_000, pid: 1, tid: 10 },
      { name: 'DrawFrame', ph: 'X', ts: 4_000, dur: 1_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 10_000 },
    ], { maxCandidatesPerKind: 2, maxFactsPerKind: 1 });

    expect(result.facts.context.factCounts!.requests.total).toBe(2);
    expect(result.facts.context.factCounts!.animationFrames.total).toBe(2);
    expect(result.facts.context.requests).toHaveLength(1);
    expect(result.facts.context.requests![0].redirectNextRequestId).toBeUndefined();
    expect(result.warnings).toContain('TRACE_FACT_CANDIDATES_TRUNCATED');
    expect(new Set(result.facts.context.requests!.map(item => item.requestId)).size).toBe(1);
    expect(JSON.stringify(result.facts.context)).not.toMatch(/secret-a|secret-b/);
  });

  it('does not pair interactions across process or navigation scopes', async () => {
    const result = await aggregate([
      ...context,
      { name: 'EventTiming', ph: 'b', ts: 10, pid: 1, tid: 10, args: { data: { interactionId: 7, eventStart: 10, processingStart: 20 } } },
      { name: 'EventTiming', ph: 'e', ts: 50, pid: 2, tid: 20, args: { data: { interactionId: 7, processingEnd: 40, interactionEnd: 50 } } },
      { name: 'capture-end', ts: 100 },
    ]);
    expect(result.facts.context.interactions).toEqual([]);
  });

  it('handles equal task intervals without parent cycles', async () => {
    const result = await aggregate([
      ...context,
      { name: 'RunTask', ph: 'X', ts: 1_000, dur: 100_000, pid: 1, tid: 10 },
      { name: 'EvaluateScript', ph: 'X', ts: 10_000, dur: 20_000, pid: 1, tid: 10 },
      { name: 'FunctionCall', ph: 'X', ts: 10_000, dur: 20_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 110_000 },
    ]);
    const task = result.facts.context.tasks![0];
    expect(task.selfTimeMs).toBe(80);
    expect(Object.values(task.categorySelfTimeMs).every(Number.isFinite)).toBe(true);
  });

  it('supports incremental profile chunks, rejects negative deltas and hides raw IDs', async () => {
    const result = await aggregate([
      ...context,
      { name: 'Profile', ts: 100, pid: 1, tid: 10, id: 'private-profile', args: { data: { startTime: 100 } } },
      { name: 'ProfileChunk', ts: 110, pid: 1, tid: 10, id: 'private-profile', args: { data: {
        cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: 'work' } }], samples: [1] }, timeDeltas: [10],
      } } },
      { name: 'ProfileChunk', ts: 120, pid: 1, tid: 10, id: 'private-profile', args: { data: {
        cpuProfile: { samples: [1] }, timeDeltas: [20],
      } } },
      { name: 'ProfileChunk', ts: 130, pid: 1, tid: 10, id: 'private-profile', args: { data: {
        cpuProfile: { samples: [1] }, timeDeltas: [-1],
      } } },
      { name: 'capture-end', ts: 1_000 },
    ]);
    expect(result.facts.context.profiles![0].sampleCount).toBe(2);
    expect(result.facts.context.profiles![0].profileId).toMatch(/^profile:/);
    expect(result.warnings).toContain('TRACE_PROFILE_NEGATIVE_TIME_DELTA');
    expect(JSON.stringify(result.facts.context)).not.toContain('private-profile');
  });

  it('uses same-frame navigation overlap and requires strong Layout evidence', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 100, args: { data: { requestId: 'r', navigationId: 'nav', url: 'https://example.test/a' } } },
      { name: 'Layout', ph: 'X', ts: 120, dur: 5, pid: 1, tid: 10 },
      { name: 'Layout', ph: 'X', ts: 130, dur: 5, pid: 1, tid: 10, args: { data: { invalidationTracking: [{}] } } },
      { name: 'navigationStart', ts: 150, args: { data: { frame: 'root', navigationId: 'next' } } },
      { name: 'ResourceFail', ts: 200, args: { data: { requestId: 'r' } } },
      { name: 'capture-end', ts: 300 },
    ]);
    expect(result.facts.context.requests![0].result).toBe('cancelled');
    expect(result.facts.context.forcedReflowClues).toHaveLength(1);
    expect(result.facts.context.forcedReflowClues![0].startUs).toBe(130);
  });

  it('requires trace, network and renderer domains to match for dispatch', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 1_000, args: { data: {
        requestId: 'r', navigationId: 'nav', url: 'https://example.test/a',
        calibratedNetworkResponseMs: 10, rendererResponseEventMs: 30,
        networkTimeDomain: 'clock', rendererTimeDomain: 'clock', traceTimeDomain: 'other',
      } } },
      { name: 'RunTask', ph: 'X', ts: 15_000, dur: 10_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 40_000 },
    ]);
    expect(result.facts.context.requests![0].dispatch).toBeUndefined();
    expect(result.facts.context.requests![0].limitations).toContain('dispatch-time-domain-unavailable');
  });

  it('checks cancellation during bounded collector finalization', () => {
    let cancelled = false;
    const collector = new Batch3FactCollector({
      checkCancelled: () => {
        if (cancelled) throw new Error('cancelled');
      },
    });
    for (let index = 0; index < 300; index += 1) {
      collector.collect({
        name: 'firstContentfulPaint', ts: index + 1,
        args: { data: { frame: 'root' } },
      }, index);
    }
    cancelled = true;
    expect(() => collector.finalize([{
      key: 'trace:navigation:nav', navigationId: 'nav', frameId: 'root',
      outermostFrameId: 'root', startUs: 0, endUs: 1_000,
      processSpans: [], evidenceIds: [], limitations: [],
    }], 1_000, 10)).toThrow('cancelled');
  });

  it('keeps distinct event-index public IDs for distinct requests', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 10, args: { data: { requestId: 'raw-one', navigationId: 'nav', url: 'https://example.test/one' } } },
      { name: 'ResourceSendRequest', ts: 20, args: { data: { requestId: 'raw-two', navigationId: 'nav', url: 'https://example.test/two' } } },
      { name: 'capture-end', ts: 100 },
    ]);
    const ids = result.facts.context.requests!.map(item => item.requestId);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(id => id.startsWith('request:'))).toBe(true);
    expect(JSON.stringify(result.facts.context)).not.toMatch(/raw-one|raw-two/);
  });


  it('uses original start event indexes for public refs and all fact IDs', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 10, args: { data: { requestId: 'private', navigationId: 'nav', url: 'https://example.test/a' } } },
      { name: 'Profile', ts: 20, pid: 1, tid: 10, id: 'private-profile', args: { data: { startTime: 20 } } },
      { name: 'ProfileChunk', ts: 30, pid: 1, tid: 10, id: 'private-profile', args: { data: {
        cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: 'work' } }], samples: [1] }, timeDeltas: [1],
      } } },
      { name: 'capture-end', ts: 100 },
    ]);
    expect(result.facts.context.requests![0].requestId).toBe('request:3');
    expect(result.facts.context.requests![0].id).toMatch(/:event:3$/);
    expect(result.facts.context.profiles![0].profileId).toBe('profile:4');
    expect(result.facts.context.profiles![0].id).toMatch(/:event:4$/);
    expect(result.facts.context.cpuHotspots![0].id).toMatch(/:event:4:node:1:sample:0$/);
  });

  it('keeps phase events and profile samples under one global cap', async () => {
    const collector = new Batch3FactCollector({ maxCandidatesPerKind: 2 });
    collector.collect({ name: 'Profile', ts: 1, pid: 1, tid: 1, id: 'p', args: { data: { startTime: 1 } } }, 0);
    collector.collect({ name: 'ProfileChunk', ts: 2, pid: 1, tid: 1, id: 'p', args: { data: {
      cpuProfile: { nodes: [{ id: 1 }], samples: [1, 1, 1] }, timeDeltas: [1, 1, 1],
    } } }, 1);
    for (let index = 0; index < 3; index += 1) {
      collector.collect({ name: 'EvaluateScript', ph: 'B', ts: index + 1, pid: 1, tid: 1 }, index + 2);
    }
    const output = collector.finalize([], 10, 10);
    expect(output.profiles[0].sampleCount).toBe(3);
    expect(output.profiles[0].limitations).toContain('profile-samples-candidate-limit');
    expect(output.warnings).toContain('TRACE_FACT_CANDIDATES_TRUNCATED');
  });

  it('does not double count overlapping siblings and caps category sum at task duration', async () => {
    const result = await aggregate([
      ...context,
      { name: 'RunTask', ph: 'X', ts: 1_000, dur: 100_000, pid: 1, tid: 10 },
      { name: 'EvaluateScript', ph: 'X', ts: 10_000, dur: 60_000, pid: 1, tid: 10 },
      { name: 'Layout', ph: 'X', ts: 40_000, dur: 50_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 110_000 },
    ]);
    const task = result.facts.context.tasks![0];
    expect(Object.values(task.categorySelfTimeMs).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(100);
    expect(task.selfTimeMs).toBe(20);
  });

  it('accepts a nodes-only profile chunk', async () => {
    const result = await aggregate([
      ...context,
      { name: 'Profile', ts: 100, pid: 1, tid: 10, id: 'p', args: { data: { startTime: 100 } } },
      { name: 'ProfileChunk', ts: 110, pid: 1, tid: 10, id: 'p', args: { data: {
        cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: 'work' } }] },
      } } },
      { name: 'ProfileChunk', ts: 120, pid: 1, tid: 10, id: 'p', args: { data: {
        cpuProfile: { samples: [1] }, timeDeltas: [10],
      } } },
      { name: 'capture-end', ts: 1_000 },
    ]);
    expect(result.facts.context.profiles![0]).toEqual(expect.objectContaining({ nodeCount: 1, sampleCount: 1 }));
  });

  it('clears initiator evidence and marks summaries partial after internal truncation', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 10, args: { data: { requestId: 'parent', navigationId: 'nav', url: 'https://example.test/p' } } },
      { name: 'ResourceSendRequest', ts: 20, args: { data: { requestId: 'child', initiatorRequestId: 'parent', navigationId: 'nav', url: 'https://example.test/c' } } },
      { name: 'DrawFrame', ph: 'X', ts: 30, dur: 20_000, pid: 1, tid: 10 },
      { name: 'DrawFrame', ph: 'X', ts: 30_000, dur: 30_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 100_000 },
    ], { maxCandidatesPerKind: 1, maxFactsPerKind: 1 });
    expect(result.facts.context.requests![0].initiatorRequestId).toBeUndefined();
    expect(result.facts.context.requests![0].initiatorEvidenceIds).toEqual([]);
    expect(result.facts.context.animationFrameSummary).toEqual(expect.objectContaining({
      totalCount: 1, completeness: 'partial', limitations: ['internal-candidate-limit'],
    }));
    expect(result.facts.context.quality.level).toBe('partial');
    expect(result.facts.context.quality.warnings).toContain('TRACE_FACT_CANDIDATES_TRUNCATED');
  });


  it('caps globally retained phase events and evidence at 10000', async () => {
    const phases = Array.from({ length: 10_001 }, (_, index) => ({
      name: 'EvaluateScript', ph: 'B', ts: index + 10, pid: 1, tid: 10,
    }));
    const result = await aggregate([
      ...context,
      ...phases,
      { name: 'capture-end', ts: 20_000 },
    ], { maxCandidatesPerKind: 20_000, maxEvidence: 20_000 });
    expect(result.warnings).toContain('TRACE_FACT_CANDIDATES_TRUNCATED');
    expect(result.facts.context.quality.level).toBe('partial');
  });


  it('caps entity evidence at 32 and removes every reference missing from final evidence output', async () => {
    const requestEvents = [
      { name: 'ResourceSendRequest', ts: 10, args: { data: { requestId: 'r', navigationId: 'nav', url: 'https://example.test/a' } } },
      ...Array.from({ length: 40 }, (_, index) => ({
        name: 'ResourceReceivedData', ts: 20 + index,
        args: { data: { requestId: 'r', encodedDataLength: 1 } },
      })),
      { name: 'ResourceFinish', ts: 70, args: { data: { requestId: 'r' } } },
    ];
    const result = await aggregate([
      ...context,
      ...requestEvents,
      { name: 'capture-end', ts: 100 },
    ], { maxEvidence: 2 });
    const available = new Set(result.facts.context.evidence.map(item => item.evidenceId));
    const request = result.facts.context.requests![0];
    expect(request.evidenceIds.length).toBeLessThanOrEqual(32);
    expect(request.evidenceIds.every(id => available.has(id))).toBe(true);
    expect(request.initiatorEvidenceIds.every(id => available.has(id))).toBe(true);
    expect(result.facts.context.processes.every(item => item.evidenceIds.every(id => available.has(id)))).toBe(true);
    expect(result.facts.context.threads.every(item => item.evidenceIds.every(id => available.has(id)))).toBe(true);
    expect(result.facts.context.frames.every(item => (
      item.evidenceIds.every(id => available.has(id))
      && item.processSpans.every(span => span.evidenceIds.every(id => available.has(id)))
    ))).toBe(true);
    expect(result.facts.context.navigations.every(item => (
      item.evidenceIds.every(id => available.has(id))
      && item.processSpans.every(span => span.evidenceIds.every(id => available.has(id)))
    ))).toBe(true);
  });

  it('isolates later events when a same-raw-ID send or Profile start is discarded', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 10, args: { data: { requestId: 'r', navigationId: 'nav', url: 'https://example.test/kept' } } },
      { name: 'ResourceSendRequest', ts: 20, args: { data: { requestId: 'r', navigationId: 'nav', url: 'https://example.test/dropped' } } },
      { name: 'ResourceReceiveResponse', ts: 30, args: { data: { requestId: 'r', statusCode: 500 } } },
      { name: 'Profile', ts: 40, pid: 1, tid: 10, id: 'p', args: { data: { startTime: 40 } } },
      { name: 'ProfileChunk', ts: 50, pid: 1, tid: 10, id: 'p', args: { data: {
        cpuProfile: { nodes: [{ id: 1 }], samples: [1] }, timeDeltas: [1],
      } } },
      { name: 'Profile', ts: 60, pid: 1, tid: 10, id: 'p', args: { data: { startTime: 60 } } },
      { name: 'ProfileChunk', ts: 70, pid: 1, tid: 10, id: 'p', args: { data: {
        cpuProfile: { nodes: [{ id: 2 }], samples: [2] }, timeDeltas: [1],
      } } },
      { name: 'capture-end', ts: 100 },
    ], { maxCandidatesPerKind: 1 });
    expect(result.facts.context.requests).toHaveLength(1);
    expect(result.facts.context.requests![0].statusCode).toBeUndefined();
    expect(result.facts.context.profiles).toHaveLength(1);
    expect(result.facts.context.profiles![0]).toEqual(expect.objectContaining({ nodeCount: 1, sampleCount: 1 }));
  });

  it('uses the navigation main evidence event index as every Batch3 navigationKey', async () => {
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 10, args: { data: { requestId: 'r', navigationId: 'nav', url: 'https://example.test/a' } } },
      { name: 'RunTask', ph: 'X', ts: 20, dur: 60_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 100_000 },
    ]);
    expect(result.facts.context.navigations[0].key).toBe('trace:navigation:event:2');
    expect(result.facts.context.requests![0].navigationKey).toBe('trace:navigation:event:2');
    expect(result.facts.context.tasks![0].navigationKey).toBe('trace:navigation:event:2');
  });

  it('counts only successfully built facts and does not invent partial interaction totals', async () => {
    const result = await aggregate([
      ...context,
      { name: 'EventTiming', ph: 'X', ts: 10, pid: 1, tid: 10, args: { data: {
        interactionId: 1, eventStart: 10, processingStart: 5,
        processingEnd: 20, interactionEnd: 30,
      } } },
      { name: 'EventTiming', ph: 'X', ts: 30, pid: 1, tid: 10, args: { data: {
        interactionId: 2, eventStart: 30, processingStart: 40,
        processingEnd: 50, interactionEnd: 60,
      } } },
      { name: 'EventTiming', ph: 'b', ts: 70, pid: 1, tid: 10, args: { data: {
        interactionId: 3, eventStart: 70, processingStart: 80,
      } } },
      { name: 'capture-end', ts: 100 },
    ], { maxCandidatesPerKind: 2 });
    expect(result.facts.context.interactions).toHaveLength(1);
    expect(result.facts.context.factCounts!.interactions.total).toBe(1);
    expect(result.facts.context.interactionSummary).toEqual(expect.objectContaining({
      totalCount: 1, completeness: 'partial', limitations: ['internal-candidate-limit'],
    }));
  });


  it('does not retain unbounded isolation state and leaves later events unmapped after deletion', async () => {
    const dropped = Array.from({ length: 100 }, (_, index) => [
      { name: 'ResourceSendRequest', ts: 20 + index * 3, args: { data: { requestId: `dropped-${index}`, navigationId: 'private-nav', url: 'https://example.test/dropped' } } },
      { name: 'ResourceReceiveResponse', ts: 21 + index * 3, args: { data: { requestId: `dropped-${index}`, statusCode: 500 } } },
      { name: 'ResourceFinish', ts: 22 + index * 3, args: { data: { requestId: `dropped-${index}` } } },
    ]).flat();
    const result = await aggregate([
      ...context,
      { name: 'ResourceSendRequest', ts: 10, args: { data: { requestId: 'kept', navigationId: 'nav', url: 'https://example.test/kept' } } },
      ...dropped,
      { name: 'capture-end', ts: 1_000 },
    ], { maxCandidatesPerKind: 1 });
    expect(result.facts.context.requests).toHaveLength(1);
    expect(result.facts.context.requests![0].statusCode).toBeUndefined();
  });

  it('maps navigation and frame topology DTO identifiers to primary evidence refs', async () => {
    const result = await aggregate([
      { name: 'TracingStartedInBrowser', ts: 0, args: { data: { frames: [
        { frame: 'private-root', processId: 1, isOutermostMainFrame: true },
        { frame: 'private-child', parent: 'private-root', processId: 1 },
      ] } } },
      { name: 'navigationStart', ts: 10, args: { data: {
        frame: 'private-child', navigationId: 'private-navigation',
      } } },
      { name: 'capture-end', ts: 100 },
    ]);
    const serialized = JSON.stringify(result.facts.context);
    const root = result.facts.context.frames.find(frame => frame.isOutermost)!;
    const child = result.facts.context.frames.find(frame => !frame.isOutermost)!;
    const navigation = result.facts.context.navigations[0];
    expect(root.frameId).toMatch(/^trace:frame:event:0:\d+$/);
    expect(child.frameId).toMatch(/^trace:frame:event:0:\d+$/);
    expect(child.parentFrameId).toBe(root.frameId);
    expect(child.outermostFrameId).toBe(root.frameId);
    expect(navigation.navigationId).toBe('trace:navigation:event:1');
    expect(navigation.frameId).toBe(child.frameId);
    expect(navigation.outermostFrameId).toBe(root.frameId);
    expect(serialized).not.toMatch(/private-root|private-child|private-navigation/);
  });

});
