import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { WorkbenchFlameFrameDto } from '../../../workbench/protocol';
import { timeToX } from '../../../workbench/timelineGeometry';
import type { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';

interface FlameChartCanvasProps {
  frames: WorkbenchFlameFrameDto[];
  store: TimelineInteractionStore;
  onEscape?(): void;
}

const ROW_HEIGHT = 22;

const FlameChartCanvas: React.FC<FlameChartCanvasProps> = ({
  frames,
  store,
  onEscape,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [renderRevision, setRenderRevision] = useState(0);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const ordered = useMemo(() => [...frames].sort((left, right) => (
    left.startUs - right.startUs
    || left.depth - right.depth
    || left.id.localeCompare(right.id)
  )), [frames]);
  const accessible = selectedIndex < 0
    ? ordered.slice(0, 5)
    : ordered.slice(Math.max(0, selectedIndex - 2), selectedIndex + 3);

  useEffect(() => {
    setSelectedIndex(current => (
      current >= ordered.length ? Math.max(-1, ordered.length - 1) : current
    ));
  }, [ordered.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => setRenderRevision(value => value + 1);
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
    const width = Math.max(1, canvas.clientWidth || 900);
    const maxDepth = ordered.reduce((value, frame) => Math.max(value, frame.depth), 0);
    const height = Math.max(88, (maxDepth + 1) * ROW_HEIGHT);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = getComputedStyle(canvas);
    const surface = styles.getPropertyValue('--timeline-surface').trim() || '#ffffff';
    const ink = styles.getPropertyValue('--timeline-ink').trim() || '#152033';
    const evidence = styles.getPropertyValue('--timeline-rendering').trim() || '#6552a3';
    const selection = styles.getPropertyValue('--timeline-selection').trim() || '#1d5fc1';
    context.fillStyle = surface;
    context.fillRect(0, 0, width, height);
    context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (const frame of ordered) {
      const x = timeToX(frame.startUs, snapshot.viewport, width);
      const endX = timeToX(frame.startUs + frame.durationUs, snapshot.viewport, width);
      const frameWidth = Math.max(2, endX - x);
      const y = frame.depth * ROW_HEIGHT + 2;
      context.fillStyle = evidence;
      context.fillRect(x, y, frameWidth, ROW_HEIGHT - 4);
      if (frame.entityId === snapshot.highlightedEntityId) {
        context.strokeStyle = selection;
        context.lineWidth = 3;
        context.strokeRect(x, y, frameWidth, ROW_HEIGHT - 4);
      }
      if (frameWidth > 42) {
        context.fillStyle = ink;
        context.fillText(frame.functionName.slice(0, 32), x + 4, y + 14);
      }
    }
  }, [ordered, renderRevision, snapshot]);

  const activate = (index: number) => {
    const frame = ordered[index];
    if (!frame) return;
    setSelectedIndex(index);
    store.highlightEntity(frame.entityId);
    const sourceIndex = frame.evidenceIds
      .map(evidenceId => /^trace:event:(0|[1-9]\d*)$/.exec(evidenceId)?.[1])
      .find((value): value is string => value !== undefined);
    if (sourceIndex !== undefined) {
      store.selectEvent(`trace:timeline:${sourceIndex}`);
    }
    store.setCursor(frame.startUs);
    store.setSelection({
      startUs: frame.startUs,
      endUs: frame.startUs + frame.durationUs,
    });
  };

  return (
    <section className="trace-flame-chart" aria-labelledby="trace-flame-chart-heading">
      <h4 id="trace-flame-chart-heading">主线程 Flame Chart</h4>
      <canvas
        ref={canvasRef}
        className="trace-flame-chart-canvas"
        role="application"
        tabIndex={0}
        aria-label="Flame Chart。使用左右方向键选择帧，Enter 定位，Escape 返回。"
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const next = Math.max(0, Math.min(
              ordered.length - 1,
              (selectedIndex < 0 ? -1 : selectedIndex)
                + (event.key === 'ArrowLeft' ? -1 : 1),
            ));
            setSelectedIndex(next);
          } else if (event.key === 'Enter') {
            activate(selectedIndex < 0 ? 0 : selectedIndex);
          } else if (event.key === 'Escape') {
            onEscape?.();
          }
        }}
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const timeUs = snapshot.viewport.startUs
            + (event.clientX - bounds.left) / Math.max(1, bounds.width)
              * (snapshot.viewport.endUs - snapshot.viewport.startUs);
          const depth = Math.max(0, Math.floor(
            (event.clientY - bounds.top) / ROW_HEIGHT,
          ));
          const match = ordered.findIndex(frame => (
            frame.depth === depth
            &&
            timeUs >= frame.startUs
            && timeUs <= frame.startUs + frame.durationUs
          ));
          if (match >= 0) activate(match);
        }}
      />
      <ul className="trace-flame-a11y-frames" aria-label="当前调用帧及邻近项">
        {accessible.map(frame => (
          <li key={frame.id}>
            <button type="button" onClick={() => activate(ordered.indexOf(frame))}>
              {frame.functionName}，采样命中 {frame.sampleHits} 次，
              持续 {(frame.durationUs / 1_000).toFixed(2)} 毫秒
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default FlameChartCanvas;
