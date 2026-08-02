import type { ChromiumTraceEvent } from '../parsers/trace/types';
import type {
  AdvancedAnalysisResultResponse,
  AnimationCompositionAnalysisDto,
  LayoutShiftAnalysisDto,
} from './protocol';

type AdvancedResult<T> = Pick<
  AdvancedAnalysisResultResponse,
  'status' | 'evidenceIds' | 'limitations'
> & { result: T };

interface LayoutShiftFact {
  sourceIndex: number;
  timestampUs: number;
  score?: number;
  hadRecentInput?: boolean;
}

interface AnimationFact {
  sourceIndex: number;
  startUs: number;
  endUs: number;
  state: 'composited' | 'not-composited' | 'unknown';
}

interface ContextEvent {
  sourceIndex: number;
  startUs: number;
  endUs: number;
}

interface ContextIndex {
  sourceIndexes: Uint32Array;
  startUs: Float64Array;
  endUs: Float64Array;
  prefixMaxEndUs: Float64Array;
}

const MAX_CLUSTER_GAP_US = 1_000_000;
const MAX_CLUSTER_DURATION_US = 5_000_000;
const MAX_ADVANCED_RESULTS = 2_000;
const ROOT_CAUSE_LIMITATION = '不映射原页面 DOM，不推断布局偏移根因。';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function layoutShiftFact(
  event: ChromiumTraceEvent,
  sourceIndex: number,
): LayoutShiftFact | undefined {
  if (event.name !== 'LayoutShift') return undefined;
  const timestampUs = finiteNumber(event.ts);
  if (timestampUs === undefined) return undefined;
  const data = record(record(event.args)?.data);
  const score = finiteNumber(data?.weighted_score_delta);
  return {
    sourceIndex,
    timestampUs,
    ...(score === undefined || score < 0 ? {} : { score }),
    ...(typeof data?.had_recent_input === 'boolean'
      ? { hadRecentInput: data.had_recent_input }
      : {}),
  };
}

function eventRange(
  event: ChromiumTraceEvent,
  sourceIndex: number,
): ContextEvent | undefined {
  const startUs = finiteNumber(event.ts);
  if (startUs === undefined) return undefined;
  return {
    sourceIndex,
    startUs,
    endUs: startUs + Math.max(0, finiteNumber(event.dur) ?? 0),
  };
}

function animationFact(
  event: ChromiumTraceEvent,
  sourceIndex: number,
): AnimationFact | undefined {
  const name = typeof event.name === 'string' ? event.name : '';
  if (
    name !== 'Animation'
    && !name.startsWith('Animation::')
    && !isCompositorAnimationName(name)
  ) {
    return undefined;
  }
  const range = eventRange(event, sourceIndex);
  if (!range) return undefined;
  const data = record(record(event.args)?.data);
  const compositeFailed = data?.composite_failed ?? data?.compositeFailed;
  const state = isCompositorAnimationName(name) || compositeFailed === false
    ? 'composited'
    : compositeFailed === true
      ? 'not-composited'
      : 'unknown';
  return { ...range, state };
}

