import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { HarRequestEntry } from '../../harParser';
import {
  getHarTimelineTicks, getHarWaterfallPosition, isHarTimelineEntryAvailable,
  type HarWaterfallRange, type HarWaterfallMarkerPosition,
} from '../../diagnosis/shared/harWaterfall';

interface Props {
  entries: HarRequestEntry[];
  fullRange: HarWaterfallRange;
  selection: HarWaterfallRange | null;
  markers: HarWaterfallMarkerPosition[];
  width: number;
  onChange: (range: HarWaterfallRange | null) => void;
}

export default function HarTimelineOverview({ entries, fullRange, selection, markers, width, onChange }: Props) {
  const overview = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number; mode: 'select' | 'pan' | 'left' | 'right'; start: number; end: number }>(undefined);
  const [preview, setPreview] = useState<[number, number] | null>(null);
  const selectedStart = selection ? (selection.minStart - fullRange.minStart) / fullRange.span : 0;
  const selectedEnd = selection ? (selection.maxEnd - fullRange.minStart) / fullRange.span : 1;
  const [left, right] = preview ?? [selectedStart, selectedEnd];
  const ticks = useMemo(() => getHarTimelineTicks(fullRange.span, width), [fullRange.span, width]);
  const unavailable = useMemo(() => entries.filter(entry => !isHarTimelineEntryAvailable(entry)).length, [entries]);

  useEffect(() => {
    drag.current = undefined;
    setPreview(null);
  }, [fullRange, width, selection]);

  useEffect(() => {
    const element = overview.current;
    if (!element || !fullRange.available) return;
    let currentRange = selection ?? fullRange;
    const zoom = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.har-timeline-track, .har-timeline-ticks')) return;
      if (drag.current || !Number.isFinite(event.deltaY) || event.deltaY === 0 || !event.cancelable) return;
      // React delegates wheel events passively. Listen here so zoom does not
      // also scroll the page, and normalize mouse/trackpad delta units.
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
      const factor = Math.exp(Math.max(-0.4, Math.min(0.4, delta * 0.002)));
      const span = Math.min(fullRange.span, Math.max(fullRange.span * 0.001, currentRange.span * factor));
      const centre = (currentRange.minStart + currentRange.maxEnd) / 2;
      const minStart = Math.max(fullRange.minStart, Math.min(fullRange.maxEnd - span, centre - span / 2));
      currentRange = { minStart, maxEnd: minStart + span, span, available: true };
      onChange(span === fullRange.span ? null : currentRange);
    };
    element.addEventListener('wheel', zoom, { passive: false });
    return () => element.removeEventListener('wheel', zoom);
  }, [fullRange, selection, onChange]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !fullRange.available) return;
    const context = element.getContext('2d');
    if (!context) return;
    const cssWidth = Math.max(1, width);
    const ratio = window.devicePixelRatio || 1;
    element.width = cssWidth * ratio;
    element.height = 64 * ratio;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, cssWidth, 64);
    // One canvas keeps overview DOM size constant even for large captures.
    entries.forEach(entry => {
      const position = getHarWaterfallPosition(entry, fullRange);
      if (!position.available) return;
      context.fillStyle = entry.isFailed ? 'rgba(220,80,80,0.55)' : 'rgba(91,145,190,0.40)';
      context.fillRect(position.leftPercent / 100 * cssWidth, (entry.id % 16) * 4,
        Math.max(1, position.widthPercent / 100 * cssWidth), 2);
    });
  }, [entries, fullRange, width]);

  const commit = (start: number, end: number) => {
    if (end - start < 0.001 || (start === 0 && end === 1)) { onChange(null); return; }
    const minStart = fullRange.minStart + start * fullRange.span;
    const maxEnd = fullRange.minStart + end * fullRange.span;
    onChange({ minStart, maxEnd, span: maxEnd - minStart, available: true });
  };
  const begin = (event: PointerEvent<HTMLElement>, mode: 'select' | 'pan' | 'left' | 'right') => {
    if (event.button !== 0 || drag.current) return;
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    event.preventDefault();
    event.stopPropagation();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    drag.current = { id: event.pointerId, x, width: bounds.width, mode, start: selectedStart, end: selectedEnd };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview(mode === 'select' ? [x, x] : [selectedStart, selectedEnd]);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / active.width));
    if (active.mode === 'select') setPreview([Math.min(x, active.x), Math.max(x, active.x)]);
    if (active.mode === 'left') setPreview([Math.min(x, active.end - 0.001), active.end]);
    if (active.mode === 'right') setPreview([active.start, Math.max(x, active.start + 0.001)]);
    if (active.mode === 'pan') {
      const delta = Math.max(-active.start, Math.min(1 - active.end, x - active.x));
      setPreview([active.start + delta, active.end + delta]);
    }
  };
  const finish = (event: PointerEvent<HTMLElement>, apply: boolean) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = undefined;
    if (apply && preview) commit(...preview);
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const events = {
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, true),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, false),
    onLostPointerCapture: () => { drag.current = undefined; setPreview(null); },
  };

  if (!fullRange.available) return <div className="har-timeline-note">缺少有效起点或总耗时，无法建立时间概览。</div>;
  return (
    <section ref={overview} className="har-timeline-overview" aria-label="请求时间概览">
      <div className="har-timeline-toolbar">
        <span>时间概览 · {Math.round(left * fullRange.span)}–{Math.round(right * fullRange.span)} ms</span>
        <button type="button" onClick={() => { drag.current = undefined; setPreview(null); onChange(null); }}>重置时间范围</button>
      </div>
      <div className="har-timeline-ticks" aria-hidden="true">
        {ticks.map(tick => <span key={tick} style={{ left: `${tick / fullRange.span * 100}%`, transform: tick === fullRange.span ? 'translateX(-100%)' : undefined }}>{Number(tick.toFixed(2))} ms</span>)}
      </div>
      <div ref={track} className="har-timeline-track" onPointerDown={event => begin(event, 'select')} {...events}>
        <canvas ref={canvas} aria-hidden="true" />
        {markers.map(marker => <span key={marker.key} className="har-timeline-marker" title={marker.label} style={{ left: `${marker.leftPercent}%`, background: marker.color }} />)}
        <div className="har-timeline-selection" style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
          role="group" aria-label="已选时间范围" tabIndex={0}
          onPointerDown={event => begin(event, selection ? 'pan' : 'select')}
          onKeyDown={event => {
            if (event.key === 'Escape') { drag.current = undefined; setPreview(null); onChange(null); }
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const delta = Math.max(-left, Math.min(1 - right, event.key === 'ArrowRight' ? 0.02 : -0.02));
            commit(left + delta, right + delta);
          }}>
          {(['left', 'right'] as const).map(side => (
            <span key={side} className={`har-timeline-handle is-${side}`} role="slider" tabIndex={0}
              aria-label={side === 'left' ? '时间范围起点' : '时间范围终点'}
              aria-valuemin={0} aria-valuemax={Math.round(fullRange.span)}
              aria-valuenow={Math.round((side === 'left' ? left : right) * fullRange.span)}
              onPointerDown={event => begin(event, side)}
              onKeyDown={event => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault(); event.stopPropagation();
                const delta = event.key === 'ArrowRight' ? 0.02 : -0.02;
                commit(side === 'left' ? Math.max(0, Math.min(right - 0.001, left + delta)) : left,
                  side === 'right' ? Math.min(1, Math.max(left + 0.001, right + delta)) : right);
              }} />
          ))}
        </div>
      </div>
      <div className="har-timeline-note">滚轮向上居中缩小范围，向下向左右扩大。拖选范围、拖动选区平移；两端可拖动或用方向键调整。{unavailable > 0 && ` ${unavailable} 条请求缺少有效起点或总耗时，启用时间筛选后不参与列表。`}</div>
    </section>
  );
}
