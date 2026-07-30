import type { FinalDiagnosisSummary } from './finalSummaryTypes';
import type { DiagnosisCoverage } from './diagnosisCoverage';
import { buildDiagnosisEvidenceGuardReport, scanConfirmedTextForForbiddenEvidence } from './diagnosisEvidenceGuardReport';
import { findSensitiveDataLeaks } from './maskedExport';

export interface DiagnosisPerformanceMetrics {
  harObservationClusterCoverageMs?: number;
  netlogFirstDiagnosisMs?: number;
  datasetQueryMs?: number;
  datasetDetailMs?: number;
  addedFullFileScans?: number;
}

export interface ProductAcceptanceMetrics {
  participants: number;
  identifyTopIssueRate: number;
  identifyScopeRate: number;
  identifyEvidenceSufficiencyRate: number;
  chooseFirstActionRate: number;
  identifyOwnerRate: number;
}

export interface GoldenCorpusCaseResult {
  id: string;
  requiredMatches: string[];
  missingRequiredMatches?: string[];
  forbiddenMatches: string[];
  sanitized: boolean;
  passed: boolean;
}

export interface GoldenCorpusCaseEvaluationInput {
  id: string;
  output: string;
  requiredMatches: string[];
  forbiddenMatches?: string[];
}

export interface DiagnosisReleaseGateInput {
  summaries: FinalDiagnosisSummary[];
  coverageReports: DiagnosisCoverage[];
  performance: DiagnosisPerformanceMetrics;
  goldenCorpus: GoldenCorpusCaseResult[];
  productAcceptance?: ProductAcceptanceMetrics;
  copyTextSamples?: string[];
  hasBrowserAcceptanceArtifacts?: boolean;
}

export interface DiagnosisReleaseGateReport {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  metrics: {
    explicitFailureCoverageRate: number;
    mainProblemCoverageRate: number;
    moreEvidenceGapCoverageRate: number;
    topEpisodeEvidenceCoverageRate: number;
    topEpisodeActionCoverageRate: number;
    forbiddenConclusionCount: number;
    sensitiveLeakCount: number;
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function textOfSummary(summary: FinalDiagnosisSummary): string {
  return JSON.stringify({
    headline: summary.headline,
    rootCauseClusters: summary.rootCauseClusters.map(cluster => ({
      title: cluster.title,
      summary: cluster.summary,
      keyEvidence: cluster.keyEvidence,
      actions: cluster.actions,
    })),
    missingInfo: summary.missingInfo,
    executiveSummary: summary.executiveSummary,
  });
}

function countSensitiveLeaks(texts: string[]): number {
  return texts.reduce((count, text) => count + findSensitiveDataLeaks(text).length, 0);
}

export function evaluateGoldenCorpusCase(input: GoldenCorpusCaseEvaluationInput): GoldenCorpusCaseResult {
  const normalizedOutput = input.output.toLowerCase();
  const missingRequired = input.requiredMatches.filter(match => !normalizedOutput.includes(match.toLowerCase()));
  const matchedForbidden = (input.forbiddenMatches || []).filter(match => normalizedOutput.includes(match.toLowerCase()));
  const sanitized = countSensitiveLeaks([input.output]) === 0;

  return {
    id: input.id,
    requiredMatches: input.requiredMatches,
    missingRequiredMatches: missingRequired,
    forbiddenMatches: matchedForbidden,
    sanitized,
    passed: missingRequired.length === 0 && matchedForbidden.length === 0 && sanitized,
  };
}

function hasMissingInfoForCard(summary: FinalDiagnosisSummary, cardId: string): boolean {
  const lower = cardId.toLowerCase();
  return summary.missingInfo.some(item => JSON.stringify(item).toLowerCase().includes(lower)) ||
    summary.headline.some(item => item.relatedCardIds.includes(cardId) && item.missingInfo.length > 0);
}

function hasEvidenceGapMarker(cardText: string): boolean {
  return /evidence-gap|证据缺口|需补证|需要补|不能确认|无法确认|needs more data/i.test(cardText);
}

function isExplicitFailure(cardText: string): boolean {
  return /err_|net_error|status-0|status[:：=]?\s*[45]\d\d|5xx|4xx|失败|超时|refused|timeout|nxdomain|cert|tls|proxy|407/i.test(cardText);
}

function isMainProblem(cardText: string): boolean {
  return isExplicitFailure(cardText) || /慢|slow|ttfb|duration|耗时|等待/i.test(cardText);
}

export function buildDiagnosisReleaseGateReport(input: DiagnosisReleaseGateInput): DiagnosisReleaseGateReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const allCards = input.summaries.flatMap(summary => summary.expertCards);
  const allCardTexts = allCards.map(card => JSON.stringify(card));
  const failureCards = allCards.filter((_, index) => isExplicitFailure(allCardTexts[index]));
  const mainProblemCards = allCards.filter((_, index) => isMainProblem(allCardTexts[index]));
  const explainedCoverage = input.coverageReports.reduce((sum, item) => sum + item.explained + item.partiallyExplained, 0);
  const totalCoverageObjects = input.coverageReports.reduce((sum, item) => sum + item.totalAbnormalObjects, 0);
  const requiresMoreEvidenceCards = allCards.filter((_, index) => hasEvidenceGapMarker(allCardTexts[index]));
  const requiresMoreEvidenceWithGap = input.summaries.reduce((sum, summary) => {
    return sum + summary.expertCards.filter(card => hasEvidenceGapMarker(JSON.stringify(card)) && hasMissingInfoForCard(summary, card.id)).length;
  }, 0);
  const topClusters = input.summaries.flatMap(summary => summary.rootCauseClusters.slice(0, 1));
  const topWithEvidence = topClusters.filter(cluster => cluster.keyEvidence.length > 0).length;
  const topWithActions = topClusters.filter(cluster => cluster.actions.length > 0 || cluster.cards.some(card => card.actions.length > 0)).length;
  const guardReports = input.summaries.map(buildDiagnosisEvidenceGuardReport);
  const forbiddenConclusionCount = guardReports.reduce((sum, report) => sum + report.forbiddenConfirmedMatches.length, 0) +
    input.goldenCorpus.reduce((sum, item) => sum + item.forbiddenMatches.length, 0) +
    (input.copyTextSamples || []).reduce((sum, text) => sum + scanConfirmedTextForForbiddenEvidence(text).length, 0);
  const summaryLeakCount = countSensitiveLeaks(input.summaries.map(textOfSummary));
  const copyLeakCount = countSensitiveLeaks(input.copyTextSamples || []);
  const goldenLeakCount = input.goldenCorpus.filter(item => !item.sanitized).length;
  const sensitiveLeakCount = summaryLeakCount + copyLeakCount + goldenLeakCount;

