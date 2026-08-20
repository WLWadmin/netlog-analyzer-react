import { parseHar, type HarRequestEntry } from '../../harParser';
import { buildHarRequestCopyText, sanitizeHarUrl } from './buildHarRequestCopyText';

function entry(overrides: Partial<HarRequestEntry> = {}): HarRequestEntry {
  return {
    id: 1,
    name: 'api',
    url: 'https://example.com/api?token=SECRET_QUERY#fragment',
    method: 'POST',
    status: 0,
    statusText: '',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '203.0.113.10',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: 'application/json',
    size: 0,
    contentSize: 0,
    time: 1200,
    startedDateTime: '2026-07-10T00:00:00.000Z',
    startMs: 1000,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 1199, receive: 0 },
    timingAvailability: { blocked: true, dns: false, connect: false, ssl: false, send: true, wait: true, receive: true },
    requestHeaders: [
      { name: 'authorization', value: 'Bearer SECRET_AUTH' },
      { name: 'cookie', value: 'session=SECRET_COOKIE' },
    ],
    responseHeaders: [{ name: 'set-cookie', value: 'session=SECRET_SET_COOKIE' }],
    responseBody: 'SECRET_RESPONSE_BODY',
    responseEncoding: '',
    queryString: [{ name: 'token', value: 'SECRET_QUERY' }],
    postData: { mimeType: 'application/json', text: 'SECRET_REQUEST_BODY' },
    requestCookies: [{ name: 'session', value: 'SECRET_COOKIE' }],
    responseCookies: [{ name: 'session', value: 'SECRET_SET_COOKIE' }],
    serverTiming: [{ name: 'app', dur: 12 }],
    xTtLogid: 'log-1',
    xTtCip: '',
    xLscSourceIp: '',
    isFailed: true,
    isSlow: true,
    ...overrides,
    standard: overrides.standard ?? parseHar({
      log: {
        entries: [{
          request: { method: 'GET', url: 'https://example.test/', headers: [] },
          response: { status: overrides.status ?? 0, headers: [], content: {} },
          timings: { send: 0, wait: 0, receive: 0 },
        }],
      },
    }).entries[0].standard,
  };
}

describe('buildHarRequestCopyText', () => {
  it('removes query, body, cookie and authorization values from the summary', () => {
    const text = buildHarRequestCopyText(entry());

    expect(text).toContain('URL: https://example.com/api');
    expect(text).toContain('Status: 浏览器未拿到 HTTP 响应');
    expect(text).toContain('DNS: 未记录');
    expect(text).toContain('Queueing: 0 ms');
    expect(text).toContain('Server-Timing: app=12 ms');
    expect(text).toContain('证据边界: HAR 可看到请求现象');
    expect(text).not.toContain('SECRET_QUERY');
    expect(text).not.toContain('SECRET_AUTH');
    expect(text).not.toContain('SECRET_COOKIE');
    expect(text).not.toContain('SECRET_SET_COOKIE');
    expect(text).not.toContain('SECRET_REQUEST_BODY');
    expect(text).not.toContain('SECRET_RESPONSE_BODY');
  });

  it('sanitizes malformed URLs without leaking query or hash', () => {
    expect(sanitizeHarUrl('not-a-url/path?secret=1#hash')).toBe('not-a-url/path');
  });
});
