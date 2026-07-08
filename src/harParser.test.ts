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
    expect(result.entries[0].serverTiming.length).toBeGreaterThan(0);
    expect(result.entries[0].serverTiming[0].name).toBe('app');
    expect(result.entries[0].xTtLogid).toBe('abc');
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
});
