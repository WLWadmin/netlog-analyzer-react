import type { HarRequestEntry } from '../../harParser';
import {
  buildHarWaterfallRange,
  getHarWaterfallMarkers,
  getHarWaterfallPosition,
  getHarWaterfallSegments,
  getHarWaterfallSortValue,
  sortHarWaterfallEntries,
} from './harWaterfall';

function entry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'request',
    url: 'https://example.com/api',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '203.0.113.10',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: '',
    size: 0,
    contentSize: 0,
    time: 100,
    startedDateTime: '2026-06-25T00:00:00.000Z',
    startMs: 1000,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 100, receive: 0 },
    requestHeaders: [],
    responseHeaders: [],
    responseBody: '',
    responseEncoding: '',
    queryString: [],
    serverTiming: [],
    xTtLogid: '',
    xTtCip: '',
    xLscSourceIp: '',
    isFailed: false,
    isSlow: false,
    ...overrides,
  };
}

describe('harWaterfall', () => {
  it('builds a global range and positions requests on one timeline', () => {
    const entries = [
      entry({ id: 1, startMs: 1000, time: 100 }),
      entry({ id: 2, startMs: 1050, time: 200 }),
      entry({ id: 3, startMs: 1200, time: 100 }),
    ];

    const range = buildHarWaterfallRange(entries);

    expect(range).toEqual({ minStart: 1000, maxEnd: 1300, span: 300, available: true });
    expect(getHarWaterfallPosition(entries[1], range)).toEqual({
      leftPercent: 16.666666666666664,
      widthPercent: 66.66666666666666,
      startOffsetMs: 50,
      durationMs: 200,
      available: true,
    });
  });

  it('returns unavailable range for a single request with span zero', () => {
    const range = buildHarWaterfallRange([entry({ startMs: 1000, time: 0 })]);

    expect(range.available).toBe(false);
    expect(getHarWaterfallPosition(entry({ startMs: 1000, time: 0 }), range).available).toBe(false);
  });

  it('ignores entries without reliable startMs', () => {
    const range = buildHarWaterfallRange([
      entry({ id: 1, startMs: 0, time: 100 }),
      entry({ id: 2, startMs: 1000, time: 100 }),
      entry({ id: 3, startMs: 1200, time: 100 }),
    ]);

    expect(range).toEqual({ minStart: 1000, maxEnd: 1300, span: 300, available: true });
    expect(getHarWaterfallPosition(entry({ startMs: 0, time: 100 }), range).available).toBe(false);
  });

  it('keeps the range stable when computed from all entries before filtering', () => {
    const allEntries = [
      entry({ id: 1, startMs: 1000, time: 100 }),
      entry({ id: 2, startMs: 2000, time: 500 }),
    ];
    const range = buildHarWaterfallRange(allEntries);

    expect(getHarWaterfallPosition(allEntries[0], range).widthPercent).toBeCloseTo(6.666, 2);
  });

  it('keeps zero and sub-millisecond requests available on a valid range', () => {
    const entries = [
      entry({ id: 1, startMs: 1000, time: 0 }),
      entry({ id: 2, startMs: 1050, time: 0.5 }),
      entry({ id: 3, startMs: 1100, time: 100 }),
    ];
    const range = buildHarWaterfallRange(entries);

    expect(getHarWaterfallPosition(entries[0], range)).toMatchObject({ available: true, widthPercent: 0, durationMs: 0 });
    expect(getHarWaterfallPosition(entries[1], range).available).toBe(true);
    expect(getHarWaterfallPosition(entries[1], range).widthPercent).toBeGreaterThan(0);
  });

  it('builds phase segments without double counting ssl', () => {
    const segments = getHarWaterfallSegments(entry({
      time: 100,
      timings: { blocked: 10, dns: 10, connect: 50, ssl: 20, send: 5, wait: 20, receive: 5 },
      timingAvailability: { blocked: true, dns: true, connect: true, ssl: true, send: true, wait: true, receive: true },
    }));

    expect(segments.map(segment => segment.key)).toEqual(['stalled', 'dns', 'tcp', 'ssl', 'send', 'wait', 'receive']);
    expect(segments.find(segment => segment.key === 'tcp')?.durationMs).toBe(30);
    expect(segments.find(segment => segment.key === 'ssl')?.durationMs).toBe(20);
    expect(segments.reduce((sum, segment) => sum + segment.durationMs, 0)).toBe(100);
  });

  it('includes queueing, proxy, stalled and unaccounted segments', () => {
    const segments = getHarWaterfallSegments(entry({
      time: 120,
      timings: { blocked: 30, dns: 0, connect: 0, ssl: 0, send: 0, wait: 50, receive: 10 },
      chromeTiming: { blockedQueueingMs: 10, blockedProxyMs: 5 },
    }));

    expect(segments.map(segment => segment.key)).toEqual(['queueing', 'proxy', 'stalled', 'dns', 'tcp', 'ssl', 'send', 'wait', 'receive', 'unaccounted']);
    expect(segments.find(segment => segment.key === 'stalled')?.durationMs).toBe(15);
    expect(segments.find(segment => segment.key === 'unaccounted')?.durationMs).toBe(30);
  });

  it('keeps segment widths within the request bar when recorded phases exceed HAR total', () => {
    const segments = getHarWaterfallSegments(entry({
      time: 50,
      timings: { blocked: 10, dns: 10, connect: 20, ssl: 5, send: 5, wait: 20, receive: 5 },
    }));

    expect(segments.reduce((sum, segment) => sum + segment.widthPercent, 0)).toBeLessThanOrEqual(100.001);
  });

  it('supports all five stable waterfall sort values', () => {
    const slowResponse = entry({
      id: 1,
      startMs: 1000,
      time: 200,
      timings: { blocked: 10, dns: 0, connect: 0, ssl: 0, send: 10, wait: 150, receive: 30 },
    });
    const fastResponse = entry({
      id: 2,
      startMs: 1050,
      time: 100,
      timings: { blocked: 10, dns: 0, connect: 0, ssl: 0, send: 5, wait: 20, receive: 65 },
    });

    expect(sortHarWaterfallEntries([fastResponse, slowResponse], 'start-time').map(item => item.id)).toEqual([1, 2]);
    expect(sortHarWaterfallEntries([slowResponse, fastResponse], 'response-time').map(item => item.id)).toEqual([2, 1]);
    expect(sortHarWaterfallEntries([slowResponse, fastResponse], 'end-time').map(item => item.id)).toEqual([2, 1]);
    expect(sortHarWaterfallEntries([slowResponse, fastResponse], 'total-duration').map(item => item.id)).toEqual([2, 1]);
    expect(sortHarWaterfallEntries([slowResponse, fastResponse], 'latency').map(item => item.id)).toEqual([2, 1]);
    expect(getHarWaterfallSortValue(slowResponse, 'response-time')).toBe(1170);
  });

  it('positions DCL and Load markers on the global waterfall range', () => {
    const range = buildHarWaterfallRange([
      entry({ startMs: 1000, time: 100 }),
      entry({ startMs: 1200, time: 100 }),
    ]);
    const markers = getHarWaterfallMarkers([{
      pageId: 'page-1',
      title: 'Example',
      startMs: 1000,
      domContentLoadedMs: 150,
      loadMs: 250,
    }], range);

    expect(markers).toEqual([
      expect.objectContaining({ key: 'page-1-dcl', leftPercent: 50 }),
      expect.objectContaining({ key: 'page-1-load', leftPercent: 83.33333333333334 }),
    ]);
  });
});
