import { queryNetlogEvents, queryNetlogEventsWithRawSearch } from './netlogDatasetQuery';
import type { CompactEventIndex, NetlogIndexableFile } from './netlogDatasetIndexer';

const index: CompactEventIndex = {
  count: 4,
  timeTickOffset: 1741095022562,
  time: [1, 2, 3, 4],
  typeId: [10, 20, 10, 30],
  sourceTypeId: [100, 100, 200, 200],
  sourceId: [1, 1, 2, 3],
  phase: [0, 1, 2, 0],
  flags: [0, 1, 0, 1],
  byteStart: [5, 15, 25, 35],
  byteEnd: [14, 24, 34, 44],
  sourceDependencyFrom: [3],
  sourceDependencyTo: [1],
  eventTypeNames: {
    10: 'URL_REQUEST',
    20: 'SOCKET_CONNECT',
    30: 'HTTP2_SESSION',
  },
  sourceTypeNames: {
    100: 'URL_REQUEST',
    200: 'SOCKET',
  },
};

describe('queryNetlogEvents', () => {
  it('支持分页查询', () => {
    const result = queryNetlogEvents(index, { analysisId: 'a1', page: 2, pageSize: 2 });

    expect(result.total).toBe(4);
    expect(result.timeTickOffset).toBe(1741095022562);
    expect(result.rows.map(row => row.eventId)).toEqual([2, 3]);
  });

  it('支持 type/source/error 过滤', () => {
    expect(queryNetlogEvents(index, { analysisId: 'a1', typeId: 10 }).rows.map(row => row.eventId)).toEqual([0, 2]);
    expect(queryNetlogEvents(index, { analysisId: 'a1', sourceId: 1 }).rows.map(row => row.eventId)).toEqual([0, 1]);
    expect(queryNetlogEvents(index, { analysisId: 'a1', errorOnly: true }).rows.map(row => row.eventId)).toEqual([1, 3]);
  });

  it('使用 constants name map 输出和过滤 type/source 名称', () => {
    const result = queryNetlogEvents(index, { analysisId: 'a1', typeName: 'URL_REQUEST', sourceTypeName: 'SOCKET' });

    expect(result.rows.map(row => row.eventId)).toEqual([2]);
    expect(result.rows[0]).toEqual(expect.objectContaining({
      typeName: 'URL_REQUEST',
      sourceTypeName: 'SOCKET',
      phaseName: 'PHASE_NONE',
    }));
  });

  it('支持 time range 过滤', () => {
    expect(queryNetlogEvents(index, { analysisId: 'a1', startTime: 2, endTime: 3 }).rows.map(row => row.eventId)).toEqual([1, 2]);
    expect(queryNetlogEvents(index, { analysisId: 'a1', startTime: 3 }).rows.map(row => row.eventId)).toEqual([2, 3]);
    expect(queryNetlogEvents(index, { analysisId: 'a1', endTime: 2 }).rows.map(row => row.eventId)).toEqual([0, 1]);
  });

  it('支持 source chain 过滤', () => {
    expect(queryNetlogEvents(index, { analysisId: 'a1', sourceChainId: 1 }).rows.map(row => row.eventId)).toEqual([0, 1, 3]);
    expect(queryNetlogEvents(index, { analysisId: 'a1', sourceChainId: 2 }).rows.map(row => row.eventId)).toEqual([2]);
  });

  it('支持按需读取 raw event 做 text/params 搜索', async () => {
    const events = [
      '{"params":{"url":"https://api.example.com","method":"GET"}}',
      '{"params":{"net_error":-105,"host":"dns.example.com"}}',
      '{"params":{"address":"203.0.113.10:443"}}',
      '{"params":{"protocol":"h2","host":"api.example.com"}}',
    ];
    const file: NetlogIndexableFile = {
      name: 'query-test.json',
      size: events.join('').length,
      stream: () => new Blob([]).stream(),
      slice: (start?: number) => {
        const eventId = index.byteStart.indexOf(start || 0);
        return { text: async () => events[eventId] || '{}' } as Blob;
      },
    };

    const result = await queryNetlogEventsWithRawSearch(file, index, { analysisId: 'a1', searchText: 'NET_ERROR' });
    const combined = await queryNetlogEventsWithRawSearch(file, index, { analysisId: 'a1', searchText: 'api.example.com', sourceChainId: 1 });

    expect(result.rows.map(row => row.eventId)).toEqual([1]);
    expect(combined.rows.map(row => row.eventId)).toEqual([0, 3]);
    expect(result.scanned).toBe(4);
    expect(result.hasMoreMatchesUnknown).toBe(false);
  });

  it('raw search 达到扫描上限时标记结果可能不完整', async () => {
    const events = [
      '{"params":{"url":"https://api.example.com/a"}}',
      '{"params":{"url":"https://api.example.com/b"}}',
      '{"params":{"url":"https://api.example.com/c"}}',
      '{"params":{"url":"https://api.example.com/d"}}',
    ];
    const file: NetlogIndexableFile = {
      name: 'query-test.json',
      size: events.join('').length,
      stream: () => new Blob([]).stream(),
      slice: (start?: number) => {
        const eventId = index.byteStart.indexOf(start || 0);
        return { text: async () => events[eventId] || '{}' } as Blob;
      },
    };

    const result = await queryNetlogEventsWithRawSearch(file, index, {
      analysisId: 'a1',
      searchText: 'api.example.com',
      rawSearchScanLimit: 2,
    });

    expect(result.rows.map(row => row.eventId)).toEqual([0, 1]);
    expect(result.total).toBe(2);
    expect(result.scanned).toBe(2);
    expect(result.scanLimitHit).toBe(true);
    expect(result.hasMoreMatchesUnknown).toBe(true);
  });

  it('raw search 达到耗时上限时标记结果可能不完整', async () => {
    const file: NetlogIndexableFile = {
      name: 'query-test.json',
      size: 100,
      stream: () => new Blob([]).stream(),
      slice: () => ({ text: async () => '{"params":{"url":"https://api.example.com"}}' } as Blob),
    };

    const result = await queryNetlogEventsWithRawSearch(file, index, {
      analysisId: 'a1',
      searchText: 'api.example.com',
      rawSearchTimeLimitMs: 0,
    });

    expect(result.rows).toEqual([]);
    expect(result.scanned).toBe(0);
    expect(result.timeLimitHit).toBe(true);
    expect(result.hasMoreMatchesUnknown).toBe(true);
  });

  it('raw search 只扫描结构化过滤后的候选集', async () => {
    const events = [
      '{"params":{"url":"https://api.example.com/a"}}',
      '{"params":{"url":"https://api.example.com/b"}}',
      '{"params":{"url":"https://api.example.com/c"}}',
      '{"params":{"url":"https://api.example.com/d"}}',
    ];
    const file: NetlogIndexableFile = {
      name: 'query-test.json',
      size: events.join('').length,
      stream: () => new Blob([]).stream(),
      slice: (start?: number) => {
        const eventId = index.byteStart.indexOf(start || 0);
        return { text: async () => events[eventId] || '{}' } as Blob;
      },
    };

    const result = await queryNetlogEventsWithRawSearch(file, index, {
      analysisId: 'a1',
      searchText: 'api.example.com',
      sourceId: 1,
    });

    expect(result.rows.map(row => row.eventId)).toEqual([0, 1]);
    expect(result.scanned).toBe(2);
    expect(result.hasMoreMatchesUnknown).toBe(false);
  });

  it('raw search 的扫描上限只作用于结构化过滤后的候选集', async () => {
    const events = [
      '{"params":{"url":"https://api.example.com/a"}}',
      '{"params":{"url":"https://api.example.com/b"}}',
      '{"params":{"url":"https://api.example.com/c"}}',
      '{"params":{"url":"https://api.example.com/d"}}',
    ];
    const file: NetlogIndexableFile = {
      name: 'query-test.json',
      size: events.join('').length,
      stream: () => new Blob([]).stream(),
      slice: (start?: number) => {
        const eventId = index.byteStart.indexOf(start || 0);
        return { text: async () => events[eventId] || '{}' } as Blob;
      },
    };

    const unfiltered = await queryNetlogEventsWithRawSearch(file, index, {
      analysisId: 'a1',
      searchText: 'api.example.com',
      rawSearchScanLimit: 1,
    });
    const filtered = await queryNetlogEventsWithRawSearch(file, index, {
      analysisId: 'a1',
      searchText: 'api.example.com',
      sourceId: 2,
      rawSearchScanLimit: 1,
    });

    expect(unfiltered.scanned).toBe(1);
    expect(unfiltered.scanLimitHit).toBe(true);
    expect(unfiltered.hasMoreMatchesUnknown).toBe(true);
    expect(filtered.rows.map(row => row.eventId)).toEqual([2]);
    expect(filtered.scanned).toBe(1);
    expect(filtered.scanLimitHit).toBe(false);
    expect(filtered.hasMoreMatchesUnknown).toBe(false);
  });

  it('raw search 新查询会重新计算扫描上限状态，不沿用旧的不完整结果', async () => {
    const events = [
      '{"params":{"url":"https://api.example.com/a"}}',
      '{"params":{"url":"https://api.example.com/b"}}',
      '{"params":{"url":"https://api.example.com/c"}}',
      '{"params":{"url":"https://api.example.com/d"}}',
    ];
    const file: NetlogIndexableFile = {
      name: 'query-test.json',
      size: events.join('').length,
      stream: () => new Blob([]).stream(),
      slice: (start?: number) => {
        const eventId = index.byteStart.indexOf(start || 0);
        return { text: async () => events[eventId] || '{}' } as Blob;
      },
    };

    const broadSearch = await queryNetlogEventsWithRawSearch(file, index, {
      analysisId: 'a1',
      searchText: 'api.example.com',
      rawSearchScanLimit: 1,
    });
    const refinedSearch = await queryNetlogEventsWithRawSearch(file, index, {
      analysisId: 'a1',
      searchText: 'api.example.com',
      sourceId: 3,
      rawSearchScanLimit: 1,
    });

    expect(broadSearch.hasMoreMatchesUnknown).toBe(true);
    expect(broadSearch.scanLimitHit).toBe(true);
    expect(refinedSearch.rows.map(row => row.eventId)).toEqual([3]);
    expect(refinedSearch.hasMoreMatchesUnknown).toBe(false);
    expect(refinedSearch.scanLimitHit).toBe(false);
  });
});
