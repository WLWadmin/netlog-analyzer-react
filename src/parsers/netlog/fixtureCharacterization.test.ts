import { parseLog } from './parser';
import { buildNetlogDiagnosisSummary } from '../../diagnosis/shared';

type RawEvent = {
  time: string;
  type: number;
  phase: number;
  source: { id: number; type: number };
  params?: Record<string, unknown>;
};

function event(overrides: Partial<RawEvent>): RawEvent {
  return {
    time: '0',
    type: 2,
    phase: 2,
    source: { id: 1, type: 1 },
    params: {},
    ...overrides,
  };
}

function successfulRequestFixture() {
  return {
    constants: {},
    polledData: {
      hostResolverInfo: {
        dnsConfig: {
          nameServers: ['8.8.8.8:53', '1.1.1.1'],
        },
      },
    },
    events: [
      event({
        time: '0',
        type: 111,
        phase: 0,
        source: { id: 10, type: 1 },
        params: { url: 'https://api.example.com/v1/users', method: 'GET' },
      }),
      event({
        time: '20',
        type: 395,
        source: { id: 20, type: 11 },
        params: { hostname: 'api.example.com', address_list: ['203.0.113.10'] },
      }),
      event({
        time: '120',
        type: 181,
        source: { id: 10, type: 1 },
        params: {
          status_code: 200,
          headers: 'HTTP/2 200\r\nx-response-cinfo: 203.0.113.10\r\nx-response-sinfo: 198.51.100.20\r\n',
        },
      }),
      event({
        time: '4200',
        type: 2,
        phase: 1,
        source: { id: 10, type: 1 },
        params: {},
      }),
    ],
  };
}

function dnsFailureFixture() {
  return {
    constants: {},
    events: [
      event({
        time: '0',
        type: 111,
        phase: 0,
        source: { id: 30, type: 1 },
        params: { url: 'https://missing.example.invalid/api', method: 'GET' },
      }),
      event({
        time: '80',
        type: 1,
        phase: 2,
        source: { id: 30, type: 1 },
        params: { net_error: -105 },
      }),
      event({
        time: '90',
        type: 2,
        phase: 1,
        source: { id: 30, type: 1 },
        params: {},
      }),
    ],
  };
}

function proxyAndProtocolFixture() {
  return {
    constants: {},
    events: [
      event({
        time: '0',
        type: 28,
        source: { id: 40, type: 0 },
        params: { proxy_list: ['PROXY corp-proxy.example:8080'], proxy_config: { mode: 'fixed_servers' } },
      }),
      event({
        time: '10',
        type: 199,
        source: { id: 41, type: 8 },
        params: {},
      }),
      event({
        time: '20',
        type: 252,
        source: { id: 42, type: 10 },
        params: { error_code: 42 },
      }),
      event({
        time: '30',
        type: 56,
        source: { id: 43, type: 5 },
        params: { host: 'tls.example.com', error_code: -200 },
      }),
    ],
  };
}

function protocolLocalErrorFixture() {
  return {
    constants: {},
    events: [
      event({
        time: '0',
        type: 111,
        phase: 0,
        source: { id: 50, type: 1 },
        params: { url: 'https://api.example.com/socket', method: 'GET' },
      }),
      event({
        time: '10',
        type: 210,
        source: { id: 60, type: 8 },
        params: {
          source_dependency: { id: 50, type: 1 },
          error_code: 'CANCEL',
          stream_id: 1,
        },
      }),
      event({
        time: '20',
        type: 181,
        source: { id: 50, type: 1 },
        params: { status_code: 200 },
      }),
      event({
        time: '30',
        type: 2,
        phase: 1,
        source: { id: 50, type: 1 },
      }),
    ],
  };
}

function recoveredInternalErrorFixture() {
  return {
    constants: {},
    events: [
      event({
        time: '0',
        type: 111,
        phase: 0,
        source: { id: 70, type: 1 },
        params: { url: 'https://api.example.com/cache', method: 'GET' },
      }),
      event({
        time: '10',
        type: 1,
        source: { id: 70, type: 1 },
        params: { net_error: -406 },
      }),
      event({
        time: '20',
        type: 181,
        source: { id: 70, type: 1 },
        params: { status_code: 200 },
      }),
      event({
        time: '30',
        type: 2,
        phase: 1,
        source: { id: 70, type: 1 },
      }),
    ],
  };
}

