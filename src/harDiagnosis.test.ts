import { diagnoseHar } from './harDiagnosis';
import { parseHar } from './harParser';
import { getHarTimingCompleteness } from './diagnosis/shared/harTimingCompleteness';

function harEntry(path: string, connect: number, ssl: number) {
  return {
    startedDateTime: '2026-08-18T00:00:00.000Z',
    time: connect + 10,
    request: { method: 'GET', url: `https://example.test/${path}`, headers: [] },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      content: { size: 0, mimeType: 'text/plain' },
    },
    timings: { blocked: 0, dns: 0, connect, ssl, send: 1, wait: 8, receive: 1 },
  };
}

describe('diagnoseHar timing phases', () => {
  it.each(['send', 'wait'])('withholds health when only timings.%s is missing from an otherwise zero-ms request', missingPhase => {
    const timings: Record<string, number> = { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 };
    delete timings[missingPhase];
    const parsed = parseHar({ log: { entries: [{ ...harEntry('missing-phase', 0, 0), time: 0, timings }] } });
    const completeness = getHarTimingCompleteness(parsed.entries[0]);
    expect(completeness.complete).toBe(false);
    expect(completeness.unavailable.map(field => field.key)).toEqual([missingPhase]);
    const diagnosis = diagnoseHar(parsed);
    expect(Number.isNaN(diagnosis.healthScore)).toBe(true);
    expect(diagnosis.healthScoreUnavailableReason).toBe('coverage-insufficient');
    expect(diagnosis.overallStatus).not.toBe('healthy');
    expect(diagnosis.summary).toContain('网络阶段数据不完整');
    expect(diagnosis.summary).toContain(`timings.${missingPhase} 0/1`);
    expect(diagnosis.summary).not.toContain('网络状态良好');
  });

  it('scores a complete zero-ms request as healthy', () => {
    const parsed = parseHar({ log: { entries: [{
      ...harEntry('zero-ms', 0, 0), time: 0,
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
    }] } });
    expect(getHarTimingCompleteness(parsed.entries[0]).complete).toBe(true);
    const diagnosis = diagnoseHar(parsed);
    expect(diagnosis.healthScore).toBe(100);
    expect(diagnosis.healthScoreUnavailableReason).toBeUndefined();
    expect(diagnosis.overallStatus).toBe('healthy');
    expect(diagnosis.summary).toBe('网络状态良好，未发现明显异常');
  });

  it('withholds overall health for one failed outcome and ninety-nine missing outcomes', () => {
    const parsed = parseHar({ log: { entries: Array.from({ length: 100 }, (_, index) => ({
      ...harEntry(`partial-result-${index}`, 0, 0),
      response: index === 0 ? { status: 500 } : {},
    })) } });
    const diagnosis = diagnoseHar(parsed);
    expect(Number.isNaN(diagnosis.healthScore)).toBe(true);
    expect(diagnosis.overallStatus).not.toBe('healthy');
    expect(diagnosis.summary).toContain('结果覆盖不足');
    expect(diagnosis.findings.join(' ')).toContain('失败率 100.0% · 结果覆盖 1/100');
  });

  it('withholds overall health when even one network phase has partial coverage', () => {
    const parsed = parseHar({ log: { entries: [
      harEntry('complete', 0, 0),
      { ...harEntry('partial', 0, 0), timings: { send: 0, wait: 8, receive: 1 } },
    ] } });
    const diagnosis = diagnoseHar(parsed);
    expect(Number.isNaN(diagnosis.healthScore)).toBe(true);
    expect(diagnosis.overallStatus).not.toBe('healthy');
  });

  it('does not assign verified health when only timings and no outcomes are available', () => {
    const parsed = parseHar({ log: { entries: [{
      request: { url: 'https://example.test/' }, response: {},
      time: 100, timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 100, receive: 0 },
    }] } });
    const diagnosis = diagnoseHar(parsed);
    expect(Number.isNaN(diagnosis.healthScore)).toBe(true);
    expect(diagnosis.summary).toContain('结果');
  });
  it('keeps measured zero in stage statistics and reports sample coverage', () => {
    const entries = [0, 100, undefined].map((waitingMs, index) => ({
      ...harEntry(`coverage-${index}`, 0, 0), time: 200,
      timings: { send: 0, wait: waitingMs, receive: 0 },
    }));
    const phase = diagnoseHar(parseHar({ log: { entries } })).networkStatus.find(item => item.label === 'Waiting');
    expect(phase).toMatchObject({ avgMs: 50, p95Ms: 100, maxMs: 100, validCount: 2, totalCount: 3 });
  });

  it('does not report healthy or zero stage metrics when all stages are missing', () => {
    const result = diagnoseHar(parseHar({ log: { entries: [{ ...harEntry('missing', 0, 0), timings: {} }] } }));
    expect(result.networkStatus.every(phase =>
      phase.status === 'unknown' && Number.isNaN(phase.avgMs) && Number.isNaN(phase.p95Ms) && Number.isNaN(phase.maxMs)
    )).toBe(true);
    expect(result.overallStatus).not.toBe('healthy');
    expect(result.summary).toContain('无可用数据');
    expect(result.summary).not.toContain('网络状态良好');
    expect(Number.isNaN(result.healthScore)).toBe(true);
  });

  it('excludes unknown sizes from domain, resource and duplicate waste totals', () => {
    const entries = [100, -1].map(size => ({
      ...harEntry('same-url', 0, 0),
      response: { status: 200, headers: [], bodySize: size, content: {} },
    }));
    const result = diagnoseHar(parseHar({ log: { entries } }));
    expect(result.totalSize).toBe(100);
    expect(result.domainStats[0]).toMatchObject({ totalSize: 100, knownSizeCount: 1, count: 2 });
    expect(result.resourceStats[0]).toMatchObject({ totalSize: 100, knownSizeCount: 1, count: 2 });
    expect(result.duplicateRequests[0].totalWasted).toBe(0);
  });

  it('retains all twelve duplicate URLs and twenty-four affected requests', () => {
    const entries = Array.from({ length: 12 }, (_, index) => [
      harEntry(`duplicate-${index}`, 0, 0), harEntry(`duplicate-${index}`, 0, 0),
    ]).flat();
    const result = diagnoseHar(parseHar({ log: { entries } }));
    expect(result.duplicateRequests).toHaveLength(12);
    expect(result.duplicateRequests.reduce((sum, item) => sum + item.count, 0)).toBe(24);
    expect(result.findings).toContain('检测到 12 个 URL 被重复请求');
  });

  it('orders known failure durations before unknown values without masking the slowest request', () => {
    const parsed = parseHar({ log: { entries: [undefined, 100, 5000].map((time, index) => ({
      ...harEntry(`failure-${index}`, 0, 0), time,
      response: { status: 500, headers: [], content: {} },
    })) } });
    expect(diagnoseHar(parsed).failedRequests.map(entry => entry.id)).toEqual([2, 1, 0]);
  });

  it('averages only known durations and retains unknown counts in domain, IP and category statistics', () => {
    const entries = [100, 0, undefined, -1, '9000', Infinity].map((time, index) => ({
      ...harEntry(`duration-${index}`, 0, 0), time, serverIPAddress: '203.0.113.10',
    }));
    const result = diagnoseHar(parseHar({ log: { entries } }));
    for (const stats of [result.domainStats[0], result.ipStats[0], result.resourceStats[0]]) {
      expect(stats).toMatchObject({ count: 6, avgTime: 50, unknownTimeCount: 4 });
    }
    const unknown = diagnoseHar(parseHar({ log: { entries: entries.slice(2) } }));
    for (const stats of [unknown.domainStats[0], unknown.ipStats[0], unknown.resourceStats[0]]) {
      expect(Number.isNaN(stats.avgTime)).toBe(true);
      expect(stats).toMatchObject({ count: 4, unknownTimeCount: 4 });
    }
  });
  it('excludes contradictory phases from aggregate findings and attribution evidence', () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      ...harEntry(`contradiction-${index}`, 0, 0), time: 1,
      timings: { send: 0, wait: 8000, receive: 0, dns: 4000, blocked: 2000 },
    }));
    const result = diagnoseHar(parseHar({ log: { entries } }));
    expect(result.networkStatus.every(phase => phase.slowCount === 0 && phase.validCount === 0 && Number.isNaN(phase.maxMs))).toBe(true);
    expect(result.attributions).toEqual([]);
    expect(result.findings.join(' ')).toContain('矛盾');
  });

  it('uses order-independent percentiles and excludes TLS from TCP duration', () => {
    const parsed = parseHar({
      log: {
        version: '1.2',
        creator: { name: 'test', version: '1' },
        entries: [
          harEntry('slow', 900, 800),
          harEntry('fast', 20, 10),
          harEntry('middle', 200, 50),
        ],
      },
    });

    const result = diagnoseHar(parsed);
    const tcp = result.networkStatus.find(phase => phase.label === 'TCP');
    const tls = result.networkStatus.find(phase => phase.label === 'TLS');

    expect(tcp).toMatchObject({ avgMs: 87, maxMs: 150, p95Ms: 150, slowCount: 0 });
    expect(tls).toMatchObject({ maxMs: 800, p95Ms: 800, slowCount: 1 });
  });
});
