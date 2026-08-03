import type {
  TraceAnimationFrameFacts,
  TraceContextFacts,
  TraceCpuHotspot,
  TraceCpuProfileFacts,
  TraceForcedReflowClue,
  TraceRenderingEventFacts,
  TraceRequestFacts,
  TraceTaskFacts,
} from '../../parsers/trace/types';

export const TRACE_PRIORITY_LIMIT = 5;
export const TRACE_EXPERT_PAGE_SIZE = 25;
export type TraceEvidenceCategory = '网络' | '主线程 / CPU' | '渲染' | '其他';

const NETWORK_RESULT_PRIORITY: Record<TraceRequestFacts['result'], number> = {
  'transport-failed': 6,
  'http-error': 5,
  cancelled: 4,
  'incomplete-at-trace-end': 3,
  'unknown-failure': 2,
  success: 0,
};

export type MainThreadPriorityItem =
  | { kind: 'task'; item: TraceTaskFacts }
  | { kind: 'hotspot'; item: TraceCpuHotspot }
  | { kind: 'profile'; item: TraceCpuProfileFacts };

export type RenderingPriorityItem =
  | { kind: 'frame'; item: TraceAnimationFrameFacts }
  | { kind: 'event'; item: TraceRenderingEventFacts }
  | { kind: 'reflow'; item: TraceForcedReflowClue };

function compareNumberDescending(left: number | undefined, right: number | undefined): number {
  return (right ?? Number.NEGATIVE_INFINITY) - (left ?? Number.NEGATIVE_INFINITY);
}

function pinWithinLimit<T extends { id: string }>(
  items: T[],
  targetId?: string,
  limit = TRACE_PRIORITY_LIMIT,
  targetPool: T[] = items,
): T[] {
  if (!targetId) return items.slice(0, limit);
  const target = targetPool.find(item => item.id === targetId);
  if (!target) return items.slice(0, limit);
  return [target, ...items.filter(item => item.id !== targetId)].slice(0, limit);
}

export interface NetworkFactsViewModel {
  counts: {
    total: number;
    success: number;
    httpError: number;
    transportFailed: number;
    cancelled: number;
    incomplete: number;
    unknownFailure: number;
  };
  failureCount: number;
  dispatchOverlapCount: number;
  slowestRequest?: TraceRequestFacts;
  priority: TraceRequestFacts[];
  all: TraceRequestFacts[];
  limitationMessages: string[];
}

export function buildNetworkFactsViewModel(
  context: TraceContextFacts,
  targetId?: string,
): NetworkFactsViewModel {
  const requests = context.requests ?? [];
  const counts: NetworkFactsViewModel['counts'] = {
    total: requests.length,
    success: 0,
    httpError: 0,
    transportFailed: 0,
    cancelled: 0,
    incomplete: 0,
    unknownFailure: 0,
  };
  requests.forEach(item => {
    if (item.result === 'success') counts.success += 1;
    else if (item.result === 'http-error') counts.httpError += 1;
    else if (item.result === 'transport-failed') counts.transportFailed += 1;
    else if (item.result === 'cancelled') counts.cancelled += 1;
    else if (item.result === 'incomplete-at-trace-end') counts.incomplete += 1;
    else counts.unknownFailure += 1;
  });

  const sorted = [...requests].sort((left, right) => (
    NETWORK_RESULT_PRIORITY[right.result] - NETWORK_RESULT_PRIORITY[left.result]
    || compareNumberDescending(left.timing.trace.durationMs, right.timing.trace.durationMs)
    || left.timing.trace.startUs - right.timing.trace.startUs
    || left.id.localeCompare(right.id)
  ));
  const abnormal = sorted.filter(item => (
    item.result !== 'success'
    || (item.dispatch?.mainThreadOverlapMs ?? 0) > 0
    || item.timing.trace.durationMs !== undefined
  ));
  const factCount = context.factCounts?.requests;
  const limitationMessages = [
    ...(factCount?.truncated
      ? [`请求事实仅返回 ${factCount.returned} / ${factCount.total} 条，统计不代表完整录制。`]
      : []),
    ...(context.quality.captureWindow !== 'available'
      ? ['采集窗口不完整，Trace 结束时未完成的请求只能描述录制内现象。']
      : []),
  ];

  return {
    counts,
    failureCount: requests.length - counts.success,
    dispatchOverlapCount: requests.filter(
      item => (item.dispatch?.mainThreadOverlapMs ?? 0) > 0,
    ).length,
    slowestRequest: [...requests].sort((left, right) => (
      compareNumberDescending(left.timing.trace.durationMs, right.timing.trace.durationMs)
      || left.timing.trace.startUs - right.timing.trace.startUs
      || left.id.localeCompare(right.id)
    ))[0],
    priority: pinWithinLimit(abnormal, targetId, TRACE_PRIORITY_LIMIT, requests),
    all: requests,
    limitationMessages,
  };
}

