import { MinimalTraceAggregator, TraceAggregationCancelled } from './minimalTraceAggregator';
import type { ChromiumTraceEvent, ChromiumTraceFile } from './types';

function trace(traceEvents: unknown[]): ChromiumTraceFile {
  return { traceEvents: traceEvents as ChromiumTraceEvent[] };
}

const intake = {
  encoding: 'plain-json' as const,
  jsonBytes: 1024,
  skippedEventCount: 0,
  warnings: [],
};

describe('MinimalTraceAggregator', () => {
  it('collects metadata with last-valid values and exact renderer-main matching', async () => {
    const result = await new MinimalTraceAggregator(intake).aggregate(trace([
      { ph: 'M', name: 'process_name', pid: 1, args: { name: 'Renderer' } },
      { ph: 'M', name: 'process_sort_index', pid: 1, args: { sort_index: 4 } },
      { ph: 'M', name: 'process_labels', pid: 1, args: { labels: 'one,two' } },
      { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'Old' } },
      { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
      { ph: 'M', name: 'thread_sort_index', pid: 1, tid: 10, args: { sort_index: 2 } },
      { ph: 'M', name: 'thread_name', pid: 1, tid: 11, args: { name: 'CrRendererMainHelper' } },
      { ph: 'M', name: 'thread_name', pid: 'bad', tid: 12, args: { name: 'CrRendererMain' } },
      { ph: 'M', name: 'process_name', pid: 1, args: { name: 7 } },
    ]), { isCancelled: () => false, onProgress: jest.fn() });

    expect(result.facts.context.processes).toEqual([{
      processId: 1,
      name: 'Renderer',
      labels: ['one', 'two'],
      sortIndex: 4,
      threadIds: [10, 11],
      evidenceIds: [
        'trace:event:0',
        'trace:event:1',
        'trace:event:2',
        'trace:event:3',
        'trace:event:4',
        'trace:event:5',
        'trace:event:6',
        'trace:event:8',
      ],
    }]);
    expect(result.facts.context.threads).toEqual([
      expect.objectContaining({ threadId: 10, name: 'CrRendererMain', isRendererMain: true }),
      expect.objectContaining({ threadId: 11, name: 'CrRendererMainHelper', isRendererMain: false }),
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'TRACE_METADATA_ID_MISSING',
      'TRACE_METADATA_VALUE_INVALID',
    ]));
  });

  it('builds frame hierarchy, navigation windows and process-swap spans', async () => {
    const result = await new MinimalTraceAggregator(intake).aggregate(trace([
      { ph: 'M', name: 'thread_name', pid: 10, tid: 101, args: { name: 'CrRendererMain' } },
      { ph: 'M', name: 'thread_name', pid: 20, tid: 201, args: { name: 'CrRendererMain' } },
      {
        name: 'TracingStartedInBrowser',
        ts: 0,
        args: { data: { frames: [
          { frame: 'root', processId: 10, isOutermostMainFrame: true },
          { frame: 'child', parent: 'root', processId: 20 },
        ] } },
      },
      {
        name: 'navigationStart',
        ts: 10,
        pid: 10,
        args: {
          data: {
            frame: 'root',
            navigationId: 'nav-1',
            url: 'https://private.invalid/?token=secret-query',
            headers: {
              Authorization: 'secret-authorization',
              Cookie: 'secret-cookie',
              'Set-Cookie': 'secret-set-cookie',
            },
            screenshot: 'secret-screenshot',
            source: 'secret-source',
            sourceMap: 'secret-source-map',
          },
        },
      },
      {
        name: 'FrameCommittedInBrowser',
        ts: 50,
        args: { data: { frame: 'root', processId: 20, isOutermostMainFrame: true } },
      },
      {
        name: 'navigationStart',
        ts: 80,
        pid: 20,
        args: { data: { frame: 'root', navigationId: 'nav-2' } },
      },
      {
        name: 'navigationStart',
        ts: 20,
        pid: 20,
        args: { data: { frame: 'child' } },
      },
      { name: 'capture-end', ts: 100 },
    ]), { isCancelled: () => false, onProgress: jest.fn() });

    const context = result.facts.context;
    const childFrame = context.frames.find(frame => !frame.isOutermost)!;
    const rootFrame = context.frames.find(frame => frame.isOutermost)!;
    expect(childFrame).toEqual(expect.objectContaining({
      parentFrameId: rootFrame.frameId,
      outermostFrameId: rootFrame.frameId,
    }));
    expect(rootFrame.outermostFrameId).toBe(rootFrame.frameId);
    expect(context.navigations.map(navigation => ({
      key: navigation.key,
      frameId: navigation.frameId,
      outermostFrameId: navigation.outermostFrameId,
      startUs: navigation.startUs,
      endUs: navigation.endUs,
      spans: navigation.processSpans.map(span => [
        span.processId,
        span.startUs,
        span.endUs,
        span.mainThreadId,
      ]),
    }))).toEqual([
      {
        key: 'trace:navigation:event:6',
        frameId: childFrame.frameId,
        outermostFrameId: rootFrame.frameId,
        startUs: 20,
        endUs: 100,
        spans: [[20, 20, 100, 201]],
      },
      {
        key: 'trace:navigation:event:3',
        frameId: rootFrame.frameId,
        outermostFrameId: rootFrame.frameId,
        startUs: 10,
        endUs: 80,
        spans: [[10, 10, 50, 101], [20, 50, 80, 201]],
      },
      {
        key: 'trace:navigation:event:5',
        frameId: rootFrame.frameId,
        outermostFrameId: rootFrame.frameId,
        startUs: 80,
        endUs: 100,
        spans: [[20, 80, 100, 201]],
      },
    ]);
    expect(context.evidence.map(item => item.evidenceId)).toContain('trace:event:2');
    expect(JSON.stringify(result.facts)).not.toMatch(
      /traceEvents|args|private\.invalid|secret-|Authorization|Cookie|Set-Cookie|screenshot|sourceMap/,
    );
  });

  it('handles missing parents, cycles, missing navigation IDs and ambiguous main threads', async () => {
    const result = await new MinimalTraceAggregator(intake).aggregate(trace([
      { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
      { ph: 'M', name: 'thread_name', pid: 1, tid: 11, args: { name: 'CrRendererMain' } },
      { name: 'FrameCommittedInBrowser', ts: 1, args: { data: { frame: 'a', parent: 'b', processId: 1 } } },
      { name: 'FrameCommittedInBrowser', ts: 2, args: { data: { frame: 'b', parent: 'a', processId: 1 } } },
      { name: 'FrameCommittedInBrowser', ts: 3, args: { data: { frame: 'orphan', parent: 'missing', processId: 1 } } },
      { name: 'navigationStart', ts: 4, args: { data: { frame: 'orphan' } } },
      { name: 'end', ts: 5 },
    ]), { isCancelled: () => false, onProgress: jest.fn() });

    expect(result.warnings).toEqual(expect.arrayContaining([
      'TRACE_FRAME_PARENT_CYCLE',
      'TRACE_FRAME_PARENT_MISSING',
      'TRACE_RENDERER_MAIN_AMBIGUOUS',
    ]));
    const orphanFrame = result.facts.context.frames.find(frame => (
      frame.frameId === result.facts.context.navigations[0].frameId
    ));
    expect(orphanFrame?.outermostFrameId).toBe(orphanFrame?.frameId);
    expect(result.facts.context.navigations[0].key).toBe('trace:navigation:event:5');
    expect(result.facts.context.navigations[0].processSpans[0]).toEqual(
      expect.objectContaining({ confidence: 'uncertain' }),
    );
    expect(result.facts.context.navigations[0].processSpans[0])
      .not.toHaveProperty('mainThreadId');
    expect(result.facts.context.quality.frameHierarchy).toBe('partial');
  });

  it('inherits a multi-level outermost frame and orders equal-time navigations by event index', async () => {
    const result = await new MinimalTraceAggregator(intake).aggregate(trace([
      {
        name: 'TracingStartedInBrowser',
        ts: 0,
        args: { data: { frames: [
          { frame: 'root', processId: 1, isOutermostMainFrame: true },
          { frame: 'child', parent: 'root', processId: 1 },
          { frame: 'grandchild', parent: 'child', processId: 1 },
        ] } },
      },
      { name: 'navigationStart', ts: 10, args: { frame: 'grandchild', data: { navigationId: 'nav-a' } } },
      { name: 'navigationStart', ts: 10, args: { frame: 'grandchild', data: { navigationId: 'nav-b' } } },
      { name: 'end', ts: 20 },
    ]), { isCancelled: () => false, onProgress: jest.fn() });

    const navigationFrame = result.facts.context.frames.find(frame => (
      frame.frameId === result.facts.context.navigations[0].frameId
    ));
    expect(navigationFrame?.outermostFrameId).not.toBe(navigationFrame?.frameId);
    expect(result.facts.context.navigations.map(navigation => [
      navigation.key,
      navigation.startUs,
      navigation.endUs,
    ])).toEqual([
      ['trace:navigation:event:1', 10, 10],
      ['trace:navigation:event:2', 10, 20],
    ]);
    expect(result.facts.context.navigations[0].processSpans).toEqual([]);
  });

  it('uses original event indexes, bounds evidence and is deterministic', async () => {
    const source = trace([
      {},
      {},
      { ph: 'M', name: 'process_name', pid: 1, args: { name: 'Renderer' } },
      { name: 'FrameCommittedInBrowser', ts: 0, args: { data: { frame: 'root', processId: 1, isOutermostMainFrame: true } } },
      { name: 'navigationStart', ts: 1, args: { data: { frame: 'root', navigationId: 'nav' } } },
      { name: 'end', ts: 2 },
    ]);
    const aggregator = new MinimalTraceAggregator(intake, { maxEvidence: 2 });
    const runs = await Promise.all([0, 1, 2].map(() => aggregator.aggregate(
      source,
      { isCancelled: () => false, onProgress: jest.fn() },
    )));

    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(runs[0].facts.context.evidence.map(item => item.evidenceId))
      .toEqual(['trace:event:2', 'trace:event:3']);
    expect(runs[0].facts.context.evidenceTotalCount).toBe(3);
    expect(runs[0].facts.context.evidenceReturnedCount).toBe(2);
    expect(runs[0].warnings).toContain('TRACE_EVIDENCE_TRUNCATED');
  });

  it('checks cancellation during scan and finalize', async () => {
    let scanCancelled = false;
    await expect(new MinimalTraceAggregator(intake, { cancellationInterval: 1 }).aggregate(
      trace([{ ts: 1 }, { ts: 2 }]),
      {
        isCancelled: () => scanCancelled,
        onProgress: progress => {
          if (progress.phase === 'scan-events' && progress.processed === 1) scanCancelled = true;
        },
      },
    )).rejects.toBeInstanceOf(TraceAggregationCancelled);

    let finalizeCancelled = false;
    await expect(new MinimalTraceAggregator(intake).aggregate(
      trace([{ ts: 1 }]),
      {
        isCancelled: () => finalizeCancelled,
        onProgress: progress => {
          if (progress.phase === 'finalize-contexts') finalizeCancelled = true;
        },
      },
    )).rejects.toBeInstanceOf(TraceAggregationCancelled);
  });
});
