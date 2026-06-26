import { classifyDnsServer } from './classifyDnsServer';
import { extractDnsIpEvidenceFromHar, extractDnsIpEvidenceFromNetlog } from './extractDnsIpEvidence';
import type { HarAnalysisResult, HarRequestEntry } from '../../harParser';
import type { AnalysisResult, URLRequest } from '../../parsers/netlog/parser';

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

  it('NetLog 优先展示 DNS，并提取失败请求 socket SIP', () => {
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
    expect(summary.cipSipRows[0].sipSources).toEqual(expect.arrayContaining(['netlog.URLRequest.remoteIp', 'netlog.params.ip_endpoint']));
  });
});
