import { readFileSync } from 'fs';
import path from 'path';
import { MinimalTraceAggregator } from './minimalTraceAggregator';
import type { ChromiumTraceFile, TraceParserWarning } from './types';

function loadFixture(name: string): ChromiumTraceFile {
  return JSON.parse(readFileSync(
    path.join(__dirname, '__fixtures__', name),
    'utf8',
  )) as ChromiumTraceFile;
}

async function aggregate(name: string) {
  return new MinimalTraceAggregator({
    encoding: 'plain-json',
    jsonBytes: 0,
    skippedEventCount: 0,
    warnings: [],
  }).aggregate(loadFixture(name), {
    isCancelled: () => false,
    onProgress: () => undefined,
  });
}

describe('MinimalTraceAggregator synthetic fixtures', () => {
  it.each([
    ['minimal-navigation.json', 1, 1],
    ['multi-navigation.json', 2, 2],
    ['renderer-process-swap.json', 1, 2],
    ['iframe-oopif.json', 2, 2],
    ['missing-thread-metadata.json', 1, 1],
    ['frame-parent-cycle.json', 1, 1],
    ['missing-navigation.json', 0, 0],
  ])('%s produces bounded navigation and span facts', async (
    name,
    navigationCount,
    processSpanCount,
  ) => {
    const result = await aggregate(name);
    expect(result.facts.context.navigations).toHaveLength(navigationCount);
    expect(result.facts.context.navigations.reduce(
      (count, navigation) => count + navigation.processSpans.length,
      0,
    )).toBe(processSpanCount);
    expect(result.facts.context.evidenceReturnedCount)
      .toBeLessThanOrEqual(result.facts.context.evidenceTotalCount);
  });

  it.each([
    ['missing-thread-metadata.json', 'TRACE_RENDERER_MAIN_MISSING'],
    ['frame-parent-cycle.json', 'TRACE_FRAME_PARENT_CYCLE'],
  ] as Array<[string, TraceParserWarning]>)(
    '%s reports %s conservatively',
    async (name, warning) => {
      const result = await aggregate(name);
      expect(result.warnings).toContain(warning);
      expect(result.facts.context.quality.level).not.toBe('good');
    },
  );

  it('keeps OOPIF process spans on the child frame', async () => {
    const result = await aggregate('iframe-oopif.json');
    const child = result.facts.context.frames.find(frame => (
      frame.processSpans.some(span => span.processId === 20)
    ));
    const root = result.facts.context.frames.find(frame => frame.isOutermost);

    expect(child).toEqual(expect.objectContaining({
      parentFrameId: root?.frameId,
      outermostFrameId: root?.frameId,
    }));
    expect(child?.processSpans.map(span => span.processId)).toEqual([20]);
    expect(root?.processSpans.map(span => span.processId)).toEqual([10]);
  });
});
