import type { AnalysisResult } from '../../parsers/netlog/parser';
import { compareNetlogBaselines } from './netlogBaselineComparator';

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    totalEvents: 100,
    uniqueSources: 10,
    peakConcurrency: 1,
    urlRequests: [],
    sslEvents: [],
    quicEvents: [],
    http2Events: [],
    dnsEvents: [],
    connectEvents: [],
    proxyEvents: [],
    errors: [],
    warnings: [],
    info: [],
    timeRange: { start: 0, end: 1000 },
    protocols: {},
    hosts: {},
    dnsServers: [],
    dnsRecords: [],
    dohCandidates: [],
    errorSources: {},
    certIssues: [],
    sslIssues: [],
    connectionFailures: [],
    stalledRequests: [],
    slowRequests: [],
    cacheEvents: [],
    networkChanges: [],
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
    failedDomains: [],
    systemInfo: { os: null, browser: null, netLogVersion: null, commandLine: null },
    ...overrides,
  };
}

describe('netlogBaselineComparator', () => {
  it('detects newly added DNS, proxy, TLS, protocol and error differences', () => {
    const baseline = result({ dnsServers: ['10.0.0.1'], protocols: { 'HTTP/2': 10 } });
    const current = result({
      dnsServers: ['10.0.0.1', '8.8.8.8'],
      protocols: { 'HTTP/2': 10, QUIC: 3 },
      proxyInfo: {
        hasProxy: true,
        proxyType: 'PAC',
        proxySettings: null,
        effectiveProxy: null,
        originalProxy: null,
        pacUrl: 'https://proxy.example.test/proxy.pac',
        proxyList: ['PROXY proxy.example.test:8080'],
        proxyFallback: null,
        isVPN: false,
        vpnHints: [],
      },
      failedDomains: [{
        domain: 'api.example.test',
        urls: ['https://api.example.test/a'],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1 }],
        errorCodes: [-105],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 1,
        firstTime: 1,
        lastTime: 1,
      }],
      certIssues: [{ event: { time: 1, type: 0, typeName: 'SSL', source: { id: 1, type: 1, typeName: 'SSL' }, phase: 0, phaseName: 'PHASE_NONE', params: {} }, error: -202, host: 'tls.example.test', category: 'cert' }],
    });

    const cards = compareNetlogBaselines(baseline, current);

    expect(cards.map(card => card.id)).toEqual(expect.arrayContaining([
      'netlog-baseline-dns-servers',
      'netlog-baseline-proxy',
      'netlog-baseline-tls',
      'netlog-baseline-protocol',
      'netlog-baseline-errors',
    ]));
    expect(cards.every(card => card.limitations?.join('\n').includes('差异本身不是根因'))).toBe(true);
  });

  it('downgrades confidence when either NetLog is incomplete', () => {
    const cards = compareNetlogBaselines(result(), result({
      dnsServers: ['8.8.8.8'],
      largeFileMode: {
        enabled: true,
        fileSize: 100,
        bytesRead: 10,
        parsedEvents: 1,
        skippedEvents: 0,
        truncatedEventsPreview: true,
        reachedEventsEnd: false,
      },
    }));

    expect(cards[0]).toMatchObject({ confidence: 'low', severity: 'info' });
    expect(cards[0].confidenceFactors?.some(item => item.label === '采集不完整')).toBe(true);
  });

  it('sanitizes URL queries and proxy credentials in baseline evidence', () => {
    const cards = compareNetlogBaselines(result(), result({
      proxyInfo: {
        hasProxy: true,
        proxyType: 'PAC',
        proxySettings: null,
        effectiveProxy: null,
        originalProxy: null,
        pacUrl: 'https://proxy.example.test/proxy.pac?token=SECRET_QUERY',
        proxyList: ['PROXY user:SECRET_PASSWORD@proxy.example.test:8080'],
        proxyFallback: null,
        isVPN: false,
        vpnHints: [],
      },
      connectionFailures: [{ url: 'https://api.example.test/data?token=SECRET_QUERY', error: -102, time: 100 }],
    }));
    const text = JSON.stringify(cards);

    expect(text).not.toContain('SECRET_QUERY');
    expect(text).not.toContain('SECRET_PASSWORD');
  });

  it('compares network-change counts without treating different timestamps as new types', () => {
    const change = (time: number) => ({
      time,
      type: 1,
      typeName: 'NETWORK_CHANGED',
      source: { id: time, type: 1, typeName: 'NETWORK_CHANGE' },
      phase: 0,
      phaseName: 'PHASE_NONE',
      params: {},
    });
    const sameCount = compareNetlogBaselines(result({ networkChanges: [change(100)] }), result({ networkChanges: [change(900)] }));
    const increasedCount = compareNetlogBaselines(result({ networkChanges: [change(100)] }), result({ networkChanges: [change(900), change(1200)] }));

    expect(sameCount.some(card => card.id === 'netlog-baseline-network-change')).toBe(false);
    expect(increasedCount.some(card => card.id === 'netlog-baseline-network-change')).toBe(true);
  });
});
