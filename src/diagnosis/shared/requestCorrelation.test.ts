import type { HarRequestEntry } from '../../harParser';
import type { URLRequest } from '../../parsers/netlog/parser';
import { buildTimeAlignmentContext } from './timeAlignment';
import { correlateHarRequestToNetlog, correlateHarRequestsToNetlog, summarizeRequestCorrelations } from './requestCorrelation';

function har(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'resource',
    url: 'https://api.example.test/v1/resource?token=SECRET_QUERY',
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
    startMs: 1_700_000_005_000,
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

function req(overrides: Partial<URLRequest>): URLRequest {
  return {
    id: 10,
    url: 'https://api.example.test/v1/resource?token=OTHER_SECRET',
    method: 'GET',
    startTime: 5000,
    duration: 100,
    statusCode: 200,
    events: [],
    timeline: {},
    ...overrides,
  };
}

describe('requestCorrelation', () => {
  it('uses verified NetLog clock context to enable time window', () => {
    const context = buildTimeAlignmentContext([har({})], [req({})], {
      kind: 'time-tick-offset',
      unit: 'ms',
      originMs: 1_700_000_000_000,
      confidence: 'verified',
      evidence: 'constants.timeTickOffset',
    });

    expect(context.enabled).toBe(true);
    expect(context.windowMs).toBe(5000);
    expect(context.clockKind).toBe('time-tick-offset');
  });

  it('disables time window when clock is relative-only', () => {
    const context = buildTimeAlignmentContext([har({})], [req({})], {
      kind: 'relative-only',
      unit: 'ms',
      confidence: 'none',
      evidence: 'missing origin',
    });

    expect(context.enabled).toBe(false);
    expect(context.reason).toContain('time origin 未明确');
  });

  it('correlates same origin path method without leaking query values', () => {
    const context = buildTimeAlignmentContext([har({})], [req({})]);
    const correlation = correlateHarRequestToNetlog(har({}), [req({})], context);

    expect(correlation.level).toBe('same-origin-path-method');
    expect(correlation.score).toBe(0.9);
    expect(correlation.safeKey).toBe('GET https://api.example.test/v1/resource');
    expect(JSON.stringify(correlation)).not.toContain('SECRET_QUERY');
    expect(JSON.stringify(correlation)).not.toContain('OTHER_SECRET');
  });

  it('does not treat different method as strong correlation', () => {
    const context = buildTimeAlignmentContext([har({ method: 'POST' })], [req({ method: 'GET' })]);
    const correlation = correlateHarRequestToNetlog(har({ method: 'POST' }), [req({ method: 'GET' })], context);

    expect(correlation.level).toBe('same-host-path');
    expect(correlation.score).toBeLessThan(0.9);
    expect(correlation.conflicts.join(' ')).toContain('method 不一致');
  });

  it('keeps same host different path as weak supporting correlation only', () => {
    const context = buildTimeAlignmentContext([har({})], [req({ url: 'https://api.example.test/other' })]);
    const correlation = correlateHarRequestToNetlog(har({}), [req({ url: 'https://api.example.test/other' })], context);

    expect(correlation.level).toBe('same-host-only');
    expect(correlation.score).toBe(0.45);
  });

  it('uses verified time window only after path matching fails', () => {
    const context = buildTimeAlignmentContext([har({})], [req({ url: 'https://api.example.test/other', startTime: 5100 })], {
      kind: 'time-tick-offset',
      unit: 'ms',
      originMs: 1_700_000_000_000,
      confidence: 'verified',
      evidence: 'constants.timeTickOffset',
    });
    const correlation = correlateHarRequestToNetlog(har({}), [req({ url: 'https://api.example.test/other', startTime: 5100 })], context);

    expect(correlation.level).toBe('same-host-time');
    expect(correlation.timeDeltaMs).toBe(100);
  });

  it('sorts retry candidates by score then time delta then source id', () => {
    const context = buildTimeAlignmentContext([har({})], [
      req({ id: 12, url: 'https://api.example.test/other', startTime: 6000 }),
      req({ id: 11, url: 'https://api.example.test/v1/resource?token=another', startTime: 7000 }),
      req({ id: 10, url: 'https://api.example.test/v1/resource?token=yet-another', startTime: 8000 }),
    ]);
    const correlation = correlateHarRequestToNetlog(har({}), [
      req({ id: 12, url: 'https://api.example.test/other', startTime: 6000 }),
      req({ id: 11, url: 'https://api.example.test/v1/resource?token=another', startTime: 7000 }),
      req({ id: 10, url: 'https://api.example.test/v1/resource?token=yet-another', startTime: 8000 }),
    ], context);

    expect(correlation.primaryNetlogSourceId).toBe(10);
    expect(correlation.netlogSourceIds).toEqual([10, 11]);
    expect(correlation.candidateCount).toBe(3);
    expect(correlation.score).toBe(0.75);
    expect(correlation.conflicts).toContain('同等级候选不唯一，不能作为强请求关联');
  });

  it('does not attach conflicts from weaker unrelated candidates to a strong match', () => {
    const context = buildTimeAlignmentContext([har({})], [req({})]);
    const correlation = correlateHarRequestToNetlog(har({}), [
      req({ id: 10 }),
      req({ id: 11, method: 'POST', url: 'https://api.example.test/other' }),
    ], context);

    expect(correlation.level).toBe('same-origin-path-method');
    expect(correlation.conflicts).toEqual([]);
  });

  it('summarizes strong, weak and none correlation rates', () => {
    const context = buildTimeAlignmentContext([har({ id: 1 }), har({ id: 2, url: 'https://b.example.test/a' })], [req({})]);
    const correlations = correlateHarRequestsToNetlog([
      har({ id: 1 }),
      har({ id: 2, url: 'https://b.example.test/a', domain: 'b.example.test' }),
    ], [req({})], context);

    expect(summarizeRequestCorrelations(correlations)).toMatchObject({
      total: 2,
      strong: 1,
      weak: 0,
      none: 1,
      strongRate: 0.5,
      noneRate: 0.5,
    });
  });
});