export interface MainThreadFactsViewModel {
  summary: {
    longTaskCount: number;
    totalBlockingContributionMs: number;
    longestTaskMs?: number;
    primaryHotspot?: TraceCpuHotspot;
    profileCapability: 'available' | 'missing';
  };
  priorityTasks: TraceTaskFacts[];
  priorityHotspots: TraceCpuHotspot[];
  priority: MainThreadPriorityItem[];
  allTasks: TraceTaskFacts[];
  allHotspots: TraceCpuHotspot[];
  profiles: NonNullable<TraceContextFacts['profiles']>;
  targetProfile?: NonNullable<TraceContextFacts['profiles']>[number];
  capabilityMessage: string;
  limitationMessages: string[];
}

export function buildMainThreadFactsViewModel(
  context: TraceContextFacts,
  targetId?: string,
): MainThreadFactsViewModel {
  const tasks = context.tasks ?? [];
  const hotspots = context.cpuHotspots ?? [];
  const profiles = context.profiles ?? [];
  const sortedTasks = [...tasks].sort((left, right) => (
    compareNumberDescending(left.durationMs, right.durationMs)
    || compareNumberDescending(left.blockingContributionMs, right.blockingContributionMs)
    || left.startUs - right.startUs
    || left.id.localeCompare(right.id)
  ));
  const sortedHotspots = [...hotspots].sort((left, right) => (
    compareNumberDescending(left.sampleTimeMs, right.sampleTimeMs)
    || compareNumberDescending(left.sampleCount, right.sampleCount)
    || left.functionName.localeCompare(right.functionName)
    || left.id.localeCompare(right.id)
  ));
  const targetIsTask = tasks.some(item => item.id === targetId);
  const targetIsHotspot = hotspots.some(item => item.id === targetId);
  const targetProfile = profiles.find(item => item.id === targetId);
  const priorityTasks = pinWithinLimit(sortedTasks, targetIsTask ? targetId : undefined);
  const priorityHotspots = pinWithinLimit(
    sortedHotspots,
    targetIsHotspot ? targetId : undefined,
  );
  const taskLimit = priorityHotspots.length > 0 ? 3 : TRACE_PRIORITY_LIMIT;
  const priority: MainThreadPriorityItem[] = priorityTasks
    .slice(0, taskLimit)
    .map(item => ({ kind: 'task', item }));
  priorityHotspots
    .slice(0, TRACE_PRIORITY_LIMIT - priority.length)
    .forEach(item => priority.push({ kind: 'hotspot', item }));
  priorityTasks
    .slice(taskLimit, taskLimit + TRACE_PRIORITY_LIMIT - priority.length)
    .forEach(item => priority.push({ kind: 'task', item }));
  if (targetProfile) {
    priority.unshift({ kind: 'profile', item: targetProfile });
    priority.splice(TRACE_PRIORITY_LIMIT);
  }
  const limitationMessages = [
    ...(context.factCounts?.tasks.truncated ? ['长任务事实已截断，阻塞贡献为已返回事实的合计。'] : []),
    ...(context.factCounts?.cpuHotspots.truncated ? ['CPU 热点事实已截断，热点排名可能不完整。'] : []),
  ];

  return {
    summary: {
      longTaskCount: tasks.length,
      totalBlockingContributionMs: tasks.reduce(
        (total, item) => total + item.blockingContributionMs,
        0,
      ),
      longestTaskMs: sortedTasks[0]?.durationMs,
      primaryHotspot: sortedHotspots[0],
      profileCapability: profiles.length > 0 ? 'available' : 'missing',
    },
    priorityTasks,
    priorityHotspots,
    priority,
    allTasks: tasks,
    allHotspots: hotspots,
    profiles,
    targetProfile,
    capabilityMessage: profiles.length > 0
      ? `已取得 ${profiles.length} 组 CPU Profile，可用于采样热点复核。`
      : '缺少 CPU Profile，无法进行采样热点归因；这表示能力缺失，不代表主线程状态正常。',
    limitationMessages,
  };
}

