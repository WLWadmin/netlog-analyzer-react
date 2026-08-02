import type { ChromiumTraceEvent } from '../parsers/trace/types';
import { AdvancedAnalysisStore } from './advancedAnalysisStore';

function shift(
  ts: number,
  score: number | undefined,
  hadRecentInput: boolean | null = false,
): ChromiumTraceEvent {
  return {
    name: 'LayoutShift',
    cat: 'loading',
    ph: 'I',
    ts,
    args: {
      data: {
        ...(score === undefined ? {} : { weighted_score_delta: score }),
        ...(hadRecentInput === null ? {} : { had_recent_input: hadRecentInput }),
      },
    },
  };
}

describe('AdvancedAnalysisStore layout shift analysis', () => {
  it('clusters explicit CLS-eligible shifts by one-second gap and five-second window', () => {
    const store = new AdvancedAnalysisStore([
      shift(0, 0.1),
      shift(900_000, 0.2),
      shift(5_100_000, 0.3),
      shift(5_200_000, 0.4, true),
    ]);

    expect(store.queryLayoutShifts({ startUs: 0, endUs: 6_000_000 })).toEqual({
      status: 'available',
      evidenceIds: ['trace:event:0', 'trace:event:1', 'trace:event:2', 'trace:event:3'],
      limitations: [
        '仅聚类 Trace 中含明确分值且不受近期输入影响的 LayoutShift 事件。',
        '不映射原页面 DOM，不推断布局偏移根因。',
        '1 个受近期输入影响的 LayoutShift 未计入 CLS 聚类。',
      ],
      result: {
        kind: 'layout-shifts',
        clusters: [
          {
            clusterId: 'trace:layout-shift-cluster:0',
            startUs: 0,
            endUs: 900_000,
            cumulativeScore: 0.3,
            memberEventIds: ['trace:timeline:0', 'trace:timeline:1'],
            evidenceIds: ['trace:event:0', 'trace:event:1'],
            limitations: ['不映射原页面 DOM，不推断布局偏移根因。'],
          },
          {
            clusterId: 'trace:layout-shift-cluster:2',
            startUs: 5_100_000,
            endUs: 5_100_000,
            cumulativeScore: 0.3,
            memberEventIds: ['trace:timeline:2'],
            evidenceIds: ['trace:event:2'],
            limitations: ['不映射原页面 DOM，不推断布局偏移根因。'],
          },
        ],
      },
    });
  });

  it('returns insufficient when LayoutShift exists without an explicit score', () => {
    const store = new AdvancedAnalysisStore([shift(100, undefined)]);

    expect(store.queryLayoutShifts({ startUs: 0, endUs: 1_000 })).toMatchObject({
      status: 'insufficient',
      evidenceIds: ['trace:event:0'],
      result: { kind: 'layout-shifts', clusters: [] },
    });
  });

  it('does not treat a generic score field as a CLS delta', () => {
    const store = new AdvancedAnalysisStore([{
      name: 'LayoutShift',
      ts: 100,
      args: {
        data: {
          score: 0.2,
          had_recent_input: false,
        },
      },
    }]);

    expect(store.queryLayoutShifts({ startUs: 0, endUs: 1_000 })).toMatchObject({
      status: 'insufficient',
      result: { kind: 'layout-shifts', clusters: [] },
    });
  });

  it('does not guess CLS eligibility when recent-input evidence is missing', () => {
    const store = new AdvancedAnalysisStore([shift(100, 0.2, null)]);

    expect(store.queryLayoutShifts({ startUs: 0, endUs: 1_000 })).toMatchObject({
      status: 'insufficient',
      limitations: expect.arrayContaining([
        expect.stringMatching(/缺少 had_recent_input/),
      ]),
      result: { kind: 'layout-shifts', clusters: [] },
    });
  });

  it('returns unavailable when the range has no explicit LayoutShift event', () => {
    const store = new AdvancedAnalysisStore([{
      name: 'Layout',
      ts: 100,
      dur: 10,
    }]);

    expect(store.queryLayoutShifts({ startUs: 0, endUs: 1_000 })).toMatchObject({
      status: 'unavailable',
      evidenceIds: [],
      result: { kind: 'layout-shifts', clusters: [] },
    });
  });
});

