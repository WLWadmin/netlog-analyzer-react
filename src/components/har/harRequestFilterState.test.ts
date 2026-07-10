import type { HarRequestEntry } from '../../harParser';
import { DEFAULT_HAR_REQUEST_FILTER_STATE, filterHarRequests, getTopHarDomains } from './harRequestFilterState';

function entry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'request',
    url: 'https://a.example.com/api',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    protocol: 'h2',
    domain: 'a.example.com',
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

describe('harRequestFilterState', () => {
  it('filters by issue phase using getHarRequestIssue output', () => {
    const entries = [
      entry({ id: 1, timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 2000, receive: 0 }, time: 2000, isSlow: true }),
      entry({ id: 2, timings: { blocked: 900, dns: 0, connect: 0, ssl: 0, send: 0, wait: 100, receive: 0 }, time: 1000, isSlow: true }),
      entry({ id: 3, status: 0, isFailed: true }),
      entry({ id: 4, netErrorText: 'net::ERR_NAME_NOT_RESOLVED', isFailed: true, status: 0 }),
      entry({ id: 5, status: 500, isFailed: true }),
      entry({ id: 6, status: 404, isFailed: true }),
      entry({ id: 7, status: 600, isFailed: true }),
    ];

    expect(filterHarRequests(entries, { ...DEFAULT_HAR_REQUEST_FILTER_STATE, issue: 'ttfb' }).map(e => e.id)).toEqual([1]);
    expect(filterHarRequests(entries, { ...DEFAULT_HAR_REQUEST_FILTER_STATE, issue: 'queueing' }).map(e => e.id)).toEqual([2]);
    expect(filterHarRequests(entries, { ...DEFAULT_HAR_REQUEST_FILTER_STATE, issue: 'status-zero' }).map(e => e.id)).toEqual([3]);
    expect(filterHarRequests(entries, { ...DEFAULT_HAR_REQUEST_FILTER_STATE, issue: 'net-error' }).map(e => e.id)).toEqual([4]);
    expect(filterHarRequests(entries, { ...DEFAULT_HAR_REQUEST_FILTER_STATE, issue: '5xx' }).map(e => e.id)).toEqual([5]);
    expect(filterHarRequests(entries, { ...DEFAULT_HAR_REQUEST_FILTER_STATE, issue: '4xx' }).map(e => e.id)).toEqual([6]);
  });

  it('filters by method domain logid serverTiming and blocked domains with AND logic', () => {
    const entries = [
      entry({ id: 1, method: 'POST', domain: 'api.example.com', url: 'https://api.example.com/user', xTtLogid: 'log-1', serverTiming: [{ name: 'app', dur: 10 }] }),
      entry({ id: 2, method: 'PUT', domain: 'blocked.example.com', url: 'https://blocked.example.com/user' }),
    ];

    expect(filterHarRequests(entries, {
      ...DEFAULT_HAR_REQUEST_FILTER_STATE,
      method: 'POST',
      domain: 'api.example.com',
      hasLogid: 'yes',
      hasServerTiming: 'yes',
      keyword: 'user',
    }).map(e => e.id)).toEqual([1]);

    expect(filterHarRequests(entries, {
      ...DEFAULT_HAR_REQUEST_FILTER_STATE,
      method: 'other',
      blockedDomains: ['blocked'],
    })).toEqual([]);
  });

  it('sorts top domains by count then name', () => {
    expect(getTopHarDomains([
      entry({ domain: 'b.example.com' }),
      entry({ domain: 'a.example.com' }),
      entry({ domain: 'b.example.com' }),
      entry({ domain: '-' }),
    ])).toEqual(['b.example.com', 'a.example.com']);
  });
});