export interface RenderingFactsViewModel {
  summary: {
    totalFrameCount: number;
    overBudgetCount: number;
    droppedCount: number;
    overBudgetRatio?: number;
    longestRenderingEvent?: TraceRenderingEventFacts;
    forcedReflowClueCount: number;
    explicitReflowClueCount: number;
  };
  priorityFrames: TraceAnimationFrameFacts[];
  priorityRenderingEvents: TraceRenderingEventFacts[];
  priorityReflowClues: TraceForcedReflowClue[];
  priority: RenderingPriorityItem[];
  allFrames: TraceAnimationFrameFacts[];
  allRenderingEvents: TraceRenderingEventFacts[];
  allReflowClues: TraceForcedReflowClue[];
  budgetNote: string;
  limitationMessages: string[];
}

export function buildRenderingFactsViewModel(
  context: TraceContextFacts,
  targetId?: string,
): RenderingFactsViewModel {
  const frames = context.animationFrames ?? [];
  const renderingEvents = context.rendering ?? [];
  const reflowClues = context.forcedReflowClues ?? [];
  const summary = context.animationFrameSummary;
  const abnormalFrames = frames
    .filter(item => item.dropped || item.overBudget)
    .sort((left, right) => (
      Number(right.dropped) - Number(left.dropped)
      || compareNumberDescending(left.durationMs, right.durationMs)
      || left.startUs - right.startUs
      || left.id.localeCompare(right.id)
    ));
  const sortedRenderingEvents = [...renderingEvents].sort((left, right) => (
    compareNumberDescending(left.durationMs, right.durationMs)
    || left.startUs - right.startUs
    || left.id.localeCompare(right.id)
  ));
  const sortedReflowClues = [...reflowClues].sort((left, right) => (
    Number(right.confidence === 'explicit') - Number(left.confidence === 'explicit')
    || left.startUs - right.startUs
    || left.id.localeCompare(right.id)
  ));
  const priorityFrames = pinWithinLimit(
    abnormalFrames,
    frames.some(item => item.id === targetId) ? targetId : undefined,
    TRACE_PRIORITY_LIMIT,
    frames,
  );
  const priorityRenderingEvents = pinWithinLimit(
    sortedRenderingEvents,
    renderingEvents.some(item => item.id === targetId) ? targetId : undefined,
  );
  const priorityReflowClues = pinWithinLimit(
    sortedReflowClues,
    reflowClues.some(item => item.id === targetId) ? targetId : undefined,
  );
  const priority: RenderingPriorityItem[] = [];
  priorityFrames.slice(0, 2).forEach(item => priority.push({ kind: 'frame', item }));
  priorityReflowClues.slice(0, 2).forEach(item => priority.push({ kind: 'reflow', item }));
  priorityRenderingEvents
    .slice(0, TRACE_PRIORITY_LIMIT - priority.length)
    .forEach(item => priority.push({ kind: 'event', item }));
  priorityFrames
    .slice(2, 2 + TRACE_PRIORITY_LIMIT - priority.length)
    .forEach(item => priority.push({ kind: 'frame', item }));

  return {
    summary: {
      totalFrameCount: summary?.totalCount ?? frames.length,
      overBudgetCount: summary?.overBudgetCount
        ?? frames.filter(item => item.overBudget).length,
      droppedCount: summary?.droppedCount
        ?? frames.filter(item => item.dropped).length,
      overBudgetRatio: (summary?.totalCount ?? frames.length) > 0
        ? (summary?.overBudgetCount ?? frames.filter(item => item.overBudget).length)
          / (summary?.totalCount ?? frames.length)
        : undefined,
      longestRenderingEvent: sortedRenderingEvents[0],
      forcedReflowClueCount: reflowClues.length,
      explicitReflowClueCount: reflowClues.filter(item => item.confidence === 'explicit').length,
    },
    priorityFrames,
    priorityRenderingEvents,
    priorityReflowClues,
    priority,
    allFrames: frames,
    allRenderingEvents: renderingEvents,
    allReflowClues: reflowClues,
    budgetNote: '16.7 ms 仅作为 60 Hz 参考预算；Trace 未提供实际刷新率时不能据此确定丢帧原因。',
    limitationMessages: [
      ...(summary?.limitations ?? []),
      ...(context.factCounts?.animationFrames.truncated ? ['帧事实已截断，比例仅基于可用汇总。'] : []),
      ...(context.factCounts?.rendering.truncated ? ['渲染事件已截断，最长事件排名可能不完整。'] : []),
      ...(context.factCounts?.forcedReflowClues.truncated
        ? ['Forced reflow 线索已截断，弱线索仍需结合任务与事件复核。']
        : []),
    ],
  };
}

