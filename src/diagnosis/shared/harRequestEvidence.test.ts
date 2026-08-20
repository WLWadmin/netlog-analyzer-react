import { parseHar } from '../../harParser';
import {
  buildHarRequestEvidenceConclusion,
  getHarRequestAnomalyHints,
} from './harRequestEvidence';

function parsedEntry(overrides: Record<string, unknown> = {}) {
  return parseHar({ log: { entries: [{
    startedDateTime: '2026-08-20T00:00:00.000Z',
    time: 1200,
    serverIPAddress: '203.0.113.10',
    connection: '42',
    request: { method: 'GET', url: 'https://example.test/api', httpVersion: 'HTTP/2', headers: [], queryString: [] },
    response: {
      status: 200, statusText: 'OK', httpVersion: 'HTTP/2',
      headers: [{ name: 'server-timing', value: 'app;dur=900;desc="application"' }],
      content: { size: 2048, mimeType: 'application/json', text: '{}' },
    },
    timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: 1100, receive: 100 },
    ...overrides,
  }] } }).entries[0];
}

describe('HAR request evidence model', () => {
  it('reports actual value, threshold, source, field state and supplemental evidence', () => {
    const hints = getHarRequestAnomalyHints(parsedEntry());
    const waiting = hints.find(hint => hint.key === 'wait');
    const dns = hints.find(hint => hint.key === 'dns');

    expect(waiting).toEqual(expect.objectContaining({
      state: 'anomaly',
      actualValue: 1100,
      thresholdValue: 800,
      unit: 'ms',
      sourcePath: '$.log.entries[0].timings.wait',
      evidenceLevel: 'anomaly-hint',
      supplement: '同次服务端日志；如需排除网络栈影响，再补充同次 NetLog',
    }));
    expect(dns).toEqual(expect.objectContaining({
      state: 'not-applicable',
      sourcePath: '$.log.entries[0].timings.dns',
      evidenceLevel: 'needs-evidence',
    }));
    expect(dns).not.toHaveProperty('actualValue');
    expect(hints.some(hint => hint.key === 'send')).toBe(false);
  });

  it('keeps missing, invalid and legitimate zero timing values distinct', () => {
    const entry = parsedEntry({
      time: 0,
      timings: { send: 0, wait: 'invalid', receive: 0 },
    });
    const hints = getHarRequestAnomalyHints(entry);

    expect(hints.find(hint => hint.key === 'receive')).toEqual(expect.objectContaining({
      state: 'within-reference', actualValue: 0,
    }));
    expect(hints.find(hint => hint.key === 'wait')).toEqual(expect.objectContaining({
      state: 'invalid', evidenceLevel: 'needs-evidence',
    }));
    expect(hints.find(hint => hint.key === 'dns')).toEqual(expect.objectContaining({
      state: 'missing', evidenceLevel: 'needs-evidence',
    }));
  });

  it('builds a bounded conclusion without assigning remote address or Server-Timing ownership', () => {
    const conclusion = buildHarRequestEvidenceConclusion(parsedEntry());
    const output = JSON.stringify(conclusion);

    expect(conclusion.summary).toContain('Waiting 阶段耗时异常');
    expect(output).toContain('浏览器记录的远端连接地址');
    expect(output).toContain('服务端通过响应头提供的自报指标');
    expect(output).toContain('$.log.entries[0].response.headers');
    expect(output).not.toMatch(/已确认(?:CDN|源站|故障节点)|服务端瓶颈/);
  });

  it('explains status zero and Chromium NetError as separate direct facts', () => {
    const conclusion = buildHarRequestEvidenceConclusion(parsedEntry({
      _netError: -105,
      _error: 'net::ERR_NAME_NOT_RESOLVED',
      time: 10,
      response: { status: 0, statusText: '', headers: [], content: { size: 0 } },
      timings: { send: 0, wait: 10, receive: 0 },
    }));
    const output = JSON.stringify(conclusion);

    expect(output).toContain('没有取得 HTTP 响应，不是服务端返回状态码 0');
    expect(output).toContain('浏览器导出的 Chromium 非标准网络错误事实');
    expect(output).toContain('$.log.entries[0]._netError');
    expect(conclusion.requiredEvidence).toContain('同次 NetLog，用于确认 DNS、连接、TLS、代理或系统网络栈证据');
  });

  it('does not turn a missing status or unavailable timings into observed facts', () => {
    for (const responseFields of [{}, { status: 'invalid' }]) {
      const conclusion = buildHarRequestEvidenceConclusion(parsedEntry({
        response: { ...responseFields, headers: [], content: {} },
        timings: {},
      }));
      const output = JSON.stringify(conclusion);

      expect(conclusion.summary).toContain('Timing 证据不足');
      expect(output).toContain('HAR 未提供可用的 HTTP 状态码');
      expect(output).not.toContain('没有取得 HTTP 响应');
      expect(output).not.toContain('未发现超过参考阈值');
    }
  });

  it('preserves the actual response extension source paths', () => {
    const conclusion = buildHarRequestEvidenceConclusion(parsedEntry({
      response: {
        status: 0,
        headers: [],
        content: {},
        netError: -105,
        blockedReason: 'mixed-content',
      },
      timings: { send: 0, wait: 0, receive: 0 },
    }));
    const output = JSON.stringify(conclusion);

    expect(output).toContain('$.log.entries[0].response.netError');
    expect(output).toContain('$.log.entries[0].response.blockedReason');
    expect(output).not.toContain('$.log.entries[0]._netError');
    expect(output).not.toContain('$.log.entries[0]._blockedReason');
  });
});