  const metrics = {
    explicitFailureCoverageRate: ratio(failureCards.filter(card => card.confidence !== 'low' || card.evidence.length > 0).length, failureCards.length),
    mainProblemCoverageRate: totalCoverageObjects > 0 ? ratio(explainedCoverage, totalCoverageObjects) : ratio(mainProblemCards.filter(card => card.confidence !== 'low').length, mainProblemCards.length),
    moreEvidenceGapCoverageRate: ratio(requiresMoreEvidenceWithGap, requiresMoreEvidenceCards.length),
    topEpisodeEvidenceCoverageRate: ratio(topWithEvidence, topClusters.length),
    topEpisodeActionCoverageRate: ratio(topWithActions, topClusters.length),
    forbiddenConclusionCount,
    sensitiveLeakCount,
  };

  if (metrics.explicitFailureCoverageRate < 1) blockers.push('明确失败分类覆盖率未达到 100%');
  if (metrics.mainProblemCoverageRate < 0.95) blockers.push('失败或慢请求主问题覆盖率低于 95%');
  if (metrics.moreEvidenceGapCoverageRate < 1) blockers.push('requiresMoreEvidence 缺口文案覆盖率未达到 100%');
  if (metrics.topEpisodeEvidenceCoverageRate < 1) blockers.push('Top episode 代表证据覆盖率未达到 100%');
  if (metrics.topEpisodeActionCoverageRate < 1) blockers.push('Top episode 行动建议覆盖率未达到 100%');
  if (metrics.forbiddenConclusionCount > 0) blockers.push('Golden Corpus forbidden conclusion 数量不为 0');
  if (metrics.sensitiveLeakCount > 0) blockers.push('摘要或样本存在敏感值泄漏');

  const goldenFailures = input.goldenCorpus.filter(item => item.passed !== true || item.requiredMatches.length === 0 || item.forbiddenMatches.length > 0 || !item.sanitized);
  if (goldenFailures.length > 0) blockers.push(`Golden Corpus 未全部通过：${goldenFailures.map(item => item.id).join(', ')}`);

  if ((input.performance.harObservationClusterCoverageMs ?? 0) > 100) blockers.push('500 条 HAR observation + cluster + coverage 超过 100ms');
  if ((input.performance.addedFullFileScans ?? 0) > 0) blockers.push('大 NetLog 新增了第二次完整文件扫描');
  if ((input.performance.netlogFirstDiagnosisMs ?? 0) > 500) blockers.push('NetLog 首诊断性能低于 benchmark gate');
  if ((input.performance.datasetQueryMs ?? 0) > 100) blockers.push('Dataset query 性能低于 benchmark gate');
  if ((input.performance.datasetDetailMs ?? 0) > 100) blockers.push('Dataset detail 性能低于 benchmark gate');

  if (input.productAcceptance) {
    const product = input.productAcceptance;
    if (product.participants < 5) blockers.push('非网络专业用户验收人数不足 5 人');
    [
      ['10 秒内指出最值得先看的问题', product.identifyTopIssueRate],
      ['说出影响范围', product.identifyScopeRate],
      ['说出证据是否足够', product.identifyEvidenceSufficiencyRate],
      ['选择正确第一步行动', product.chooseFirstActionRate],
      ['知道下一步 owner', product.identifyOwnerRate],
    ].forEach(([label, value]) => {
      if ((value as number) < 0.8) blockers.push(`产品验收未达 80%：${label}`);
    });
  } else {
    warnings.push('尚未提供 5 名非网络专业用户验收结果');
  }

  if (!input.hasBrowserAcceptanceArtifacts) {
    warnings.push('尚未记录桌面/窄屏浏览器验收截图');
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    metrics,
  };
}
