import { parseHar, type HarAnalysisResult } from '../../harParser';
import type { HarDiagnosisResult } from '../../harDiagnosis';
import type { AnalysisResult, ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import { harDiagnosisToCards } from './fromHar';
import { netlogToCards } from './fromNetlog';
import { combinedDiagnosisToCards } from './fromCombined';
import type { DiagnosticCard } from './types';

const SECRET_QUERY = 'SECRET_QUERY_VALUE';
const SECRET_BODY = 'SECRET_BODY_VALUE';
const SECRET_AUTH = 'SECRET_AUTH_VALUE';
const SECRET_COOKIE = 'SECRET_COOKIE_VALUE';

function rawHarEntry(overrides: Record<string, any>) {
  return {
    startedDateTime: '2026-07-12T00:00:00.000Z',
    time: 1800,
    request: {
      method: 'GET',
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
      status: 200,
      statusText: 'OK',
      headers: [],
      cookies: [],
      content: { size: 0, mimeType: 'application/json', text: '' },
    },
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 1798, receive: 1 },
    ...overrides,
  };
}

function parseFixtureHar(entries: Record<string, any>[]): HarAnalysisResult {
  return parseHar({
    log: {
      version: '1.2',
      creator: { name: 'Synthetic', version: '1.0' },
      entries: entries.map(rawHarEntry),
    },
  });
}

function harDiagnosis(overrides: Partial<HarDiagnosisResult> = {}): HarDiagnosisResult {
  return {
    overallStatus: 'critical',
    healthScore: 45,
    summary: 'synthetic diagnosis',
    findings: [],
    totalRequests: 1,
    domainCount: 1,
    networkStatus: [],
    httpStatus: { total: 1, count2xx: 0, count3xx: 0, count4xx: 0, count5xx: 1, count0: 0, countFailed: 1 },
    cacheStats: { cachedCount: 0, uncachedCount: 1, cacheRate: 0 },
    securityStats: { mixedContentCount: 0, missingSecurityHeaders: [] },
    attributions: [],
    duplicateRequests: [],
    uncompressedLargeResources: [],
    ...overrides,
  } as unknown as HarDiagnosisResult;
}

function event(overrides: Partial<ParsedEvent>): ParsedEvent {
  return {
    time: 1000,
    type: 0,
    typeName: 'URL_REQUEST',
    source: { id: 1, type: 1, typeName: 'URL_REQUEST' },
    phase: 0,
    phaseName: 'PHASE_NONE',
    params: {},
    ...overrides,
  };
}

function urlRequest(overrides: Partial<URLRequest>): URLRequest {
  return {
    id: 1,
    url: 'https://api.example.test/v1/resource',
    method: 'GET',
    startTime: 1000,
    duration: 1800,
    statusCode: 200,
    events: [],
    timeline: {},
    ...overrides,
  };
}

function netlogResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    totalEvents: 100,
    uniqueSources: 4,
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

function cardSignature(cards: DiagnosticCard[]) {
  return cards.map(card => ({
    source: card.source,
    category: card.category,
    severity: card.severity,
    confidence: card.confidence,
    evidenceCount: card.evidence.length,
    limitationCount: card.limitations?.length || 0,
  }));
}

function expectNoSensitiveLeak(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(SECRET_QUERY);
  expect(text).not.toContain(SECRET_BODY);
  expect(text).not.toContain(SECRET_AUTH);
  expect(text).not.toContain(SECRET_COOKIE);
}

function expectNoConfirmedRootCause(cards: DiagnosticCard[]) {
  const text = JSON.stringify(cards);
  expect(text).not.toContain('确定根因');
  expect(text).not.toContain('确认根因');
  expect(text).not.toContain('一定是');
  expect(text).not.toContain('责任方就是');
}

