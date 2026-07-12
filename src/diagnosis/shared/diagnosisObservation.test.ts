import { parseHar } from '../../harParser';
import type { AnalysisResult, ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import { buildHarObservations, buildNetlogObservations } from './diagnosisObservation';

const SECRET_QUERY = 'SECRET_QUERY_VALUE';
const SECRET_AUTH = 'SECRET_AUTH_VALUE';
const SECRET_COOKIE = 'SECRET_COOKIE_VALUE';
const SECRET_BODY = 'SECRET_BODY_VALUE';

function parseFixtureHar(status: number, extra: Record<string, any> = {}) {
  return parseHar({
    log: {
      version: '1.2',
      creator: { name: 'Synthetic', version: '1.0' },
      entries: [{
        startedDateTime: '2026-07-12T00:00:00.000Z',
        time: extra.time ?? 120,
        request: {
          method: extra.method || 'GET',
          url: `https://api.example.test/v1/resource?token=${SECRET_QUERY}`,
          headers: [
            { name: 'Authorization', value: `Bearer ${SECRET_AUTH}` },
            { name: 'Cookie', value: `sid=${SECRET_COOKIE}` },
          ],
          cookies: [{ name: 'sid', value: SECRET_COOKIE }],
          queryString: [{ name: 'token', value: SECRET_QUERY }],
          postData: { text: SECRET_BODY },
        },
        response: {
          status,
          statusText: status === 0 ? '' : status >= 500 ? 'Server Error' : 'OK',
          headers: [],
          cookies: [],
          content: { size: 0, mimeType: 'application/json', text: SECRET_BODY },
        },
        timings: extra.timings || { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 118, receive: 1 },
        ...extra,
      }],
    },
  });
}

function event(overrides: Partial<ParsedEvent>): ParsedEvent {
  return {
    time: 1000,
    type: 0,
    typeName: 'SSL_CONNECT_JOB',
    source: { id: 7, type: 1, typeName: 'SSL_CONNECT_JOB' },
    phase: 0,
    phaseName: 'PHASE_NONE',
    params: {},
    ...overrides,
  };
}

function request(overrides: Partial<URLRequest>): URLRequest {
  return {
    id: 12,
    url: `https://api.example.test/v1/resource?token=${SECRET_QUERY}`,
    method: 'GET',
    startTime: 1000,
    duration: 1600,
    statusCode: 200,
    events: [],
    timeline: {},
    ...overrides,
  };
}

function netlogResult(overrides: Partial<AnalysisResult>): AnalysisResult {
  return {
    totalEvents: 100,
    uniqueSources: 3,
    peakConcurrency: 1,
    urlRequests: [],
    sslEvents: [],
    quicEvents: [],
    http2Events: [],
    dnsEvents: [],
    connectEvents: [],
    proxyEvents: [],
    errors: [],
    warnings: [],
    info: [],
    timeRange: { start: 1000, end: 3000 },
    protocols: {},
    hosts: {},
    dnsServers: [],
    dnsRecords: [],
    dohCandidates: [],
    errorSources: {},
    certIssues: [],
    sslIssues: [],
    connectionFailures: [],
    stalledRequests: [],
    slowRequests: [],
    cacheEvents: [],
    networkChanges: [],
    proxyInfo: {
      hasProxy: false,
      proxyType: null,
      proxySettings: null,
      effectiveProxy: null,
      originalProxy: null,
      pacUrl: null,
      proxyList: [],
      proxyFallback: null,
      isVPN: false,
      vpnHints: [],
    },
    failedDomains: [],
    systemInfo: { os: null, browser: null, netLogVersion: null, commandLine: null },
    ...overrides,
  };
}

function expectNoSensitiveLeak(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(SECRET_QUERY);
  expect(text).not.toContain(SECRET_AUTH);
  expect(text).not.toContain(SECRET_COOKIE);
  expect(text).not.toContain(SECRET_BODY);
}

describe('diagnosisObservation', () => {
  it.each([
    ['DNS status=0', parseFixtureHar(0, { _failureText: 'net::ERR_NAME_NOT_RESOLVED' }), 'unknown', 'insufficient'],
    ['HTTP 5xx', parseFixtureHar(500), 'server', 'confirmed-observation'],
    ['TTFB slow', parseFixtureHar(200, { time: 1800, timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 1798, receive: 1 } }), 'server', 'supporting'],
  ])('builds HAR observation for %s', (_name, har, category, evidenceLevel) => {
    const observations = buildHarObservations(har.entries);

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ source: 'har', category, evidenceLevel, primary: true });
    expectNoSensitiveLeak(observations);
  });

  it('keeps only one primary observation for one HAR request with multiple signals', () => {
    const har = parseFixtureHar(500, {
      time: 1800,
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 1798, receive: 1 },
    });

    const observations = buildHarObservations(har.entries);

    expect(observations.filter(observation => observation.subject.requestId === har.entries[0].id && observation.primary)).toHaveLength(1);
    expect(observations[0].category).toBe('server');
  });

  it('builds NetLog observations from structured failures and slow requests', () => {
    const observations = buildNetlogObservations(netlogResult({
      failedDomains: [{
        domain: 'api.example.test',
        urls: [`https://api.example.test/v1/resource?token=${SECRET_QUERY}`],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1200 }],
        errorCodes: [-105],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 1,
        firstTime: 1200,
        lastTime: 1200,
      }],
      certIssues: [{ event: event({}), error: -202, host: 'tls.example.test', category: 'cert' }],
      slowRequests: [request({})],
    }));

    expect(observations.map(item => item.category).sort()).toEqual(['dns', 'performance', 'tls']);
    expect(observations.every(item => item.primary || item.category === 'quality')).toBe(true);
    expectNoSensitiveLeak(observations);
  });

  it('marks preview NetLog dataset as incomplete evidence', () => {
    const observations = buildNetlogObservations(netlogResult({
      largeFileMode: {
        enabled: true,
        fileSize: 100,
        bytesRead: 20,
        parsedEvents: 10,
        skippedEvents: 0,
        truncatedEventsPreview: true,
        reachedEventsEnd: false,
      },
    }), { datasetComplete: false });

    expect(observations).toContainEqual(expect.objectContaining({
      id: 'netlog:dataset:preview-incomplete',
      category: 'quality',
      evidenceLevel: 'insufficient',
      requiresMoreEvidence: true,
      primary: false,
    }));
  });
});
