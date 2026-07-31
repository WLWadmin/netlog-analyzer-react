export interface TraceInterval {
  start: number;
  end: number;
}

export function mergeIntervals(intervals: readonly TraceInterval[]): TraceInterval[] {
  const sorted = intervals
    .filter(interval => Number.isFinite(interval.start)
      && Number.isFinite(interval.end)
      && interval.end > interval.start)
    .map(interval => ({ ...interval }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: TraceInterval[] = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push(interval);
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged;
}

export function unionDuration(intervals: readonly TraceInterval[]): number {
  return mergeIntervals(intervals).reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
}

export function calculateSelfTime(
  parent: TraceInterval,
  directChildren: readonly TraceInterval[],
): number {
  if (!Number.isFinite(parent.start)
    || !Number.isFinite(parent.end)
    || parent.end <= parent.start) {
    return 0;
  }
  const clippedChildren = directChildren.map(child => ({
    start: Math.max(parent.start, child.start),
    end: Math.min(parent.end, child.end),
  }));
  return Math.max(
    parent.end - parent.start - unionDuration(clippedChildren),
    0,
  );
}