describe('Diagnosis Golden Baseline', () => {
  it('freezes HAR-only card shape and privacy boundary', () => {
    const har = parseFixtureHar([
      {
        time: 120,
        response: {
          status: 500,
          statusText: 'Server Error',
          headers: [],
          cookies: [],
          content: { size: 0, mimeType: 'application/json', text: SECRET_BODY },
        },
      },
    ]);

    const cards = harDiagnosisToCards(har, harDiagnosis());

    expect(cardSignature(cards)).toEqual([
      { source: 'har', category: 'server', severity: 'critical', confidence: 'high', evidenceCount: 4, limitationCount: 1 },
    ]);
    expectNoSensitiveLeak(cards);
    expectNoConfirmedRootCause(cards);
  });

  it('freezes NetLog-only proxy environment as observation, not root cause', () => {
    const cards = netlogToCards(netlogResult({
      urlRequests: [urlRequest({})],
      proxyInfo: {
        hasProxy: true,
        proxyType: 'PAC',
        proxySettings: null,
        effectiveProxy: null,
        originalProxy: null,
        pacUrl: 'https://proxy.example.test/proxy.pac',
        proxyList: ['PROXY proxy.example.test:8080'],
        proxyFallback: null,
        isVPN: false,
        vpnHints: [],
      },
    }), []);

    const proxyCards = cards.filter(card => card.category === 'proxy');
    expect(proxyCards).toHaveLength(2);
    expect(proxyCards.map(card => ({ severity: card.severity, source: card.source }))).toEqual([
      { severity: 'info', source: 'netlog' },
      { severity: 'info', source: 'netlog' },
    ]);
    expectNoConfirmedRootCause(proxyCards);
  });

  it('sanitizes PAC query values and proxy credentials in NetLog cards', () => {
    const cards = netlogToCards(netlogResult({
      urlRequests: [urlRequest({})],
      proxyInfo: {
        hasProxy: true,
        proxyType: 'PAC',
        proxySettings: null,
        effectiveProxy: null,
        originalProxy: null,
        pacUrl: 'https://proxy.example.test/proxy.pac?token=PAC_SECRET',
        proxyList: ['PROXY user:PROXY_SECRET@proxy.example.test:8080'],
        proxyFallback: null,
        isVPN: false,
        vpnHints: [],
      },
    }), []);
    const text = JSON.stringify(cards);

    expect(text).not.toContain('PAC_SECRET');
    expect(text).not.toContain('PROXY_SECRET');
  });

  it('freezes combined DNS correlation without leaking query values', () => {
    const har = parseFixtureHar([
      {
        time: 1800,
        timings: { blocked: 0, dns: 600, connect: 0, ssl: 0, send: 1, wait: 1198, receive: 1 },
      },
    ]);
    const netlog = netlogResult({
      urlRequests: [urlRequest({ id: 101, url: 'https://api.example.test/v1/resource' })],
      failedDomains: [{
        domain: 'api.example.test',
        urls: ['https://api.example.test/v1/resource'],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1200 }],
        errorCodes: [-105],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 1,
        firstTime: 1200,
        lastTime: 1200,
      }],
      dnsEvents: [event({ time: 1200, typeName: 'HOST_RESOLVER_IMPL_JOB', source: { id: 301, type: 1, typeName: 'HOST_RESOLVER_IMPL_JOB' } })],
    });

    const cards = combinedDiagnosisToCards(har, netlog);

    // Diagnosis Batch 2: query value 不再参与请求关联；同 origin + pathname + method 可作为强关联。
    // Diagnosis Batch 3: 双源融合会追加 HAR/NetLog observation 证据。
    expect(cardSignature(cards).slice(0, 1)).toEqual([
      { source: 'combined', category: 'dns', severity: 'critical', confidence: 'high', evidenceCount: 7, limitationCount: 3 },
    ]);
    expectNoSensitiveLeak(cards);
    expectNoConfirmedRootCause(cards);
  });

  it('creates a combined card for a correlated explicit failure even when the HAR request is not slow', () => {
    const har = parseFixtureHar([{
      time: 100,
      _netError: 'net::ERR_NAME_NOT_RESOLVED',
      response: {
        status: 0,
        statusText: '',
        headers: [],
        cookies: [],
        content: { size: 0, mimeType: '', text: '' },
      },
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
    }]);
    const netlog = netlogResult({
      urlRequests: [urlRequest({ id: 101, duration: 100, status: 'error' })],
      failedDomains: [{
        domain: 'api.example.test',
        urls: ['https://api.example.test/v1/resource'],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1200 }],
        errorCodes: [-105],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 1,
        firstTime: 1200,
        lastTime: 1200,
      }],
    });

    const cards = combinedDiagnosisToCards(har, netlog);

    expect(cards).toContainEqual(expect.objectContaining({ source: 'combined', category: 'dns', confidence: 'high' }));
    expectNoSensitiveLeak(cards);
  });
});
