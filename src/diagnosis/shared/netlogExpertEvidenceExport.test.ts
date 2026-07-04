import { buildNetlogExpertEvidencePackage } from './netlogExpertEvidenceExport';
import type { AnalysisResult } from '../../parsers/netlog/parser';
import type { AltSvcStateView, CacheStateView, StreamPoolStateView } from '../../workers/netlogDatasetViews';

function baseResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    totalEvents: 10,
    uniqueSources: 3,
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
    timeRange: { start: 1, end: 2 },
    protocols: {},
    hosts: {},
    dnsServers: [],
    dnsRecords: [],
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
    systemInfo: {
      os: 'Windows',
      browser: 'Edge',
      netLogVersion: '1',
      commandLine: null,
    },
    ...overrides,
  };
}

describe('buildNetlogExpertEvidencePackage', () => {
  it('masks sensitive URL values in request evidence', () => {
    const report = buildNetlogExpertEvidencePackage({
      result: baseResult({
        urlRequests: [{
          id: 42,
          url: 'https://example.com/path?token=secret-token&ok=1',
          method: 'GET',
          startTime: 1,
          duration: 4000,
          protocol: 'HTTP/2',
          events: [],
          timeline: {},
        }],
      }),
      generatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(report).toContain('token=***');
    expect(report).not.toContain('secret-token');
    expect(report).toContain('sourceId');
    expect(report).toContain('42');
  });

  it('includes newly added cache, alt-svc and stream pool states', () => {
    const cacheState: CacheStateView = {
      entries: [],
      operations: [],
      impactSummaries: [{
        kind: 'miss',
        eventId: 101,
        sourceId: 201,
        requestScoped: true,
        summary: 'cache miss for https://example.com/a?key=abc',
      }],
      eventCount: 3,
      openCount: 1,
      createCount: 1,
      readCount: 0,
      writeCount: 0,
      doomCount: 0,
      bypassCount: 0,
      validationCount: 1,
      errorCount: 0,
      requestScopedCandidateCount: 1,
      evidenceGaps: [],
    };
    const altSvcState: AltSvcStateView = {
      alternatives: [{
        key: 'example.com|h3',
        host: 'example.com',
        protocol: 'h3',
        alternativeService: 'h3=":443"',
        eventCount: 1,
        brokenCount: 1,
        firstEventId: 301,
      }],
      events: [],
      impactSummaries: [],
      eventCount: 1,
      foundCount: 1,
      usedCount: 0,
      brokenCount: 1,
      clearedCount: 0,
      requestScopedCandidateCount: 0,
      evidenceGaps: [],
    };
    const streamPoolState: StreamPoolStateView = {
      jobs: [],
      events: [],
      impactSummaries: [{
        kind: 'stalled',
        eventId: 401,
        sourceId: 501,
        requestScoped: false,
        summary: 'stream pool stalled',
      }],
      sourceLinks: [],
      eventCount: 2,
      waitCount: 1,
      stalledCount: 1,
      reusedSocketCount: 0,
      boundSocketCount: 0,
      connectJobCount: 0,
      errorCount: 0,
      requestScopedCandidateCount: 1,
      evidenceGaps: [],
    };

    const report = buildNetlogExpertEvidencePackage({
      result: baseResult(),
      datasetReady: true,
      cacheState,
      altSvcState,
      streamPoolState,
      generatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(report).toContain('## Cache State');
    expect(report).toContain('101');
    expect(report).toContain('key=***');
    expect(report).toContain('## Alt-Svc State');
    expect(report).toContain('example.com\\|h3');
    expect(report).toContain('## StreamPool State');
    expect(report).toContain('401');
  });
});