describe('AdvancedAnalysisStore animation composition analysis', () => {
  it('uses explicit composition evidence and keeps overlap as non-causal context', () => {
    const store = new AdvancedAnalysisStore([
      {
        name: 'CompositorAnimation',
        cat: 'cc,animation',
        ph: 'X',
        ts: 100,
        dur: 100,
      },
      {
        name: 'DrawFrame',
        cat: 'cc',
        ph: 'X',
        ts: 120,
        dur: 10,
      },
      {
        name: 'Paint',
        cat: 'rendering',
        ph: 'X',
        ts: 130,
        dur: 20,
      },
      {
        name: 'Animation',
        cat: 'animation',
        ph: 'X',
        ts: 300,
        dur: 50,
        args: { data: { composite_failed: true } },
      },
    ]);

    expect(store.queryAnimationComposition({ startUs: 0, endUs: 1_000 }))
      .toMatchObject({
        status: 'available',
        result: {
          kind: 'animation-composition',
          animations: [
            {
              animationId: 'trace:animation:0',
              state: 'composited',
              frameEventIds: ['trace:timeline:1'],
              renderingEventIds: ['trace:timeline:2'],
              evidenceIds: ['trace:event:0'],
            },
            {
              animationId: 'trace:animation:3',
              state: 'not-composited',
              frameEventIds: [],
              renderingEventIds: [],
              evidenceIds: ['trace:event:3'],
            },
          ],
        },
      });
  });

  it('returns insufficient with unknown state for generic animation evidence', () => {
    const store = new AdvancedAnalysisStore([{
      name: 'Animation',
      cat: 'animation',
      ph: 'X',
      ts: 100,
      dur: 20,
    }]);

    expect(store.queryAnimationComposition({ startUs: 0, endUs: 1_000 }))
      .toMatchObject({
        status: 'insufficient',
        result: {
          kind: 'animation-composition',
          animations: [{ state: 'unknown' }],
        },
      });
  });

  it('returns unavailable without explicit animation evidence', () => {
    const store = new AdvancedAnalysisStore([{
      name: 'FireAnimationFrame',
      ts: 100,
      dur: 20,
    }]);

    expect(store.queryAnimationComposition({ startUs: 0, endUs: 1_000 }))
      .toMatchObject({
        status: 'unavailable',
        result: { kind: 'animation-composition', animations: [] },
      });
  });

  it('does not classify compositor-like substrings as explicit compositor evidence', () => {
    const store = new AdvancedAnalysisStore([{
      name: 'NonCompositorAnimation',
      cat: 'animation',
      ph: 'X',
      ts: 100,
      dur: 20,
    }]);

    expect(store.queryAnimationComposition({ startUs: 0, endUs: 1_000 }))
      .toMatchObject({
        status: 'unavailable',
        result: { kind: 'animation-composition', animations: [] },
      });
  });

  it('bounds dense results and reports visible truncation', () => {
    const animations = Array.from({ length: 10_050 }, (_, index) => ({
      name: 'CompositorAnimation',
      cat: 'cc,animation',
      ph: 'X',
      ts: index * 10,
      dur: 5,
    }));
    const store = new AdvancedAnalysisStore(animations);

    const result = store.queryAnimationComposition({
      startUs: 0,
      endUs: 200_000,
    });
    expect(result.result.animations).toHaveLength(2_000);
    expect(result.evidenceIds).toHaveLength(2_000);
    expect(result.limitations).toContain(
      '结果已按 2000 个动画事件上限截断；请缩小时间范围继续检查。',
    );
  });
});

