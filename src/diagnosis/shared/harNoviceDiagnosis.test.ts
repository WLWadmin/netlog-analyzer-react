import { parseHar, type HarAnalysisResult, type HarRequestEntry } from '../../harParser';
import { buildHarNoviceDiagnosis } from './harNoviceDiagnosis';

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
        response: { status: overrides.status ?? 200, headers: [], content: {} },
        timings: { send: 0, wait: 0, receive: 0 },
      }] },
    }).entries[0].standard,
  };
}

function result(entries: HarRequestEntry[]): HarAnalysisResult {
  return {
    entries,
    totalRequests: entries.length,
    failedCount: entries.filter(e => e.isFailed).length,
    slowCount: entries.filter(e => e.isSlow).length,
    totalSize: 0,
    totalTime: 0,
    creator: '',
    typeCounts: { xhr: entries.length, doc: 0, css: 0, js: 0, font: 0, img: 0, media: 0, other: 0 },
    bodyRetention: { mode: 'full', omittedCount: 0, omittedBytes: 0 },
    standard: parseHar({ log: { entries: [] } }).standard,
  };
}

describe('buildHarNoviceDiagnosis', () => {
  it('builds DNS diagnosis with actions, handoff role and evidence gap', () => {
    const diagnosis = buildHarNoviceDiagnosis(result([
      entry({ id: 0, status: 0, isFailed: true, netErrorText: 'net::ERR_NAME_NOT_RESOLVED', netErrorCode: -105 }),
    ]));

    expect(diagnosis.headline).toContain('DNS');
    expect(diagnosis.evidenceLevel).toBe('explicit-observation');
    expect(diagnosis.immediateActions.length).toBeGreaterThan(0);
    expect(diagnosis.handoffRoles[0].role).toBe('it');
    expect(diagnosis.evidenceGap).toContain('NetLog');
  });

  it('uses no-issue boundary text instead of claiming the network is normal', () => {
    const diagnosis = buildHarNoviceDiagnosis(result([
      entry({ id: 0, status: 200 }),
      entry({ id: 1, status: 200 }),
    ]));

    expect(diagnosis.headline).toContain('未发现明确失败');
    expect(diagnosis.summary).not.toContain('网络完全正常');
    expect(diagnosis.evidenceGap).toContain('无法证明未记录阶段没有异常');
  });

  it('does not output responsibility certainty or sensitive values', () => {
    const diagnosis = buildHarNoviceDiagnosis(result([
      entry({
        id: 0,
        url: 'https://example.com/api?token=SECRET_QUERY',
        requestHeaders: [{ name: 'authorization', value: 'SECRET_AUTH' }],
        requestCookies: [{ name: 'session', value: 'SECRET_COOKIE' }],
        responseBody: 'SECRET_BODY',
        status: 500,
        isFailed: true,
      }),
    ]));
    const text = JSON.stringify(diagnosis);

    expect(text).not.toContain('SECRET_QUERY');
    expect(text).not.toContain('SECRET_AUTH');
    expect(text).not.toContain('SECRET_COOKIE');
    expect(text).not.toContain('SECRET_BODY');
    expect(text).not.toContain('责任方就是');
    expect(text).not.toContain('一定是');
  });

  it('deduplicates actions and limits immediate actions to three', () => {
    const diagnosis = buildHarNoviceDiagnosis(result([
      entry({ id: 0, status: 500, isFailed: true }),
      entry({ id: 1, status: 500, isFailed: true, startMs: 1200 }),
      entry({ id: 2, status: 500, isFailed: true, startMs: 1400 }),
    ]));

    expect(diagnosis.immediateActions.length).toBeLessThanOrEqual(3);
    expect(new Set(diagnosis.immediateActions.map(action => `${action.role}:${action.title}`)).size).toBe(diagnosis.immediateActions.length);
  });

  it('explains status=0 as no HTTP response and requests more evidence', () => {
    const diagnosis = buildHarNoviceDiagnosis(result([
      entry({ id: 0, status: 0, isFailed: true }),
    ]));

    expect(JSON.stringify(diagnosis)).toContain('浏览器没有拿到 HTTP 响应，不是服务端返回了 0');
    expect(diagnosis.evidenceGap).toContain('NetLog');
    expect(diagnosis.headline).not.toContain('DNS');
    expect(diagnosis.headline).not.toContain('TLS');
  });
});
