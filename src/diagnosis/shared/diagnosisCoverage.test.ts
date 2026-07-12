import { parseHar } from '../../harParser';
import type { AnalysisResult, URLRequest } from '../../parsers/netlog/parser';
import { buildHarObservations, buildNetlogObservations } from './diagnosisObservation';
import { calculateCombinedDiagnosisCoverage, calculateHarDiagnosisCoverage, calculateNetlogDiagnosisCoverage } from './diagnosisCoverage';

function parseFixtureHar() {
  return parseHar({
    log: {
      version: '1.2',
      creator: { name: 'Synthetic', version: '1.0' },
      entries: [
        {
          startedDateTime: '2026-07-12T00:00:00.000Z',
          time: 100,
          request: { method: 'GET', url: 'https://api.example.test/500', headers: [], cookies: [], queryString: [] },
          response: { status: 500, statusText: 'Server Error', headers: [], cookies: [], content: { size: 0, mimeType: '', text: '' } },
          timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 98, receive: 1 },
        },
        {
          startedDateTime: '2026-07-12T00:00:02.000Z',
          time: 100,
          request: { method: 'GET', url: 'https://api.example.test/status-zero', headers: [], cookies: [], queryString: [] },
          response: { status: 0, statusText: '', headers: [], cookies: [], content: { size: 0, mimeType: '', text: '' } },
          timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
        },
        {
          startedDateTime: '2026-07-12T00:00:04.000Z',
          time: 100,
          request: { method: 'GET', url: 'https://api.example.test/ok', headers: [], cookies: [], queryString: [] },
          response: { status: 200, statusText: 'OK', headers: [], cookies: [], content: { size: 0, mimeType: '', text: '' } },
          timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 98, receive: 1 },
        },
      ],
    },
  });
}

function request(overrides: Partial<URLRequest>): URLRequest {
  return {
    id: 1,
    url: 'https://api.example.test/slow',
    method: 'GET',
    startTime: 1000,
    duration: 1800,
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

describe('diagnosisCoverage', () => {
  it('calculates HAR explained, partial and unexplained coverage', () => {
    const har = parseFixtureHar();
    const observations = buildHarObservations(har.entries);
    const coverage = calculateHarDiagnosisCoverage(har.entries, observations);

    expect(coverage).toMatchObject({
      totalAbnormalObjects: 2,
      explained: 1,
      partiallyExplained: 0,
      unexplained: 1,
      excluded: 0,
      denominatorMayBeIncomplete: false,
    });
    expect(coverage.coverageRate).toBe(0.5);
    expect(coverage.unexplainedRequestIds).toEqual([1]);
  });

  it('keeps unknown errors in denominator when observation is missing', () => {
    const har = parseFixtureHar();
    const coverage = calculateHarDiagnosisCoverage(har.entries, []);

    expect(coverage.totalAbnormalObjects).toBe(2);
    expect(coverage.unexplained).toBe(2);
    expect(coverage.reasons).toContainEqual({ reason: '没有匹配 observation', count: 2 });
  });

  it('calculates NetLog coverage and marks preview denominator as incomplete', () => {
    const result = netlogResult({
      failedDomains: [{
        domain: 'api.example.test',
        urls: ['https://api.example.test/a'],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1200 }],
        errorCodes: [-105],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 1,
        firstTime: 1200,
        lastTime: 1200,
      }],
      slowRequests: [request({ id: 9 })],
      largeFileMode: {
        enabled: true,
        fileSize: 100,
        bytesRead: 20,
        parsedEvents: 10,
        skippedEvents: 0,
        truncatedEventsPreview: true,
        reachedEventsEnd: false,
      },
    });
    const observations = buildNetlogObservations(result, { datasetComplete: false });
    const coverage = calculateNetlogDiagnosisCoverage(result, observations, { datasetComplete: false });

    expect(coverage.totalAbnormalObjects).toBe(2);
    expect(coverage.explained).toBe(1);
    expect(coverage.partiallyExplained).toBe(1);
    expect(coverage.unexplained).toBe(0);
    expect(coverage.denominatorMayBeIncomplete).toBe(true);
    expect(coverage.reasons).toContainEqual({ reason: 'Dataset 可能不完整，覆盖率分母可能偏低', count: 1 });
  });

  it('counts a connection failure once and links it through its domain observation', () => {
    const result = netlogResult({
      connectionFailures: [{ url: 'https://api.example.test/data?token=SECRET', error: -102, time: 1200 }],
      failedDomains: [{
        domain: 'api.example.test',
        urls: ['https://api.example.test/data?token=SECRET'],
        errors: [{ code: -102, desc: 'ERR_CONNECTION_REFUSED', time: 1200 }],
        errorCodes: [-102],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 1,
        firstTime: 1200,
        lastTime: 1200,
      }],
    });
    const observations = buildNetlogObservations(result);
    const coverage = calculateNetlogDiagnosisCoverage(result, observations);

    expect(coverage).toMatchObject({ totalAbnormalObjects: 1, explained: 1, unexplained: 0 });
    expect(JSON.stringify(observations)).not.toContain('SECRET');
  });

  it('deduplicates strongly correlated HAR and NetLog failures in combined coverage', () => {
    const har = parseFixtureHar();
    const harObservations = buildHarObservations(har.entries);
    const result = netlogResult({
      failedDomains: [{
        domain: 'api.example.test',
        urls: ['https://api.example.test/status-zero'],
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
    const coverage = calculateCombinedDiagnosisCoverage(harObservations, buildNetlogObservations(result), [{
      harRequestId: 1,
      netlogSourceIds: [10],
      candidateCount: 1,
      level: 'same-origin-path-method',
      score: 0.9,
      reasons: ['same path'],
      conflicts: [],
      safeKey: 'GET https://api.example.test/status-zero',
    }]);

    expect(coverage.totalAbnormalObjects).toBe(2);
    expect(coverage.explained).toBe(2);
  });
});
