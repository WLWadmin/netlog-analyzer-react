import type { HarRequestEntry } from '../../harParser';
import { buildHarWaterfallRange, getHarWaterfallPosition } from './harWaterfall';

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
});
