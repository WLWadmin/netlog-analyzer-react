import { extractDnsAnswerCandidates, summarizeDnsAnswerCandidates } from './dnsAnswerCandidates';

describe('dnsAnswerCandidates', () => {
  it('提取 Host Resolver cache hit 的 aliases 和 ip_endpoints', () => {
    const candidates = extractDnsAnswerCandidates({
      results: {
        aliases: ['api.example.com', 'api.example.com.cdn.example'],
        ip_endpoints: [
          { endpoint_address: '203.0.113.10', endpoint_port: 0 },
          { endpoint_address: '203.0.113.11:443' },
        ],
      },
    }, {
      typeName: 'HOST_RESOLVER_MANAGER_CACHE_HIT',
      sourceTypeName: 'HOST_RESOLVER_IMPL_JOB',
      eventId: 1,
      sourceId: 100,
      byteStart: 10,
      byteEnd: 99,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        host: 'api.example.com',
        ips: ['203.0.113.10', '203.0.113.11'],
        aliases: ['api.example.com', 'api.example.com.cdn.example'],
        sourceKind: 'hostResolverCache',
        eventId: 1,
        sourceId: 100,
        byteStart: 10,
        byteEnd: 99,
      }),
    ]);
  });

  it('将 DNS task alias 映射到目标 answer IP', () => {
    const candidates = extractDnsAnswerCandidates({
      results: [
        {
          domain_name: 'cdn.example.net',
          endpoints: [{ address: '198.51.100.10' }],
        },
        {
          domain_name: 'api.example.com',
          alias_target: 'cdn.example.net',
          type: 'alias',
        },
      ],
    }, {
      typeName: 'HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS',
      eventId: 2,
      sourceId: 200,
      byteStart: 100,
      byteEnd: 199,
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        host: 'cdn.example.net',
        ips: ['198.51.100.10'],
        sourceKind: 'dnsTaskResult',
      }),
      expect.objectContaining({
        host: 'api.example.com',
        ips: ['198.51.100.10'],
        aliases: ['cdn.example.net'],
        sourceKind: 'dnsTaskResult',
      }),
    ]));
  });

  it('提取 generic DNS event 但不把 DoH/server 字段当作 DNS answer', () => {
    const candidates = extractDnsAnswerCandidates({
      hostname: 'generic.example.com',
      address_list: ['192.0.2.10'],
      dohServers: ['https://dns.example/dns-query'],
      nameservers: ['8.8.8.8'],
    }, {
      typeName: 'HOST_RESOLVER_MANAGER_JOB',
      eventId: 3,
      sourceId: 300,
      byteStart: 200,
      byteEnd: 299,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        host: 'generic.example.com',
        ips: ['192.0.2.10'],
        sourceKind: 'genericDnsEvent',
      }),
    ]);
    expect(candidates.flatMap(candidate => candidate.ips)).not.toEqual(expect.arrayContaining(['8.8.8.8']));
  });

  it('输出 sourceKind/typeName 聚合统计和 trace 缺失数', () => {
    const candidates = [
      ...extractDnsAnswerCandidates({ hostname: 'a.example.com', address_list: ['192.0.2.1'] }, { typeName: 'HOST_RESOLVER_MANAGER_JOB' }),
      ...extractDnsAnswerCandidates({ hostname: 'b.example.com', address_list: ['192.0.2.2'] }, { typeName: 'HOST_RESOLVER_MANAGER_JOB', eventId: 4, sourceId: 400, byteStart: 300, byteEnd: 399 }),
    ];

    expect(summarizeDnsAnswerCandidates(candidates)).toEqual({
      candidateCount: 2,
      uniqueHostIpPairs: 2,
      missingTraceCount: 1,
      bySourceKind: { genericDnsEvent: 2 },
      byTypeName: { HOST_RESOLVER_MANAGER_JOB: 2 },
    });
  });
});
