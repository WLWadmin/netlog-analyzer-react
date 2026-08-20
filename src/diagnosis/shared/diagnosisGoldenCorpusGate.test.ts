import { parseHar } from '../../harParser';
import { diagnoseHar } from '../../harDiagnosis';
import { parseLog } from '../../parsers/netlog/parser';
import { generateSuggestions } from '../../parsers/netlog/diagnosis';
import {
  buildDiagnosisReleaseGateReport,
  evaluateGoldenCorpusCase,
  type GoldenCorpusCaseResult,
} from './diagnosisReleaseGate';
import { buildFinalDiagnosisSummary } from './finalSummaryBuilder';
import { buildHarDiagnosisSummary } from './fromHar';
import { buildNetlogDiagnosisSummary } from './fromNetlog';
import { getHarRequestIssue } from './harRequestIssue';
import { compareBaselines } from './baselineComparator';
import { buildTimeAlignmentContext } from './timeAlignment';
import type { FinalDiagnosisSummary } from './finalSummaryTypes';
import type { DiagnosisCoverage } from './diagnosisCoverage';
import { buildRealSampleValidationGateReport } from './realSampleValidationGate';

function emptySummary(): FinalDiagnosisSummary {
  return {
    mode: 'combined',
    status: 'limited-conclusion',
    headline: [],
    rootCauseClusters: [],
    actionPlan: [],
    missingInfo: [],
    expertCards: [],
    executiveSummary: '仅用于 release gate 测试。',
  };
}

const coverage: DiagnosisCoverage = {
  totalAbnormalObjects: 0,
  explained: 0,
  partiallyExplained: 0,
  unexplained: 0,
  excluded: 0,
  coverageRate: 1,
  denominatorMayBeIncomplete: false,
  unexplainedRequestIds: [],
  unexplainedSourceIds: [],
  reasons: [],
};

const realSampleValidation = buildRealSampleValidationGateReport({
  RUN_HAR_REAL_SAMPLES: '1',
  HAR_REAL_SAMPLE_DIR: 'configured',
  NETLOG_PARITY_SAMPLE_DIR: 'configured',
  TRACE_SAMPLE_MANIFEST_PATH: 'configured',
  TRACE_PLAIN_SAMPLE_PATH: 'configured',
  TRACE_GZIP_SAMPLE_PATH: 'configured',
  DIAGNOSIS_COMBINED_SAMPLE_MANIFEST_PATH: 'configured',
  DIAGNOSIS_LARGE_FILE_SAMPLE_MANIFEST_PATH: 'configured',
  DIAGNOSIS_ACCEPTANCE_RECORD_PATH: 'configured',
}, {
  har: { executed: true, passed: true },
  netlog: { executed: true, passed: true },
  trace: { executed: true, passed: true },
  combined: { executed: true, passed: true },
  'large-file': { executed: true, passed: true },
  acceptance: { executed: true, passed: true },
});

function rawHarEntry(overrides: Record<string, any> = {}) {
  const response = overrides.response || {};
  return {
    startedDateTime: overrides.startedDateTime || '2026-07-12T00:00:00.000Z',
    time: overrides.time ?? 100,
    request: {
      method: 'GET',
      url: 'https://api.example.test/v1/resource',
      headers: [],
      cookies: [],
      queryString: [],
    },
    response: {
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      httpVersion: 'HTTP/2',
      headers: [],
      cookies: [],
      content: { size: 0, mimeType: 'application/json', text: '' },
      ...response,
    },
    timings: overrides.timings || { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 98, receive: 1 },
    ...overrides,
  };
}

function parseHarSample(overrides: Record<string, any> = {}) {
  return parseHar({
    log: {
      version: '1.2',
      creator: { name: 'Synthetic', version: '1.0' },
      entries: [rawHarEntry(overrides)],
    },
  });
}

function harOutput(overrides: Record<string, any> = {}): string {
  const parsed = parseHarSample(overrides);
  const diagnosis = diagnoseHar(parsed);
  return JSON.stringify({
    aggregate: { failedCount: parsed.failedCount, slowCount: parsed.slowCount },
    issue: getHarRequestIssue(parsed.entries[0]),
    final: buildFinalDiagnosisSummary(buildHarDiagnosisSummary(parsed, diagnosis), 'har'),
  });
}

