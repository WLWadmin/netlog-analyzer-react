import type { TimelineRange } from './timelineInteractionStore';

export function timeToX(
  timeUs: number,
  range: TimelineRange,
  width: number,
): number {
  const duration = range.endUs - range.startUs;
  return duration <= 0 || width <= 0
    ? 0
    : (timeUs - range.startUs) / duration * width;
}

export function xToTime(
  x: number,
  range: TimelineRange,
  width: number,
): number {
  return width <= 0
    ? range.startUs
    : range.startUs + x / width * (range.endUs - range.startUs);
}

export function zoomTimelineRange(
  range: TimelineRange,
  anchorUs: number,
  scale: number,
): TimelineRange {
  const normalizedScale = Math.max(0.02, Math.min(50, scale));
  return {
    startUs: anchorUs - (anchorUs - range.startUs) * normalizedScale,
    endUs: anchorUs + (range.endUs - anchorUs) * normalizedScale,
  };
}

export function panTimelineRange(
  range: TimelineRange,
  deltaUs: number,
): TimelineRange {
  return {
    startUs: range.startUs + deltaUs,
    endUs: range.endUs + deltaUs,
  };
}

interface HitTestEvent {
  id: string;
  trackId: string;
  startUs: number;
  durationUs: number;
}

export function hitTestTimelineEvent<T extends HitTestEvent>(
  events: T[],
  target: { timeUs: number; trackId: string },
): T | undefined {
  let match: T | undefined;
  for (const event of events) {
    if (
      event.trackId !== target.trackId
      || event.startUs > target.timeUs
      || event.startUs + Math.max(0, event.durationUs) < target.timeUs
    ) {
      continue;
    }
    if (!match || event.durationUs < match.durationUs) match = event;
  }
  return match;
}
