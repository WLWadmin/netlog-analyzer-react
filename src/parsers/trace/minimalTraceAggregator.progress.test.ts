import { MinimalTraceAggregator } from './minimalTraceAggregator';
import type { ChromiumTraceEvent, ChromiumTraceFile } from './types';

function trace(events: unknown[]): ChromiumTraceFile {
  return { traceEvents: events as ChromiumTraceEvent[] };
}

describe('MinimalTraceAggregator build-facts progress', () => {
  it('reports cumulative progress from actual fact entries and explicit truncation', async () => {
    const onProgress = jest.fn();
    const result = await new MinimalTraceAggregator({
      encoding: 'plain-json', jsonBytes: 1, skippedEventCount: 0, warnings: [],
    }, { maxFactsPerKind: 1 }).aggregate(trace([
      { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
      { name: 'TracingStartedInBrowser', ts: 0, args: { data: { frames: [
        { frame: 'root', processId: 1, isOutermostMainFrame: true },
      ] } } },
      { name: 'navigationStart', ts: 1, args: { data: { frame: 'root', navigationId: 'nav' } } },
      { name: 'RunTask', ph: 'X', ts: 10, dur: 60_000, pid: 1, tid: 10 },
      { name: 'RunTask', ph: 'X', ts: 70_000, dur: 60_000, pid: 1, tid: 10 },
      { name: 'Layout', ph: 'X', ts: 140_000, dur: 1_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 150_000 },
    ]), { isCancelled: () => false, onProgress });

    expect(result.facts.context.factCounts!.tasks).toEqual({
      total: 2, returned: 1, truncated: true,
    });
    expect(result.facts.context.factCounts!.rendering).toEqual({
      total: 1, returned: 1, truncated: false,
    });
    const buildProgress = onProgress.mock.calls
      .map(([value]) => value)
      .filter(value => value.phase === 'build-facts');
    expect(buildProgress[0]).toEqual({ phase: 'build-facts', processed: 0, total: 3 });
    expect(buildProgress.at(-1)).toEqual({ phase: 'build-facts', processed: 3, total: 3 });
    expect(buildProgress.map(value => value.processed)).toEqual([0, 2, 3]);
  });
});
