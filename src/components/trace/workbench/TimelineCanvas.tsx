import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { WorkbenchTimelineEventDto } from '../../../workbench/protocol';
import {
  hitTestTimelineEvent,
  panTimelineRange,
  timeToX,
  xToTime,
  zoomTimelineRange,
} from '../../../workbench/timelineGeometry';
import type {
  TimelineInteractionStore,
  TimelineRange,
} from '../../../workbench/timelineInteractionStore';
import {
  TIMELINE_TRACKS,
  type TimelineTrackDefinition,
} from '../../../workbench/timelineTracks';

interface TimelineCanvasProps {
  events: WorkbenchTimelineEventDto[];
  store: TimelineInteractionStore;
  tracks?: TimelineTrackDefinition[];
  displayedViewport?: TimelineRange;
  onOpenDetail(eventId: string): void;
  onEscape(): void;
}

const LABEL_WIDTH = 112;
const OVERVIEW_HEIGHT = 48;
const TRACK_HEIGHT = 46;
const EVENT_LANE_HEIGHT = 10;
const MAX_EVENT_LANES = 3;

function eventLabel(event: WorkbenchTimelineEventDto): string {
  const status = event.status ? `，状态 ${event.status}` : '';
  return `${event.name}，开始 ${(event.startUs / 1_000).toFixed(2)} 毫秒，持续 ${(event.durationUs / 1_000).toFixed(2)} 毫秒${status}`;
}