describe('AdvancedAnalysisStore memory trend analysis', () => {
  it('uses explicit byte counters and summarizes GC with non-causal context', () => {
    const store = new AdvancedAnalysisStore([
      {
        name: 'UpdateCounters',
        cat: 'v8',
        ph: 'I',
        ts: 100,
        args: { data: { jsHeapSizeUsed: 1_024 } },
      },
      {
        name: 'MinorGC',
        cat: 'v8',
        ph: 'X',
        ts: 200,
        dur: 20,
      },
      {
        name: 'UnrelatedRawInteractionShape',
        ts: 190,
        dur: 50,
      },
      {
        name: 'UnrelatedRawTaskShape',
        ts: 180,
        dur: 50_000,
      },
      {
        name: 'UpdateCounters',
        cat: 'v8',
        ph: 'I',
        ts: 300,
        args: { data: { jsHeapSizeUsed: 2_048 } },
      },
    ], {
      interactions: [{
        id: 'trace:interaction:normalized',
        interactionId: 1,
        startUs: 190,
        totalLatencyMs: 0.05,
        inputDelayMs: 0,
        processingDurationMs: 0.05,
        presentationDelayMs: 0,
        taskIds: [],
        renderingEventIds: [],
        frameIds: [],
        evidenceIds: ['trace:event:2'],
      }],
      tasks: [{
        id: 'trace:task:normalized',
        startUs: 180,
        durationMs: 50,
        processId: 1,
        threadId: 1,
        blockingContributionMs: 0,
        selfTimeMs: 50,
        categorySelfTimeMs: { other: 50 },
        selfTimeConfidence: 'exact',
        limitations: [],
        evidenceIds: ['trace:event:3'],
      }],
    });

    expect(store.queryMemoryTrend({ startUs: 0, endUs: 1_000 })).toEqual({
      status: 'available',
      evidenceIds: [
        'trace:event:0',
        'trace:event:1',
        'trace:event:4',
      ],
      limitations: [
        '内存样本仅使用 UpdateCounters 的 jsHeapSizeUsed 明确字节值。',
        'GC 与交互或长任务的时间重叠只作相关上下文，不证明因果关系。',
        '不提供对象保留链、对象级归因、确定内存泄漏或泄漏速度。',
      ],
      result: {
        kind: 'memory-trend',
        samples: [
          {
            timestampUs: 100,
            metric: 'js-heap-used',
            bytes: 1_024,
            evidenceIds: ['trace:event:0'],
          },
          {
            timestampUs: 300,
            metric: 'js-heap-used',
            bytes: 2_048,
            evidenceIds: ['trace:event:4'],
          },
        ],
        gcEvents: [{
          eventId: 'trace:gc:1',
          type: 'minor',
          startUs: 200,
          durationUs: 20,
          interactionEventIds: ['trace:interaction:normalized'],
          longTaskEventIds: ['trace:task:normalized'],
          evidenceIds: ['trace:event:1'],
        }],
        summary: {
          gcCount: 1,
          totalPauseUs: 20,
          maxPauseUs: 20,
        },
      },
    });
  });

  it('bounds all GC context IDs across the whole response', () => {
    const interactions = Array.from({ length: 2_100 }, (_, index) => ({
      id: `trace:interaction:${index}`,
      interactionId: index + 1,
      startUs: 0,
      totalLatencyMs: 1,
      inputDelayMs: 0,
      processingDurationMs: 1,
      presentationDelayMs: 0,
      taskIds: [],
      renderingEventIds: [],
      frameIds: [],
      evidenceIds: [`trace:event:${index + 2}`],
    }));
    const store = new AdvancedAnalysisStore([
      {
        name: 'UpdateCounters',
        ts: 0,
        args: { data: { jsHeapSizeUsed: 1 } },
      },
      { name: 'MinorGC', ts: 10, dur: 10 },
      { name: 'MinorGC', ts: 20, dur: 10 },
    ], { interactions, tasks: [] });

    const result = store.queryMemoryTrend({ startUs: 0, endUs: 1_000 });
    const contextCount = result.result.gcEvents.reduce(
      (sum, event) => (
        sum + event.interactionEventIds.length + event.longTaskEventIds.length
      ),
      0,
    );
    expect(contextCount).toBe(2_000);
    expect(result.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/上下文引用.*2000/),
    ]));
  });

  it('does not invent a GC pause when duration is missing', () => {
    const store = new AdvancedAnalysisStore([
      { name: 'MajorGC', ts: 100 },
    ]);

    expect(store.queryMemoryTrend({ startUs: 0, endUs: 1_000 }))
      .toMatchObject({
        status: 'insufficient',
        evidenceIds: ['trace:event:0'],
        result: {
          kind: 'memory-trend',
          gcEvents: [],
          summary: { gcCount: 0, totalPauseUs: 0, maxPauseUs: 0 },
        },
      });
  });

  it('returns insufficient for GC-only evidence and rejects guessed memory values', () => {
    const store = new AdvancedAnalysisStore([
      {
        name: 'MajorGC',
        cat: 'v8',
        ph: 'X',
        ts: 100,
        dur: 30,
        args: { data: { object_count: 900, memory: 4_096 } },
      },
    ]);

    expect(store.queryMemoryTrend({ startUs: 0, endUs: 1_000 })).toMatchObject({
      status: 'insufficient',
      result: {
        kind: 'memory-trend',
        samples: [],
        gcEvents: [{ type: 'major' }],
        summary: { gcCount: 1, totalPauseUs: 30, maxPauseUs: 30 },
      },
    });
  });

  it('bounds memory and GC results and clears them on release', () => {
    const events: ChromiumTraceEvent[] = [];
    for (let index = 0; index < 2_010; index += 1) {
      events.push({
        name: 'UpdateCounters',
        ts: index * 10,
        args: { data: { jsHeapSizeUsed: index } },
      });
      events.push({
        name: 'MinorGC',
        ts: index * 10,
        dur: 1,
      });
    }
    const store = new AdvancedAnalysisStore(events);

    const result = store.queryMemoryTrend({ startUs: 0, endUs: 100_000 });
    expect(result.result.samples).toHaveLength(2_000);
    expect(result.result.gcEvents).toHaveLength(2_000);
    expect(result.result.summary).toEqual({
      gcCount: 2_010,
      totalPauseUs: 2_010,
      maxPauseUs: 1,
    });
    expect(result.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/2000.*内存样本/),
      expect.stringMatching(/2000.*GC 事件/),
    ]));

    store.release();
    expect(store.queryMemoryTrend({ startUs: 0, endUs: 100_000 }))
      .toMatchObject({
        status: 'unavailable',
        evidenceIds: [],
        result: {
          kind: 'memory-trend',
          samples: [],
          gcEvents: [],
          summary: { gcCount: 0, totalPauseUs: 0, maxPauseUs: 0 },
        },
      });
  });

  it('bounds evidence for dense GC events without explicit duration', () => {
    const store = new AdvancedAnalysisStore(Array.from(
      { length: 2_010 },
      (_, index) => ({ name: 'MinorGC', ts: index * 10 }),
    ));

    const result = store.queryMemoryTrend({ startUs: 0, endUs: 100_000 });
    expect(result.status).toBe('insufficient');
    expect(result.evidenceIds).toHaveLength(2_000);
    expect(result.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/2010 个 GC 事件缺少明确持续时间/),
      expect.stringMatching(/证据引用.*2000.*截断/),
    ]));
  });
});

