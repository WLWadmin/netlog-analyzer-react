import type { HarRequestEntry } from '../../harParser';
import { getHarRequestImportance, getNetlogRequestImportance } from './requestImportance';

function har(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'request',
    url: 'https://api.example.test/api/order?token=SECRET',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    protocol: 'h2',
    domain: 'api.example.test',
    remoteAddress: '',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: '',
    size: 0,
    contentSize: 0,
    time: 100,
    startedDateTime: '2026-07-12T00:00:00.000Z',
    startMs: 0,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 98, receive: 1 },
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

describe('requestImportance', () => {
  it('prioritizes document and business XHR requests', () => {
    expect(getHarRequestImportance(har({ category: 'doc', rawType: 'document', url: 'https://app.example.test/home' })).level).toBe('high');
    expect(getHarRequestImportance(har({ category: 'xhr', rawType: 'fetch', method: 'POST', url: 'https://api.example.test/api/order' })).level).toBe('high');
  });

  it('keeps analytics single request below business API', () => {
    const analytics = getHarRequestImportance(har({ category: 'xhr', rawType: 'xhr', url: 'https://analytics.example.test/collect?token=SECRET' }));
    const api = getHarRequestImportance(har({ category: 'xhr', rawType: 'xhr', url: 'https://api.example.test/api/order' }));

    expect(analytics.score).toBeLessThan(api.score);
    expect(JSON.stringify(analytics)).not.toContain('SECRET');
  });

  it('scores NetLog business paths without query values', () => {
    const importance = getNetlogRequestImportance({
      id: 1,
      url: 'https://api.example.test/graphql?token=SECRET',
      method: 'POST',
      startTime: 0,
      duration: 100,
      events: [],
      timeline: {},
    });

    expect(importance.level).toBe('high');
    expect(JSON.stringify(importance)).not.toContain('SECRET');
  });

  it('does not treat login or catalog path segments as telemetry log endpoints', () => {
    const login = getHarRequestImportance(har({ category: 'xhr', rawType: 'xhr', url: 'https://api.example.test/login' }));
    const catalog = getHarRequestImportance(har({ category: 'xhr', rawType: 'xhr', url: 'https://api.example.test/catalog' }));

    expect(login.reasons).not.toContain('pathname 命中埋点/遥测特征');
    expect(catalog.reasons).not.toContain('pathname 命中埋点/遥测特征');
  });
});
