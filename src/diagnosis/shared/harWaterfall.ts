import type { HarRequestEntry } from '../../harParser';

export interface HarWaterfallRange {
  minStart: number;
  maxEnd: number;
  span: number;
  available: boolean;
}

export interface HarWaterfallPosition {
  leftPercent: number;
  widthPercent: number;
  startOffsetMs: number;
  durationMs: number;
  available: boolean;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function isTimingEntryAvailable(entry: HarRequestEntry): boolean {
  return Number.isFinite(entry.startMs) && entry.startMs > 0 && Number.isFinite(entry.time) && entry.time >= 0;
}

export function buildHarWaterfallRange(entries: HarRequestEntry[]): HarWaterfallRange {
  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const entry of entries) {
    if (!isTimingEntryAvailable(entry)) continue;
    minStart = Math.min(minStart, entry.startMs);
    maxEnd = Math.max(maxEnd, entry.startMs + entry.time);
  }

  const span = maxEnd - minStart;
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || !Number.isFinite(span) || span <= 0) {
    return { minStart: 0, maxEnd: 0, span: 0, available: false };
  }

  return { minStart, maxEnd, span, available: true };
}

export function getHarWaterfallPosition(entry: HarRequestEntry, range: HarWaterfallRange): HarWaterfallPosition {
  if (!range.available || !isTimingEntryAvailable(entry)) {
    return { leftPercent: 0, widthPercent: 0, startOffsetMs: 0, durationMs: entry.time || 0, available: false };
  }

  const startOffsetMs = entry.startMs - range.minStart;
  const leftPercent = clampPercent((startOffsetMs / range.span) * 100);
  const widthPercent = clampPercent((entry.time / range.span) * 100);

  return {
    leftPercent,
    widthPercent,
    startOffsetMs,
    durationMs: entry.time,
    available: Number.isFinite(startOffsetMs) && startOffsetMs >= 0,
  };
}
