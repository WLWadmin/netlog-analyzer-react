import { parseHar, type HarRequestEntry } from '../../harParser';
import { buildHarRedirectLinks } from './harRedirectChain';

function entry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'request',
    url: 'https://example.com/old',
    method: 'GET',
    status: 302,
    statusText: 'Found',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '203.0.113.10',
    category: 'doc',
    rawType: 'document',
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
    standard: overrides.standard ?? parseHar({
      log: { entries: [{
        request: { method: 'GET', url: 'https://example.test/', headers: [] },
        response: { status: overrides.status ?? 200, headers: [], content: {} },
        timings: { send: 0, wait: 0, receive: 0 },
      }] },
    }).entries[0].standard,
  };
}

describe('harRedirectChain', () => {
  it('links explicit redirect targets to matching following requests', () => {
    const links = buildHarRedirectLinks([
      entry({ id: 1, url: 'https://example.com/old', redirect: { status: 302, location: '/new' }, startMs: 1000 }),
      entry({ id: 2, url: 'https://example.com/new', status: 200, redirect: undefined, startMs: 1200 }),
    ]);

    expect(links).toEqual([
      { fromRequestId: 1, toRequestId: 2, targetUrl: 'https://example.com/new', confidence: 'medium', basis: 'explicit-target-match' },
    ]);
  });

  it('does not infer redirect links from adjacent timing alone', () => {
    const links = buildHarRedirectLinks([
      entry({ id: 1, url: 'https://example.com/old', redirect: undefined, startMs: 1000 }),
      entry({ id: 2, url: 'https://example.com/new', status: 200, redirect: undefined, startMs: 1010 }),
    ]);

    expect(links).toEqual([]);
  });

  it('does not link targets outside the matching window', () => {
    const links = buildHarRedirectLinks([
      entry({ id: 1, url: 'https://example.com/old', redirect: { status: 302, redirectURL: 'https://example.com/new' }, startMs: 1000 }),
      entry({ id: 2, url: 'https://example.com/new', status: 200, redirect: undefined, startMs: 10000 }),
    ], 1000);

    expect(links).toEqual([]);
  });

  it('ignores URL fragments because browsers do not send them in the next request', () => {
    const links = buildHarRedirectLinks([
      entry({ id: 1, url: 'https://example.com/old', redirect: { status: 302, location: '/new#section' }, startMs: 1000 }),
      entry({ id: 2, url: 'https://example.com/new', status: 200, redirect: undefined, startMs: 1200 }),
    ]);

    expect(links).toEqual([
      { fromRequestId: 1, toRequestId: 2, targetUrl: 'https://example.com/new', confidence: 'medium', basis: 'explicit-target-match' },
    ]);
  });
});
