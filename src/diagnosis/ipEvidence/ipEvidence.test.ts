import { classifyDnsServer } from './classifyDnsServer';
import { extractDnsIpEvidenceFromHar, extractDnsIpEvidenceFromNetlog } from './extractDnsIpEvidence';
import { buildIpLookupConclusions } from './ipLookupDiagnosis';
import { getCarrierDisplayName } from './ipLookupDiagnosis';
import {
  BUILTIN_IP_LOOKUP_PROXY_URL,
  getIpLookupProxyUrl,
  lookupIpViaProxy,
  lookupIpsWithLimit,
  resetIpLookupBudgetForTest,
  shouldLookupIp,
} from './ipLookupClient';
import { parseManualIps } from './manualIpInput';
import type { HarAnalysisResult, HarRequestEntry } from '../../harParser';
import type { AnalysisResult, URLRequest } from '../../parsers/netlog/parser';
import type { DnsIpEvidenceSummary } from './ipEvidenceTypes';
import type { IpLookupResult } from './ipLookupTypes';

function harEntry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'api',
    url: 'https://api.example.com/data',
    method: 'GET',
    status: 0,
    statusText: '',
    protocol: 'h2',
    domain: 'api.example.com',
    remoteAddress: '',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: 'application/json',
    size: 0,
    contentSize: 0,
    time: 1200,
    startedDateTime: '',
    startMs: 0,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
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
    ...overrides,
  };
}

function harResult(entries: HarRequestEntry[]): HarAnalysisResult {
  return {
    entries,
    totalRequests: entries.length,
    failedCount: entries.filter(e => e.isFailed).length,
    slowCount: entries.filter(e => e.isSlow).length,
    totalSize: 0,
    totalTime: entries.reduce((sum, e) => sum + e.time, 0),
    creator: 'test',
    typeCounts: {} as HarAnalysisResult['typeCounts'],
    bodyRetention: { mode: 'full', omittedCount: 0, omittedBytes: 0 },
  };
}

function netlogResultWithRequest(req: URLRequest): AnalysisResult {
  return {
    totalEvents: 1,
    uniqueSources: 1,
    peakConcurrency: 1,
    urlRequests: [req],
    sslEvents: [],
    quicEvents: [],
    http2Events: [],
    dnsEvents: [],
    connectEvents: [],
    proxyEvents: [],
    errors: [],
    warnings: [],
    info: [],
    timeRange: { start: 0, end: 1 },
    protocols: {},
    hosts: {},
    dnsServers: ['8.8.8.8', '192.168.1.1'],
    dnsRecords: [{ host: 'api.example.com', ips: ['203.0.113.10'], source: 'dns_event' }],
    errorSources: {},
    certIssues: [],
    sslIssues: [],
    connectionFailures: [],
    stalledRequests: [],
    slowRequests: [],
    cacheEvents: [],
    proxyInfo: {
      hasProxy: false,
      proxyType: null,
      proxySettings: null,
      effectiveProxy: null,
      originalProxy: null,
      pacUrl: null,
      proxyList: [],
      proxyFallback: null,
      isVPN: false,
      vpnHints: [],
    },
    networkChanges: [],
    failedDomains: [],
    systemInfo: { os: null, browser: null, netLogVersion: null, commandLine: null },
  };
}

function lookupSummary(overrides: Partial<DnsIpEvidenceSummary> = {}): DnsIpEvidenceSummary {
  return {
    dnsServers: [],
    dnsAnswers: [],
    dohCandidates: [],
    dnsEventCount: 0,
    failedOrSlowIps: [],
    cipSipRows: [],
    copyableIps: [],
    copyableDnsServers: [],
    guidance: [],
    limitations: [],
    ...overrides,
  };
}