export interface EvidenceFactsViewModel {
  categoryByEvidenceId: Map<string, string>;
  counts: Record<TraceEvidenceCategory, number>;
  availableCount: number;
  totalCount: number;
  truncated: boolean;
}

export function buildEvidenceFactsViewModel(
  context: TraceContextFacts,
): EvidenceFactsViewModel {
  const networkIds = new Set<string>();
  const mainThreadIds = new Set<string>();
  const renderingIds = new Set<string>();
  context.requests?.forEach(item => {
    item.evidenceIds.forEach(id => networkIds.add(id));
    item.initiatorEvidenceIds.forEach(id => networkIds.add(id));
  });
  context.tasks?.forEach(item => item.evidenceIds.forEach(id => mainThreadIds.add(id)));
  context.profiles?.forEach(item => item.evidenceIds.forEach(id => mainThreadIds.add(id)));
  context.cpuHotspots?.forEach(item => item.evidenceIds.forEach(id => mainThreadIds.add(id)));
  context.animationFrames?.forEach(item => item.evidenceIds.forEach(id => renderingIds.add(id)));
  context.rendering?.forEach(item => item.evidenceIds.forEach(id => renderingIds.add(id)));
  context.forcedReflowClues?.forEach(item => item.evidenceIds.forEach(id => renderingIds.add(id)));

  const counts: EvidenceFactsViewModel['counts'] = {
    网络: 0,
    '主线程 / CPU': 0,
    渲染: 0,
    其他: 0,
  };
  const categoryByEvidenceId = new Map<string, string>();
  context.evidence.forEach(item => {
    const categories: TraceEvidenceCategory[] = [];
    if (networkIds.has(item.evidenceId)) categories.push('网络');
    if (mainThreadIds.has(item.evidenceId)) categories.push('主线程 / CPU');
    if (renderingIds.has(item.evidenceId)) categories.push('渲染');
    if (categories.length === 0) categories.push('其他');
    categoryByEvidenceId.set(item.evidenceId, categories.join(' / '));
    categories.forEach(category => { counts[category] += 1; });
  });
  const totalCount = Math.max(context.evidenceTotalCount, context.evidence.length);
  return {
    categoryByEvidenceId,
    counts,
    availableCount: context.evidence.length,
    totalCount,
    truncated: totalCount > context.evidence.length,
  };
}
