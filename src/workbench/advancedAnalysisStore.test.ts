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
