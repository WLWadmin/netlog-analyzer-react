import type { HarPageMarker, HarRequestEntry } from '../../harParser';
import type { HarDisplayTimingPhaseKey } from './harTimingNormalization';
import { normalizeHarTiming } from './harTimingNormalization';

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

export interface HarWaterfallSegment {
  key: HarDisplayTimingPhaseKey | 'unaccounted';
  leftPercent: number;
  widthPercent: number;
  durationMs: number;
  label: string;
  color: string;
  striped?: boolean;
}

export type HarWaterfallSortKey =
  | 'start-time'
  | 'response-time'
  | 'end-time'
  | 'total-duration'
  | 'latency';

export interface HarWaterfallMarkerPosition {
  key: string;
  label: string;
  leftPercent: number;
  color: string;
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

export function getHarWaterfallSortValue(entry: HarRequestEntry, key: HarWaterfallSortKey): number {
  const normalized = normalizeHarTiming(entry);
  const send = normalized.phases.find(phase => phase.key === 'send' && phase.available);

  switch (key) {
    case 'start-time':
      return entry.startMs > 0 ? entry.startMs : Number.POSITIVE_INFINITY;
    case 'response-time':
      return entry.startMs > 0 && normalized.responseStartOffsetMs !== undefined
        ? entry.startMs + normalized.responseStartOffsetMs
        : Number.POSITIVE_INFINITY;
    case 'end-time':
      return entry.startMs > 0 ? entry.startMs + entry.time : Number.POSITIVE_INFINITY;
    case 'total-duration':
      return entry.time;
    case 'latency':
      return send && normalized.responseStartOffsetMs !== undefined
        ? Math.max(0, normalized.responseStartOffsetMs - send.startOffsetMs)
        : Number.POSITIVE_INFINITY;
  }
}

export function sortHarWaterfallEntries(entries: HarRequestEntry[], key: HarWaterfallSortKey): HarRequestEntry[] {
  return [...entries].sort((a, b) => {
    const aValue = getHarWaterfallSortValue(a, key);
    const bValue = getHarWaterfallSortValue(b, key);
    if (Number.isFinite(aValue) && !Number.isFinite(bValue)) return -1;
    if (!Number.isFinite(aValue) && Number.isFinite(bValue)) return 1;
    const delta = aValue - bValue;
    if (delta !== 0 && !Number.isNaN(delta)) return delta;
    return a.id - b.id;
  });
}

export function getHarWaterfallMarkers(
  markers: HarPageMarker[] | undefined,
  range: HarWaterfallRange,
): HarWaterfallMarkerPosition[] {
  if (!range.available || !markers?.length) return [];

  const positions: HarWaterfallMarkerPosition[] = [];
  markers.forEach((marker, index) => {
    if (!Number.isFinite(marker.startMs) || (marker.startMs || 0) <= 0) return;
    const events: Array<{ kind: 'dcl' | 'load'; offset?: number; label: string; color: string }> = [
      { kind: 'dcl', offset: marker.domContentLoadedMs, label: 'DOMContentLoaded', color: '#2563eb' },
      { kind: 'load', offset: marker.loadMs, label: 'Load', color: '#dc2626' },
    ];
    events.forEach(event => {
      if (!Number.isFinite(event.offset) || (event.offset || 0) < 0) return;
      const absoluteMs = (marker.startMs || 0) + (event.offset || 0);
      if (absoluteMs < range.minStart || absoluteMs > range.maxEnd) return;
      positions.push({
        key: `${marker.pageId || index}-${event.kind}`,
        label: `${event.label}${marker.title ? ` · ${marker.title}` : ''}`,
        leftPercent: clampPercent(((absoluteMs - range.minStart) / range.span) * 100),
        color: event.color,
      });
    });
  });
  return positions;
}

const SEGMENT_STYLES: Record<HarDisplayTimingPhaseKey | 'unaccounted', { label: string; color: string; striped?: boolean }> = {
  queueing: { label: 'Queueing', color: 'rgba(148, 163, 184, 0.72)' },
  stalled: { label: 'Stalled', color: 'rgba(100, 116, 139, 0.72)' },
  proxy: { label: 'Proxy', color: 'rgba(156, 163, 175, 0.72)' },
  dns: { label: 'DNS', color: 'rgba(96, 165, 250, 0.78)' },
  tcp: { label: 'TCP', color: 'rgba(251, 146, 60, 0.78)' },
  ssl: { label: 'SSL', color: 'rgba(168, 85, 247, 0.78)' },
  'service-worker-preparation': { label: 'SW Prep', color: 'rgba(20, 184, 166, 0.42)' },
  'service-worker-request': { label: 'SW Request', color: 'rgba(13, 148, 136, 0.42)' },
  send: { label: 'Send', color: 'rgba(125, 211, 252, 0.78)' },
  wait: { label: 'TTFB', color: 'rgba(74, 222, 128, 0.72)' },
  receive: { label: 'Download', color: 'rgba(22, 163, 74, 0.78)' },
  unaccounted: { label: 'Unaccounted', color: 'rgba(148, 163, 184, 0.24)', striped: true },
};

export function getHarWaterfallSegments(entry: HarRequestEntry): HarWaterfallSegment[] {
  const timing = normalizeHarTiming(entry);
  const total = Math.max(timing.totalMs, timing.accountedMs, 1);
  const standardPhases = timing.phases.filter(phase => !phase.overlapsStandardTotal);
  const segments: HarWaterfallSegment[] = standardPhases
    .filter(phase => phase.available && phase.durationMs >= 0)
    .map(phase => {
      const style = SEGMENT_STYLES[phase.key];
      return {
        key: phase.key,
        leftPercent: clampPercent((phase.startOffsetMs / total) * 100),
        widthPercent: clampPercent((phase.durationMs / total) * 100),
        durationMs: phase.durationMs,
        label: style.label,
        color: style.color,
        striped: style.striped,
      };
    });

  if (timing.unaccountedMs > 0) {
    const style = SEGMENT_STYLES.unaccounted;
    segments.push({
      key: 'unaccounted',
      leftPercent: clampPercent((timing.accountedMs / total) * 100),
      widthPercent: clampPercent((timing.unaccountedMs / total) * 100),
      durationMs: timing.unaccountedMs,
      label: style.label,
      color: style.color,
      striped: style.striped,
    });
  }

  return segments;
}
