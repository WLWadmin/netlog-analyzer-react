import type { HarRequestEntry } from '../../harParser';
import { buildHarIssueClusters } from './harIssueClusters';

function entry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 0,
    name: 'api',
    url: 'https://example.com/api?token=SECRET_QUERY',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '-',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: '',
    size: 0,
    contentSize: 0,
    time: 120,
    startedDateTime: '',
    startMs: 1000,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 118, receive: 1 },
    timingAvailability: { blocked: true, dns: true, connect: true, ssl: true, send: true, wait: true, receive: true },
    requestHeaders: [{ name: 'authorization', value: 'Bearer SECRET_AUTH' }],
    responseHeaders: [],
    responseBody: 'SECRET_BODY',
    responseEncoding: '',
    queryString: [{ name: 'token', value: 'SECRET_QUERY' }],
    requestCookies: [{ name: 'session', value: 'SECRET_COOKIE' }],
    responseCookies: [],
    serverTiming: [],
    xTtLogid: '',
    xTtCip: '',
    xLscSourceIp: '',
    isFailed: false,
    isSlow: false,
    ...overrides,
  };
}

describe('buildHarIssueClusters', () => {
  it('clusters same-domain same netError in the same time window', () => {
    const clusters = buildHarIssueClusters([
      entry({ id: 0, status: 0, isFailed: true, netErrorText: 'net::ERR_NAME_NOT_RESOLVED', netErrorCode: -105, startMs: 1000 }),
      entry({ id: 1, status: 0, isFailed: true, netErrorText: 'net::ERR_NAME_NOT_RESOLVED', netErrorCode: -105, startMs: 2500, time: 300 }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      category: 'dns',
      evidenceLevel: 'explicit-observation',
      affectedRequestCount: 2,
      affectedDomainCount: 1,
      requiresNetLog: true,
    });
    expect(clusters[0].representativeRequestIds).toEqual([0, 1]);
  });

  it('does not merge different domains', () => {
    const clusters = buildHarIssueClusters([
      entry({ id: 0, status: 0, isFailed: true, netErrorText: 'net::ERR_NAME_NOT_RESOLVED', netErrorCode: -105, domain: 'a.example', url: 'https://a.example/api' }),
      entry({ id: 1, status: 0, isFailed: true, netErrorText: 'net::ERR_NAME_NOT_RESOLVED', netErrorCode: -105, domain: 'b.example', url: 'https://b.example/api' }),
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters.map(cluster => cluster.affectedDomainCount)).toEqual([1, 1]);
  });

  it('splits same-domain issues by five-second windows', () => {
    const clusters = buildHarIssueClusters([
      entry({ id: 0, status: 500, isFailed: true, startMs: 1000 }),
      entry({ id: 1, status: 500, isFailed: true, startMs: 8000 }),
    ]);

    expect(clusters).toHaveLength(2);
  });

  it('creates stable single-request unknown failure cluster without guessing cause', () => {
    const clusters = buildHarIssueClusters([
      entry({ id: 0, status: 0, isFailed: true, netErrorText: undefined, netErrorCode: undefined }),
    ]);

    expect(clusters[0].category).toBe('unknown-failure');
    expect(clusters[0].evidenceLevel).toBe('insufficient');
    expect(clusters[0].title).toContain('HAR 缺少更底层错误');
  });

  it('does not put query, cookies, auth or body into evidence text', () => {
    const clusters = buildHarIssueClusters([
      entry({ id: 0, status: 500, isFailed: true }),
    ]);
    const text = JSON.stringify(clusters);

    expect(text).not.toContain('SECRET_QUERY');
    expect(text).not.toContain('SECRET_AUTH');
    expect(text).not.toContain('SECRET_COOKIE');
    expect(text).not.toContain('SECRET_BODY');
  });

  it('sorts by severity, request count and duration', () => {
    const clusters = buildHarIssueClusters([
      entry({ id: 0, status: 200, time: 1800, isSlow: true, timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 1798, receive: 1 } }),
      entry({ id: 1, status: 500, isFailed: true, time: 100 }),
    ]);

    expect(clusters[0].category).toBe('server-error');
  });

  it.each([
    ['TLS net error', { status: 0, isFailed: true, netErrorText: 'net::ERR_CERT_AUTHORITY_INVALID', netErrorCode: -202 }, 'tls'],
    ['proxy auth', { status: 407, isFailed: true }, 'proxy'],
    ['blockedReason', { status: 0, isFailed: true, blockedReason: 'mixed-content' }, 'browser-block'],
    ['401', { status: 401, isFailed: true }, 'auth'],
    ['403', { status: 403, isFailed: true }, 'auth'],
    ['404', { status: 404, isFailed: true }, 'http-error'],
    ['500', { status: 500, isFailed: true }, 'server-error'],
  ])('classifies %s', (_name, overrides, category) => {
    const clusters = buildHarIssueClusters([entry({ id: 0, ...(overrides as Partial<HarRequestEntry>) })]);
    expect(clusters[0].category).toBe(category);
  });

  it('marks CORS heuristic as suspicious instead of explicit fact', () => {
    const clusters = buildHarIssueClusters([
      entry({
        id: 0,
        status: 0,
        isFailed: true,
        method: 'OPTIONS',
        rawType: 'preflight',
      }),
    ]);

    expect(clusters[0].category).toBe('cors');
    expect(clusters[0].evidenceLevel).toBe('heuristic');
  });

  it.each([
    ['net::ERR_NAME_NOT_RESOLVED', 'dns'],
    ['net::ERR_CONNECTION_TIMED_OUT', 'connection'],
    ['net::ERR_CERT_AUTHORITY_INVALID', 'tls'],
    ['net::ERR_PROXY_CONNECTION_FAILED', 'proxy'],
    ['net::ERR_BLOCKED_BY_CLIENT', 'browser-block'],
  ])('classifies text-only netError %s', (netErrorText, category) => {
    const clusters = buildHarIssueClusters([
      entry({ id: 0, status: 0, isFailed: true, netErrorText, netErrorCode: undefined }),
    ]);

    expect(clusters[0].category).toBe(category);
    expect(clusters[0].evidenceLevel).toBe('explicit-observation');
  });

  it('keeps one isolated slow request as an info-level request observation', () => {
    const clusters = buildHarIssueClusters([
      entry({
        id: 0,
        time: 3200,
        isSlow: true,
        timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 100, receive: 3099 },
      }),
      entry({ id: 1, time: 100, isSlow: false }),
    ]);

    expect(clusters[0]).toMatchObject({ category: 'download', severity: 'info', affectedRequestCount: 1 });
    expect(clusters[0].title).not.toContain('集中');
  });

  it('merges request role hints with the category playbook roles', () => {
    const cors = buildHarIssueClusters([
      entry({ id: 0, status: 0, isFailed: true, method: 'OPTIONS', rawType: 'preflight' }),
    ])[0];
    const auth = buildHarIssueClusters([
      entry({ id: 0, status: 401, isFailed: true }),
    ])[0];
    const download = buildHarIssueClusters([
      entry({
        id: 0,
        time: 2200,
        isSlow: true,
        timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 100, receive: 2099 },
      }),
    ])[0];

    expect(cors.roleHints).toEqual(expect.arrayContaining(['frontend', 'backend']));
    expect(auth.roleHints).toEqual(expect.arrayContaining(['user', 'frontend', 'backend']));
    expect(download.roleHints).toEqual(expect.arrayContaining(['frontend', 'it']));
  });
});
