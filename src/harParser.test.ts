import { parseHar } from './harParser';

describe('harParser', () => {
  test('parseHar should parse basic entry and server-timing', () => {
    const data = {
      log: {
        creator: { name: 'Chrome', version: '1' },
        entries: [
          {
            _resourceType: 'xhr',
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 123,
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              headers: [{ name: 'x-tt-logid', value: 'abc' }],
              queryString: [],
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'h2',
              headers: [
                { name: 'server-timing', value: 'app;dur=600;desc="db"' },
                { name: 'x-tt-logid', value: 'abc' },
              ],
              content: { mimeType: 'application/json', size: 10, text: '{"ok":true}', encoding: '' },
              bodySize: 10,
              _transferSize: 10,
            },
            timings: { blocked: 0, dns: 10, connect: 20, ssl: 30, send: 1, wait: 50, receive: 12 },
          },
        ],
      },
    };

    const result = parseHar(data as any);
    expect(result.totalRequests).toBe(1);
    expect(result.entries[0].domain).toBe('example.com');
    expect(result.entries[0].name).toBe('api');
    expect(result.entries[0].serverTiming.length).toBeGreaterThan(0);
    expect(result.entries[0].serverTiming[0].name).toBe('app');
    expect(result.entries[0].xTtLogid).toBe('abc');
  });

  test('parseHar should use the final path segment as Network-style request name', () => {
    const baseEntry = {
      startedDateTime: '2026-06-25T00:00:00.000Z',
      time: 1,
      request: { method: 'GET', headers: [], queryString: [] },
      response: { status: 200, statusText: 'OK', httpVersion: 'h2', headers: [], content: { mimeType: '', size: 0, text: '' } },
      timings: {},
    };
    const result = parseHar({
      log: {
        entries: [
          { ...baseEntry, request: { ...baseEntry.request, url: 'https://static.example.com/assets/runtime.abc123.js' } },
          { ...baseEntry, request: { ...baseEntry.request, url: 'https://api.example.com/user/change?source=web' } },
          { ...baseEntry, request: { ...baseEntry.request, url: 'https://errors.example.com/envelope/?sentry_version=7' } },
          { ...baseEntry, request: { ...baseEntry.request, url: 'https://example.com/?r=signature' } },
        ],
      },
    } as any);

    expect(result.entries.map(entry => entry.name)).toEqual([
      'runtime.abc123.js',
      'change?source=web',
      'envelope/?sentry_version=7',
      '?r=signature',
    ]);
  });

  test('parseHar should keep raw failure fields and timing availability', () => {
    const data = {
      log: {
        entries: [
          {
            _resourceType: 'xhr',
            _error: 'net::ERR_NAME_NOT_RESOLVED',
            _netError: -105,
            _blockedReason: 'inspector',
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 20,
            request: {
              method: 'GET',
              url: 'https://missing.example.com/api',
              headers: [],
              queryString: [],
            },
            response: {
              status: 0,
              statusText: '',
              httpVersion: '',
              headers: [],
              content: { mimeType: '', size: 0, text: '', encoding: '' },
            },
            timings: { blocked: 0, dns: -1, connect: 0, ssl: -1, send: 0, wait: 20, receive: 0 },
          },
        ],
      },
    };

    const result = parseHar(data as any);
    const entry = result.entries[0];
    expect(entry.failureText).toBe('net::ERR_NAME_NOT_RESOLVED');
    expect(entry.netErrorText).toBe('net::ERR_NAME_NOT_RESOLVED');
    expect(entry.netErrorCode).toBe(-105);
    expect(entry.blockedReason).toBe('inspector');
    expect(entry.timings.dns).toBe(0);
    expect(entry.timingAvailability?.dns).toBe(false);
    expect(entry.timingAvailability?.blocked).toBe(true);
  });

  test('parseHar should parse initiator array stack and request metadata evidence', () => {
    const data = {
      log: {
        entries: [
          {
            _resourceType: 'xhr',
            _priority: 'High',
            _initiator: {
              type: 'script',
              url: 'https://example.com/app.js',
              lineNumber: 12,
              columnNumber: 8,
              requestId: 'REQ-1',
              stack: [
                { functionName: 'loadData', url: 'https://example.com/app.js', lineNumber: 12, columnNumber: 8 },
              ],
            },
            connection: 0,
            serverIPAddress: '203.0.113.10',
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 42,
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              headers: [],
              queryString: [],
              cookies: [
                { name: 'session', value: 'TEST_VALUE', path: '/', domain: 'example.com', httpOnly: true, secure: true, sameSite: 'Lax', comment: 'fake test cookie' },
                { name: '', value: 'ignored' },
              ],
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'h2',
              headers: [],
              cookies: [
                { name: 'trace', value: 'TEST_TRACE', expires: '2026-07-10T00:00:00.000Z', secure: false },
              ],
              content: { mimeType: 'application/json', size: 10, text: '{"ok":true}', encoding: '' },
            },
            timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 40, receive: 1 },
          },
        ],
      },
    };

    const entry = parseHar(data as any).entries[0];
    expect(entry.initiator).toEqual({
      type: 'script',
      url: 'https://example.com/app.js',
      lineNumber: 12,
      columnNumber: 8,
      requestId: 'REQ-1',
      stack: [
        { functionName: 'loadData', url: 'https://example.com/app.js', lineNumber: 12, columnNumber: 8 },
      ],
    });
    expect(entry.priority).toBe('High');
    expect(entry.requestCookies).toEqual([
      { name: 'session', value: 'TEST_VALUE', path: '/', domain: 'example.com', httpOnly: true, secure: true, sameSite: 'Lax', comment: 'fake test cookie' },
    ]);
    expect(entry.responseCookies).toEqual([
      { name: 'trace', value: 'TEST_TRACE', expires: '2026-07-10T00:00:00.000Z', secure: false },
    ]);
    expect(entry.connectionId).toBe('0');
    expect(entry.connectionInfo).toEqual({
      connectionId: '0',
      remoteAddress: '203.0.113.10',
      protocol: 'h2',
    });
  });

  test('parseHar should flatten Chrome initiator callFrames with parent stack', () => {
    const data = {
      log: {
        entries: [
          {
            _initiator: {
              type: 'script',
              stack: {
                callFrames: [
                  { functionName: 'child', url: 'https://example.com/child.js', lineNumber: 2, columnNumber: 3 },
                ],
                parent: {
                  callFrames: [
                    { functionName: 'parent', url: 'https://example.com/parent.js', lineNumber: 4, columnNumber: 5 },
                  ],
                },
              },
            },
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 10,
            request: { method: 'GET', url: 'https://example.com/script.js', headers: [], queryString: [] },
            response: { status: 200, statusText: 'OK', httpVersion: 'h2', headers: [], content: { mimeType: '', size: 0, text: '', encoding: '' } },
            timings: {},
          },
        ],
      },
    };

    const entry = parseHar(data as any).entries[0];
    expect(entry.initiator?.stack).toEqual([
      { functionName: 'child', url: 'https://example.com/child.js', lineNumber: 2, columnNumber: 3 },
      { functionName: 'parent', url: 'https://example.com/parent.js', lineNumber: 4, columnNumber: 5 },
    ]);
  });

  test('parseHar should parse redirect and cache evidence without inferring chains', () => {
    const data = {
      log: {
        entries: [
          {
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 5,
            request: { method: 'GET', url: 'https://example.com/old', headers: [], queryString: [] },
            response: {
              status: 302,
              statusText: 'Found',
              httpVersion: 'http/1.1',
              redirectURL: 'https://example.com/new',
              headers: [{ name: 'LOCATION', value: '/new' }],
              content: { mimeType: '', size: 0, text: '', encoding: '' },
            },
            timings: {},
          },
          {
            _fromDiskCache: false,
            startedDateTime: '2026-06-25T00:00:00.010Z',
            time: 5,
            request: { method: 'GET', url: 'https://example.com/cached', headers: [], queryString: [] },
            response: {
              status: 304,
              statusText: 'Not Modified',
              httpVersion: 'h2',
              _fromMemoryCache: true,
              _fromServiceWorker: false,
              _fromPrefetchCache: false,
              headers: [
                { name: 'cache-control', value: 'max-age=60' },
                { name: 'etag', value: '"abc"' },
                { name: 'age', value: '12' },
                { name: 'expires', value: 'Fri, 10 Jul 2026 00:00:00 GMT' },
                { name: 'last-modified', value: 'Thu, 09 Jul 2026 00:00:00 GMT' },
              ],
              content: { mimeType: '', size: 0, text: '', encoding: '' },
            },
            timings: {},
          },
        ],
      },
    };

    const [redirectEntry, cacheEntry] = parseHar(data as any).entries;
    expect(redirectEntry.redirect).toEqual({
      redirectURL: 'https://example.com/new',
      location: '/new',
      status: 302,
    });
    expect(cacheEntry.redirect).toBeUndefined();
    expect(cacheEntry.cacheInfo).toEqual({
      cacheControl: 'max-age=60',
      etag: '"abc"',
      age: '12',
      expires: 'Fri, 10 Jul 2026 00:00:00 GMT',
      lastModified: 'Thu, 09 Jul 2026 00:00:00 GMT',
      fromDiskCache: false,
      fromMemoryCache: true,
      fromServiceWorker: false,
      fromPrefetchCache: false,
      fromCache: true,
      status304: true,
    });
  });

  test('parseHar should keep explicit cache false fields without fromCache false', () => {
    const data = {
      log: {
        entries: [
          {
            _fromDiskCache: false,
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 5,
            request: { method: 'GET', url: 'https://example.com/no-cache-hit', headers: [], queryString: [] },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'h2',
              _fromMemoryCache: false,
              headers: [],
              content: { mimeType: '', size: 0, text: '', encoding: '' },
            },
            timings: {},
          },
        ],
      },
    };

    const entry = parseHar(data as any).entries[0];
    expect(entry.cacheInfo).toEqual({
      fromDiskCache: false,
      fromMemoryCache: false,
    });
    expect(entry.cacheInfo?.fromCache).toBeUndefined();
  });

  test('parseHar should leave missing optional network evidence undefined', () => {
    const data = {
      log: {
        entries: [
          {
            _initiator: {},
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 5,
            request: {
              method: 'GET',
              url: 'https://example.com/minimal',
              headers: [],
              queryString: [],
              cookies: 'not-array',
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: '',
              headers: [],
              cookies: 'not-array',
              content: { mimeType: '', size: 0, text: '', encoding: '' },
            },
            timings: {},
          },
        ],
      },
    };

    const entry = parseHar(data as any).entries[0];
    expect(entry.initiator).toBeUndefined();
    expect(entry.redirect).toBeUndefined();
    expect(entry.requestCookies).toEqual([]);
    expect(entry.responseCookies).toEqual([]);
    expect(entry.priority).toBeUndefined();
    expect(entry.cacheInfo).toBeUndefined();
    expect(entry.connectionInfo).toBeUndefined();
  });

  test('parseHar should preserve null and empty-string boundaries for initiator and cookies', () => {
    const data = {
      log: {
        entries: [
          {
            _initiator: {
              type: 'script',
              lineNumber: null,
              columnNumber: '',
              stack: [
                { functionName: 'zeroFrame', url: 'https://example.com/app.js', lineNumber: 0, columnNumber: 0 },
              ],
            },
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 5,
            request: {
              method: 'GET',
              url: 'https://example.com/empty-cookie',
              headers: [],
              queryString: [],
              cookies: [{ name: 'emptyValue', value: '' }],
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'h2',
              headers: [],
              content: { mimeType: '', size: 0, text: '', encoding: '' },
            },
            timings: {},
          },
        ],
      },
    };

    const entry = parseHar(data as any).entries[0];
    expect(entry.initiator?.lineNumber).toBeUndefined();
    expect(entry.initiator?.columnNumber).toBeUndefined();
    expect(entry.initiator?.stack).toEqual([
      { functionName: 'zeroFrame', url: 'https://example.com/app.js', lineNumber: 0, columnNumber: 0 },
    ]);
    expect(entry.requestCookies).toEqual([
      { name: 'emptyValue', value: '' },
    ]);
  });

  test('parseHar should merge cache booleans without letting false override true', () => {
    const data = {
      log: {
        entries: [
          {
            _fromDiskCache: true,
            _fromServiceWorker: true,
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 5,
            request: { method: 'GET', url: 'https://example.com/cache-merge', headers: [], queryString: [] },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'h2',
              _fromDiskCache: false,
              _fromMemoryCache: false,
              _fromServiceWorker: false,
              headers: [],
              content: { mimeType: '', size: 0, text: '', encoding: '' },
            },
            timings: {},
          },
        ],
      },
    };

    const entry = parseHar(data as any).entries[0];
    expect(entry.cacheInfo).toEqual({
      fromDiskCache: true,
      fromMemoryCache: false,
      fromServiceWorker: true,
      fromCache: true,
    });
  });
});
