import { buildHarDiagnosisSummary, checkHarQuality, harDiagnosisToCards } from './fromHar';
import { buildFinalDiagnosisSummary } from './finalSummaryBuilder';
import { parseHar, type HarAnalysisResult, type HarRequestEntry } from '../../harParser';
import type { HarDiagnosisResult } from '../../harDiagnosis';
import { diagnoseHar } from '../../harDiagnosis';

describe('HAR subset statistics regressions', () => {
  it('looks up duplicate keys once while retaining all affected IDs', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 200 }, (_, index) => ({
      request: { method: 'GET', url: `https://example.test/duplicate-${index % 100}` },
      response: { status: 200 }, time: 0,
    })) } });
    const diagnosis = diagnoseHar(parsed);
    let keyReads = 0;
    diagnosis.duplicateRequests = diagnosis.duplicateRequests.map(duplicate => ({
      ...duplicate,
      get url() { keyReads++; return duplicate.url; },
    }));
    const card = harDiagnosisToCards(parsed, diagnosis).find(item => item.id.startsWith('har-dup'));
    expect(card?.relatedRequestIds).toEqual(parsed.entries.map(entry => entry.id));
    // Include the ten displayed examples, but reject per-request scans of all keys.
    expect(keyReads).toBeLessThanOrEqual(110);
  });

  it.each([1, 10])('does not diagnose low cache rate from only %s valid samples out of twenty', valid => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 20 }, (_, index) => ({
      request: { url: `https://example.test/cache-${index}` },
      response: { status: 200, ...(index < valid ? { headers: [] } : {}) },
    })) } });
    expect(harDiagnosisToCards(parsed, diagnoseHar(parsed)).some(card => card.id.startsWith('har-cache'))).toBe(false);
  });

  it('states partial cache evidence coverage when the valid sample exceeds the threshold', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 20 }, (_, index) => ({
      request: { url: `https://example.test/cache-${index}` },
      response: { status: 200, ...(index < 11 ? { headers: [] } : {}) },
    })) } });
    const card = harDiagnosisToCards(parsed, diagnoseHar(parsed)).find(item => item.id.startsWith('har-cache'));
    expect(card?.conclusion).toContain('覆盖 11/20');
    expect(card?.limitations).toContain('仅基于部分请求，缺失响应头的请求不能判断缓存状态');
  });

  it('labels missing outcomes separately from fully observed zero-duration phases', () => {
    const parsed = parseHar({ log: { entries: [{
      request: { url: 'https://example.test/' }, response: {}, time: 0,
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
    }] } });
    const card = harDiagnosisToCards(parsed, diagnoseHar(parsed)).find(item => item.id.startsWith('har-overview'));
    expect(card?.title).toBe('请求结果无可用数据');
    expect(card?.conclusion).not.toContain('阶段无可用');
  });

  it('retains all affected IDs for duplicate, redirect and Cookie cards', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 35 }, () => ({
      request: { url: 'https://example.test/duplicate', headers: [{ name: 'cookie', value: 'x'.repeat(5000) }] },
      response: { status: 302, headers: [], bodySize: 100, content: {} },
      time: 600, timings: { wait: 600 },
    })) } });
    const cards = harDiagnosisToCards(parsed, diagnoseHar(parsed));
    ['har-dup', 'har-redirect', 'har-cookie'].forEach(prefix => {
      expect(cards.find(item => item.id.startsWith(prefix))?.relatedRequestIds).toHaveLength(35);
    });
  });
  it('retains every timing domain and diagnostic request before presenting examples', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 35 }, (_, index) => ({
      request: { url: `https://host-${index}.example.test/large` },
      response: { status: 500, bodySize: 2 * 1024 * 1024, content: {} },
      time: 6000, timings: { dns: 600, wait: 5000, receive: 400 },
    })) } });
    const diagnosis = diagnoseHar(parsed);
    expect(diagnosis.failedRequests).toHaveLength(35);
    expect(diagnosis.slowRequests).toHaveLength(35);
    expect(diagnosis.largestResources).toHaveLength(35);
    expect(diagnosis.networkStatus.find(item => item.label === 'DNS')?.slowDomains).toHaveLength(35);
    const cards = harDiagnosisToCards(parsed, diagnosis);
    const large = cards.find(item => item.id.startsWith('har-large-payload'));
    expect(large).toBeDefined();
    expect(large?.relatedRequestIds).toHaveLength(35);
    expect(cards.filter(item => item.id.startsWith('har-cluster')).flatMap(item => item.relatedRequestIds || [])).toHaveLength(35);
  });

  it('does not drop the sixth and later issue clusters', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 12 }, (_, index) => ({
      request: { url: `https://host-${index}.example.test/fail` },
      response: { status: 500 }, time: 10, timings: { wait: 10 },
    })) } });
    const cards = harDiagnosisToCards(parsed, diagnoseHar(parsed));
    expect(cards.filter(item => item.id.startsWith('har-cluster'))).toHaveLength(12);
  });

  it('does not classify missing response headers as uncompressed or uncached evidence', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 12 }, () => ({
      request: { url: 'https://example.test/large' },
      response: { status: 200, bodySize: 2 * 1024 * 1024, content: {} },
    })) } });
    const diagnosis = diagnoseHar(parsed);
    expect(Number.isNaN(diagnosis.cacheStats.cacheRate)).toBe(true);
    expect(Number.isNaN(diagnosis.compressionStats.compressionRate)).toBe(true);
    expect(diagnosis.uncompressedLargeResources).toHaveLength(0);
    expect(harDiagnosisToCards(parsed, diagnosis).some(item => item.id.startsWith('har-cache'))).toBe(false);
  });
  it('counts all twelve uncompressed resources before displaying five examples', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 12 }, (_, index) => ({
      request: { url: `https://example.test/large-${index}` },
      response: { status: 200, headers: [], bodySize: 2 * 1024 * 1024, content: {} },
      time: 100, timings: { wait: 100 },
    })) } });
    const diagnosis = diagnoseHar(parsed);
    expect(diagnosis.uncompressedLargeResources).toHaveLength(12);
    expect(diagnosis.findings).toContain('检测到 12 个大资源未启用压缩');
    const card = harDiagnosisToCards(parsed, diagnosis).find(item => item.id.startsWith('har-compress'));
    expect(card?.title).toContain('12 个');
    expect(card?.scope.affectedRequestCount).toBe(12);
    expect(card?.relatedRequestIds).toHaveLength(12);
  });

  it('keeps third-party transfer size unknown and counts all affected domains', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 20 }, (_, index) => ({
      request: { url: `https://sdk-${index}.example.test/resource` },
      response: { status: 500, bodySize: -1, content: {} },
    })) } });
    const card = harDiagnosisToCards(parsed, diagnoseHar(parsed)).find(item => item.id.startsWith('har-third-party'));
    expect(card?.evidence.find(item => item.label === '总传输体积')?.value).toContain('无可用数据');
    expect(card?.evidence.find(item => item.label === '总传输体积')?.value).toContain('覆盖 0/20');
    expect(card?.scope.affectedDomainCount).toBe(20);
  });

  it('keeps concurrency unknown when starts exist but durations do not', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 20 }, (_, index) => ({
      request: { url: `https://example.test/queue-${index}` },
      response: { status: 200 },
      startedDateTime: new Date(Date.parse('2026-10-28T00:00:00Z') + index * 20).toISOString(),
      timings: { blocked: 600 },
    })) } });
    const card = harDiagnosisToCards(parsed, diagnoseHar(parsed)).find(item => item.id.startsWith('har-browser-queue-pressure'));
    expect(card?.evidence.find(item => item.label === '最大并发')?.value).toContain('无可用数据');
    expect(card?.evidence.find(item => item.label === '最大并发')?.value).toContain('覆盖 0/20');
    expect(card?.conclusion).not.toContain('最大并发 0');
  });

  it('does not display zero duplicate transfer volume when all duplicate sizes are unknown', () => {
    const parsed = parseHar({ log: { entries: [0, 1].map(() => ({
      request: { method: 'GET', url: 'https://example.test/duplicate' },
      response: { status: 200, bodySize: -1, content: {} },
      time: 100, timings: { send: 0, wait: 100, receive: 0 },
    })) } });
    const card = harDiagnosisToCards(parsed, diagnoseHar(parsed)).find(item => item.id.startsWith('har-dup'));
    expect(card?.conclusion).toContain('无可用数据');
    expect(card?.conclusion).toContain('覆盖 0/1');
    expect(card?.conclusion).not.toContain('0.0 KB');
  });

  it('counts every duplicate URL and affected request while labeling the top ten', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 12 }, (_, index) => [0, 1].map(() => ({
      request: { method: 'GET', url: `https://example.test/duplicate-${index}` },
      response: { status: 200, bodySize: 100, content: {} },
      time: 100, timings: { send: 0, wait: 100, receive: 0 },
    }))).flat() } });
    const card = harDiagnosisToCards(parsed, diagnoseHar(parsed)).find(item => item.id.startsWith('har-dup'));
    expect(card?.title).toBe('重复请求检测 (12 个)');
    expect(card?.scope.affectedRequestCount).toBe(24);
    expect(card?.conclusion).toContain('1.2 KB');
    expect(card?.evidence).toContainEqual(expect.objectContaining({ value: '显示前 10 / 共 12' }));
  });

  it.each([
    [undefined, 'Waiting P95 无可用数据 · 覆盖 0/20'],
    [0, 'Waiting P95 0ms · 覆盖 20/20'],
    [100, 'Waiting P95 100 ms · 覆盖 20/20'],
  ])('does not convert absent successful GET Waiting into <1ms (%s)', (wait, text) => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 20 }, (_, index) => ({
      request: { method: 'GET', url: `https://example.test/queue-${index}` },
      response: { status: 200, bodySize: -1, content: {} },
      startedDateTime: new Date(Date.parse('2026-10-28T00:00:00Z') + index * 20).toISOString(),
      time: 1000, timings: { blocked: 600, send: 0, wait },
    })) } });
    const queue = harDiagnosisToCards(parsed, diagnoseHar(parsed)).find(card => card.id.startsWith('har-browser-queue-pressure'));
    expect(queue?.evidence.find(item => item.label === '成功 GET 响应')?.value).toContain(text);
    expect(queue?.evidence.find(item => item.label === '成功 GET 响应')?.value).toContain('下载 P95 无可用数据 · 覆盖 0/20');
  });
});