function isCompositorAnimationName(name: string): boolean {
  return name === 'CompositorAnimation'
    || name.startsWith('CompositorAnimation::');
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function clusterLayoutShifts(
  facts: LayoutShiftFact[],
): { clusters: LayoutShiftAnalysisDto['clusters']; truncated: boolean } {
  const clusters: LayoutShiftAnalysisDto['clusters'] = [];
  let truncated = false;
  for (const fact of facts) {
    const previous = clusters[clusters.length - 1];
    if (
      !previous
      || fact.timestampUs - previous.endUs > MAX_CLUSTER_GAP_US
      || fact.timestampUs - previous.startUs > MAX_CLUSTER_DURATION_US
    ) {
      if (clusters.length >= MAX_ADVANCED_RESULTS) {
        truncated = true;
        continue;
      }
      clusters.push({
        clusterId: `trace:layout-shift-cluster:${fact.sourceIndex}`,
        startUs: fact.timestampUs,
        endUs: fact.timestampUs,
        cumulativeScore: fact.score!,
        memberEventIds: [`trace:timeline:${fact.sourceIndex}`],
        evidenceIds: [`trace:event:${fact.sourceIndex}`],
        limitations: [ROOT_CAUSE_LIMITATION],
      });
      continue;
    }
    previous.endUs = fact.timestampUs;
    previous.cumulativeScore = Number(
      (previous.cumulativeScore + fact.score!).toFixed(6),
    );
    if (previous.memberEventIds.length < MAX_ADVANCED_RESULTS) {
      previous.memberEventIds.push(`trace:timeline:${fact.sourceIndex}`);
      previous.evidenceIds.push(`trace:event:${fact.sourceIndex}`);
    } else if (!previous.limitations.some(item => item.includes('成员上限'))) {
      previous.limitations.push(
        `成员证据已按 ${MAX_ADVANCED_RESULTS} 项上限截断。`,
      );
    }
  }
  return { clusters, truncated };
}

export class AdvancedAnalysisStore {
  private layoutShifts: LayoutShiftFact[];
  private animations: AnimationFact[];
  private animationStarts: number[];
  private animationPrefixMaxEnds: number[];
  private frames: ContextIndex;
  private rendering: ContextIndex;
  private released = false;

  constructor(events: ChromiumTraceEvent[]) {
    this.layoutShifts = [];
    this.animations = [];
    const frames: ContextEvent[] = [];
    const renderingEvents: ContextEvent[] = [];
    events.forEach((event, sourceIndex) => {
      const shift = layoutShiftFact(event, sourceIndex);
      if (shift) this.layoutShifts.push(shift);
      const animation = animationFact(event, sourceIndex);
      if (animation) this.animations.push(animation);
      const name = typeof event.name === 'string' ? event.name : '';
      if (
        /^(?:BeginFrame|DrawFrame|DroppedFrame|CommitFrame|ActivateLayerTree)$/
          .test(name)
      ) {
        const frame = eventRange(event, sourceIndex);
        if (frame) frames.push(frame);
      }
      if (
        /^(?:Layout|UpdateLayoutTree|Paint|RasterTask|CompositeLayers|PrePaint)$/
          .test(name)
      ) {
        const rendering = eventRange(event, sourceIndex);
        if (rendering) renderingEvents.push(rendering);
      }
    });
    const byStart = (left: ContextEvent, right: ContextEvent) => (
      left.startUs - right.startUs || left.sourceIndex - right.sourceIndex
    );
    this.layoutShifts.sort((left, right) => (
      left.timestampUs - right.timestampUs || left.sourceIndex - right.sourceIndex
    ));
    this.animations.sort(byStart);
    this.animationStarts = this.animations.map(event => event.startUs);
    this.animationPrefixMaxEnds = this.prefixMaxEnds(this.animations);
    this.frames = this.buildContextIndex(frames);
    this.rendering = this.buildContextIndex(renderingEvents);
  }

  queryLayoutShifts(
    range: { startUs: number; endUs: number },
  ): AdvancedResult<LayoutShiftAnalysisDto> {
    if (this.released) {
      return {
        status: 'unavailable',
        evidenceIds: [],
        limitations: ['高级分析存储已释放。', ROOT_CAUSE_LIMITATION],
        result: { kind: 'layout-shifts', clusters: [] },
      };
    }
    const facts = this.layoutShifts.filter(fact => (
      fact.timestampUs >= range.startUs && fact.timestampUs <= range.endUs
    ));
    const evidenceIds = facts.map(fact => `trace:event:${fact.sourceIndex}`);
    if (facts.length === 0) {
      return {
        status: 'unavailable',
        evidenceIds: [],
        limitations: [
          '当前范围没有明确的 LayoutShift 事件，CLS 能力不可用。',
          ROOT_CAUSE_LIMITATION,
        ],
        result: { kind: 'layout-shifts', clusters: [] },
      };
    }

    const eligible = facts.filter(fact => (
      fact.score !== undefined && fact.hadRecentInput === false
    ));
    const missingScoreCount = facts.filter(fact => fact.score === undefined).length;
    const recentInputCount = facts.filter(fact => fact.hadRecentInput).length;
    const missingInputEligibilityCount = facts.filter(
      fact => fact.hadRecentInput === undefined,
    ).length;
    const clustered = clusterLayoutShifts(eligible);
    const limitations = [
      '仅聚类 Trace 中含明确分值且不受近期输入影响的 LayoutShift 事件。',
      ROOT_CAUSE_LIMITATION,
      ...(missingScoreCount > 0
        ? [`${missingScoreCount} 个 LayoutShift 缺少明确分值，未计入 CLS 聚类。`]
        : []),
      ...(recentInputCount > 0
        ? [`${recentInputCount} 个受近期输入影响的 LayoutShift 未计入 CLS 聚类。`]
        : []),
      ...(missingInputEligibilityCount > 0
        ? [
            `${missingInputEligibilityCount} 个 LayoutShift 缺少 had_recent_input，`
            + '无法确认 CLS 计分资格。',
          ]
        : []),
      ...(clustered.truncated
        ? [
            `结果已按 ${MAX_ADVANCED_RESULTS} 个布局偏移簇上限截断；`
            + '请缩小时间范围继续检查。',
          ]
        : []),
    ];
    return {
      status: eligible.length > 0 ? 'available' : 'insufficient',
      evidenceIds: evidenceIds.slice(0, MAX_ADVANCED_RESULTS),
      limitations,
      result: {
        kind: 'layout-shifts',
        clusters: clustered.clusters,
      },
    };
  }

  queryAnimationComposition(
    range: { startUs: number; endUs: number },
  ): AdvancedResult<AnimationCompositionAnalysisDto> {
    const facts = this.released
      ? []
      : this.intersectingEvents(
          this.animations,
          this.animationStarts,
          this.animationPrefixMaxEnds,
          range,
          MAX_ADVANCED_RESULTS + 1,
        );
    if (facts.length === 0) {
      return {
        status: 'unavailable',
        evidenceIds: [],
        limitations: [
          '当前范围没有明确的 Animation 或 CompositorAnimation 事件，能力不可用。',
          '不根据时间重叠推断动画合成状态。',
        ],
        result: { kind: 'animation-composition', animations: [] },
      };
    }
    const returnedFacts = facts.slice(0, MAX_ADVANCED_RESULTS);
    const unknownCount = returnedFacts.filter(fact => fact.state === 'unknown').length;
    const overlapLimitation = '时间重叠只作范围关联，不证明动画导致帧或渲染活动。';
    return {
      status: unknownCount === returnedFacts.length ? 'insufficient' : 'available',
      evidenceIds: returnedFacts.map(fact => `trace:event:${fact.sourceIndex}`),
      limitations: [
        '仅依据明确 compositor 名称或 composite_failed 字段展示合成状态。',
        overlapLimitation,
        ...(unknownCount > 0
          ? [`${unknownCount} 个动画事件没有明确 compositor 状态，显示为 unknown。`]
          : []),
        ...(facts.length > returnedFacts.length
          ? [
              `结果已按 ${MAX_ADVANCED_RESULTS} 个动画事件上限截断；`
              + '请缩小时间范围继续检查。',
            ]
          : []),
      ],
      result: {
        kind: 'animation-composition',
        animations: returnedFacts.map(fact => ({
          animationId: `trace:animation:${fact.sourceIndex}`,
          startUs: fact.startUs,
          endUs: fact.endUs,
          state: fact.state,
          frameEventIds: this.overlappingEventIds(
            this.frames,
            fact,
          ),
          renderingEventIds: this.overlappingEventIds(
            this.rendering,
            fact,
          ),
          evidenceIds: [`trace:event:${fact.sourceIndex}`],
          limitations: [
            fact.state === 'unknown'
              ? '不根据时间重叠推断合成状态。'
              : overlapLimitation,
          ],
        })),
      },
    };
  }

  private prefixMaxEnds(events: ContextEvent[]): number[] {
    let maximum = Number.NEGATIVE_INFINITY;
    return events.map(event => {
      maximum = Math.max(maximum, event.endUs);
      return maximum;
    });
  }

  private buildContextIndex(events: ContextEvent[]): ContextIndex {
    events.sort((left, right) => (
      left.startUs - right.startUs || left.sourceIndex - right.sourceIndex
    ));
    const sourceIndexes = new Uint32Array(events.length);
    const startUs = new Float64Array(events.length);
    const endUs = new Float64Array(events.length);
    const prefixMaxEndUs = new Float64Array(events.length);
    let maximum = Number.NEGATIVE_INFINITY;
    events.forEach((event, index) => {
      sourceIndexes[index] = event.sourceIndex;
      startUs[index] = event.startUs;
      endUs[index] = event.endUs;
      maximum = Math.max(maximum, event.endUs);
      prefixMaxEndUs[index] = maximum;
    });
    return { sourceIndexes, startUs, endUs, prefixMaxEndUs };
  }

  private overlappingEventIds(
    index: ContextIndex,
    range: ContextEvent,
  ): string[] {
    const first = lowerBound(index.prefixMaxEndUs, range.startUs);
    const end = upperBound(index.startUs, range.endUs);
    const ids: string[] = [];
    for (let offset = first; offset < end && ids.length < MAX_ADVANCED_RESULTS; offset += 1) {
      if (index.endUs[offset] >= range.startUs) {
        ids.push(`trace:timeline:${index.sourceIndexes[offset]}`);
      }
    }
    return ids;
  }

  private intersectingEvents<T extends ContextEvent>(
    events: T[],
    starts: number[],
    prefixMaxEnds: number[],
    range: { startUs: number; endUs: number },
    limit: number,
  ): T[] {
    const first = lowerBound(prefixMaxEnds, range.startUs);
    const end = upperBound(starts, range.endUs);
    const result: T[] = [];
    for (let index = first; index < end && result.length < limit; index += 1) {
      const event = events[index];
      if (event.endUs >= range.startUs) result.push(event);
    }
    return result;
  }

  release(): void {
    this.layoutShifts = [];
    this.animations = [];
    this.animationStarts = [];
    this.animationPrefixMaxEnds = [];
    this.frames = this.buildContextIndex([]);
    this.rendering = this.buildContextIndex([]);
    this.released = true;
  }
}