function netlogOutput(code: number): string {
  const { events, result } = parseLog({
    constants: {},
    events: [
      { time: '0', type: 111, phase: 0, source: { id: 10, type: 1 }, params: { url: 'https://api.example.test/v1/resource', method: 'GET' } },
      { time: '20', type: 1, phase: 2, source: { id: 10, type: 1 }, params: { net_error: code } },
      { time: '30', type: 2, phase: 1, source: { id: 10, type: 1 }, params: {} },
    ],
  });
  const final = buildFinalDiagnosisSummary(buildNetlogDiagnosisSummary(result, generateSuggestions(result), events), 'netlog');
  return JSON.stringify({ failures: result.connectionFailures, final });
}

function quicFallbackOutput(): string {
  const { events, result } = parseLog({
    constants: {},
    events: [
      { time: '0', type: 111, phase: 0, source: { id: 10, type: 1 }, params: { url: 'https://api.example.test/v1/resource', method: 'GET' } },
      { time: '10', type: 252, phase: 2, source: { id: 20, type: 10 }, params: { source_dependency: { id: 10, type: 1 }, error_code: 42 } },
      { time: '20', type: 181, phase: 2, source: { id: 10, type: 1 }, params: { status_code: 200 } },
      { time: '30', type: 2, phase: 1, source: { id: 10, type: 1 }, params: {} },
    ],
  });
  const final = buildFinalDiagnosisSummary(buildNetlogDiagnosisSummary(result, generateSuggestions(result), events), 'netlog');
  return JSON.stringify({ protocols: result.protocols, failures: result.connectionFailures, final });
}

function baselineOutput(): string {
  const baseline = parseHarSample({ time: 100, response: { status: 200, statusText: 'OK' } });
  const current = parseHarSample({
    time: 2500,
    response: { status: 500, statusText: 'Server Error' },
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 2498, receive: 1 },
  });
  return JSON.stringify(compareBaselines(baseline, current));
}

function timeAlignmentOutput(): string {
  const har = parseHarSample();
  const context = buildTimeAlignmentContext(har.entries, [{
    id: 10,
    url: 'https://api.example.test/v1/resource',
    method: 'GET',
    startTime: 1000,
    duration: 100,
    events: [],
    timeline: {},
  }]);
  return JSON.stringify(context);
}

