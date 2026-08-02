import type {
  ChromiumTraceEvent,
  TraceContextResult,
} from '../parsers/trace/types';
import type {
  AdvancedAnalysisResultResponse,
  AnimationCompositionAnalysisDto,
  GpuRasterAnalysisDto,
  LayoutShiftAnalysisDto,
  MemoryTrendAnalysisDto,
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

interface MemorySampleFact {
  sourceIndex: number;
  timestampUs: number;
  bytes: number;
}

interface GcFact extends ContextEvent {
  type: MemoryTrendAnalysisDto['gcEvents'][number]['type'];
}

interface GpuRasterFact extends ContextEvent {
  activity: GpuRasterAnalysisDto['intervals'][number]['activity'];
}

interface IncompleteEventFact {
  sourceIndex: number;
  timestampUs: number;
}

interface ContextEvent {
  sourceIndex: number;
  startUs: number;
  endUs: number;
  eventId?: string;
}

interface ContextIndex {
  sourceIndexes: Uint32Array;
  eventIds: string[];
  startUs: Float64Array;
  endUs: Float64Array;
  prefixMaxEndUs: Float64Array;
}

export interface GpuEvidenceMetadata {
  processIds: Set<number>;
  threadKeys: Set<string>;
}

type AdvancedContext = Pick<
  TraceContextResult['context'],
  'interactions' | 'tasks'
>;

const MAX_CLUSTER_GAP_US = 1_000_000;
const MAX_CLUSTER_DURATION_US = 5_000_000;
const MAX_ADVANCED_RESULTS = 2_000;
const MAX_ADVANCED_CONTEXT_IDS = 2_000;
const ROOT_CAUSE_LIMITATION = '不映射原页面 DOM，不推断布局偏移根因。';
const MEMORY_SOURCE_LIMITATION =
  '内存样本仅使用 UpdateCounters 的 jsHeapSizeUsed 明确字节值。';
const MEMORY_CAUSALITY_LIMITATION =
  'GC 与交互或长任务的时间重叠只作相关上下文，不证明因果关系。';
const MEMORY_SCOPE_LIMITATION =
  '不提供对象保留链、对象级归因、确定内存泄漏或泄漏速度。';
const GC_TYPES = new Map<string, GcFact['type']>([
  ['MinorGC', 'minor'],
  ['V8.GCScavenger', 'minor'],
  ['MajorGC', 'major'],
  ['V8.GCCompactor', 'major'],
  ['V8.GCIncrementalMarking', 'incremental'],
  ['V8.GCFinalizeMC', 'other'],
  ['V8.GCFinalizeMCReduceMemory', 'other'],
]);
const GPU_EVENT_NAMES = new Set(['GPUTask', 'GpuTask', 'GPU::Task']);
const GPU_RASTER_SOURCE_LIMITATION =
  'Raster 仅接受明确 RasterTask；GPU 仅接受白名单事件及 GPU 类别或进程/线程元数据。';
const GPU_RASTER_SCOPE_LIMITATION =
  '只报告记录到的 GPU/Raster 活动，不推断利用率、硬件瓶颈、显存压力或驱动根因。';

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

function memorySampleFact(
  event: ChromiumTraceEvent,
  sourceIndex: number,
): MemorySampleFact | undefined {
  if (event.name !== 'UpdateCounters') return undefined;
  const timestampUs = finiteNumber(event.ts);
  const bytes = finiteNumber(record(record(event.args)?.data)?.jsHeapSizeUsed);
  if (
    timestampUs === undefined
    || bytes === undefined
    || !Number.isSafeInteger(bytes)
    || bytes < 0
  ) {
    return undefined;
  }
  return { sourceIndex, timestampUs, bytes };
}

function completeEventRange(
  event: ChromiumTraceEvent,
  sourceIndex: number,
): ContextEvent | undefined {
  const startUs = finiteNumber(event.ts);
  const durationUs = finiteNumber(event.dur);
  if (startUs === undefined || durationUs === undefined || durationUs < 0) {
    return undefined;
  }
  return { sourceIndex, startUs, endUs: startUs + durationUs };
}

function metadataName(event: ChromiumTraceEvent): string | undefined {
  const name = record(event.args)?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

export function collectGpuEvidenceMetadata(
  events: ChromiumTraceEvent[],
): GpuEvidenceMetadata {
  const processIds = new Set<number>();
  const threadKeys = new Set<string>();
  events.forEach(event => {
    const name = typeof event.name === 'string' ? event.name : '';
    const processId = finiteNumber(event.pid);
    const threadId = finiteNumber(event.tid);
    const label = metadataName(event)?.toLowerCase();
    if (!label?.includes('gpu') || processId === undefined) return;
    if (name === 'process_name') processIds.add(processId);
    if (name === 'thread_name' && threadId !== undefined) {
      threadKeys.add(`${processId}:${threadId}`);
    }
  });
  return { processIds, threadKeys };
}

export function isGpuRasterCandidateName(name: string): boolean {
  return name === 'RasterTask' || GPU_EVENT_NAMES.has(name);
}

export function classifyGpuRasterActivity(
  event: ChromiumTraceEvent,
  metadata: GpuEvidenceMetadata,
): GpuRasterFact['activity'] | undefined {
  const name = typeof event.name === 'string' ? event.name : '';
  if (name === 'RasterTask') return 'raster';
  if (!GPU_EVENT_NAMES.has(name)) return undefined;
  const category = typeof event.cat === 'string' ? event.cat.toLowerCase() : '';
  const processId = finiteNumber(event.pid);
  const threadId = finiteNumber(event.tid);
  const hasGpuMetadata = (
    processId !== undefined
    && (
      metadata.processIds.has(processId)
      || (
        threadId !== undefined
        && metadata.threadKeys.has(`${processId}:${threadId}`)
      )
    )
  );
  return category.split(',').some(token => token.includes('gpu')) || hasGpuMetadata
    ? 'gpu'
    : undefined;
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
  private memorySamples: MemorySampleFact[];
  private memorySampleTimestamps: number[];
  private gcEvents: GcFact[];
  private incompleteGcEvents: IncompleteEventFact[];
  private incompleteGcTimestamps: number[];
  private gcStarts: number[];
  private gcPrefixMaxEnds: number[];
  private gpuRasterEvents: GpuRasterFact[];
  private incompleteGpuRasterEvents: IncompleteEventFact[];
  private incompleteGpuRasterTimestamps: number[];
  private gpuRasterStarts: number[];
  private gpuRasterPrefixMaxEnds: number[];
  private frames: ContextIndex;
  private rendering: ContextIndex;
  private interactions: ContextIndex;
  private longTasks: ContextIndex;
  private released = false;

  constructor(
    events: ChromiumTraceEvent[],
    context?: AdvancedContext,
  ) {
    this.layoutShifts = [];
    this.animations = [];
    this.memorySamples = [];
    this.gcEvents = [];
    this.incompleteGcEvents = [];
    this.gpuRasterEvents = [];
    this.incompleteGpuRasterEvents = [];
    const frames: ContextEvent[] = [];
    const renderingEvents: ContextEvent[] = [];
    const interactionEvents: ContextEvent[] = [];
    const longTaskEvents: ContextEvent[] = [];
    const gpuMetadata = collectGpuEvidenceMetadata(events);
    events.forEach((event, sourceIndex) => {
      const shift = layoutShiftFact(event, sourceIndex);
      if (shift) this.layoutShifts.push(shift);
      const animation = animationFact(event, sourceIndex);
      if (animation) this.animations.push(animation);
      const memorySample = memorySampleFact(event, sourceIndex);
      if (memorySample) this.memorySamples.push(memorySample);
      const name = typeof event.name === 'string' ? event.name : '';
      const gcType = GC_TYPES.get(name);
      if (gcType) {
        const range = completeEventRange(event, sourceIndex);
        if (range) this.gcEvents.push({ ...range, type: gcType });
        else {
          const timestampUs = finiteNumber(event.ts);
          if (timestampUs !== undefined) {
            this.incompleteGcEvents.push({ sourceIndex, timestampUs });
          }
        }
      }
      const gpuRasterActivity = classifyGpuRasterActivity(event, gpuMetadata);
      if (gpuRasterActivity) {
        const range = completeEventRange(event, sourceIndex);
        if (range) {
          this.gpuRasterEvents.push({
            ...range,
            activity: gpuRasterActivity,
          });
        } else {
          const timestampUs = finiteNumber(event.ts);
          if (timestampUs !== undefined) {
            this.incompleteGpuRasterEvents.push({ sourceIndex, timestampUs });
          }
        }
      }
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
    for (const interaction of context?.interactions ?? []) {
      interactionEvents.push({
        sourceIndex: 0,
        eventId: interaction.id,
        startUs: interaction.startUs,
        endUs: interaction.startUs + interaction.totalLatencyMs * 1_000,
      });
    }
    for (const task of context?.tasks ?? []) {
      if (task.durationMs < 50) continue;
      longTaskEvents.push({
        sourceIndex: 0,
        eventId: task.id,
        startUs: task.startUs,
        endUs: task.startUs + task.durationMs * 1_000,
      });
    }
    const byStart = (left: ContextEvent, right: ContextEvent) => (
      left.startUs - right.startUs || left.sourceIndex - right.sourceIndex
    );
    this.layoutShifts.sort((left, right) => (
      left.timestampUs - right.timestampUs || left.sourceIndex - right.sourceIndex
    ));
    this.animations.sort(byStart);
    this.animationStarts = this.animations.map(event => event.startUs);
    this.animationPrefixMaxEnds = this.prefixMaxEnds(this.animations);
    this.memorySamples.sort((left, right) => (
      left.timestampUs - right.timestampUs || left.sourceIndex - right.sourceIndex
    ));
    this.memorySampleTimestamps = this.memorySamples.map(
      sample => sample.timestampUs,
    );
    this.gcEvents.sort(byStart);
    this.incompleteGcEvents.sort((left, right) => (
      left.timestampUs - right.timestampUs || left.sourceIndex - right.sourceIndex
    ));
    this.gcStarts = this.gcEvents.map(event => event.startUs);
    this.gcPrefixMaxEnds = this.prefixMaxEnds(this.gcEvents);
    this.incompleteGcTimestamps = this.incompleteGcEvents.map(
      event => event.timestampUs,
    );
    this.gpuRasterEvents.sort(byStart);
    this.incompleteGpuRasterEvents.sort((left, right) => (
      left.timestampUs - right.timestampUs || left.sourceIndex - right.sourceIndex
    ));
    this.gpuRasterStarts = this.gpuRasterEvents.map(event => event.startUs);
    this.gpuRasterPrefixMaxEnds = this.prefixMaxEnds(this.gpuRasterEvents);
    this.incompleteGpuRasterTimestamps = this.incompleteGpuRasterEvents.map(
      event => event.timestampUs,
    );
    this.frames = this.buildContextIndex(frames);
    this.rendering = this.buildContextIndex(renderingEvents);
    this.interactions = this.buildContextIndex(interactionEvents);
    this.longTasks = this.buildContextIndex(longTaskEvents);
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

  queryMemoryTrend(
    range: { startUs: number; endUs: number },
  ): AdvancedResult<MemoryTrendAnalysisDto> {
    if (this.released) {
      return {
        status: 'unavailable',
        evidenceIds: [],
        limitations: [
          '高级分析存储已释放。',
          MEMORY_SCOPE_LIMITATION,
        ],
        result: {
          kind: 'memory-trend',
          samples: [],
          gcEvents: [],
          summary: { gcCount: 0, totalPauseUs: 0, maxPauseUs: 0 },
        },
      };
    }
    const sampleStart = lowerBound(this.memorySampleTimestamps, range.startUs);
    const sampleEnd = upperBound(this.memorySampleTimestamps, range.endUs);
    const matchingSamples = this.memorySamples.slice(
      sampleStart,
      Math.min(sampleEnd, sampleStart + MAX_ADVANCED_RESULTS + 1),
    );
    const matchingGc = this.summarizeIntersectingEvents(
      this.gcEvents,
      this.gcStarts,
      this.gcPrefixMaxEnds,
      range,
    );
    const incompleteGc = this.incompleteEventsInRange(
      this.incompleteGcEvents,
      this.incompleteGcTimestamps,
      range,
    );
    const returnedSamples = matchingSamples.slice(0, MAX_ADVANCED_RESULTS);
    const returnedGc = matchingGc.events;
    if (
      returnedSamples.length === 0
      && returnedGc.length === 0
      && incompleteGc.count === 0
    ) {
      return {
        status: 'unavailable',
        evidenceIds: [],
        limitations: [
          '当前范围没有明确的 JS Heap Used 计数器或 GC 事件。',
          MEMORY_SCOPE_LIMITATION,
        ],
        result: {
          kind: 'memory-trend',
          samples: [],
          gcEvents: [],
          summary: { gcCount: 0, totalPauseUs: 0, maxPauseUs: 0 },
        },
      };
    }
    const evidenceSourceIndexes = [
      ...returnedSamples.map(sample => sample.sourceIndex),
      ...returnedGc.map(event => event.sourceIndex),
      ...incompleteGc.events.map(event => event.sourceIndex),
    ].sort((left, right) => left - right);
    const evidenceIds = evidenceSourceIndexes
      .slice(0, MAX_ADVANCED_RESULTS)
      .sort((left, right) => left - right)
      .map(sourceIndex => `trace:event:${sourceIndex}`);
    const limitations = [
      MEMORY_SOURCE_LIMITATION,
      MEMORY_CAUSALITY_LIMITATION,
      MEMORY_SCOPE_LIMITATION,
      ...(returnedSamples.length === 0
        ? ['当前范围只有 GC 事件，没有明确内存计数器，无法形成内存趋势。']
        : []),
      ...(incompleteGc.count > 0
        ? [
            `${incompleteGc.count} 个 GC 事件缺少明确持续时间，`
            + '未计入暂停统计。',
          ]
        : []),
      ...(
        evidenceSourceIndexes.length > evidenceIds.length
        || incompleteGc.count > incompleteGc.events.length
        ? [
            `证据引用已按 ${MAX_ADVANCED_RESULTS} 项上限截断；`
            + '请缩小时间范围继续检查。',
          ]
        : []),
      ...(matchingSamples.length > returnedSamples.length
        ? [
            `结果已按 ${MAX_ADVANCED_RESULTS} 个内存样本上限截断；`
            + '请缩小时间范围继续检查。',
          ]
        : []),
      ...(matchingGc.count > returnedGc.length
        ? [
            `结果已按 ${MAX_ADVANCED_RESULTS} 个 GC 事件上限截断；`
            + '请缩小时间范围继续检查。',
          ]
        : []),
    ];
    let remainingContextIds = MAX_ADVANCED_CONTEXT_IDS;
    let contextTruncated = false;
    const gcEvents = returnedGc.map(event => {
      const interactions = this.boundedOverlappingEventIds(
        this.interactions,
        event,
        remainingContextIds,
      );
      remainingContextIds -= interactions.ids.length;
      const longTasks = this.boundedOverlappingEventIds(
        this.longTasks,
        event,
        remainingContextIds,
      );
      remainingContextIds -= longTasks.ids.length;
      contextTruncated ||= interactions.truncated || longTasks.truncated;
      return {
        eventId: `trace:gc:${event.sourceIndex}`,
        type: event.type,
        startUs: event.startUs,
        durationUs: Math.max(0, event.endUs - event.startUs),
        interactionEventIds: interactions.ids,
        longTaskEventIds: longTasks.ids,
        evidenceIds: [`trace:event:${event.sourceIndex}`],
      };
    });
    if (contextTruncated) {
      limitations.push(
        `GC 相关上下文引用已按整个响应 ${MAX_ADVANCED_CONTEXT_IDS} 项上限截断。`,
      );
    }
    return {
      status: returnedSamples.length > 0 ? 'available' : 'insufficient',
      evidenceIds,
      limitations,
      result: {
        kind: 'memory-trend',
        samples: returnedSamples.map(sample => ({
          timestampUs: sample.timestampUs,
          metric: 'js-heap-used',
          bytes: sample.bytes,
          evidenceIds: [`trace:event:${sample.sourceIndex}`],
        })),
        gcEvents,
        summary: {
          gcCount: matchingGc.count,
          totalPauseUs: matchingGc.totalDurationUs,
          maxPauseUs: matchingGc.maxDurationUs,
        },
      },
    };
  }

  queryGpuRaster(
    range: { startUs: number; endUs: number },
  ): AdvancedResult<GpuRasterAnalysisDto> {
    const summary = this.released
      ? {
          events: [] as GpuRasterFact[],
          count: 0,
          totalDurationUs: 0,
          maxDurationUs: 0,
        }
      : this.summarizeIntersectingEvents(
          this.gpuRasterEvents,
          this.gpuRasterStarts,
          this.gpuRasterPrefixMaxEnds,
          range,
        );
    const returnedFacts = summary.events;
    const incompleteFacts = this.incompleteEventsInRange(
      this.incompleteGpuRasterEvents,
      this.incompleteGpuRasterTimestamps,
      range,
    );
    if (returnedFacts.length === 0) {
      return {
        status: incompleteFacts.count > 0 ? 'insufficient' : 'unavailable',
        evidenceIds: incompleteFacts.events.map(
          fact => `trace:event:${fact.sourceIndex}`,
        ),
        limitations: [
          this.released
            ? '高级分析存储已释放。'
            : incompleteFacts.count > 0
              ? `${incompleteFacts.count} 个 GPU/Raster 事件缺少明确持续时间，未计入区间统计。`
              : '当前范围没有明确的 GPU 或 RasterTask 事件，能力不可用。',
          GPU_RASTER_SCOPE_LIMITATION,
          ...(incompleteFacts.count > incompleteFacts.events.length
            ? [
                `证据引用已按 ${MAX_ADVANCED_RESULTS} 项上限截断；`
                + '请缩小时间范围继续检查。',
              ]
            : []),
        ],
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
      };
    }
    const durations = returnedFacts.map(
      fact => Math.max(0, fact.endUs - fact.startUs),
    );
    const evidenceSourceIndexes = [
      ...returnedFacts.map(fact => fact.sourceIndex),
      ...incompleteFacts.events.map(fact => fact.sourceIndex),
    ].sort((left, right) => left - right);
    const evidenceIds = evidenceSourceIndexes
      .slice(0, MAX_ADVANCED_RESULTS)
      .map(sourceIndex => `trace:event:${sourceIndex}`);
    return {
      status: 'available',
      evidenceIds,
      limitations: [
        GPU_RASTER_SOURCE_LIMITATION,
        GPU_RASTER_SCOPE_LIMITATION,
        ...(incompleteFacts.count > 0
          ? [
              `${incompleteFacts.count} 个 GPU/Raster 事件缺少明确持续时间，`
              + '未计入区间统计。',
            ]
          : []),
        ...(evidenceSourceIndexes.length > evidenceIds.length
          ? [
              `证据引用已按 ${MAX_ADVANCED_RESULTS} 项上限截断；`
              + '请缩小时间范围继续检查。',
            ]
          : []),
        ...(summary.count > returnedFacts.length
          ? [
              `结果已按 ${MAX_ADVANCED_RESULTS} 个 GPU/Raster 区间上限截断；`
              + '请缩小时间范围继续检查。',
            ]
          : []),
      ],
      result: {
        kind: 'gpu-raster',
        intervals: returnedFacts.map((fact, index) => ({
          eventId: `trace:gpu-raster:${fact.sourceIndex}`,
          activity: fact.activity,
          startUs: fact.startUs,
          durationUs: durations[index],
          evidenceIds: [`trace:event:${fact.sourceIndex}`],
        })),
        summary: {
          intervalCount: summary.count,
          gpuIntervalCount: this.countIntersectingActivity(range, 'gpu'),
          rasterIntervalCount: this.countIntersectingActivity(range, 'raster'),
          totalDurationUs: summary.totalDurationUs,
          maxDurationUs: summary.maxDurationUs,
        },
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
    const eventIds = new Array<string>(events.length);
    const startUs = new Float64Array(events.length);
    const endUs = new Float64Array(events.length);
    const prefixMaxEndUs = new Float64Array(events.length);
    let maximum = Number.NEGATIVE_INFINITY;
    events.forEach((event, index) => {
      sourceIndexes[index] = event.sourceIndex;
      eventIds[index] = event.eventId ?? `trace:timeline:${event.sourceIndex}`;
      startUs[index] = event.startUs;
      endUs[index] = event.endUs;
      maximum = Math.max(maximum, event.endUs);
      prefixMaxEndUs[index] = maximum;
    });
    return { sourceIndexes, eventIds, startUs, endUs, prefixMaxEndUs };
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
        ids.push(index.eventIds[offset]);
      }
    }
    return ids;
  }

  private boundedOverlappingEventIds(
    index: ContextIndex,
    range: ContextEvent,
    limit: number,
  ): { ids: string[]; truncated: boolean } {
    const first = lowerBound(index.prefixMaxEndUs, range.startUs);
    const end = upperBound(index.startUs, range.endUs);
    const ids: string[] = [];
    let truncated = false;
    for (let offset = first; offset < end; offset += 1) {
      if (index.endUs[offset] < range.startUs) continue;
      if (ids.length < limit) ids.push(index.eventIds[offset]);
      else truncated = true;
    }
    return { ids, truncated };
  }

  private incompleteEventsInRange(
    events: IncompleteEventFact[],
    timestamps: number[],
    range: { startUs: number; endUs: number },
  ): { events: IncompleteEventFact[]; count: number } {
    const first = lowerBound(timestamps, range.startUs);
    const end = upperBound(timestamps, range.endUs);
    return {
      events: events.slice(first, Math.min(end, first + MAX_ADVANCED_RESULTS)),
      count: Math.max(0, end - first),
    };
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

  private summarizeIntersectingEvents<T extends ContextEvent>(
    events: T[],
    starts: number[],
    prefixMaxEnds: number[],
    range: { startUs: number; endUs: number },
  ): {
    events: T[];
    count: number;
    totalDurationUs: number;
    maxDurationUs: number;
  } {
    const first = lowerBound(prefixMaxEnds, range.startUs);
    const end = upperBound(starts, range.endUs);
    const result: T[] = [];
    let count = 0;
    let totalDurationUs = 0;
    let maxDurationUs = 0;
    for (let index = first; index < end; index += 1) {
      const event = events[index];
      if (event.endUs < range.startUs) continue;
      const durationUs = Math.max(0, event.endUs - event.startUs);
      count += 1;
      totalDurationUs += durationUs;
      maxDurationUs = Math.max(maxDurationUs, durationUs);
      if (result.length < MAX_ADVANCED_RESULTS) result.push(event);
    }
    return { events: result, count, totalDurationUs, maxDurationUs };
  }

  private countIntersectingActivity(
    range: { startUs: number; endUs: number },
    activity: GpuRasterFact['activity'],
  ): number {
    const first = lowerBound(this.gpuRasterPrefixMaxEnds, range.startUs);
    const end = upperBound(this.gpuRasterStarts, range.endUs);
    let count = 0;
    for (let index = first; index < end; index += 1) {
      const event = this.gpuRasterEvents[index];
      if (event.endUs >= range.startUs && event.activity === activity) count += 1;
    }
    return count;
  }

  release(): void {
    this.layoutShifts = [];
    this.animations = [];
    this.animationStarts = [];
    this.animationPrefixMaxEnds = [];
    this.memorySamples = [];
    this.memorySampleTimestamps = [];
    this.gcEvents = [];
    this.incompleteGcEvents = [];
    this.incompleteGcTimestamps = [];
    this.gcStarts = [];
    this.gcPrefixMaxEnds = [];
    this.gpuRasterEvents = [];
    this.incompleteGpuRasterEvents = [];
    this.incompleteGpuRasterTimestamps = [];
    this.gpuRasterStarts = [];
    this.gpuRasterPrefixMaxEnds = [];
    this.frames = this.buildContextIndex([]);
    this.rendering = this.buildContextIndex([]);
    this.interactions = this.buildContextIndex([]);
    this.longTasks = this.buildContextIndex([]);
    this.released = true;
  }
}
