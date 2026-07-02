import { parseLog } from './parser';

function minimalEvent(overrides: Record<string, unknown> = {}) {
  return {
    time: '0',
    type: 2,
    phase: 0,
    source: { id: 1, type: 1 },
    params: {},
    ...overrides,
  };
}

describe('netlog dns extraction compatibility', () => {
  it('从 polledData.hostResolverInfo.dnsConfig.nameServers 提取 DNS server', () => {
    const { result } = parseLog({
      constants: {},
      events: [minimalEvent()],
      polledData: {
        hostResolverInfo: {
          dnsConfig: {
            nameServers: ['8.8.8.8:53', '1.1.1.1'],
          },
        },
      },
    });

    expect(result.dnsServers).toEqual(expect.arrayContaining(['8.8.8.8', '1.1.1.1']));
  });

  it('从 DNS_TRANSACTION address_list 提取 DNS answer', () => {
    const { result } = parseLog({
      constants: {},
      events: [
        minimalEvent({
          type: 395,
          source: { id: 7, type: 0 },
          params: {
            hostname: 'api.example.com',
            address_list: ['1.2.3.4', '5.6.7.8'],
          },
        }),
      ],
    });

    expect(result.dnsRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: 'api.example.com',
          ips: expect.arrayContaining(['1.2.3.4', '5.6.7.8']),
        }),
      ])
    );
  });

  it('从 HOST_RESOLVER endpoint_results 提取 DNS answer', () => {
    const { result } = parseLog({
      constants: {},
      events: [
        minimalEvent({
          type: 393,
          source: { id: 9, type: 11 },
          params: {
            host: 'cdn.example.com',
            endpoint_results: [
              { ip_endpoint: '58.215.109.83:443' },
              { endpoint: '[2408:abcd::1]:443' },
            ],
          },
        }),
      ],
    });

    expect(result.dnsRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: 'cdn.example.com',
          ips: expect.arrayContaining(['58.215.109.83', '2408:abcd::1']),
        }),
      ])
    );
  });

  it('从 dnsCache object 形态提取 DNS answer', () => {
    const { result } = parseLog({
      constants: {},
      events: [minimalEvent()],
      polledData: {
        dnsCache: {
          'api.example.com': {
            hostname: 'api.example.com',
            addresses: ['1.1.1.1'],
          },
        },
      },
    });

    expect(result.dnsRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: 'api.example.com',
          ips: ['1.1.1.1'],
        }),
      ])
    );
  });

  it('不要把普通 socket address 当成 DNS server', () => {
    const { result } = parseLog({
      constants: {},
      events: [minimalEvent()],
      polledData: {
        sockets: [{ address: '2.2.2.2' }],
      },
    });

    expect(result.dnsServers).not.toContain('2.2.2.2');
  });

  it('DoH / Secure DNS 只进入候选线索，不进入 DNS server', () => {
    const { result } = parseLog({
      constants: {},
      events: [minimalEvent()],
      polledData: {
        hostResolverInfo: {
          dnsConfig: {
            nameServers: ['223.5.5.5:53'],
            dohServers: ['https://dns.google/dns-query', '1.1.1.1'],
            secureDnsServers: ['https://dns.alidns.com/dns-query'],
          },
        },
      },
    });

    expect(result.dnsServers).toContain('223.5.5.5');
    expect(result.dnsServers).not.toContain('1.1.1.1');
    expect(result.dohCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'https://dns.google/dns-query' }),
      expect.objectContaining({ value: '1.1.1.1' }),
      expect.objectContaining({ value: 'https://dns.alidns.com/dns-query' }),
    ]));
  });
});
