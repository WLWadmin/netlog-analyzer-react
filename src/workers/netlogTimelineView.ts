import type { CompactEventIndex } from './netlogDatasetIndexer';
import type { TimelineStateView } from './netlogDatasetViews';
import {
  numericColumnAt,
  numericColumnValues,
  type NumericColumn,
} from './chunkedNumericColumn';

const DEFAULT_BUCKET_COUNT = 60;

function nameOf(names: Record<number, string> | undefined, id: number, fallback: string): string {
  return names?.[id] || `${fallback}_${id}`;
}

function sortedCounts(
  ids: NumericColumn,
  flags: NumericColumn,
  names: Record<number, string> | undefined,
  fallback: string
): Array<{ name: string; count: number; errorCount: number }> {
  const map = new Map<number, { count: number; errorCount: number }>();
  let index = 0;
  for (const id of numericColumnValues(ids)) {
    const row = map.get(id) || { count: 0, errorCount: 0 };
    row.count += 1;
    if (numericColumnAt(flags, index)) row.errorCount += 1;
    map.set(id, row);
    index += 1;
  }
  return Array.from(map.entries())
    .map(([id, row]) => ({ name: nameOf(names, id, fallback), ...row }))
    .sort((a, b) => b.errorCount - a.errorCount || b.count - a.count)
    .slice(0, 30);
}

function finiteTimeRange(times: NumericColumn): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  let hasFiniteTime = false;
  for (const time of numericColumnValues(times)) {
    if (!Number.isFinite(time)) continue;
    hasFiniteTime = true;
    if (time < start) start = time;
    if (time > end) end = time;
  }
  return hasFiniteTime ? { start, end } : { start: 0, end: 0 };
}

export function buildNetlogTimelineView(index: CompactEventIndex): TimelineStateView {
  const { start, end } = finiteTimeRange(index.time);
  const duration = Math.max(0, end - start);
  const bucketCount = duration > 0 ? Math.min(DEFAULT_BUCKET_COUNT, Math.max(1, index.count)) : 1;
  const bucketSizeMs = duration > 0 ? Math.max(1, Math.ceil(duration / bucketCount)) : 1;
  const buckets: TimelineStateView['buckets'] = Array.from({ length: bucketCount }, (_, bucketIndex) => ({
    index: bucketIndex,
    start: start + bucketIndex * bucketSizeMs,
    end: bucketIndex === bucketCount - 1 ? end : start + (bucketIndex + 1) * bucketSizeMs,
    eventCount: 0,
    errorCount: 0,
  }));
  const sourceMap = new Map<number, TimelineStateView['sourceActivity'][number]>();
  const notableEvents: TimelineStateView['notableEvents'] = [];

  for (let eventId = 0; eventId < index.count; eventId += 1) {
    const time = numericColumnAt(index.time, eventId) || 0;
    const bucketIndex = duration > 0 ? Math.min(bucketCount - 1, Math.max(0, Math.floor((time - start) / bucketSizeMs))) : 0;
    const bucket = buckets[bucketIndex];
    bucket.eventCount += 1;
    if (numericColumnAt(index.flags, eventId)) bucket.errorCount += 1;

    const sourceId = numericColumnAt(index.sourceId, eventId) || 0;
    const sourceTypeName = nameOf(
      index.sourceTypeNames,
      numericColumnAt(index.sourceTypeId, eventId) || 0,
      'SOURCE',
    );
    const source = sourceMap.get(sourceId) || {
      sourceId,
      sourceTypeName,
      eventCount: 0,
      errorCount: 0,
      firstEventId: eventId,
      lastEventId: eventId,
      firstTime: time,
      lastTime: time,
    };
    source.eventCount += 1;
    if (numericColumnAt(index.flags, eventId)) source.errorCount += 1;
    source.firstEventId = Math.min(source.firstEventId, eventId);
    source.lastEventId = Math.max(source.lastEventId, eventId);
    source.firstTime = Math.min(source.firstTime, time);
    source.lastTime = Math.max(source.lastTime, time);
    sourceMap.set(sourceId, source);

    if (numericColumnAt(index.flags, eventId) && notableEvents.length < 100) {
      notableEvents.push({
        sourceId,
        eventId,
        byteStart: numericColumnAt(index.byteStart, eventId),
        byteEnd: numericColumnAt(index.byteEnd, eventId),
        time,
        typeName: nameOf(
          index.eventTypeNames,
          numericColumnAt(index.typeId, eventId) || 0,
          'EVENT',
        ),
        sourceTypeName,
        phase: numericColumnAt(index.phase, eventId) || 0,
        hasError: true,
      });
    }
  }

  const evidenceGaps: string[] = [];
  if (index.count === 0) {
    evidenceGaps.push('未发现 NetLog events，无法生成全局 Timeline。');
  } else {
    evidenceGaps.push('Timeline 展示事件时间分布和错误密度，不能单独说明根因；需要结合 Source Chain 与 raw event 复核。');
  }
  if (duration === 0 && index.count > 0) {
    evidenceGaps.push('所有事件时间相同或时间字段缺失，Timeline 只能展示单桶分布。');
  }

  return {
    timeTickOffset: index.timeTickOffset,
    timeRange: { start, end, duration },
    bucketSizeMs,
    buckets,
    topEventTypes: sortedCounts(index.typeId, index.flags, index.eventTypeNames, 'EVENT'),
    topSourceTypes: sortedCounts(index.sourceTypeId, index.flags, index.sourceTypeNames, 'SOURCE'),
    sourceActivity: Array.from(sourceMap.values())
      .sort((a, b) => b.errorCount - a.errorCount || b.eventCount - a.eventCount)
      .slice(0, 50),
    notableEvents,
    evidenceGaps,
  };
}