describe('ipEvidence', () => {
  it('按 DNS 类型分类公共 DNS 与本地网关 DNS', () => {
    expect(classifyDnsServer('8.8.8.8').type).toBe('overseas-public-dns');
    expect(classifyDnsServer('114.114.114.114').type).toBe('public-dns');
    expect(classifyDnsServer('192.168.1.1').type).toBe('local-router-dns');
  });

  it('HAR 只提取失败或慢请求的 CIP/SIP 证据', () => {
    const summary = extractDnsIpEvidenceFromHar(harResult([
      harEntry({
        remoteAddress: '1.2.3.4:443',
        xTtCip: '5.6.7.8',
        isFailed: true,
        status: 0,
      }),
      harEntry({
        id: 2,
        remoteAddress: '9.9.9.9',
        xTtCip: '8.8.8.8',
        isFailed: false,
        isSlow: false,
        status: 200,
        time: 100,
      }),
    ]));

    expect(summary.cipSipRows).toHaveLength(1);
    expect(summary.copyableIps).toEqual(expect.arrayContaining(['1.2.3.4', '5.6.7.8']));
    expect(summary.copyableIps).not.toContain('9.9.9.9');
  });

  it('NetLog 优先展示 DNS，并将 socket peer 与 SIP 分列', () => {
    const req: URLRequest = {
      id: 1,
      url: 'https://api.example.com/data',
      method: 'GET',
      startTime: 0,
      statusCode: 0,
      error: -118,
      duration: 3000,
      remoteIp: '58.215.109.83',
      resolvedIp: '10.1.1.1',
      events: [{
        source: { id: 1, type: 1, typeName: 'URL_REQUEST' },
        type: 1,
        typeName: 'SOCKET_ALIVE',
        phase: 0,
        phaseName: 'PHASE_NONE',
        time: 0,
        params: { ip_endpoint: '58.215.109.84:443' },
      }],
      timeline: {},
    };

    const summary = extractDnsIpEvidenceFromNetlog(netlogResultWithRequest(req));

    expect(summary.dnsServers.map(item => item.ip)).toEqual(['8.8.8.8', '192.168.1.1']);
    expect(summary.dnsAnswers[0].ips).toContain('203.0.113.10');
    expect(summary.copyableIps).toEqual(expect.arrayContaining(['58.215.109.83', '58.215.109.84']));
    expect(summary.cipSipRows[0].sipIps).toEqual(['58.215.109.83']);
    expect(summary.cipSipRows[0].socketPeerIps).toEqual(expect.arrayContaining(['58.215.109.84']));
    expect(summary.cipSipRows[0].dnsAnswerIps).toEqual(expect.arrayContaining(['203.0.113.10']));
  });

  it('小 fixture：DNS answer 可见但不会冒充 DNS server 或 SIP', () => {
    const summary = extractDnsIpEvidenceFromNetlog({
      ...netlogResultWithRequest({
        id: 1,
        url: 'https://slow.example.com/data',
        method: 'GET',
        startTime: 0,
        duration: 2500,
        events: [],
        timeline: {},
      }),
      dnsServers: [],
      dnsRecords: [{ host: 'unrelated.example.com', ips: ['203.0.113.20'], source: 'dns_event' }],
    });

    expect(summary.dnsServers).toEqual([]);
    expect(summary.dnsAnswers[0].ips).toContain('203.0.113.20');
    expect(summary.failedOrSlowIps).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'dns-answer', ip: '203.0.113.20' }),
    ]));
    expect(summary.cipSipRows.some(row => row.sipIps.includes('203.0.113.20'))).toBe(false);
  });

  it('小 fixture：x-request-ip 作为服务端观察客户端 IP 线索', () => {
    const req: URLRequest = {
      id: 2,
      url: 'https://api.example.com/slow',
      method: 'GET',
      startTime: 0,
      duration: 3000,
      events: [{
        source: { id: 2, type: 1, typeName: 'URL_REQUEST' },
        type: 1,
        typeName: 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS',
        phase: 0,
        phaseName: 'PHASE_NONE',
        time: 0,
        params: { headers: ['x-request-ip: 198.51.100.7'] },
      }],
      timeline: {},
    };

    const summary = extractDnsIpEvidenceFromNetlog(netlogResultWithRequest(req));

    expect(summary.failedOrSlowIps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'server-observed-client-ip',
        source: 'netlog.headers.x-request-ip',
        ip: '198.51.100.7',
      }),
    ]));
    expect(summary.cipSipRows[0].serverObservedClientIps).toEqual(['198.51.100.7']);
  });

  it('小 fixture：全局 connectEvents 无法关联请求时仍展示 socket peer 线索', () => {
    const summary = extractDnsIpEvidenceFromNetlog({
      ...netlogResultWithRequest({
        id: 3,
        url: 'https://api.example.com/ok',
        method: 'GET',
        startTime: 0,
        statusCode: 200,
        duration: 100,
        events: [],
        timeline: {},
      }),
      connectEvents: [{
        source: { id: 9, type: 3, typeName: 'SOCKET' },
        type: 3,
        typeName: 'SOCKET_CONNECT',
        phase: 0,
        phaseName: 'PHASE_NONE',
        time: 1,
        params: { address: '198.51.100.8:443' },
      }],
    });

    expect(summary.failedOrSlowIps).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'socket-peer', ip: '198.51.100.8', host: '未关联到具体请求' }),
    ]));
  });

  it('小 fixture：DoH candidate 可见但不进入 DNS server', () => {
    const summary = extractDnsIpEvidenceFromNetlog({
      ...netlogResultWithRequest({
        id: 4,
        url: 'https://api.example.com/ok',
        method: 'GET',
        startTime: 0,
        statusCode: 200,
        duration: 100,
        events: [],
        timeline: {},
      }),
      dnsServers: [],
      dohCandidates: [{ value: 'https://dns.google/dns-query', source: 'polledData' }],
    });

    expect(summary.dnsServers).toEqual([]);
    expect(summary.dohCandidates).toEqual([
      { value: 'https://dns.google/dns-query', source: 'polledData' },
    ]);
  });

  it('相同域名和相同 CIP/SIP 去重，并保留耗时最长前三个代表请求', () => {
    const entries = [1000, 5000, 3000, 2000].map((time, index) => harEntry({
      id: index + 1,
      url: `https://api.example.com/data?i=${index}`,
      remoteAddress: '1.2.3.4',
      xTtCip: '5.6.7.8',
      isFailed: false,
      isSlow: true,
      status: 200,
      time,
    }));

    const summary = extractDnsIpEvidenceFromHar(harResult(entries));

    expect(summary.cipSipRows).toHaveLength(1);
    expect(summary.cipSipRows[0].representativeRequests).toHaveLength(3);
    expect(summary.cipSipRows[0].representativeRequests.map(req => req.durationMs)).toEqual([5000, 3000, 2000]);
  });

  it('shouldLookupIp 不允许内网、loopback、保留地址外发', () => {
    expect(shouldLookupIp('58.215.109.83')).toBe(true);
    expect(shouldLookupIp('10.0.0.1')).toBe(false);
    expect(shouldLookupIp('127.0.0.1')).toBe(false);
    expect(shouldLookupIp('2001:db8::1')).toBe(false);
  });

  it('海外公共 DNS server 输出 DNS 调度 warning', () => {
    const conclusions = buildIpLookupConclusions(lookupSummary({
      dnsServers: [classifyDnsServer('8.8.8.8')],
    }), new Map());

    expect(conclusions.some(item => item.title.includes('DNS'))).toBe(true);
    expect(conclusions[0].level).toBe('warning');
  });

  it('SIP 为海外时输出跨境线索', () => {
    const lookupMap = new Map<string, IpLookupResult>([
      ['8.8.8.8', { ip: '8.8.8.8', status: 'success', country: '美国', isp: 'Google LLC', as: 'AS15169 Google LLC' }],
    ]);

    const conclusions = buildIpLookupConclusions(lookupSummary({
      cipSipRows: [{
        id: '1',
        host: 'api.example.com',
        hostOrUrl: 'api.example.com',
        impact: 'failed',
        durationMs: 3000,
        cipIps: [],
        sipIps: ['8.8.8.8'],
        representativeRequests: [],
        descriptions: [],
      }],
    }), lookupMap);

    expect(conclusions.some(item => item.title.includes('跨境'))).toBe(true);
  });

  it('CIP/SIP 都为中国但运营商族群不同，输出跨运营商线索', () => {
    const lookupMap = new Map<string, IpLookupResult>([
      ['223.5.5.5', { ip: '223.5.5.5', status: 'success', country: '中国', isp: 'China Mobile', org: '中国移动' }],
      ['58.215.109.83', { ip: '58.215.109.83', status: 'success', country: '中国', isp: 'Chinanet Jiangsu', org: '中国电信' }],
    ]);

    const conclusions = buildIpLookupConclusions(lookupSummary({
      cipSipRows: [{
        id: '1',
        host: 'api.example.com',
        hostOrUrl: 'api.example.com',
        impact: 'slow',
        durationMs: 2000,
        cipIps: ['223.5.5.5'],
        sipIps: ['58.215.109.83'],
        representativeRequests: [],
        descriptions: [],
      }],
    }), lookupMap);

    expect(conclusions.some(item => item.title.includes('运营商'))).toBe(true);
  });

  it('同一行 CIP 为移动且 SIP 为移动和电信时，输出跨运营商线索', () => {
    const lookupMap = new Map<string, IpLookupResult>([
      ['183.205.137.81', { ip: '183.205.137.81', status: 'success', country: '中国', isp: 'China Mobile', org: '中国移动' }],
      ['171.8.194.33', { ip: '171.8.194.33', status: 'success', country: '中国', isp: 'Chinanet Henan', org: '中国电信' }],
    ]);

    const conclusions = buildIpLookupConclusions(lookupSummary({
      cipSipRows: [{
        id: '1',
        host: 'internal-api-security.feishu.cn',
        hostOrUrl: 'internal-api-security.feishu.cn',
        impact: 'failed',
        durationMs: 315,
        cipIps: ['183.205.137.81'],
        sipIps: ['183.205.137.81', '171.8.194.33'],
        representativeRequests: [],
        descriptions: [],
      }],
    }), lookupMap);

    expect(conclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: '客户端出口线索与服务端目标运营商不同',
        detail: expect.stringContaining('CIP 侧运营商为 中国移动，SIP 侧运营商为 中国移动、中国电信'),
      }),
    ]));
  });

  it('同一行 CIP 为移动和电信且 SIP 为移动时，输出跨运营商线索', () => {
    const lookupMap = new Map<string, IpLookupResult>([
      ['183.205.137.81', { ip: '183.205.137.81', status: 'success', country: '中国', isp: 'China Mobile', org: '中国移动' }],
      ['171.8.194.33', { ip: '171.8.194.33', status: 'success', country: '中国', isp: 'Chinanet Henan', org: '中国电信' }],
    ]);

    const conclusions = buildIpLookupConclusions(lookupSummary({
      cipSipRows: [{
        id: '1',
        host: 'internal-api-security.feishu.cn',
        hostOrUrl: 'internal-api-security.feishu.cn',
        impact: 'failed',
        durationMs: 315,
        cipIps: ['183.205.137.81', '171.8.194.33'],
        sipIps: ['183.205.137.81'],
        representativeRequests: [],
        descriptions: [],
      }],
    }), lookupMap);

    expect(conclusions.some(item => item.detail.includes('CIP 侧运营商为 中国移动、中国电信，SIP 侧运营商为 中国移动'))).toBe(true);
  });

  it('同一行 CIP/SIP 运营商集合一致时，不输出跨运营商线索', () => {
    const lookupMap = new Map<string, IpLookupResult>([
      ['183.205.137.81', { ip: '183.205.137.81', status: 'success', country: '中国', isp: 'China Mobile', org: '中国移动' }],
      ['171.8.194.33', { ip: '171.8.194.33', status: 'success', country: '中国', isp: 'Chinanet Henan', org: '中国电信' }],
    ]);

    const conclusions = buildIpLookupConclusions(lookupSummary({
      cipSipRows: [{
        id: '1',
        host: 'internal-api-security.feishu.cn',
        hostOrUrl: 'internal-api-security.feishu.cn',
        impact: 'failed',
        durationMs: 315,
        cipIps: ['183.205.137.81', '171.8.194.33'],
        sipIps: ['183.205.137.81', '171.8.194.33'],
        representativeRequests: [],
        descriptions: [],
      }],
    }), lookupMap);

    expect(conclusions.some(item => item.title.includes('运营商不同'))).toBe(false);
  });

  it('运营商显示中文归一化', () => {
    expect(getCarrierDisplayName({ ip: '1.1.1.1', status: 'success', isp: 'Chinanet Jiangsu' })).toBe('中国电信');
    expect(getCarrierDisplayName({ ip: '1.1.1.1', status: 'success', org: 'China Mobile Communications' })).toBe('中国移动');
    expect(getCarrierDisplayName({ ip: '1.1.1.1', status: 'success', asname: 'CHINA UNICOM China169 Backbone' })).toBe('中国联通');
    expect(getCarrierDisplayName({ ip: '1.1.1.1', status: 'success', isp: 'China Tietong Telecommunications' })).toBe('中国铁通');
  });

  it('只有 SIP 没有 CIP 时，不输出跨运营商结论', () => {
    const lookupMap = new Map<string, IpLookupResult>([
      ['58.215.109.83', { ip: '58.215.109.83', status: 'success', country: '中国', isp: 'Chinanet Jiangsu', org: '中国电信' }],
    ]);

    const conclusions = buildIpLookupConclusions(lookupSummary({
      cipSipRows: [{
        id: '1',
        host: 'api.example.com',
        hostOrUrl: 'api.example.com',
        impact: 'slow',
        durationMs: 2000,
        cipIps: [],
        sipIps: ['58.215.109.83'],
        representativeRequests: [],
        descriptions: [],
      }],
    }), lookupMap);

    expect(conclusions.some(item => item.title.includes('运营商不同'))).toBe(false);
  });

  it('lookupIpsWithLimit 对重复 IP 去重并过滤内网 IP', async () => {
    resetIpLookupBudgetForTest();
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'success', query: '58.215.109.83', country: '中国' }),
    } as any);
    const results: string[] = [];

    const batch = await lookupIpsWithLimit(['58.215.109.83', '58.215.109.83', '10.0.0.1'], (ip) => {
      results.push(ip);
    });

    expect(batch.requested).toBe(2);
    expect(batch.skipped).toBe(1);
    expect(results).toEqual(['58.215.109.83']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('lookupIpsWithLimit 每轮最多查询 limit 个公网 IP', async () => {
    resetIpLookupBudgetForTest();
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'success', query: '58.215.109.1', country: '中国' }),
    } as any);
    const queried: string[] = [];

    const ips = Array.from({ length: 25 }, (_, index) => `58.215.109.${index + 1}`);
    const batch = await lookupIpsWithLimit(ips, (ip) => {
      queried.push(ip);
    }, { limit: 20, concurrency: 3 });

    expect(batch.requested).toBe(25);
    expect(batch.queued).toBe(20);
    expect(queried).toHaveLength(20);
    expect(fetchMock).toHaveBeenCalledTimes(20);
    fetchMock.mockRestore();
    resetIpLookupBudgetForTest();
  });

  it('IP 查询代理地址仅接受 HTTPS，空值和非 HTTPS 回退内置地址', () => {
    expect(getIpLookupProxyUrl(undefined)).toBe(BUILTIN_IP_LOOKUP_PROXY_URL);
    expect(getIpLookupProxyUrl('')).toBe(BUILTIN_IP_LOOKUP_PROXY_URL);
    expect(getIpLookupProxyUrl('   ')).toBe(BUILTIN_IP_LOOKUP_PROXY_URL);
    expect(getIpLookupProxyUrl('http://example.com')).toBe(BUILTIN_IP_LOOKUP_PROXY_URL);
    expect(getIpLookupProxyUrl('https://example.com/')).toBe('https://example.com');
  });

  it('parseManualIps 支持多种分隔符、trim、去重和过滤空值', () => {
    expect(parseManualIps(' 1.1.1.1, 8.8.8.8\n1.1.1.1，9.9.9.9； 4.4.4.4; ')).toEqual([
      '1.1.1.1',
      '8.8.8.8',
      '9.9.9.9',
      '4.4.4.4',
    ]);
    expect(parseManualIps('  \n,，;；  ')).toEqual([]);
  });

  it('Worker 返回 HTTP 502 但 body 为成功 JSON 时仍展示成功结果', async () => {
    resetIpLookupBudgetForTest();
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({
        status: 'success',
        query: '162.128.226.9',
        country: '香港',
        isp: 'Zenlayer Inc',
      }),
    } as any);

    const result = await lookupIpViaProxy('162.128.226.9');

    expect(result.status).toBe('success');
    expect(result.ip).toBe('162.128.226.9');
    expect(result.country).toBe('香港');
    expect(result.message).toBeUndefined();
    fetchMock.mockRestore();
  });

  it('达到本地每分钟预算后返回限流提示', async () => {
    resetIpLookupBudgetForTest();
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'success', query: '58.215.109.83', country: '中国' }),
    } as any);

    for (let i = 0; i < 40; i += 1) {
      await lookupIpViaProxy(`58.215.109.${i + 1}`);
    }
    const limited = await lookupIpViaProxy('58.215.109.99');

    expect(limited.status).toBe('fail');
    expect(limited.message).toContain('频率');
    fetchMock.mockRestore();
    resetIpLookupBudgetForTest();
  });
});
