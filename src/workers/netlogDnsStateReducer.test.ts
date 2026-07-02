import { createNetlogDnsStateReducer } from './netlogDnsStateReducer';

describe('netlogDnsStateReducer', () => {
  it('提取 Host Resolver cache、DNS task results 和 IPv6 可达性线索', () => {
    const reducer = createNetlogDnsStateReducer();

    reducer.acceptTopLevelConfig('polledData', {
      hostResolverInfo: {
        dnsConfig: {
          nameServers: ['223.5.5.5:53', '8.8.8.8'],
          dohServers: ['https://dns.example/dns-query', '1.1.1.1'],
        },
      },
    });

    reducer.accept({
      eventId: 1,
      byteStart: 100,
      byteEnd: 199,
      time: 10,
      typeName: 'HOST_RESOLVER_MANAGER_CACHE_HIT',
      sourceId: 100,
      sourceTypeName: 'HOST_RESOLVER_IMPL_JOB',
      phase: 2,
      params: {
        results: {
          aliases: ['cache.example.com'],
          ip_endpoints: [{ endpoint_address: '203.0.113.10', endpoint_port: 0 }],
          expiration: '2026-07-02T10:00:00Z',
        },
      },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 200,
      byteEnd: 299,
      time: 20,
      typeName: 'HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS',
      sourceId: 101,
      sourceTypeName: 'HOST_RESOLVER_IMPL_JOB',
      phase: 2,
      params: {
        results: [{
          domain_name: 'task.example.com',
          query_type: 'A',
          endpoints: [{ endpoint_address: '203.0.113.11', endpoint_port: 0 }],
        }],
      },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 300,
      byteEnd: 399,
      time: 30,
      typeName: 'HOST_RESOLVER_MANAGER_IPV6_REACHABILITY_CHECK',
      sourceId: 102,
      sourceTypeName: 'HOST_RESOLVER_IMPL_JOB',
      phase: 2,
      params: { ipv6_available: false },
    });
    reducer.accept({
      eventId: 4,
      byteStart: 400,
      byteEnd: 499,
      time: 40,
      typeName: 'HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS',
      sourceId: 103,
      sourceTypeName: 'HOST_RESOLVER_IMPL_JOB',
      phase: 2,
      params: {
        results: [{
          domain_name: 'failed.example.com',
          query_type: 'AAAA',
          error: -105,
        }],
      },
    });

    const view = reducer.finish();

    expect(view.hostResolverCache).toEqual([
      expect.objectContaining({ host: 'cache.example.com', ips: ['203.0.113.10'], eventId: 1, sourceId: 100, byteStart: 100, byteEnd: 199 }),
    ]);
    expect(view.taskResults).toEqual([
      expect.objectContaining({ host: 'task.example.com', queryType: 'A', ips: ['203.0.113.11'], eventId: 2, sourceId: 101, byteStart: 200, byteEnd: 299 }),
      expect.objectContaining({ host: 'failed.example.com', queryType: 'AAAA', ips: [], error: -105, eventId: 4, sourceId: 103, byteStart: 400, byteEnd: 499 }),
    ]);
    expect(view.configServers).toEqual(expect.arrayContaining([
      expect.objectContaining({ ip: '223.5.5.5', source: 'polledData' }),
      expect.objectContaining({ ip: '8.8.8.8', source: 'polledData' }),
    ]));
    expect(view.dohCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'https://dns.example/dns-query', source: 'polledData' }),
      expect.objectContaining({ value: '1.1.1.1', source: 'polledData' }),
    ]));
    expect(view.ipv6ReachabilityChecks).toEqual([
      { available: false, sourceId: 102, eventId: 3, byteStart: 300, byteEnd: 399 },
    ]);
    expect(view.evidenceGaps).not.toContain('未发现 DNS server 配置记录，不代表用户没有配置 DNS。');
  });

  it('DoH candidate 不会被当作 DNS server，并在缺少 config server 时输出 gap', () => {
    const reducer = createNetlogDnsStateReducer();

    reducer.acceptTopLevelConfig('polledData', {
      hostResolverInfo: {
        dnsConfig: {
          dohServers: ['https://dns.google/dns-query', '1.1.1.1'],
        },
      },
    });

    const view = reducer.finish();

    expect(view.configServers).toEqual([]);
    expect(view.dohCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'https://dns.google/dns-query' }),
      expect.objectContaining({ value: '1.1.1.1' }),
    ]));
    expect(view.evidenceGaps).toContain('发现 Secure DNS/DoH 线索，但不能据此推断当前 DNS server 配置。');
  });
});
