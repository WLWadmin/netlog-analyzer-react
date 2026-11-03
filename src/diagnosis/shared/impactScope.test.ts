import type { DiagnosticCard, DiagnosticCategory } from './types';
import { calculateImpactScope } from './impactScope';
import { getHarRequestImportance } from './requestImportance';
import { parseHar, type HarRequestEntry } from '../../harParser';

function card(overrides: Partial<DiagnosticCard> & { category: DiagnosticCategory; id?: string; domain?: string }): DiagnosticCard {
  const domain = overrides.domain || 'api.example.test';
  const base: DiagnosticCard = {
    id: overrides.id || `${overrides.category}-card`,
    source: 'combined',
    category: overrides.category,
    severity: 'critical',
    confidence: 'high',
    title: `${overrides.category} issue`,
    conclusion: `${domain} failed`,
    scope: { type: 'single-domain', summary: '影响请求', affectedRequestCount: 2, affectedDomainCount: 1 },
    evidence: [{ label: '证据', value: domain, source: 'netlog', requestIds: [1] }],
    actions: [],
    relatedRequestIds: [1],
  };
  return { ...base, ...overrides };
}

function harEntry(category: HarRequestEntry['category'], url: string): HarRequestEntry {
  return {
    id: 1,
    name: 'request',
    url,
    method: 'GET',
    status: 500,
    statusText: 'Server Error',
    protocol: 'h2',
    domain: new URL(url).hostname,
    remoteAddress: '',
    category,
    rawType: category,
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
    isFailed: true,
    isSlow: false,
    standard: parseHar({
      log: { entries: [{
        request: { method: 'GET', url: 'https://example.test/', headers: [] },
        response: { status: 200, headers: [], content: {} },
        timings: { send: 0, wait: 0, receive: 0 },
      }] },
    }).entries[0].standard,
  };
}

