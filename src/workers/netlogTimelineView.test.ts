import { buildNetlogTimelineView } from './netlogTimelineView';
import type { CompactEventIndex } from './netlogDatasetIndexer';

describe('buildNetlogTimelineView', () => {
  it('按时间 bucket 聚合事件和错误密度', () => {
    const index: CompactEventIndex = {
      count: 3,
      time: [0, 50, 100],
      typeId: [1, 2, 2],
      sourceTypeId: [10, 10, 11],
      sourceId: [100, 100, 101],
      phase: [0, 1, 2],
      flags: [0, 1, 1],
      byteStart: [0, 20, 40],
      byteEnd: [10, 30, 50],
      eventTypeNames: { 1: 'URL_REQUEST_START_JOB', 2: 'SOCKET_CONNECT' },
      sourceTypeNames: { 10: 'URL_REQUEST', 11: 'SOCKET' },
      timeTickOffset: 1741095022562,
    };

    const view = buildNetlogTimelineView(index);

    expect(view.timeTickOffset).toBe(1741095022562);
    expect(view.timeRange).toEqual({ start: 0, end: 100, duration: 100 });
    expect(view.buckets.reduce((sum, bucket) => sum + bucket.eventCount, 0)).toBe(3);
    expect(view.buckets.reduce((sum, bucket) => sum + bucket.errorCount, 0)).toBe(2);
    expect(view.topEventTypes[0]).toEqual({ name: 'SOCKET_CONNECT', count: 2, errorCount: 2 });
    expect(view.sourceActivity).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 100, eventCount: 2, errorCount: 1 }),
    ]));
    expect(view.notableEvents).toHaveLength(2);
  });

  it('处理大文件事件时间轴时不展开超大数组', () => {
    const count = 200_000;
    const index: CompactEventIndex = {
      count,
      time: Array.from({ length: count }, (_, eventId) => eventId),
      typeId: Array.from({ length: count }, () => 1),
      sourceTypeId: Array.from({ length: count }, () => 10),
      sourceId: Array.from({ length: count }, (_, eventId) => eventId % 100),
      phase: Array.from({ length: count }, () => 0),
      flags: Array.from({ length: count }, (_, eventId) => eventId % 1000 === 0 ? 1 : 0),
      byteStart: Array.from({ length: count }, (_, eventId) => eventId * 10),
      byteEnd: Array.from({ length: count }, (_, eventId) => eventId * 10 + 9),
      eventTypeNames: { 1: 'URL_REQUEST_START_JOB' },
      sourceTypeNames: { 10: 'URL_REQUEST' },
    };

    const view = buildNetlogTimelineView(index);

    expect(view.timeRange).toEqual({ start: 0, end: count - 1, duration: count - 1 });
    expect(view.buckets.reduce((sum, bucket) => sum + bucket.eventCount, 0)).toBe(count);
    expect(view.notableEvents).toHaveLength(100);
  });
});