describe('NetLog parser fixture characterization', () => {
  it('固定成功请求 fixture 的关键输出', () => {
    const { result } = parseLog(successfulRequestFixture());

    expect(result.totalEvents).toBe(4);
    expect(result.urlRequests).toHaveLength(1);
    expect(result.urlRequests[0]).toEqual(expect.objectContaining({
      url: 'https://api.example.com/v1/users',
      method: 'GET',
      statusCode: 200,
      resolvedIp: '203.0.113.10',
      remoteIp: '198.51.100.20',
    }));
    expect(result.slowRequests.map(req => req.url)).toEqual(['https://api.example.com/v1/users']);
    expect(result.dnsServers).toEqual(expect.arrayContaining(['8.8.8.8', '1.1.1.1']));
    expect(result.dnsRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ host: 'api.example.com', ips: ['203.0.113.10'] }),
    ]));
    expect(result.proxyInfo.hasProxy).toBe(false);
    expect(result.failedDomains).toEqual([]);
  });

  it('固定 DNS 失败 fixture 的失败域名输出', () => {
    const { result } = parseLog(dnsFailureFixture());

    expect(result.totalEvents).toBe(3);
    expect(result.connectionFailures).toEqual([
      expect.objectContaining({ url: 'https://missing.example.invalid/api', error: -105 }),
    ]);
    expect(result.failedDomains).toEqual([
      expect.objectContaining({
        domain: 'missing.example.invalid',
        count: 1,
        errorCodes: [-105],
      }),
    ]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('固定代理和协议 fixture 的高层分类输出', () => {
    const { result } = parseLog(proxyAndProtocolFixture());

    expect(result.proxyInfo.hasProxy).toBe(true);
    expect(result.proxyInfo.proxyType).toContain('fixed_servers');
    expect(result.proxyEvents).toHaveLength(1);
    expect(result.http2Events).toHaveLength(1);
    expect(result.quicEvents).toHaveLength(1);
    expect(result.sslEvents).toHaveLength(1);
    expect(result.certIssues).toHaveLength(1);
    expect(result.protocols).toEqual(expect.objectContaining({
      'HTTP/2': 1,
      QUIC: 1,
    }));
  });

  it('does not treat protocol-local error_code as Chromium request failure', () => {
    const { result } = parseLog(protocolLocalErrorFixture());

    expect(result.connectionFailures).toEqual([]);
    expect(result.urlRequests[0]).toEqual(expect.objectContaining({
      statusCode: 200,
      status: '200',
    }));
    expect(result.urlRequests[0].error).toBeUndefined();
  });

  it('does not keep recovered internal cache status as final request failure', () => {
    const { result } = parseLog(recoveredInternalErrorFixture());

    expect(result.connectionFailures).toEqual([]);
    expect(result.urlRequests[0].error).toBeUndefined();
    expect(result.urlRequests[0].statusCode).toBe(200);
  });
});

describe('NetLog diagnosis summary fixture characterization', () => {
  it('固定 DNS 失败 summary 的核心卡片形态', () => {
    const { events, result } = parseLog(dnsFailureFixture());
    const summary = buildNetlogDiagnosisSummary(result, [], events);

    expect(summary.overallSeverity).toBe('critical');
    expect(summary.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'dns',
        severity: 'critical',
        confidence: 'low',
        title: 'DNS 解析失败 (1 个域名)',
      }),
    ]));
    const dnsCard = summary.cards.find(card => card.category === 'dns' && card.severity === 'critical');
    expect(dnsCard?.actions.map(action => action.title)).toEqual(expect.arrayContaining([
      '更换 DNS 测试',
      '检查企业 DNS 配置',
    ]));
  });

  it('固定代理和协议 summary 的核心卡片类型', () => {
    const { events, result } = parseLog(proxyAndProtocolFixture());
    const summary = buildNetlogDiagnosisSummary(result, [], events);

    expect(summary.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'proxy' }),
      expect.objectContaining({ category: 'tls' }),
      expect.objectContaining({ category: 'protocol' }),
    ]));
    expect(summary.cards.map(card => card.title)).toEqual(expect.arrayContaining([
      expect.stringContaining('代理'),
      expect.stringContaining('TLS'),
    ]));
  });
});
