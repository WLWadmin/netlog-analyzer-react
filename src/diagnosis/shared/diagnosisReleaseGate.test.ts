import type { DiagnosticCard } from './types';
import type { FinalDiagnosisSummary } from './finalSummaryTypes';
import type { DiagnosisCoverage } from './diagnosisCoverage';
import { buildDiagnosisReleaseGateReport } from './diagnosisReleaseGate';

function card(overrides: Partial<DiagnosticCard> = {}): DiagnosticCard {
  return {
    id: 'dns-card',
    source: 'combined',
    category: 'dns',
    severity: 'critical',
    confidence: 'high',
    title: 'DNS NXDOMAIN',
    conclusion: 'DNS 明确失败，需要补充 DNS 策略证据后才能定位配置原因。',
    scope: { type: 'single-domain', summary: '1 domain', affectedRequestCount: 2, affectedDomainCount: 1 },
    evidence: [{ label: 'netError', value: 'ERR_NAME_NOT_RESOLVED', source: 'netlog', requestIds: [1] }],
    actions: [{ role: 'user', title: '切换网络验证 DNS', detail: '换网络后重新访问。' }],
    relatedRequestIds: [1],
    limitations: ['evidence-gap: 需要 DNS 策略和公共 DNS 对照。'],
    ...overrides,
  };
}

function summary(overrides: Partial<FinalDiagnosisSummary> = {}): FinalDiagnosisSummary {
  const expertCard = card();
  return {
    mode: 'combined',
    status: 'has-conclusion',
    headline: [{
      id: 'headline-dns',
      kind: 'highly-likely',
      source: 'combined',
      category: 'dns',
      title: 'DNS NXDOMAIN',
      problem: 'api.example.test DNS 解析失败',
      reason: 'NetLog 记录 ERR_NAME_NOT_RESOLVED',
      impact: '影响单域名 2 个请求',
      confidence: 'high',
      confidenceText: '高',
      primaryAction: { id: 'a1', title: '切换网络验证 DNS', detail: '换网络后重新访问。', priority: 1, effort: 'low', risk: 'safe' },
      keyEvidence: [{ label: 'netError', value: 'ERR_NAME_NOT_RESOLVED', source: 'netlog', requestIds: [1] }],
      missingInfo: [{
        id: 'missing-dns',
        title: '补充 DNS 策略',
        reason: '当前只能确认 DNS 失败现象，不能确认本机 DNS 配置错误。',
        recommendation: '补充公共 DNS 和企业 DNS 对照。',
      }],
      relatedCardIds: ['dns-card'],
      score: 100,
      displayRank: 1,
      userFacingSummary: 'DNS 失败现象明确，但需要补充 DNS 策略证据。',
    }],
    rootCauseClusters: [{
      id: 'episode-dns-1',
      category: 'dns',
      title: 'DNS episode',
      kind: 'highly-likely',
      summary: '单域名 DNS 失败 episode。',
      cards: [expertCard],
      keyEvidence: [{ label: 'netError', value: 'ERR_NAME_NOT_RESOLVED', source: 'netlog', requestIds: [1] }],
      actions: [{ id: 'a1', title: '切换网络验证 DNS', detail: '换网络后重新访问。', priority: 1, effort: 'low', risk: 'safe' }],
      affectedRequestCount: 2,
      affectedDomainCount: 1,
      confidence: 'high',
      score: 100,
    }],
    actionPlan: [{
      role: 'user',
      title: '用户验证',
      priority: 1,
      actions: [{ id: 'a1', title: '切换网络验证 DNS', detail: '换网络后重新访问。', priority: 1, effort: 'low', risk: 'safe' }],
    }],
    missingInfo: [{
      id: 'missing-dns',
      title: '补充 DNS 策略',
      reason: 'dns-card 当前只能确认 DNS 失败现象，不能确认本机 DNS 配置错误。',
      recommendation: '补充公共 DNS 和企业 DNS 对照。',
    }],
    expertCards: [expertCard],
    executiveSummary: 'DNS 失败现象明确，证据仍需补齐。',
    ...overrides,
  };
}

function coverage(overrides: Partial<DiagnosisCoverage> = {}): DiagnosisCoverage {
  return {
    totalAbnormalObjects: 1,
    explained: 1,
    partiallyExplained: 0,
    unexplained: 0,
    excluded: 0,
    coverageRate: 1,
    denominatorMayBeIncomplete: false,
    unexplainedRequestIds: [],
    unexplainedSourceIds: [],
    reasons: [],
    ...overrides,
  };
}

