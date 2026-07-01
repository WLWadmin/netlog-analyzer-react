import { queryNetlogEvents } from './netlogDatasetQuery';
import type { CompactEventIndex } from './netlogDatasetIndexer';

const index: CompactEventIndex = {
  count: 4,
  time: [1, 2, 3, 4],
  typeId: [10, 20, 10, 30],
  sourceTypeId: [100, 100, 200, 200],
  sourceId: [1, 1, 2, 3],
  phase: [0, 1, 2, 0],
  flags: [0, 1, 0, 1],
  byteStart: [5, 15, 25, 35],
  byteEnd: [14, 24, 34, 44],
};

describe('queryNetlogEvents', () => {
  it('支持分页查询', () => {
    const result = queryNetlogEvents(index, { analysisId: 'a1', page: 2, pageSize: 2 });

    expect(result.total).toBe(4);
    expect(result.rows.map(row => row.eventId)).toEqual([2, 3]);
  });

  it('支持 type/source/error 过滤', () => {
    expect(queryNetlogEvents(index, { analysisId: 'a1', typeId: 10 }).rows.map(row => row.eventId)).toEqual([0, 2]);
    expect(queryNetlogEvents(index, { analysisId: 'a1', sourceId: 1 }).rows.map(row => row.eventId)).toEqual([0, 1]);
    expect(queryNetlogEvents(index, { analysisId: 'a1', errorOnly: true }).rows.map(row => row.eventId)).toEqual([1, 3]);
  });
});