describe('HAR request span coverage', () => {
  function spanResult(second: { startedDateTime?: string; time?: number }) {
    const base = {
      startedDateTime: '2026-10-28T00:00:00.000Z',
      time: 100,
      request: { url: 'https://example.test/', headers: [] },
      response: { status: 200, headers: [], content: {} },
      timings: { send: 0, wait: 100, receive: 0 },
    };
    return parseHar({ log: { entries: [base, { ...base, ...second }] } });
  }

  it('does not call a 100ms subset a short capture when the unknown request starts 60 seconds later', () => {
    const parsed = spanResult({ startedDateTime: '2026-10-28T00:01:00.000Z', time: undefined });
    expect(parsed.totalTime).toBe(100);
    expect(Number.isNaN(parsed.entries[1].time)).toBe(true);
    const quality = checkHarQuality(parsed);
    expect(quality.issues.some(issue => issue.message.includes('过短'))).toBe(false);
    expect(quality.issues).toContainEqual(expect.objectContaining({
      message: '请求时间跨度无法确定',
      detail: expect.stringContaining('覆盖 1/2'),
    }));
  });

  it('does not establish a full span from a request with no start time', () => {
    const quality = checkHarQuality(spanResult({ startedDateTime: undefined, time: 100 }));
    expect(quality.issues.some(issue => issue.message.includes('过短'))).toBe(false);
    expect(quality.issues).toContainEqual(expect.objectContaining({
      message: '请求时间跨度无法确定', detail: expect.stringContaining('覆盖 1/2'),
    }));
  });

  it('reports an unknown span when all durations are missing', () => {
    const parsed = spanResult({ time: undefined });
    const unknown = parseHar({ log: { entries: parsed.entries.map(item => ({
      startedDateTime: item.startedDateTime,
      request: { url: 'https://example.test/' }, response: { status: 200 },
    })) } });
    expect(Number.isNaN(unknown.totalTime)).toBe(true);
    expect(checkHarQuality(unknown).issues).toContainEqual(expect.objectContaining({
      message: '请求时间跨度无法确定', detail: expect.stringContaining('覆盖 0/2'),
    }));
  });

  it('describes fully covered short spans as recorded request spans', () => {
    expect(checkHarQuality(spanResult({ time: 100 })).issues).toContainEqual(expect.objectContaining({
      message: '请求时间跨度过短',
      detail: expect.stringContaining('覆盖 2/2'),
    }));
  });
});

