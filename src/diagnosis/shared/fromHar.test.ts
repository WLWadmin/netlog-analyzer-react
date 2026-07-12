import { harDiagnosisToCards } from './fromHar';
import type { HarAnalysisResult, HarRequestEntry } from '../../harParser';
import type { HarDiagnosisResult } from '../../harDiagnosis';

function entry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'cached',
    url: 'https://example.com/cached',
    method: 'GET',
    status: 304,
    statusText: 'Not Modified',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '203.0.113.10',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: '',
    size: 0,
    contentSize: 0,
    time: 800,
    startedDateTime: '2026-06-25T00:00:00.000Z',
    startMs: Date.parse('2026-06-25T00:00:00.000Z'),
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 800, receive: 0 },
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

function harResult(entries: HarRequestEntry[]): HarAnalysisResult {
  return {
    entries,
    totalRequests: entries.length,
    failedCount: 0,
    slowCount: 0,
    totalSize: 0,
    totalTime: 0,
    creator: 'Chrome',
    typeCounts: { xhr: entries.length, doc: 0, css: 0, js: 0, font: 0, img: 0, media: 0, other: 0 },
    bodyRetention: { mode: 'full', omittedCount: 0, omittedBytes: 0 },
  };
}

function diagnosis(): HarDiagnosisResult {
  return {
    overallStatus: 'healthy',
    healthScore: 100,
    summary: 'ok',
    findings: [],
    totalRequests: 1,
    domainCount: 1,
    networkStatus: [],
    httpStatus: { count2xx: 0, count3xx: 1, count4xx: 0, count5xx: 0, count0: 0, countFailed: 0 },
    cacheStats: { cachedCount: 0, uncachedCount: 1, cacheRate: 100 },
    securityStats: { mixedContentCount: 0, missingSecurityHeaders: [] },
    attributions: [],
    duplicateRequests: [],
    uncompressedLargeResources: [],
  } as unknown as HarDiagnosisResult;
}

describe('harDiagnosisToCards redirect classification', () => {
  it('does not create redirect diagnosis for slow 304 responses', () => {
    const cards = harDiagnosisToCards(harResult([entry({ cacheInfo: { status304: true } })]), diagnosis());

    expect(cards.some(card => card.id.startsWith('har-redirect'))).toBe(false);
    expect(cards.some(card => card.category === 'redirect')).toBe(false);
  });

  it('creates redirect diagnosis for explicit slow redirect evidence', () => {
    const cards = harDiagnosisToCards(harResult([
      entry({
        status: 302,
        statusText: 'Found',
        redirect: { status: 302, location: '/next' },
        cacheInfo: undefined,
      }),
    ]), diagnosis());

    expect(cards.some(card => card.id.startsWith('har-redirect'))).toBe(true);
  });

  it('does not expose URL query values in any diagnostic evidence', () => {
    const secret = 'SECRET_QUERY_VALUE';
    const failed = entry({
      id: 0,
      url: `https://example.com/api?token=${secret}`,
      status: 500,
      statusText: 'Server Error',
      isFailed: true,
    });
    const cards = harDiagnosisToCards(harResult([failed]), {
      ...diagnosis(),
      overallStatus: 'critical',
      httpStatus: { total: 1, count2xx: 0, count3xx: 0, count4xx: 0, count5xx: 1, count0: 0, countFailed: 1 },
    });

    expect(JSON.stringify(cards)).not.toContain(secret);
  });

  it('does not emit a second legacy 5xx card when a server-error cluster exists', () => {
    const failed = entry({ id: 0, status: 500, statusText: 'Server Error', isFailed: true });
    const cards = harDiagnosisToCards(harResult([failed]), {
      ...diagnosis(),
      overallStatus: 'critical',
      httpStatus: { total: 1, count2xx: 0, count3xx: 0, count4xx: 0, count5xx: 1, count0: 0, countFailed: 1 },
    });

    expect(cards.filter(card => card.id.startsWith('har-cluster') && card.category === 'server')).toHaveLength(1);
    expect(cards.some(card => card.id.startsWith('har-5xx'))).toBe(false);
  });
});