describe('impactScope', () => {
  it('distinguishes unavailable counts from explicit zero and known positive counts', () => {
    const base = card({ category: 'dns', relatedRequestIds: [], evidence: [], scope: { type: 'single-domain', summary: '未知' } });
    const unknown = calculateImpactScope({ cards: [base] });
    expect(unknown).toMatchObject({ affectedRequestCount: 0, requestCountIsKnown: false, requestCountIsLowerBound: false });
    expect(unknown.summary).toContain('无可用数据');

    const zero = calculateImpactScope({ cards: [{ ...base, scope: { ...base.scope, affectedRequestCount: 0 } }] });
    expect(zero).toMatchObject({ affectedRequestCount: 0, requestCountIsKnown: true, requestCountIsLowerBound: false });
    expect(zero.summary).toContain('0 个请求');

    const positive = calculateImpactScope({ cards: [{ ...base, scope: { ...base.scope, affectedRequestCount: 2 } }] });
    expect(positive).toMatchObject({ affectedRequestCount: 2, requestCountIsKnown: true, requestCountIsLowerBound: true });
    expect(positive.summary).toContain('至少 2 个请求');
  });
  it('does not treat an explicit zero on one card as a known total for an uncounted card', () => {
    const zero = card({ category: 'dns', id: 'zero', relatedRequestIds: [], evidence: [], scope: { type: 'single-domain', summary: '0', affectedRequestCount: 0 } });
    const uncounted = card({ category: 'dns', id: 'uncounted', relatedRequestIds: [], evidence: [], scope: { type: 'single-domain', summary: '未知' } });
    expect(calculateImpactScope({ cards: [zero, uncounted] })).toMatchObject({
      affectedRequestCount: 0, requestCountIsKnown: false, requestCountIsLowerBound: false,
    });
    const positive = { ...zero, scope: { ...zero.scope, affectedRequestCount: 2 } };
    expect(calculateImpactScope({ cards: [positive, uncounted] })).toMatchObject({
      affectedRequestCount: 2, requestCountIsKnown: true, requestCountIsLowerBound: true,
    });
  });
  it.each([
    { count: undefined, ids: [], expectedType: 'single-domain' },
    { count: 0, ids: [], expectedType: 'single-domain' },
    { count: 1, ids: [], expectedType: 'single-domain' },
    { count: 1, ids: [1], expectedType: 'single-request' },
  ])('requires an exact single affected request before using success counterevidence: %j', ({ count, ids, expectedType }) => {
    const scope = calculateImpactScope({ cards: [card({
      category: 'dns', relatedRequestIds: ids,
      scope: { type: 'unknown', summary: '影响范围待核验', affectedRequestCount: count },
      evidence: [{ label: '成功反证', value: 'api.example.test 同域请求成功', source: 'netlog' }],
    })] });
    expect(scope.type).toBe(expectedType);
  });
  it('reports a conservative lower bound across unaligned HAR and NetLog IDs', () => {
    const scope = calculateImpactScope({ cards: [
      card({ category: 'dns', source: 'har', relatedRequestIds: [1, 2],
        scope: { type: 'single-domain', summary: '2', affectedRequestCount: 2 } }),
      card({ category: 'dns', source: 'netlog', relatedRequestIds: [2, 3],
        scope: { type: 'single-domain', summary: '2', affectedRequestCount: 2 } }),
    ] });
    expect(scope.affectedRequestCount).toBe(2);
    expect(scope.requestCountIsLowerBound).toBe(true);
    expect(scope.summary).toContain('至少');
  });
  it('excludes success counterexamples from affected IDs and labels incomplete unions', () => {
    const scope = calculateImpactScope({ cards: [
      card({ category: 'dns', relatedRequestIds: [1], scope: { type: 'single-domain', summary: '影响1', affectedRequestCount: 1 },
        evidence: [{ label: '成功反证', value: 'status=200', source: 'har', requestIds: [2, 3] }] }),
    ] });
    expect(scope.affectedRequestCount).toBe(1);
    const partial = calculateImpactScope({ cards: [
      card({ category: 'dns' }), card({ category: 'dns', id: 'second' }),
    ] });
    expect(partial.summary).toContain('至少');
  });
  it('preserves the known total when evidence contains only thirty of thirty-five IDs', () => {
    const scope = calculateImpactScope({ cards: [card({
      category: 'dns',
      relatedRequestIds: Array.from({ length: 30 }, (_, index) => index),
      scope: { type: 'multi-domain', summary: '影响 35 个请求', affectedRequestCount: 35, affectedDomainCount: 12 },
    })] });
    expect(scope.affectedRequestCount).toBe(35);
    expect(scope.affectedDomainCount).toBe(12);
  });

  it('does not sum overlapping card scopes or invent a request from a card count', () => {
    const ids = Array.from({ length: 35 }, (_, index) => index);
    expect(calculateImpactScope({ cards: [
      card({ category: 'dns', relatedRequestIds: ids }),
      card({ category: 'dns', relatedRequestIds: ids, id: 'second' }),
    ] }).affectedRequestCount).toBe(35);
    expect(calculateImpactScope({ cards: [card({
      category: 'dns', relatedRequestIds: [], evidence: [], scope: { type: 'global', summary: '未知' },
    })] }).summary).toContain('无可用');
  });
  it('does not promote single-domain failures to global', () => {
    const scope = calculateImpactScope({
      cards: [card({ category: 'dns', domain: 'api.example.test' })],
    });

    expect(scope.type).toBe('single-domain');
    expect(scope.allowGlobal).toBe(false);
  });

  it('downgrades multi-domain failures without global evidence', () => {
    const scope = calculateImpactScope({
      cards: [
        card({ category: 'dns', domain: 'a.example.test' }),
        card({ category: 'dns', domain: 'b.example.test', id: 'dns-b', relatedRequestIds: [2], evidence: [{ label: '成功反证', value: '其他域 status=200', source: 'netlog', requestIds: [3] }] }),
      ],
    });

    expect(scope.type).toBe('multi-domain');
    expect(scope.allowGlobal).toBe(false);
    expect(scope.counterEvidenceSummary.join('\n')).toContain('不能升级为 global');
  });

  it('allows global only with cross-domain and bottom-layer global evidence', () => {
    const scope = calculateImpactScope({
      cards: [
        card({ category: 'network-change', domain: 'a.example.test' }),
        card({ category: 'dns', domain: 'b.example.test', id: 'dns-b', relatedRequestIds: [2] }),
      ],
    });

    expect(scope.type).toBe('global');
    expect(scope.allowGlobal).toBe(true);
  });

  it('prioritizes document and XHR representative requests over analytics', () => {
    const importances = [
      getHarRequestImportance(harEntry('img', 'https://analytics.example.test/collect')),
      getHarRequestImportance(harEntry('xhr', 'https://api.example.test/api/order')),
      getHarRequestImportance(harEntry('doc', 'https://app.example.test/home')),
    ];
    const scope = calculateImpactScope({
      cards: [card({ category: 'server', domain: 'api.example.test' })],
      requestImportances: importances,
    });

    expect(scope.rankingReasons.join('\n')).toContain('高重要性业务请求');
  });

  it('classifies single-service 5xx as server-side, not client network', () => {
    const scope = calculateImpactScope({
      cards: [card({
        category: 'server',
        domain: 'api.example.test',
        conclusion: 'HTTP 500 集中在 api.example.test',
      })],
    });

    expect(scope.type).toBe('server-side');
    expect(scope.counterEvidenceSummary.join('\n')).toContain('不归为客户端全局网络问题');
  });

  it('marks https-only when TLS evidence has non-HTTPS counter evidence', () => {
    const scope = calculateImpactScope({
      cards: [card({
        category: 'tls',
        domain: 'secure.example.test',
        evidence: [{ label: 'TLS', value: 'https TLS failed；http 正常', source: 'netlog', requestIds: [1] }],
      })],
    });

    expect(scope.type).toBe('https-only');
  });
});
