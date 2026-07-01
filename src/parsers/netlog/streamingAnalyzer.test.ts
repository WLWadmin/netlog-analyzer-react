import { createNetlogStreamingAnalyzer } from './streamingAnalyzer';

function event(overrides: any) {
  return {
    time: '0',
    type: 2,
    phase: 2,
    source: { id: 1, type: 1 },
    params: {},
    ...overrides,
  };
}

describe('createNetlogStreamingAnalyzer', () => {
  it('使用文件内 constants 还原事件名和 source 类型', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.applyMetadata({
      constants: {
        logEventTypes: { URL_REQUEST_START_JOB: 9001 },
        logSourceType: { URL_REQUEST: 9002 },
      },
    });
    analyzer.accept(event({ time: '0', type: 9001, phase: 0, source: { id: 10, type: 9002 }, params: { url: 'https://api.example.com/data' } }));
    const { eventsPreview, meta } = analyzer.finish();

    expect(eventsPreview[0].typeName).toBe('URL_REQUEST_START_JOB');
    expect(eventsPreview[0].source.typeName).toBe('URL_REQUEST');
    expect(meta.unknownEventTypes).not.toContain(9001);
    expect(meta.unknownSourceTypes).not.toContain(9002);
  });

  it('从 polledData 提取 DNS 服务器和 DNS 缓存', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.applyMetadata({
      polledData: {
        dns_config: { nameservers: ['223.5.5.5:53'] },
        host_resolver_cache: {
          entry1: {
            hostname: 'api.example.com',
            addresses: ['1.2.3.4'],
          },
        },
      },
    });
    const { result } = analyzer.finish();

    expect(result.dnsServers).toContain('223.5.5.5');
    expect(result.dnsRecords).toEqual([
      expect.objectContaining({ host: 'api.example.com', ips: ['1.2.3.4'] }),
    ]);
  });

  it('聚合 URL 请求、慢请求和失败域名', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.accept(event({ time: '0', type: 111, phase: 0, source: { id: 10, type: 1 }, params: { url: 'https://api.example.com/data', method: 'GET' } }));
    analyzer.accept(event({ time: '100', type: 1, source: { id: 10, type: 1 }, params: { net_error: -105 } }));
    analyzer.accept(event({ time: '4200', type: 2, phase: 1, source: { id: 10, type: 1 }, params: {} }));
    const { result, eventsPreview, meta } = analyzer.finish();

    expect(meta.parsedEvents).toBe(3);
    expect(result.totalEvents).toBe(3);
    expect(result.urlRequests).toHaveLength(1);
    expect(result.connectionFailures).toEqual([
      expect.objectContaining({ url: 'https://api.example.com/data', error: -105 }),
    ]);
    expect(result.failedDomains).toEqual([
      expect.objectContaining({ domain: 'api.example.com', errorCodes: [-105] }),
    ]);
    expect(result.slowRequests).toHaveLength(1);
    expect(eventsPreview.length).toBeGreaterThan(0);
  });

  it('提取 DNS answer、代理和协议事件', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.accept(event({ time: '1', type: 395, source: { id: 20, type: 11 }, params: { hostname: 'api.example.com', address_list: ['203.0.113.10'] } }));
    analyzer.accept(event({ time: '2', type: 28, source: { id: 30, type: 0 }, params: { proxy_list: ['PROXY corp.example:8080'] } }));
    analyzer.accept(event({ time: '3', type: 199, source: { id: 31, type: 8 }, params: {} }));
    analyzer.accept(event({ time: '4', type: 252, source: { id: 32, type: 10 }, params: {} }));
    const { result } = analyzer.finish();

    expect(result.dnsRecords).toEqual([
      expect.objectContaining({ host: 'api.example.com', ips: ['203.0.113.10'] }),
    ]);
    expect(result.proxyInfo.hasProxy).toBe(true);
    expect(result.proxyEvents).toHaveLength(1);
    expect(result.http2Events).toHaveLength(1);
    expect(result.quicEvents).toHaveLength(1);
  });

  it('从 HOST_RESOLVER 真实字段结构提取 DNS 记录', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.applyMetadata({
      constants: {
        logEventTypes: { HOST_RESOLVER_MANAGER_CACHE_HIT: 7101 },
        logSourceType: { HOST_RESOLVER_IMPL_JOB: 8101 },
      },
    });
    analyzer.accept(event({
      time: '1',
      type: 7101,
      source: { id: 20, type: 8101 },
      params: {
        host_ports: ['api.example.com:443'],
        ip_endpoints: [{ endpoint_address: '203.0.113.10', endpoint_port: 443 }],
        results: {
          hostname_results: [{ endpoint_address: '203.0.113.11:443' }],
        },
      },
    }));
    const { result } = analyzer.finish();

    expect(result.dnsRecords).toEqual([
      expect.objectContaining({
        host: 'api.example.com',
        ips: expect.arrayContaining(['203.0.113.10', '203.0.113.11']),
      }),
    ]);
  });

  it('从 CACHE_HIT 样本的 aliases/canonical_names + ip_endpoints 提取 DNS 记录', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.applyMetadata({
      constants: {
        logEventTypes: { HOST_RESOLVER_MANAGER_CACHE_HIT: 7101 },
        logSourceType: { HOST_RESOLVER_IMPL_JOB: 8101 },
      },
    });
    analyzer.accept(event({
      time: '1',
      type: 7101,
      source: { id: 20, type: 8101 },
      params: {
        results: {
          aliases: ['glata.bytedance.com', 'glata.bytedance.com.bytedns1.com'],
          canonical_names: ['l7-online-self-max.s.dsa.cdnbuild.net'],
          host_ports: [],
          hostname_results: [],
          ip_endpoints: [
            { endpoint_address: '27.128.209.201', endpoint_port: 0 },
            { endpoint_address: '27.185.242.148', endpoint_port: 0 },
          ],
        },
      },
    }));
    const { result } = analyzer.finish();

    expect(result.dnsRecords).toEqual([
      expect.objectContaining({
        host: 'glata.bytedance.com',
        ips: ['27.128.209.201', '27.185.242.148'],
      }),
    ]);
  });

  it('从 DNS_TASK_EXTRACTION_RESULTS 的 results 数组提取 DNS 记录', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.applyMetadata({
      constants: {
        logEventTypes: { HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS: 7102 },
        logSourceType: { DNS_TRANSACTION: 8102 },
      },
    });
    analyzer.accept(event({
      time: '1',
      type: 7102,
      source: { id: 21, type: 8102 },
      params: {
        results: [
          {
            domain_name: 'l7-online-self-max.s.dsa.cdnbuild.net',
            endpoints: [
              { address: '27.185.242.148', port: 0 },
              { address: '106.116.191.122', port: 0 },
            ],
            type: 'data',
          },
          {
            alias_target: 'l7-online-self-max.s.dsa.cdnbuild.net',
            domain_name: 'internal-api-drive-stream.larkoffice.com',
            type: 'alias',
          },
        ],
      },
    }));
    const { result } = analyzer.finish();

    expect(result.dnsRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        host: 'l7-online-self-max.s.dsa.cdnbuild.net',
        ips: expect.arrayContaining(['27.185.242.148', '106.116.191.122']),
      }),
      expect.objectContaining({
        host: 'internal-api-drive-stream.larkoffice.com',
        ips: expect.arrayContaining(['27.185.242.148', '106.116.191.122']),
      }),
    ]));
  });

  it('支持高频低价值事件轻量计数', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.applyMetadata({
      constants: {
        logEventTypes: { HTTP2_SESSION_UPDATE_RECV_WINDOW: 7201 },
        logSourceType: { HTTP2_SESSION: 8201 },
      },
    });

    analyzer.recordLightweightEvent(7201, 8201);
    const { result, meta } = analyzer.finish();

    expect(result.totalEvents).toBe(1);
    expect(meta.parsedEvents).toBe(1);
    expect(meta.fullyParsedEvents).toBe(0);
    expect(meta.lightweightCountedEvents).toBe(1);
    expect(meta.lightweightEventTypes).toEqual([
      { name: 'HTTP2_SESSION_UPDATE_RECV_WINDOW', count: 1 },
    ]);
    expect(meta.diagnostics.topEventTypes).toEqual([
      { name: 'HTTP2_SESSION_UPDATE_RECV_WINDOW', count: 1 },
    ]);
  });

  it('输出 DNS/IP/headers 候选诊断统计', () => {
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.applyMetadata({
      constants: {
        logEventTypes: {
          HOST_RESOLVER_MANAGER_JOB: 7001,
          URL_REQUEST_START_JOB: 7002,
          URL_REQUEST_READ_RESPONSE_HEADERS: 7003,
        },
        logSourceType: {
          HOST_RESOLVER_IMPL_JOB: 8001,
          URL_REQUEST: 8002,
        },
      },
    });
    analyzer.accept(event({
      time: '1',
      type: 7001,
      source: { id: 20, type: 8001 },
      params: { hostname: 'api.example.com', address_list: ['203.0.113.10'] },
    }));
    analyzer.accept(event({
      time: '2',
      type: 7002,
      phase: 0,
      source: { id: 30, type: 8002 },
      params: { url: 'https://api.example.com/data' },
    }));
    analyzer.accept(event({
      time: '3',
      type: 7003,
      source: { id: 30, type: 8002 },
      params: { headers: 'x-response-cinfo: 1.2.3.4\nx-response-sinfo: 5.6.7.8' },
    }));
    const { meta } = analyzer.finish();

    expect(meta.diagnostics.dnsCandidateEvents).toBeGreaterThan(0);
    expect(meta.diagnostics.hostResolverCandidateEvents).toBeGreaterThan(0);
    expect(meta.diagnostics.urlRequestEvents).toBeGreaterThan(0);
    expect(meta.diagnostics.urlRequestsCreated).toBeGreaterThan(0);
    expect(meta.diagnostics.eventsWithHeaders).toBe(1);
    expect(meta.diagnostics.responseHeaderKeys).toEqual([
      { name: 'x-response-cinfo', count: 1 },
      { name: 'x-response-sinfo', count: 1 },
    ]);
    expect(meta.diagnostics.eventsWithIpLikeParams).toBeGreaterThan(0);
    expect(meta.diagnostics.ipCandidateEventTypes).toEqual(
      expect.arrayContaining([{ name: 'HOST_RESOLVER_MANAGER_JOB', count: 1 }])
    );
    expect(meta.diagnostics.dnsCandidateParamKeys).toEqual(
      expect.arrayContaining([{ name: 'address_list', count: 1 }, { name: 'hostname', count: 1 }])
    );
  });
});
