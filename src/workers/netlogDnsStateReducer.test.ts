import { createNetlogDnsStateReducer } from './netlogDnsStateReducer';

describe('netlogDnsStateReducer', () => {
  it('提取 Host Resolver cache、DNS task results 和 IPv6 可达性线索', () => {
    const reducer = createNetlogDnsStateReducer();

    reducer.accept({
      eventId: 1,
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
      time: 30,
      typeName: 'HOST_RESOLVER_MANAGER_IPV6_REACHABILITY_CHECK',
      sourceId: 102,
      sourceTypeName: 'HOST_RESOLVER_IMPL_JOB',
      phase: 2,
      params: { ipv6_available: false },
    });

    const view = reducer.finish();

    expect(view.hostResolverCache).toEqual([
      expect.objectContaining({ host: 'cache.example.com', ips: ['203.0.113.10'], eventId: 1 }),
    ]);
    expect(view.taskResults).toEqual([
      expect.objectContaining({ host: 'task.example.com', queryType: 'A', ips: ['203.0.113.11'], eventId: 2 }),
    ]);
    expect(view.ipv6ReachabilityChecks).toEqual([
      { available: false, sourceId: 102, eventId: 3 },
    ]);
    expect(view.evidenceGaps).toContain('未发现 DNS server 配置记录，不代表用户没有配置 DNS。');
  });
});