const TimelineCanvas: React.FC<TimelineCanvasProps> = ({
  events,
  store,
  tracks = TIMELINE_TRACKS,
  displayedViewport,
  onOpenDetail,
  onEscape,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStartUs = useRef<number | null>(null);
  const dragStartX = useRef<number | null>(null);
  const [renderRevision, setRenderRevision] = useState(0);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const renderedViewport = displayedViewport ?? snapshot.viewport;
  const activeTracks = useMemo(() => tracks
    .filter(track => (
      !snapshot.collapsedTrackIds.includes(track.id)
      && !snapshot.hiddenTrackIds.includes(track.id)
    ))
    .sort((left, right) => (
      Number(snapshot.pinnedTrackIds.includes(right.id))
      - Number(snapshot.pinnedTrackIds.includes(left.id))
    )), [
    snapshot.collapsedTrackIds,
    snapshot.hiddenTrackIds,
    snapshot.pinnedTrackIds,
    tracks,
  ]);
  const activeTrackIds = useMemo(
    () => new Set(activeTracks.map(track => track.id)),
    [activeTracks],
  );
  const orderedEvents = useMemo(() => events
    .filter(event => activeTrackIds.has(event.trackId as TimelineTrackDefinition['id']))
    .sort((left, right) => (
      left.startUs - right.startUs || left.id.localeCompare(right.id)
    )), [activeTrackIds, events]);
  const selectedIndex = orderedEvents.findIndex(
    event => event.id === snapshot.selectedEventId,
  );
  const accessibleEvents = selectedIndex < 0
    ? orderedEvents.slice(0, 5)
    : orderedEvents.slice(Math.max(0, selectedIndex - 2), selectedIndex + 3);
  const eventLanes = useMemo(() => {
    const laneEnds = new Map<string, number[]>();
    const lanes = new Map<string, number>();
    for (const event of orderedEvents) {
      const ends = laneEnds.get(event.trackId) ?? [];
      let lane = ends.findIndex(endUs => endUs <= event.startUs);
      if (lane < 0) lane = Math.min(ends.length, MAX_EVENT_LANES - 1);
      ends[lane] = Math.max(
        ends[lane] ?? Number.NEGATIVE_INFINITY,
        event.startUs + event.durationUs,
      );
      laneEnds.set(event.trackId, ends);
      lanes.set(event.id, lane);
    }
    return lanes;
  }, [orderedEvents]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => setRenderRevision(revision => revision + 1);
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(redraw);
    observer?.observe(canvas);
    window.addEventListener('resize', redraw);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', redraw);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const cssWidth = Math.max(1, canvas.clientWidth || 900);
    const cssHeight = OVERVIEW_HEIGHT + activeTracks.length * TRACK_HEIGHT;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = getComputedStyle(canvas);
    const surface = styles.getPropertyValue('--timeline-surface').trim() || '#ffffff';
    const grid = styles.getPropertyValue('--timeline-grid').trim() || '#dce4ed';
    const ink = styles.getPropertyValue('--timeline-ink').trim() || '#152033';
    const selection = styles.getPropertyValue('--timeline-selection').trim() || '#1d5fc1';
    const trackColors = new Map(tracks.map(track => [
      track.id,
      styles.getPropertyValue(`--timeline-${track.id}`).trim() || '#6552a3',
    ]));
    const trackIndexes = new Map(activeTracks.map((track, index) => [track.id, index]));
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = surface;
    context.fillRect(0, 0, cssWidth, cssHeight);
    context.strokeStyle = grid;
    context.fillStyle = ink;
    context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (let tick = 0; tick <= 10; tick += 1) {
      const x = LABEL_WIDTH + (cssWidth - LABEL_WIDTH) * tick / 10;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, cssHeight);
      context.stroke();
    }

    const overviewWidth = Math.max(1, cssWidth - LABEL_WIDTH);
    context.fillText('CPU / NET', 12, 28);
    for (const [trackIndex, track] of activeTracks.entries()) {
      const y = OVERVIEW_HEIGHT + trackIndex * TRACK_HEIGHT;
      context.fillStyle = ink;
      context.fillText(track.label, 12, y + 27);
    }
    const decorations: Array<{
      event: WorkbenchTimelineEventDto;
      x: number;
      y: number;
      width: number;
    }> = [];
    let activeFillColor: string | undefined;
    const fillEventRect = (
      color: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => {
      if (activeFillColor !== color) {
        context.fillStyle = color;
        activeFillColor = color;
      }
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    };
    for (const event of orderedEvents) {
      const trackIndex = trackIndexes.get(
        event.trackId as TimelineTrackDefinition['id'],
      );
      if (trackIndex === undefined) continue;
      const rawStartX = LABEL_WIDTH + timeToX(event.startUs, renderedViewport, overviewWidth);
      const rawEndX = LABEL_WIDTH + timeToX(
        event.startUs + Math.max(event.durationUs, 1),
        renderedViewport,
        overviewWidth,
      );
      const startX = Math.max(LABEL_WIDTH, Math.min(cssWidth - 2, rawStartX));
      const endX = Math.max(startX + 2, Math.min(cssWidth, rawEndX));
      const width = endX - startX;
      const overviewY = event.trackId === 'network' ? 28 : 10;
      const color = trackColors.get(
        event.trackId as TimelineTrackDefinition['id'],
      ) ?? ink;
      if (event.trackId === 'network' || event.trackId === 'main') {
        fillEventRect(color, { x: startX, y: overviewY, width, height: 8 });
      }
      const y = OVERVIEW_HEIGHT + trackIndex * TRACK_HEIGHT;
      const lane = eventLanes.get(event.id) ?? 0;
      const eventY = y + 8 + lane * EVENT_LANE_HEIGHT;
      fillEventRect(color, { x: startX, y: eventY, width, height: 8 });
      if (
        event.status === 'warning'
        || event.status === 'error'
        || event.status === 'incomplete'
        || event.status === 'candidate'
        || event.id === snapshot.selectedEventId
      ) decorations.push({ event, x: startX, y: eventY, width });
    }
    for (const decoration of decorations) {
      const {
        event,
        x: startX,
        y: eventY,
        width,
      } = decoration;
      if (event.status === 'warning' || event.status === 'error') {
        context.strokeStyle = event.status === 'error'
          ? styles.getPropertyValue('--timeline-interactions').trim()
          : styles.getPropertyValue('--timeline-milestones').trim();
        context.lineWidth = 2;
        context.strokeRect(startX, eventY, width, 8);
      }
      const statusMarker = event.status === 'error'
        ? '×'
        : event.status === 'warning'
          ? '!'
          : event.status === 'incomplete'
            ? '…'
            : event.status === 'candidate'
              ? '◇'
              : undefined;
      if (statusMarker) {
        context.fillStyle = ink;
        context.fillText(statusMarker, startX + 2, eventY + 8);
      }
      if (event.id === snapshot.selectedEventId) {
        context.strokeStyle = selection;
        context.lineWidth = 3;
        context.strokeRect(startX - 1, eventY - 2, width + 2, 12);
      }
    }
    if (snapshot.selection) {
      const startX = LABEL_WIDTH + timeToX(
        snapshot.selection.startUs,
        renderedViewport,
        overviewWidth,
      );
      const endX = LABEL_WIDTH + timeToX(
        snapshot.selection.endUs,
        renderedViewport,
        overviewWidth,
      );
      context.fillStyle = `${selection}33`;
      context.fillRect(startX, 0, Math.max(1, endX - startX), cssHeight);
    }
    if (snapshot.cursorUs !== undefined) {
      const x = LABEL_WIDTH + timeToX(snapshot.cursorUs, renderedViewport, overviewWidth);
      context.strokeStyle = selection;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, cssHeight);
      context.stroke();
    }
  }, [activeTracks, eventLanes, orderedEvents, renderedViewport, renderRevision, snapshot, tracks]);

  const adjustViewport = (operation: 'zoom-in' | 'zoom-out' | 'left' | 'right') => {
    const range = snapshot.viewport;
    const duration = range.endUs - range.startUs;
    if (operation === 'zoom-in' || operation === 'zoom-out') {
      store.setViewport(zoomTimelineRange(
        range,
        range.startUs + duration / 2,
        operation === 'zoom-in' ? 0.7 : 1.4,
      ));
      return;
    }
    store.setViewport(panTimelineRange(
      range,
      duration * (operation === 'left' ? -0.2 : 0.2),
    ));
  };

  const pointerTarget = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const bounds = canvas.getBoundingClientRect();
    const contentWidth = Math.max(1, bounds.width - LABEL_WIDTH);
    const x = Math.max(0, clientX - bounds.left - LABEL_WIDTH);
    const y = clientY - bounds.top - OVERVIEW_HEIGHT;
    const trackOffsetY = y % TRACK_HEIGHT;
    const track = activeTracks[Math.floor(y / TRACK_HEIGHT)];
    if (!track) return undefined;
    const laneOffsetY = trackOffsetY - 8;
    const lane = laneOffsetY >= 0 && laneOffsetY < MAX_EVENT_LANES * EVENT_LANE_HEIGHT
      ? Math.floor(laneOffsetY / EVENT_LANE_HEIGHT)
      : undefined;
    return {
      timeUs: xToTime(x, renderedViewport, contentWidth),
      trackId: track.id,
      lane,
    };
  };

  const selectRelative = (delta: number, extendSelection: boolean) => {
    if (orderedEvents.length === 0) return;
    const current = Math.max(-1, selectedIndex);
    const next = orderedEvents[Math.max(0, Math.min(
      orderedEvents.length - 1,
      current + delta,
    ))];
    store.selectEvent(next.id);
    if (extendSelection) {
      const anchor = snapshot.selection?.startUs ?? next.startUs;
      store.setSelection({
        startUs: anchor,
        endUs: next.startUs + next.durationUs,
      });
    }
  };

  return (
    <section className="trace-timeline-viewport" aria-labelledby="trace-timeline-heading">
      <div className="trace-timeline-controls" role="toolbar" aria-label="时间轴视口控制">
        <h3 id="trace-timeline-heading">统一时间轴</h3>
        <button type="button" aria-label="放大时间轴" onClick={() => adjustViewport('zoom-in')}>＋</button>
        <button type="button" aria-label="缩小时间轴" onClick={() => adjustViewport('zoom-out')}>－</button>
        <button type="button" aria-label="向左平移" onClick={() => adjustViewport('left')}>←</button>
        <button type="button" aria-label="向右平移" onClick={() => adjustViewport('right')}>→</button>
      </div>
      <div className="trace-timeline-track-toggles" aria-label="轨道折叠控制">
        {tracks.map(track => (
          <span key={track.id}>
            <button
              type="button"
              aria-pressed={snapshot.pinnedTrackIds.includes(track.id)}
              aria-label={`${snapshot.pinnedTrackIds.includes(track.id) ? '取消固定' : '固定'} ${track.label}`}
              onClick={() => store.togglePinnedTrack(track.id)}
            >
              固定
            </button>
            <button
              type="button"
              aria-pressed={snapshot.hiddenTrackIds.includes(track.id)}
              aria-label={`${snapshot.hiddenTrackIds.includes(track.id) ? '显示' : '隐藏'} ${track.label}`}
              onClick={() => store.toggleHiddenTrack(track.id)}
            >
              {snapshot.hiddenTrackIds.includes(track.id) ? '显示' : '隐藏'}
            </button>
            <button
              type="button"
              aria-expanded={!snapshot.collapsedTrackIds.includes(track.id)}
              aria-label={`${snapshot.collapsedTrackIds.includes(track.id) ? '展开' : '折叠'} ${track.label}`}
              onClick={() => store.toggleTrack(track.id)}
            >
              {track.label}
            </button>
          </span>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="trace-timeline-canvas"
        role="application"
        tabIndex={0}
        aria-label="Timeline 画布。使用左右方向键移动事件，Shift 加方向键扩展选区，Enter 打开详情，Escape 返回。"
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            selectRelative(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
          } else if (event.key === 'Enter' && snapshot.selectedEventId) {
            onOpenDetail(snapshot.selectedEventId);
          } else if (event.key === 'Escape') {
            onEscape();
          }
        }}
        onMouseDown={event => {
          dragStartUs.current = pointerTarget(event.clientX, event.clientY)?.timeUs ?? null;
          dragStartX.current = event.clientX;
        }}
        onMouseMove={event => {
          const target = pointerTarget(event.clientX, event.clientY);
          if (!target || target.lane === undefined) {
            store.setHoveredEvent(undefined);
            return;
          }
          const match = hitTestTimelineEvent(
            orderedEvents.filter(candidate => eventLanes.get(candidate.id) === target.lane),
            target,
          );
          store.setHoveredEvent(match?.id);
        }}
        onMouseUp={event => {
          const target = pointerTarget(event.clientX, event.clientY);
          if (!target) return;
          const match = target.lane === undefined
            ? undefined
            : hitTestTimelineEvent(
                orderedEvents.filter(candidate => eventLanes.get(candidate.id) === target.lane),
                target,
              );
          const dragged = dragStartX.current !== null
            && Math.abs(event.clientX - dragStartX.current) > 3;
          if (dragged && dragStartUs.current !== null) {
            store.setSelection({ startUs: dragStartUs.current, endUs: target.timeUs });
          } else if (match) {
            onOpenDetail(match.id);
          }
          dragStartUs.current = null;
          dragStartX.current = null;
        }}
        onWheel={event => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const target = pointerTarget(event.clientX, event.clientY);
          const anchor = target?.timeUs
            ?? (snapshot.viewport.startUs + snapshot.viewport.endUs) / 2;
          store.setViewport(zoomTimelineRange(
            snapshot.viewport,
            anchor,
            event.deltaY > 0 ? 1.2 : 0.8,
          ));
        }}
      />
      <p className="trace-timeline-selection" aria-live="polite">
        {snapshot.selectedEventId
          ? `已选择 ${orderedEvents.find(event => event.id === snapshot.selectedEventId)?.name ?? '事件'}`
          : snapshot.hoveredEventId
            ? `当前悬浮 ${orderedEvents.find(event => event.id === snapshot.hoveredEventId)?.name ?? '事件'}`
            : '尚未选择事件'}
      </p>
      <ul className="trace-timeline-a11y-events" aria-label="当前事件及邻近事件">
        {accessibleEvents.map(event => (
          <li key={event.id}>
            <button type="button" onClick={() => store.selectEvent(event.id)}>
              {eventLabel(event)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default TimelineCanvas;