const matrix: GoldenCorpusCaseResult[] = [
  evaluateGoldenCorpusCase({ id: '正常 HAR-REAL-01', output: harOutput(), requiredMatches: ['"failedCount":0', '"kind":"normal"'], forbiddenMatches: ['"kind":"confirmed"'] }),
  evaluateGoldenCorpusCase({ id: 'DNS NXDOMAIN', output: netlogOutput(-105), requiredMatches: ['ERR_NAME_NOT_RESOLVED', 'DNS'], forbiddenMatches: ['80%'] }),
  evaluateGoldenCorpusCase({ id: 'DNS timeout', output: netlogOutput(-137), requiredMatches: ['ERR_NAME_RESOLUTION_FAILED', 'DNS'], forbiddenMatches: ['已确认根因'] }),
  evaluateGoldenCorpusCase({ id: 'TCP timeout/refused', output: netlogOutput(-102), requiredMatches: ['ERR_CONNECTION_REFUSED', 'connect'], forbiddenMatches: ['说明存在 DNS 劫持'] }),
  evaluateGoldenCorpusCase({ id: 'TLS certificate error', output: netlogOutput(-202), requiredMatches: ['ERR_CERT_AUTHORITY_INVALID', 'tls'], forbiddenMatches: ['90%'] }),
  evaluateGoldenCorpusCase({ id: 'Proxy 407/PAC failure', output: harOutput({ response: { status: 407, statusText: 'Proxy Authentication Required' } }), requiredMatches: ['407', 'auth'], forbiddenMatches: ['已确认代理根因'] }),
  evaluateGoldenCorpusCase({ id: 'status=0 无 netError', output: harOutput({ response: { status: 0, statusText: '' }, timings: { blocked: 0, dns: -1, connect: -1, ssl: -1, send: 0, wait: 0, receive: 0 } }), requiredMatches: ['浏览器没有取得 HTTP 响应', 'NetLog'], forbiddenMatches: ['服务端状态码 0'] }),
  evaluateGoldenCorpusCase({ id: 'blockedReason/CORS', output: harOutput({ _blockedReason: 'cors', response: { status: 0, statusText: '' } }), requiredMatches: ['CORS', 'blocked'], forbiddenMatches: ['已确认 CORS 根因'] }),
  evaluateGoldenCorpusCase({ id: '5xx + 高 TTFB', output: harOutput({ time: 2500, response: { status: 500, statusText: 'Server Error' }, timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 2498, receive: 1 } }), requiredMatches: ['HTTP 500', 'server-error'], forbiddenMatches: ['网络根因'] }),
  evaluateGoldenCorpusCase({ id: 'Network change/offline', output: netlogOutput(-106), requiredMatches: ['ERR_INTERNET_DISCONNECTED', '网络已断开'], forbiddenMatches: ['DNS 问题进一步排查'] }),
  evaluateGoldenCorpusCase({ id: 'QUIC fallback success', output: quicFallbackOutput(), requiredMatches: ['QUIC', '"failures":[]'], forbiddenMatches: ['"kind":"confirmed"'] }),
  evaluateGoldenCorpusCase({ id: '正常与异常成对采集', output: baselineOutput(), requiredMatches: ['baseline-status-class-changes', '差异本身不是根因'], forbiddenMatches: ['确定根因'] }),
  evaluateGoldenCorpusCase({ id: '不同时间 HAR+NetLog', output: timeAlignmentOutput(), requiredMatches: ['"enabled":false', '禁用时间窗口对齐'], forbiddenMatches: ['"enabled":true'] }),
];

describe('diagnosisGoldenCorpusGate', () => {
  it('accepts a fully calibrated and sanitized golden corpus matrix', () => {
    expect(matrix.filter(item => !item.passed)).toEqual([]);
    const report = buildDiagnosisReleaseGateReport({
      summaries: [emptySummary()],
      coverageReports: [coverage],
      performance: { harObservationClusterCoverageMs: 50, netlogFirstDiagnosisMs: 200, datasetQueryMs: 20, datasetDetailMs: 20, addedFullFileScans: 0 },
      goldenCorpus: matrix,
      productAcceptance: {
        participants: 5,
        identifyTopIssueRate: 0.8,
        identifyScopeRate: 0.8,
        identifyEvidenceSufficiencyRate: 0.8,
        chooseFirstActionRate: 0.8,
        identifyOwnerRate: 0.8,
      },
      hasBrowserAcceptanceArtifacts: true,
      realSampleValidation,
      copyTextSamples: [],
    });

    expect(report.passed).toBe(true);
    expect(report.metrics.forbiddenConclusionCount).toBe(0);
    expect(report.metrics.sensitiveLeakCount).toBe(0);
  });

  it('blocks forbidden conclusions from the golden corpus matrix', () => {
    const badMatrix = matrix.map(item => item.id === 'Proxy 407/PAC failure'
      ? { ...item, forbiddenMatches: ['仅凭代理配置确认根因'] }
      : item);

    const report = buildDiagnosisReleaseGateReport({
      summaries: [emptySummary()],
      coverageReports: [coverage],
      performance: { harObservationClusterCoverageMs: 50, netlogFirstDiagnosisMs: 200, datasetQueryMs: 20, datasetDetailMs: 20, addedFullFileScans: 0 },
      goldenCorpus: badMatrix,
      productAcceptance: {
        participants: 5,
        identifyTopIssueRate: 0.8,
        identifyScopeRate: 0.8,
        identifyEvidenceSufficiencyRate: 0.8,
        chooseFirstActionRate: 0.8,
        identifyOwnerRate: 0.8,
      },
      hasBrowserAcceptanceArtifacts: true,
      realSampleValidation,
      copyTextSamples: [],
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'Golden Corpus forbidden conclusion 数量不为 0',
      'Golden Corpus 未全部通过：Proxy 407/PAC failure',
    ]));
  });
});
