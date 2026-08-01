import type { WorkbenchCapability } from './protocol';

export type TimelineTrackId =
  | 'milestones'
  | 'network'
  | 'main'
  | 'rendering'
  | 'interactions'
  | 'frames';

export interface TimelineTrackDefinition {
  id: TimelineTrackId;
  label: string;
  capability: WorkbenchCapability;
  description: string;
}

export const TIMELINE_TRACKS: TimelineTrackDefinition[] = [
  {
    id: 'milestones',
    label: 'Milestones',
    capability: 'timeline-events',
    description: '导航、DOMContentLoaded、Load、FCP 与 LCP 标记',
  },
  {
    id: 'network',
    label: 'Network',
    capability: 'network',
    description: 'Trace 录制窗口内的请求生命周期事件',
  },
  {
    id: 'main',
    label: 'Main',
    capability: 'timeline-events',
    description: '主线程任务与脚本活动',
  },
  {
    id: 'rendering',
    label: 'Rendering',
    capability: 'rendering',
    description: 'Style、Layout、Paint、Raster 与 Composite 活动',
  },
  {
    id: 'interactions',
    label: 'Interactions',
    capability: 'interactions',
    description: 'Trace 内可配对的交互时间范围',
  },
  {
    id: 'frames',
    label: 'Frames',
    capability: 'frames',
    description: '帧事件及 60Hz 参考预算提示',
  },
];

const MILESTONE_NAMES = /^(navigationStart|domContentLoadedEvent(?:Start|End)?|loadEvent(?:Start|End)?|firstContentfulPaint|largestContentfulPaint::Candidate|MarkDOMContent|MarkLoad|firstPaint)$/i;
const FRAME_NAMES = /(?:^|::)(?:AnimationFrame|BeginFrame|DrawFrame|DroppedFrame|CommitFrame|ActivateLayerTree)$/i;
const MAIN_NAMES = /(?:RunTask|ThreadControllerImpl::RunTask|FunctionCall|EvaluateScript|EventDispatch|TimerFire|FireAnimationFrame|Profile|GC|V8\.)/i;
const RENDERING_NAMES = /(?:Layout|UpdateLayoutTree|RecalculateStyles|Paint|Raster|Composite|PrePaint|HitTest|ForcedReflow)/i;
const NETWORK_NAMES = /(?:Resource|Request|Response|WebSocket)/i;
const INTERACTION_NAMES = /(?:EventTiming|Interaction)/i;

export function classifyTimelineTrack(
  name: string,
  category: string,
): TimelineTrackId | undefined {
  if (name === 'Screenshot' || category === 'screenshot') return undefined;
  if (MILESTONE_NAMES.test(name)) return 'milestones';
  if (INTERACTION_NAMES.test(name) || category === 'interaction') return 'interactions';
  if (FRAME_NAMES.test(name)) return 'frames';
  if (NETWORK_NAMES.test(name) || category === 'network') return 'network';
  if (RENDERING_NAMES.test(name) || category === 'rendering') return 'rendering';
  if (MAIN_NAMES.test(name) || category === 'cpu-profile') return 'main';
  return undefined;
}
