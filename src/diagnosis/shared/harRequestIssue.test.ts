import type { HarRequestEntry } from '../../harParser';
import { getHarRequestIssue } from './harRequestIssue';

function entry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'api',
    url: 'https://example.com/api',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '-',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: 'application/json',
    size: 10,
    contentSize: 10,
    time: 100,
    startedDateTime: '2026-06-25T00:00:00.000Z',
    startMs: 0,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 100, receive: 0 },
    timingAvailability: { blocked: true, dns: true, connect: true, ssl: true, send: true, wait: true, receive: true },
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

describe('harRequestIssue', () => {
  test('netError has priority over blockedReason, HTTP error and slow phase', () => {
    const issue = getHarRequestIssue(entry({
      status: 500,
      isFailed: true,
      netErrorText: 'net::ERR_NAME_NOT_RESOLVED',
      netErrorCode: -105,
      blockedReason: 'inspector',
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 2000, receive: 0 },
      time: 2000,
      isSlow: true,
    }));

    expect(issue.kind).toBe('net-error');
    expect(issue.label).toBe('net::ERR_NAME_NOT_RESOLVED');
  });

  test('blockedReason has priority over HTTP error and slow phase', () => {
    const issue = getHarRequestIssue(entry({
      status: 500,
      isFailed: true,
      blockedReason: 'mixed-content',
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 2000, receive: 0 },
      time: 2000,
      isSlow: true,
    }));

    expect(issue.kind).toBe('blocked');
    expect(issue.label).toContain('mixed-content');
  });

  test('HTTP server error has priority over slow phase', () => {
    const issue = getHarRequestIssue(entry({
      status: 500,
      isFailed: true,
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 2000, receive: 0 },
      time: 2000,
      isSlow: true,
    }));

    expect(issue.kind).toBe('server-error');
    expect(issue.roleHint).toBe('backend');
  });

  test('401 and 403 are classified as auth issue', () => {
    expect(getHarRequestIssue(entry({ status: 401, isFailed: true })).kind).toBe('auth');
    expect(getHarRequestIssue(entry({ status: 403, isFailed: true })).kind).toBe('auth');
  });

  test('407 is classified as proxy auth issue', () => {
    const issue = getHarRequestIssue(entry({ status: 407, isFailed: true }));
    expect(issue.kind).toBe('auth');
    expect(issue.roleHint).toBe('it');
  });

  test('other 4xx is classified as HTTP error', () => {
    const issue = getHarRequestIssue(entry({ status: 404, isFailed: true }));
    expect(issue.kind).toBe('http-error');
  });

  test('out-of-range status is not classified as an HTTP 5xx error', () => {
    expect(getHarRequestIssue(entry({ status: 600, isFailed: true })).kind).toBe('unknown-failure');
  });

  test('status=0 with preflight signal is classified as cors', () => {
    const issue = getHarRequestIssue(entry({
      status: 0,
      statusText: '',
      method: 'OPTIONS',
      rawType: 'preflight',
      isFailed: true,
    }));

    expect(issue.kind).toBe('cors');
  });

  test('generic status=0 is classified as status-zero', () => {
    const issue = getHarRequestIssue(entry({ status: 0, statusText: '', isFailed: true }));
    expect(issue.kind).toBe('status-zero');
    expect(issue.detail).toContain('浏览器没有拿到 HTTP 响应');
  });

  test('slow phase uses the largest phase over threshold', () => {
    const issue = getHarRequestIssue(entry({
      time: 2200,
      isSlow: true,
      timings: { blocked: 700, dns: 600, connect: 0, ssl: 0, send: 0, wait: 900, receive: 1500 },
    }));

    expect(issue.kind).toBe('slow');
    expect(issue.phase).toBe('receive');
    expect(issue.label).toContain('下载慢');
  });

  test('wait and blocked over threshold use user-facing labels', () => {
    const ttfb = getHarRequestIssue(entry({
      time: 1000,
      isSlow: true,
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 900, receive: 0 },
    }));
    const queueing = getHarRequestIssue(entry({
      time: 1000,
      isSlow: true,
      timings: { blocked: 600, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
    }));

    expect(ttfb.label).toContain('TTFB 慢');
    expect(queueing.label).toContain('Queueing 慢');
  });

  test('normal 2xx request is normal', () => {
    const issue = getHarRequestIssue(entry({ status: 200, isFailed: false, isSlow: false }));
    expect(issue.kind).toBe('normal');
  });
});
