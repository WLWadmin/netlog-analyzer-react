import type { WorkbenchCapability } from './protocol';

export type CoreTimelineTrackId =
  | 'layout-shifts'
  | 'animations'
  | 'gpu-raster'
  | 'milestones'
  | 'network'
  | 'main'
  | 'rendering'
  | 'interactions'
  | 'frames';

export type TimelineTrackId = CoreTimelineTrackId | `plugin:${string}`;

export interface TimelineTrackDefinition {
  id: TimelineTrackId;
  label: string;
  capability: WorkbenchCapability;
  description: string;
  matches(name: string, category: string): boolean;
  displayOrder?: number;
}

const MILESTONE_NAMES = /^(navigationStart|domContentLoadedEvent(?:Start|End)?|loadEvent(?:Start|End)?|firstContentfulPaint|largestContentfulPaint::Candidate|MarkDOMContent|MarkLoad|firstPaint)$/i;
const FRAME_NAMES = /(?:^|::)(?:AnimationFrame|BeginFrame|DrawFrame|DroppedFrame|CommitFrame|ActivateLayerTree)$/i;
const MAIN_NAMES = /(?:RunTask|ThreadControllerImpl::RunTask|FunctionCall|EvaluateScript|EventDispatch|TimerFire|FireAnimationFrame|Profile|GC|V8\.)/i;
const RENDERING_NAMES = /(?:Layout|UpdateLayoutTree|RecalculateStyles|Paint|Raster|Composite|PrePaint|HitTest|ForcedReflow)/i;
const NETWORK_NAMES = /(?:Resource|Request|Response|WebSocket)/i;
const INTERACTION_NAMES = /(?:EventTiming|Interaction)/i;

export class TimelineTrackRegistry {
  private readonly definitions: TimelineTrackDefinition[];

  constructor(definitions: TimelineTrackDefinition[]) {
    this.definitions = [];
    definitions.forEach(definition => this.register(definition));
  }

  register(definition: TimelineTrackDefinition): void {
    if (this.definitions.some(item => item.id === definition.id)) {
      throw new Error(`Timeline track ${definition.id} is already registered`);
    }
    this.definitions.push(definition);
  }

  list(): TimelineTrackDefinition[] {
    return [...this.definitions].sort((left, right) => (
      (left.displayOrder ?? 0) - (right.displayOrder ?? 0)
    ));
  }

  classify(name: string, category: string): TimelineTrackId | undefined {
    return this.definitions.find(definition => (
      definition.matches(name, category)
    ))?.id;
  }
}

export const TIMELINE_TRACK_REGISTRY = new TimelineTrackRegistry([
  {
    id: 'layout-shifts',
    label: 'Layout Shifts',
    capability: 'rendering',
    description: 'Trace 中含明确证据的布局偏移事件',
    matches: name => name === 'LayoutShift',
    displayOrder: 100,
  },
  {
    id: 'animations',
    label: 'Animations',
    capability: 'rendering',
    description: '含明确 Animation 或 CompositorAnimation 证据的动画事件',
    matches: name => (
      name === 'Animation'
      || name.startsWith('Animation::')
      || name === 'CompositorAnimation'
      || name.startsWith('CompositorAnimation::')
    ),
    displayOrder: 101,
  },
  {
    id: 'gpu-raster',
    label: 'GPU / Raster',
    capability: 'rendering',
    description: 'Trace 中含明确证据的 GPU 与 RasterTask 活动',
    matches: (name, category) => (
      name === 'RasterTask'
      || (
        (name === 'GPUTask' || name === 'GpuTask' || name === 'GPU::Task')
        && category.toLowerCase().includes('gpu')
      )
    ),
    displayOrder: 102,
  },
  {
    id: 'milestones',
    label: 'Milestones',
    capability: 'timeline-events',
    description: '导航、DOMContentLoaded、Load、FCP 与 LCP 标记',
    matches: name => MILESTONE_NAMES.test(name),
  },
  {
    id: 'network',
    label: 'Network',
    capability: 'network',
    description: 'Trace 录制窗口内的请求生命周期事件',
    matches: (name, category) => NETWORK_NAMES.test(name) || category === 'network',
  },
  {
    id: 'main',
    label: 'Main',
    capability: 'timeline-events',
    description: '主线程任务与脚本活动',
    matches: (name, category) => MAIN_NAMES.test(name) || category === 'cpu-profile',
  },
  {
    id: 'rendering',
    label: 'Rendering',
    capability: 'rendering',
    description: 'Style、Layout、Paint、Raster 与 Composite 活动',
    matches: (name, category) => (
      RENDERING_NAMES.test(name)
      || (category === 'rendering' && !FRAME_NAMES.test(name))
    ),
  },
  {
    id: 'interactions',
    label: 'Interactions',
    capability: 'interactions',
    description: 'Trace 内可配对的交互时间范围',
    matches: (name, category) => (
      INTERACTION_NAMES.test(name) || category === 'interaction'
    ),
  },
  {
    id: 'frames',
    label: 'Frames',
    capability: 'frames',
    description: '帧事件及 60Hz 参考预算提示',
    matches: name => FRAME_NAMES.test(name),
  },
]);

export const TIMELINE_TRACKS = TIMELINE_TRACK_REGISTRY.list();

export function isCoreTimelineTrackId(
  trackId: TimelineTrackId,
): trackId is CoreTimelineTrackId {
  return !trackId.startsWith('plugin:');
}

export function classifyTimelineTrack(
  name: string,
  category: string,
): CoreTimelineTrackId | undefined {
  if (name === 'Screenshot' || category === 'screenshot') return undefined;
  const classified = TIMELINE_TRACK_REGISTRY.classify(name, category);
  return classified && isCoreTimelineTrackId(classified)
    ? classified
    : undefined;
}

export function classifyCoreTimelineTrack(
  name: string,
  category: string,
): CoreTimelineTrackId | undefined {
  if (name === 'Screenshot' || category === 'screenshot') return undefined;
  if (MILESTONE_NAMES.test(name)) return 'milestones';
  if (INTERACTION_NAMES.test(name) || category === 'interaction') return 'interactions';
  if (FRAME_NAMES.test(name)) return 'frames';
  if (NETWORK_NAMES.test(name) || category === 'network') return 'network';
  if (RENDERING_NAMES.test(name) || category === 'rendering') return 'rendering';
  if (MAIN_NAMES.test(name) || category === 'cpu-profile') return 'main';
  return undefined;
}
