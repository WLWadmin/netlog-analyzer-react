import { useEffect, useRef, useState, type ThHTMLAttributes, type PointerEvent } from 'react';

interface ResizableHarHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  columnWidth?: number;
  minimumWidth?: number;
  maximumWidth?: number;
  columnLabel?: string;
  onColumnResize?: (width: number) => void;
}

export default function ResizableHarHeaderCell({
  columnWidth,
  minimumWidth = 80,
  maximumWidth = Infinity,
  columnLabel,
  onColumnResize,
  children,
  className,
  ...cellProps
}: ResizableHarHeaderCellProps) {
  const drag = useRef<{ pointerId: number; startX: number; width: number; nextWidth: number; appliedWidth: number; minimum: number; maximum: number }>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const resizable = columnWidth !== undefined && onColumnResize !== undefined;

  const cancelFrame = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  };

  useEffect(() => {
    // Live updates from this drag retain capture; external layout changes cancel it.
    const active = drag.current;
    if (active && active.appliedWidth === columnWidth && active.minimum === minimumWidth && active.maximum === maximumWidth) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    drag.current = undefined;
    setDragging(false);
  }, [columnWidth, minimumWidth, maximumWidth]);

  useEffect(() => () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    drag.current = undefined;
  }, []);

  const finishDrag = (event: PointerEvent<HTMLSpanElement>, commit: boolean) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    cancelFrame();
    drag.current = undefined;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const nextWidth = commit ? active.nextWidth : active.width;
    if (nextWidth !== active.appliedWidth) onColumnResize?.(nextWidth);
  };

  return (
    <th {...cellProps} className={`${className ?? ''} har-resizable-header`}>
      {children}
      {resizable && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`调整 ${columnLabel} 列宽`}
          aria-valuemin={minimumWidth}
          aria-valuemax={Number.isFinite(maximumWidth) ? maximumWidth : undefined}
          aria-valuenow={columnWidth}
          tabIndex={0}
          title="拖拽调整列宽；左右方向键微调"
          className={`har-column-resize-handle${dragging ? ' is-resizing' : ''}`}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onPointerDown={event => {
            if (event.button !== 0 || drag.current) return;
            event.preventDefault();
            event.stopPropagation();
            const width = columnWidth;
            drag.current = { pointerId: event.pointerId, startX: event.clientX, width, nextWidth: width, appliedWidth: width, minimum: minimumWidth, maximum: maximumWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={event => {
            const active = drag.current;
            if (!active || active.pointerId !== event.pointerId) return;
            event.stopPropagation();
            active.nextWidth = Math.min(maximumWidth, Math.max(minimumWidth, Math.round(active.width + event.clientX - active.startX)));
            // Coalesce pointer samples so the header and body update at most once per frame.
            if (frame.current === undefined) {
              frame.current = requestAnimationFrame(() => {
                frame.current = undefined;
                if (drag.current !== active || active.appliedWidth === active.nextWidth) return;
                active.appliedWidth = active.nextWidth;
                onColumnResize?.(active.nextWidth);
              });
            }
          }}
          onPointerUp={event => finishDrag(event, true)}
          onPointerCancel={event => finishDrag(event, false)}
          onLostPointerCapture={() => {
            const active = drag.current;
            cancelFrame();
            drag.current = undefined;
            setDragging(false);
            if (active && active.width !== active.appliedWidth) onColumnResize?.(active.width);
          }}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            onColumnResize(Math.min(maximumWidth, Math.max(minimumWidth, columnWidth + (event.key === 'ArrowRight' ? 16 : -16))));
          }}
        />
      )}
    </th>
  );
}
