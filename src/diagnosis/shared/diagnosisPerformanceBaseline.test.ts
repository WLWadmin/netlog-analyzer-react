import { parseHar } from '../../harParser';
import type { AnalysisResult, URLRequest } from '../../parsers/netlog/parser';
import { buildHarIssueClusters } from './harIssueClusters';
import { buildHarNoviceDiagnosis } from './harNoviceDiagnosis';
import { buildHarObservations } from './diagnosisObservation';
import { calculateHarDiagnosisCoverage } from './diagnosisCoverage';
import { netlogToCards } from './fromNetlog';

function rawEntry(index: number) {
  const isSlow = index % 10 === 0;
  const isFailed = index % 37 === 0;
  return {
    startedDateTime: new Date(Date.UTC(2026, 6, 12, 0, 0, Math.floor(index / 10))).toISOString(),
    time: isSlow ? 1800 : 120,
    request: {
      method: 'GET',
      url: `https://d${index % 20}.example.test/api/${index}`,
      headers: [],
      cookies: [],
      queryString: [],
    },
    response: {
      status: isFailed ? 500 : 200,
      statusText: isFailed ? 'Server Error' : 'OK',
      headers: [],
      cookies: [],
      content: { size: 0, mimeType: 'application/json', text: '' },
    },
    timings: isSlow
      ? { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 1798, receive: 1 }
      : { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 118, receive: 1 },
  };
}

function urlRequest(index: number): URLRequest {
  const slow = index % 12 === 0;
  return {
    id: index + 1,
    url: `https://d${index % 20}.example.test/api/${index}`,
    method: 'GET',
    startTime: 1000 + index * 10,
    duration: slow ? 2200 : 120,
    statusCode: 200,
    events: [],
    timeline: slow ? { wait: { start: 1000 + index * 10, end: 3200 + index * 10, duration: 2200 } } : {},
  };
}

function netlogResult(requestCount: number): AnalysisResult {
  const requests = Array.from({ length: requestCount }, (_, index) => urlRequest(index));
  return {
    totalEvents: requestCount * 4,
    uniqueSources: requestCount,
    peakConcurrency: 8,
    urlRequests: requests,
    sslEvents: [],
    quicEvents: [],
    http2Events: [],
    dnsEvents: [],
    connectEvents: [],
    proxyEvents: [],
    errors: [],
    warnings: [],
    info: [],
    timeRange: { start: 1000, end: 1000 + requestCount * 10 + 2500 },
    protocols: { 'HTTP/2': requestCount },
    hosts: {},
    dnsServers: [],
    dnsRecords: [],
    dohCandidates: [],
    errorSources: {},
    certIssues: [],
    sslIssues: [],
    connectionFailures: [],
    stalledRequests: [],
    slowRequests: requests.filter(request => (request.duration || 0) > 1000),
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
  };
}

function elapsedMs(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe('Diagnosis Performance Baseline', () => {
  it('keeps 500-request HAR clustering and novice summary within baseline budget', () => {
    const parsed = parseHar({ log: { version: '1.2', creator: { name: 'Synthetic', version: '1.0' }, entries: Array.from({ length: 500 }, (_, index) => rawEntry(index)) } });

    let clusterCount = 0;
    const clusterMs = elapsedMs(() => {
      clusterCount = buildHarIssueClusters(parsed.entries).length;
    });
    const noviceMs = elapsedMs(() => {
      buildHarNoviceDiagnosis(parsed);
    });

    expect(clusterCount).toBeGreaterThan(0);
    expect(clusterMs).toBeLessThan(200);
    expect(noviceMs).toBeLessThan(250);
  });

  it('keeps 500-request HAR observation + cluster + coverage within release gate budget', () => {
    const parsed = parseHar({ log: { version: '1.2', creator: { name: 'Synthetic', version: '1.0' }, entries: Array.from({ length: 500 }, (_, index) => rawEntry(index)) } });

    let observationCount = 0;
    let clusterCount = 0;
    const gateMs = elapsedMs(() => {
      const observations = buildHarObservations(parsed.entries);
      const clusters = buildHarIssueClusters(parsed.entries);
      calculateHarDiagnosisCoverage(parsed.entries, observations);
      observationCount = observations.length;
      clusterCount = clusters.length;
    });

    expect(observationCount).toBeGreaterThan(0);
    expect(clusterCount).toBeGreaterThan(0);
    expect(gateMs).toBeLessThan(100);
  });

  it('keeps medium NetLog first diagnosis within baseline budget', () => {
    const result = netlogResult(500);
    let cardCount = 0;
    const diagnosisMs = elapsedMs(() => {
      cardCount = netlogToCards(result, []).length;
    });

    expect(cardCount).toBeGreaterThanOrEqual(0);
    expect(diagnosisMs).toBeLessThan(500);
  });
});