it('omits the aggregate browser queue interval when some request durations are unknown', () => {
  const parsed = parseHar({ log: { entries: Array.from({ length: 20 }, (_, index) => ({
    request: { url: `https://example.test/queue-${index}`, headers: [] },
    response: { status: 200, headers: [], content: {} },
    startedDateTime: new Date(Date.parse('2026-10-28T00:00:00Z') + index * 20).toISOString(),
    time: index === 0 ? undefined : 1000,
    timings: { blocked: 600, send: 0, wait: 0, receive: 0 },
  })) } });
  const cards = harDiagnosisToCards(parsed, diagnoseHar(parsed));
  const queue = cards.find(card => card.id.startsWith('har-browser-queue-pressure'));
  expect(queue).toBeDefined();
  expect(queue?.timeRange).toBeUndefined();
});

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
    httpStatus: { count1xx: 0, count2xx: 0, count3xx: 1, count4xx: 0, count5xx: 0, count0: 0, countFailed: 0 },
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
      httpStatus: { total: 1, count1xx: 0, count2xx: 0, count3xx: 0, count4xx: 0, count5xx: 1, count0: 0, countFailed: 1 },
    });

    expect(JSON.stringify(cards)).not.toContain(secret);
  });

  it('does not emit a second legacy 5xx card when a server-error cluster exists', () => {
    const failed = entry({ id: 0, status: 500, statusText: 'Server Error', isFailed: true });
    const cards = harDiagnosisToCards(harResult([failed]), {
      ...diagnosis(),
      overallStatus: 'critical',
      httpStatus: { total: 1, count1xx: 0, count2xx: 0, count3xx: 0, count4xx: 0, count5xx: 1, count0: 0, countFailed: 1 },
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
      httpStatus: { total: entries.length, count1xx: 0, count2xx: 30, count3xx: 0, count4xx: 0, count5xx: 0, count0: 30, countFailed: 30 },
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