const passingInput = {
  summaries: [summary()],
  coverageReports: [coverage()],
  performance: {
    harObservationClusterCoverageMs: 80,
    netlogFirstDiagnosisMs: 200,
    datasetQueryMs: 20,
    datasetDetailMs: 20,
    addedFullFileScans: 0,
  },
  goldenCorpus: [
    { id: 'DNS NXDOMAIN', requiredMatches: ['DNS 明确现象'], forbiddenMatches: [], sanitized: true, passed: true },
    { id: '5xx + 高 TTFB', requiredMatches: ['服务端 HTTP/TTFB 现象'], forbiddenMatches: [], sanitized: true, passed: true },
  ],
  productAcceptance: {
    participants: 5,
    identifyTopIssueRate: 0.8,
    identifyScopeRate: 0.8,
    identifyEvidenceSufficiencyRate: 0.8,
    chooseFirstActionRate: 0.8,
    identifyOwnerRate: 0.8,
  },
  copyTextSamples: ['DNS 失败现象明确，不能确认本机 DNS 配置错误。'],
  hasBrowserAcceptanceArtifacts: true,
  hasRealSampleValidationArtifacts: true,
};

describe('diagnosisReleaseGate', () => {
  it('passes when Batch 9 automatic, product and privacy gates are satisfied', () => {
    const report = buildDiagnosisReleaseGateReport(passingInput);

    expect(report.passed).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.metrics).toMatchObject({
      explicitFailureCoverageRate: 1,
      mainProblemCoverageRate: 1,
      moreEvidenceGapCoverageRate: 1,
      topEpisodeEvidenceCoverageRate: 1,
      topEpisodeActionCoverageRate: 1,
      forbiddenConclusionCount: 0,
      sensitiveLeakCount: 0,
    });
  });

  it('blocks forbidden confirmed conclusions and sensitive copy text', () => {
    const badSummary = summary({
      headline: [{
        ...summary().headline[0],
        kind: 'confirmed',
        reason: 'proxy config 已确认是根因',
        userFacingSummary: '已确认 proxy config 是根因。',
      }],
    });

    const report = buildDiagnosisReleaseGateReport({
      ...passingInput,
      summaries: [badSummary],
      copyTextSamples: ['Authorization: Bearer SECRET_TOKEN_123456'],
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'Golden Corpus forbidden conclusion 数量不为 0',
      '摘要或样本存在敏感值泄漏',
    ]));
  });

  it('blocks missing more-evidence copy and top episode action gaps', () => {
    const noGapSummary = summary({
      missingInfo: [],
      headline: [{ ...summary().headline[0], missingInfo: [] }],
      rootCauseClusters: [{ ...summary().rootCauseClusters[0], actions: [], cards: [{ ...card(), actions: [] }] }],
      expertCards: [{ ...card(), actions: [] }],
    });

    const report = buildDiagnosisReleaseGateReport({
      ...passingInput,
      summaries: [noGapSummary],
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'requiresMoreEvidence 缺口文案覆盖率未达到 100%',
      'Top episode 行动建议覆盖率未达到 100%',
    ]));
  });

  it('blocks performance and product acceptance regressions', () => {
    const report = buildDiagnosisReleaseGateReport({
      ...passingInput,
      performance: {
        harObservationClusterCoverageMs: 120,
        netlogFirstDiagnosisMs: 700,
        datasetQueryMs: 120,
        datasetDetailMs: 140,
        addedFullFileScans: 1,
      },
      productAcceptance: {
        participants: 4,
        identifyTopIssueRate: 0.7,
        identifyScopeRate: 0.8,
        identifyEvidenceSufficiencyRate: 0.8,
        chooseFirstActionRate: 0.8,
        identifyOwnerRate: 0.8,
      },
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      '500 条 HAR observation + cluster + coverage 超过 100ms',
      '大 NetLog 新增了第二次完整文件扫描',
      'NetLog 首诊断性能低于 benchmark gate',
      'Dataset query 性能低于 benchmark gate',
      'Dataset detail 性能低于 benchmark gate',
      '非网络专业用户验收人数不足 5 人',
      '产品验收未达 80%：10 秒内指出最值得先看的问题',
    ]));
  });

  it('blocks when product, browser, or real-sample acceptance artifacts are missing', () => {
    const report = buildDiagnosisReleaseGateReport({
      ...passingInput,
      productAcceptance: undefined,
      hasBrowserAcceptanceArtifacts: false,
      hasRealSampleValidationArtifacts: false,
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      '尚未提供 5 名非网络专业用户验收结果',
      '尚未记录桌面/窄屏浏览器验收截图',
      '尚未提供真实故障样本验证记录',
    ]));
  });

  it('blocks a corpus row whose execution result is missing', () => {
    const corpusWithoutResult = passingInput.goldenCorpus.map(item => ({ ...item })) as Array<Record<string, unknown>>;
    delete corpusWithoutResult[0].passed;
    const report = buildDiagnosisReleaseGateReport({
      ...passingInput,
      goldenCorpus: corpusWithoutResult as any,
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('Golden Corpus 未全部通过：DNS NXDOMAIN');
  });
});
