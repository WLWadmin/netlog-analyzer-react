import { buildHarDiagnosisSummary, harDiagnosisToCards } from './fromHar';
import { buildFinalDiagnosisSummary } from './finalSummaryBuilder';
import { parseHar, type HarAnalysisResult, type HarRequestEntry } from '../../harParser';
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
    standard: overrides.standard ?? parseHar({
      log: { entries: [{
        request: { method: 'GET', url: 'https://example.test/', headers: [] },
        response: { status: overrides.status ?? 304, headers: [], content: {} },
        timings: { send: 0, wait: 0, receive: 0 },
      }] },
    }).entries[0].standard,
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
    standard: parseHar({ log: { entries: [] } }).standard,
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

  it('diagnoses a same-domain request burst as browser queue pressure', () => {
    const base = Date.parse('2026-06-25T00:00:00.000Z');
    const getRequests = Array.from({ length: 30 }, (_, index) => entry({
      id: index,
      name: `preview-${index}`,
      url: `https://stream.example.com/preview/${index}`,
      domain: 'stream.example.com',
      method: 'GET',
      status: 0,
      statusText: '',
      protocol: '',
      startMs: base + index * 4,
      startedDateTime: new Date(base + index * 4).toISOString(),
      time: 30000,
      timings: { blocked: 30000, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
      netErrorText: 'net::ERR_ABORTED',
      netErrorCode: -3,
      failureText: 'net::ERR_ABORTED',
      isFailed: true,
      isSlow: true,
    }));
    const preflights = Array.from({ length: 30 }, (_, index) => entry({
      id: index + 30,
      name: `preview-${index}`,
      url: `https://stream.example.com/preview/${index}`,
      domain: 'stream.example.com',
      method: 'OPTIONS',
      rawType: 'preflight',
      status: 200,
      startMs: base + index * 4,
      startedDateTime: new Date(base + index * 4).toISOString(),
      time: 300,
      timings: { blocked: 200, dns: 0, connect: 0, ssl: 0, send: 0, wait: 100, receive: 0 },
    }));
    const entries = [...getRequests, ...preflights];
    const result = {
      ...harResult(entries),
      failedCount: 30,
      slowCount: 30,
      totalTime: 30120,
    };
    const diag = {
      ...diagnosis(),
      overallStatus: 'critical' as const,
      totalRequests: entries.length,
      httpStatus: { total: entries.length, count2xx: 30, count3xx: 0, count4xx: 0, count5xx: 0, count0: 30, countFailed: 30 },
      securityStats: {
        ...diagnosis().securityStats,
        mixedContentCount: 0,
        missingSecurityHeaders: ['Content-Security-Policy'],
      },
    };

    const summary = buildHarDiagnosisSummary(result, diag);
    const queueCard = summary.cards.find(card => card.id.startsWith('har-browser-queue-pressure'));
    const securityCard = summary.cards.find(card => card.id.startsWith('har-security'));
    const finalSummary = buildFinalDiagnosisSummary(summary, 'har');

    expect(queueCard?.category).toBe('browser-queue');
    expect(queueCard?.conclusion).toContain('1 秒内最多发起 60 个请求');
    expect(queueCard?.conclusion).toContain('30 个请求在约 30 秒后被取消');
    expect(queueCard?.actions.some(action => action.role === 'user' && action.title.includes('停止批量加载'))).toBe(true);
    expect(securityCard?.severity).toBe('info');
    expect(securityCard?.scope.affectedRequestCount || 0).toBe(0);
    expect(finalSummary.headline[0]?.category).toBe('browser-queue');
    expect(finalSummary.actionPlan.find(group => group.role === 'user')?.actions[0]?.title).toContain('停止批量加载');
  });

  it('does not classify ordinary first-party static resources as third-party dependencies', () => {
    const entries = Array.from({ length: 30 }, (_, index) => entry({
      id: index,
      name: `chunk-${index}.js`,
      url: `https://static.example.com/assets/chunk-${index}.js`,
      domain: 'static.example.com',
      category: 'js',
      rawType: 'script',
      status: 200,
      size: 20 * 1024,
      contentSize: 20 * 1024,
      time: 100,
      isSlow: false,
    }));

    const cards = harDiagnosisToCards(harResult(entries), diagnosis());

    expect(cards.some(card => card.id.startsWith('har-third-party'))).toBe(false);
  });

  it('does not promote healthy CDN resources into a diagnosis card', () => {
    const entries = Array.from({ length: 30 }, (_, index) => entry({
      id: index,
      name: `chunk-${index}.js`,
      url: `https://cdn.example.com/assets/chunk-${index}.js`,
      domain: 'cdn.example.com',
      category: 'js',
      rawType: 'script',
      status: 200,
      size: 20 * 1024,
      contentSize: 20 * 1024,
      time: 100,
      isSlow: false,
    }));

    const cards = harDiagnosisToCards(harResult(entries), diagnosis());

    expect(cards.some(card => card.id.startsWith('har-third-party'))).toBe(false);
  });

  it('does not report proxy-only blocked time as browser queue pressure', () => {
    const base = Date.parse('2026-06-25T00:00:00.000Z');
    const entries = Array.from({ length: 30 }, (_, index) => entry({
      id: index,
      name: `proxy-${index}`,
      url: `https://proxy.example.com/resource/${index}`,
      domain: 'proxy.example.com',
      startMs: base + index * 4,
      startedDateTime: new Date(base + index * 4).toISOString(),
      time: 2200,
      timings: { blocked: 2000, dns: 0, connect: 0, ssl: 0, send: 0, wait: 200, receive: 0 },
      chromeTiming: { blockedQueueingMs: 0, blockedProxyMs: 2000 },
      isSlow: true,
    }));

    const cards = harDiagnosisToCards(harResult(entries), diagnosis());

    expect(cards.some(card => card.id.startsWith('har-browser-queue-pressure'))).toBe(false);
  });

  it('generates stable diagnosis card IDs for the same input', () => {
    const result = harResult([entry({ status: 302, redirect: { status: 302, location: '/next' } })]);
    const diag = diagnosis();

    expect(harDiagnosisToCards(result, diag).map(card => card.id))
      .toEqual(harDiagnosisToCards(result, diag).map(card => card.id));
  });
});
