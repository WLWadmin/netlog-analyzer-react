import { parseHar, type HarAnalysisResult } from '../../harParser';
import type { HarDiagnosisResult } from '../../harDiagnosis';
import type { AnalysisResult, ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import { harDiagnosisToCards } from './fromHar';
import { netlogToCards } from './fromNetlog';
import { combinedDiagnosisToCards } from './fromCombined';
import { generateNextStepInfo, generateSuggestions } from '../../parsers/netlog/diagnosis';
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

  it('keeps structured NetLog suggestion categories and neutralizes causal claims', () => {
    const sslEvent = event({
      time: 1100,
      typeName: 'SSL_CONNECT',
      source: { id: 1, type: 1, typeName: 'URL_REQUEST' },
      params: { net_error: -202 },
    });
    const result = netlogResult({
      urlRequests: [urlRequest({ status: 'error', error: -202 })],
      sslEvents: [sslEvent],
      connectionFailures: [{ url: 'https://api.example.test/v1/resource', error: -202, time: 1100 }],
    });

    const cards = netlogToCards(result, generateSuggestions(result), [sslEvent]);
    const errorCard = cards.find(card => card.title.includes('-202'));

    expect(errorCard?.category).toBe('tls');
    expect(errorCard?.conclusion).toContain('可确认错误现象');
    expect(errorCard?.conclusion).not.toContain('90%');
    expect(errorCard?.conclusion).not.toContain('根因');
  });

  it('keeps generic ERR_FAILED outside the server category', () => {
    const request = urlRequest({ status: 'error', error: -2 });
    const result = netlogResult({
      urlRequests: [request],
      connectionFailures: [{ requestId: request.id, url: request.url, error: -2, time: 1100 }],
    });

    const card = netlogToCards(result, generateSuggestions(result), [])
      .find(item => item.title.includes('-2'));

    expect(card?.category).toBe('unknown');
    expect(card?.conclusion).toContain('可确认错误现象');
    expect(card?.conclusion).not.toContain('服务端');
  });

  it('reports the full matched failure scope even when navigation ids are capped', () => {
    const requests = Array.from({ length: 12 }, (_, index) => urlRequest({
      id: index + 1,
      url: `https://api.example.test/v1/resource/${index}`,
      status: 'error',
      error: -2,
    }));
    const result = netlogResult({
      urlRequests: requests,
      connectionFailures: requests.map((request, index) => ({
        requestId: request.id,
        url: request.url,
        error: -2,
        time: 1100 + index,
      })),
    });

    const card = netlogToCards(result, generateSuggestions(result), [])
      .find(item => item.title.includes('-2'));

    expect(card?.relatedRequestIds).toHaveLength(10);
    expect(card?.scope.affectedRequestCount).toBe(12);
  });

  it('routes ERR_INTERNET_DISCONNECTED to connectivity recovery instead of DNS', () => {
    const result = netlogResult({
      connectionFailures: [{ url: 'https://api.example.test/v1/resource', error: -106, time: 1100 }],
    });
    const categories = generateNextStepInfo(result).map(step => step.category);

    expect(categories).toContain('📶 本机网络连接恢复');
    expect(categories).not.toContain('🌐 DNS 问题进一步排查');
  });

  it('does not classify a mixed failed-domain summary as DNS root cause', () => {
    const result = netlogResult({
      failedDomains: [{
        domain: 'api.example.test',
        urls: ['https://api.example.test/v1/resource'],
        errors: [
          { code: -102, desc: 'ERR_CONNECTION_REFUSED', time: 1000 },
          { code: -202, desc: 'ERR_CERT_AUTHORITY_INVALID', time: 1100 },
        ],
        errorCodes: [-102, -202],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 2,
        firstTime: 1000,
        lastTime: 1100,
      }],
    });
    const suggestion = generateSuggestions(result).find(item => item.title.includes('报错域名汇总'));

    expect(suggestion?.category).toBe('unknown');
    expect(suggestion?.conclusion).toContain('不能仅凭域名数量判断为 DNS 或防火墙问题');
  });

  it('treats local-address DNS answers as a candidate instead of confirmed hijacking', () => {
    const result = netlogResult({
      failedDomains: [{
        domain: 'api.example.test',
        urls: ['https://api.example.test/v1/resource'],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1000 }],
        errorCodes: [-105],
        ips: ['127.0.0.1'],
        resolvedIp: '127.0.0.1',
        remoteIp: null,
        count: 1,
        firstTime: 1000,
        lastTime: 1000,
      }],
    });
    const suggestion = generateSuggestions(result).find(item => item.title.includes('本地地址'));

    expect(suggestion?.severity).toBe('warning');
    expect(suggestion?.title).not.toContain('劫持');
    expect(suggestion?.conclusion).toContain('不能单独确认运营商 DNS 故障');
  });

  it('does not turn cache event count into affected request count', () => {
    const cacheEvents = Array.from({ length: 30 }, (_, index) => event({
      time: 1000 + index,
      typeName: 'HTTP_CACHE_OPEN_ENTRY',
      source: { id: 100 + index, type: 2, typeName: 'HTTP_CACHE' },
    }));
    const cards = netlogToCards(netlogResult({
      urlRequests: [urlRequest({})],
      cacheEvents,
    }), [], cacheEvents);
    const cacheCard = cards.find(card => card.id.startsWith('netlog-cache-decision'));

    expect(cacheCard?.severity).toBe('info');
    expect(cacheCard?.scope.affectedRequestCount).toBeUndefined();
    expect(cacheCard?.scope.summary).toContain('30 条缓存事件');
  });

  it('does not use unrelated nearby events as cross-layer failure evidence', () => {
    const requests = [
      urlRequest({ id: 1, url: 'https://one.example.test/a', status: 'error', error: -2, startTime: 1000 }),
      urlRequest({ id: 2, url: 'https://two.example.test/b', status: 'error', error: -2, startTime: 2000 }),
    ];
    const unrelatedCacheEvents = [
      event({ time: 1001, typeName: 'HTTP_CACHE_OPEN_ENTRY', source: { id: 91, type: 2, typeName: 'HTTP_CACHE' } }),
      event({ time: 2001, typeName: 'HTTP_CACHE_OPEN_ENTRY', source: { id: 92, type: 2, typeName: 'HTTP_CACHE' } }),
    ];
    const requestEvents = requests.map(request => event({
      time: request.startTime,
      source: { id: request.id, type: 1, typeName: 'URL_REQUEST' },
      params: { url: request.url },
    }));
    const cards = netlogToCards(netlogResult({
      urlRequests: requests,
      connectionFailures: [
        { url: requests[0].url, error: -2, time: 1000 },
        { url: requests[1].url, error: -2, time: 2000 },
      ],
      cacheEvents: unrelatedCacheEvents,
    }), [], [...requestEvents, ...unrelatedCacheEvents]);

    expect(cards.some(card => card.id.startsWith('netlog-time-correlation'))).toBe(false);
  });

  it('sanitizes query values in NetLog lifecycle evidence', () => {
    const secret = 'LIFECYCLE_SECRET';
    const request = urlRequest({
      url: `https://api.example.test/v1/resource?token=${secret}`,
      duration: 4000,
      status: 'success',
      timeline: { wait: { start: 1000, end: 5000, duration: 4000 } },
    });
    const requestEvent = event({
      source: { id: request.id, type: 1, typeName: 'URL_REQUEST' },
      params: { url: request.url },
    });
    const cards = netlogToCards(netlogResult({
      urlRequests: [request],
      slowRequests: [request],
    }), [], [requestEvent]);

    expect(JSON.stringify(cards)).not.toContain(secret);
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
    // 同域 DNS aggregate 未绑定到 URL_REQUEST source，只能保持中置信度。
    expect(cardSignature(cards).slice(0, 1)).toEqual([
      { source: 'combined', category: 'dns', severity: 'critical', confidence: 'medium', evidenceCount: 7, limitationCount: 3 },
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
      connectionFailures: [{ requestId: 101, url: 'https://api.example.test/v1/resource', error: -105, time: 1200 }],
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
