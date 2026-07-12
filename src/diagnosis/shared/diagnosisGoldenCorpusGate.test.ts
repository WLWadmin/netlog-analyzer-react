import { buildDiagnosisReleaseGateReport, type GoldenCorpusCaseResult } from './diagnosisReleaseGate';
import type { FinalDiagnosisSummary } from './finalSummaryTypes';
import type { DiagnosisCoverage } from './diagnosisCoverage';

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

const matrix: GoldenCorpusCaseResult[] = [
  { id: '正常 HAR-REAL-01', requiredMatches: ['少量慢请求请求级观察', '无失败 episode'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'DNS NXDOMAIN', requiredMatches: ['DNS 明确现象', '受影响域名', '补证边界'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'DNS timeout', requiredMatches: ['DNS 超时 episode'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'TCP timeout/refused', requiredMatches: ['Connection 分类'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'TLS certificate error', requiredMatches: ['TLS/证书明确现象'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'Proxy 407/PAC failure', requiredMatches: ['Proxy 认证或 PAC 现象'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'status=0 无 netError', requiredMatches: ['未拿到 HTTP 响应', '需补证'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'blockedReason/CORS', requiredMatches: ['浏览器阻止或 CORS 疑似'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: '5xx + 高 TTFB', requiredMatches: ['服务端 HTTP/TTFB 现象', 'logid 建议'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'Network change/offline', requiredMatches: ['多域时间聚集', '网络切换证据'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: 'QUIC fallback success', requiredMatches: ['协议 fallback 观察'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: '正常与异常成对采集', requiredMatches: ['新增差异和退化'], forbiddenMatches: [], sanitized: true, passed: true },
  { id: '不同时间 HAR+NetLog', requiredMatches: ['对齐率低', '联合诊断降级'], forbiddenMatches: [], sanitized: true, passed: true },
];

describe('diagnosisGoldenCorpusGate', () => {
  it('accepts a fully calibrated and sanitized golden corpus matrix', () => {
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
      copyTextSamples: [],
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'Golden Corpus forbidden conclusion 数量不为 0',
      'Golden Corpus 未全部通过：Proxy 407/PAC failure',
    ]));
  });
});
