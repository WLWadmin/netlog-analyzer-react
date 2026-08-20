import { parseHar } from '../../harParser';
import type { AnalysisResult } from '../../parsers/netlog/parser';
import type { FinalDiagnosisSummary } from './finalSummaryTypes';
import { compareCombinedBaselines } from './combinedBaselineComparator';

function har(paths: string[]) {
  return parseHar({
    log: {
      version: '1.2',
      creator: { name: 'Synthetic', version: '1.0' },
      entries: paths.map((path, index) => ({
        startedDateTime: `2026-07-12T00:00:0${index}.000Z`,
        time: 100,
        request: { method: 'GET', url: `https://api.example.test${path}?token=SECRET`, headers: [], cookies: [], queryString: [] },
        response: { status: 200, statusText: 'OK', headers: [], cookies: [], content: { size: 0, mimeType: '', text: '' } },
        timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 98, receive: 1 },
      })),
    },
  });
}

function netlog(paths: string[], offset = 0, incomplete = false): AnalysisResult {
  return {
    totalEvents: 100,
    uniqueSources: paths.length,
    peakConcurrency: 1,
    urlRequests: paths.map((path, index) => ({
      id: index + 1,
      url: `https://api.example.test${path}`,
      method: 'GET',
      startTime: offset + index * 1000,
      duration: 100,
      statusCode: 200,
      events: [],
      timeline: {},
    })),
    sslEvents: [],
    quicEvents: [],
    http2Events: [],
    dnsEvents: [],
    connectEvents: [],
    proxyEvents: [],
    errors: [],
    warnings: [],
    info: [],
    timeRange: { start: 0, end: 1000 },
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
    largeFileMode: incomplete ? {
      enabled: true,
      fileSize: 100,
      bytesRead: 20,
      parsedEvents: 1,
      skippedEvents: 0,
      truncatedEventsPreview: true,
      reachedEventsEnd: false,
    } : undefined,
  };
}

function summary(clusterCount: number, topTitle: string): FinalDiagnosisSummary {
  return {
    mode: 'combined',
    status: 'has-conclusion',
    headline: [{
      id: topTitle,
      kind: 'highly-likely',
      source: 'combined',
      category: 'dns',
      title: topTitle,
      problem: topTitle,
      reason: topTitle,
      impact: topTitle,
      confidence: 'medium',
      confidenceText: '中',
      keyEvidence: [],
      missingInfo: [],
      relatedCardIds: [],
      score: 1,
      displayRank: 1,
      userFacingSummary: topTitle,
    }],
    rootCauseClusters: Array.from({ length: clusterCount }, (_, index) => ({
      id: `cluster-${index}`,
      category: 'dns',
      title: `cluster-${index}`,
      kind: 'highly-likely',
      summary: `cluster-${index}`,
      cards: [],
      keyEvidence: [],
      actions: [],
      affectedRequestCount: 1,
      affectedDomainCount: 1,
      confidence: 'medium',
      score: 1,
    })),
    actionPlan: [],
    missingInfo: [],
    expertCards: [],
    executiveSummary: 'summary',
  };
}

describe('combinedBaselineComparator', () => {
  it('detects newly added episodes and top conclusions', () => {
    const cards = compareCombinedBaselines(
      { har: har(['/a', '/b']), netlog: netlog(['/a', '/b']), finalSummary: summary(1, '正常') },
      { har: har(['/a', '/b']), netlog: netlog(['/a', '/b']), finalSummary: summary(3, 'DNS 新增') }
    );

    expect(cards.map(card => card.id)).toEqual(expect.arrayContaining([
      'combined-baseline-new-episodes',
      'combined-baseline-new-top-conclusions',
    ]));
    const visibleOutput = JSON.stringify(cards);
    expect(visibleOutput).not.toContain('SECRET');
    expect(visibleOutput).not.toMatch(/70%\s*以上|90%\s*以上|大概率|已确认(?:代理|防火墙|安全软件|服务端).*根因/);
  });

  it('does not fabricate comparison when request sets have no overlap', () => {
    const cards = compareCombinedBaselines(
      { har: har(['/a']), netlog: netlog(['/a']) },
      { har: parseHar({ log: { version: '1.2', creator: { name: 'Synthetic', version: '1.0' }, entries: [{ startedDateTime: '2026-07-12T00:00:00.000Z', time: 100, request: { method: 'GET', url: 'https://other.example.test/x', headers: [], cookies: [], queryString: [] }, response: { status: 200, statusText: 'OK', headers: [], cookies: [], content: { size: 0, mimeType: '', text: '' } }, timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 98, receive: 1 } }] } }), netlog: netlog(['/x']) }
    );

    expect(cards[0]).toMatchObject({ id: 'combined-baseline-no-common-requests', confidence: 'low' });
  });

  it('downgrades correlation regression when NetLog is incomplete', () => {
    const cards = compareCombinedBaselines(
      { har: har(['/a', '/b', '/c']), netlog: netlog(['/a', '/b', '/c']), finalSummary: summary(1, '正常') },
      { har: har(['/a', '/b', '/c']), netlog: netlog(['/x'], 0, true), finalSummary: summary(1, '正常') }
    );

    expect(cards.find(card => card.id === 'combined-baseline-correlation-regression')).toMatchObject({ confidence: 'low', severity: 'info' });
  });
});