describe('AdvancedAnalysisStore GPU and Raster analysis', () => {
  it('accepts explicit RasterTask and metadata-supported GPU events', () => {
    const store = new AdvancedAnalysisStore([
      {
        name: 'process_name',
        cat: '__metadata',
        ph: 'M',
        pid: 7,
        args: { name: 'GPU Process' },
      },
      {
        name: 'RasterTask',
        cat: 'cc',
        ph: 'X',
        ts: 100,
        dur: 20,
        pid: 1,
        tid: 2,
      },
      {
        name: 'GPUTask',
        cat: 'disabled-by-default-gpu.service',
        ph: 'X',
        ts: 200,
        dur: 30,
        pid: 7,
        tid: 8,
      },
    ]);

    expect(store.queryGpuRaster({ startUs: 0, endUs: 1_000 })).toEqual({
      status: 'available',
      evidenceIds: ['trace:event:1', 'trace:event:2'],
      limitations: [
        'Raster 仅接受明确 RasterTask；GPU 仅接受白名单事件及 GPU 类别或进程/线程元数据。',
        '只报告记录到的 GPU/Raster 活动，不推断利用率、硬件瓶颈、显存压力或驱动根因。',
      ],
      result: {
        kind: 'gpu-raster',
        intervals: [
          {
            eventId: 'trace:gpu-raster:1',
            activity: 'raster',
            startUs: 100,
            durationUs: 20,
            evidenceIds: ['trace:event:1'],
          },
          {
            eventId: 'trace:gpu-raster:2',
            activity: 'gpu',
            startUs: 200,
            durationUs: 30,
            evidenceIds: ['trace:event:2'],
          },
        ],
        summary: {
          intervalCount: 2,
          gpuIntervalCount: 1,
          rasterIntervalCount: 1,
          totalDurationUs: 50,
          maxDurationUs: 30,
        },
      },
    });
  });

  it('does not promote Paint, Composite or unsupported GPU-like names', () => {
    const store = new AdvancedAnalysisStore([
      { name: 'Paint', cat: 'gpu', ts: 100, dur: 10 },
      { name: 'CompositeLayers', cat: 'gpu', ts: 120, dur: 10 },
      { name: 'SomeGpuWork', cat: 'rendering', ts: 140, dur: 10 },
    ]);

    expect(store.queryGpuRaster({ startUs: 0, endUs: 1_000 }))
      .toMatchObject({
        status: 'unavailable',
        evidenceIds: [],
        result: {
          kind: 'gpu-raster',
          intervals: [],
          summary: {
            intervalCount: 0,
            gpuIntervalCount: 0,
            rasterIntervalCount: 0,
            totalDurationUs: 0,
            maxDurationUs: 0,
          },
        },
      });
  });

  it('requires explicit duration for GPU and Raster intervals', () => {
    const store = new AdvancedAnalysisStore([
      { name: 'RasterTask', cat: 'cc', ts: 100 },
      { name: 'GPUTask', cat: 'cc,gpu', ts: 200 },
    ]);

    expect(store.queryGpuRaster({ startUs: 0, endUs: 1_000 }))
      .toMatchObject({
        status: 'insufficient',
        evidenceIds: ['trace:event:0', 'trace:event:1'],
        result: {
          kind: 'gpu-raster',
          intervals: [],
          summary: { intervalCount: 0, totalDurationUs: 0 },
        },
      });
  });

  it('bounds GPU/Raster intervals and releases the compact index', () => {
    const store = new AdvancedAnalysisStore(Array.from(
      { length: 2_010 },
      (_, index) => ({
        name: 'RasterTask',
        cat: 'cc',
        ts: index * 10,
        dur: 5,
      }),
    ));

    const result = store.queryGpuRaster({ startUs: 0, endUs: 100_000 });
    expect(result.result.intervals).toHaveLength(2_000);
    expect(result.result.summary).toEqual({
      intervalCount: 2_010,
      gpuIntervalCount: 0,
      rasterIntervalCount: 2_010,
      totalDurationUs: 10_050,
      maxDurationUs: 5,
    });
    expect(result.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/2000.*GPU\/Raster/),
    ]));
    store.release();
    expect(store.queryGpuRaster({ startUs: 0, endUs: 100_000 }))
      .toMatchObject({
        status: 'unavailable',
        evidenceIds: [],
        result: { kind: 'gpu-raster', intervals: [] },
      });
  });

  it('bounds evidence for dense GPU/Raster events without explicit duration', () => {
    const store = new AdvancedAnalysisStore(Array.from(
      { length: 2_010 },
      (_, index) => ({ name: 'RasterTask', cat: 'cc', ts: index * 10 }),
    ));

    const result = store.queryGpuRaster({ startUs: 0, endUs: 100_000 });
    expect(result.status).toBe('insufficient');
    expect(result.evidenceIds).toHaveLength(2_000);
    expect(result.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/2010 个 GPU\/Raster 事件缺少明确持续时间/),
      expect.stringMatching(/证据引用.*2000.*截断/),
    ]));
  });
});
