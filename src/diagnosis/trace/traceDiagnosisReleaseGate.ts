import { findSensitiveDataLeaks } from '../shared/maskedExport';
import { TRACE_DIAGNOSIS_RULES } from './traceDiagnosisRules';
import {
  TRACE_GOLDEN_CORPUS_IDS,
  type TraceGoldenCorpusCase,
  type TraceGoldenRuleExpectation,
} from './traceGoldenCorpus';
import type {
  RuleEvaluation,
  TraceDiagnosis,
  TraceDiagnosisConfidence,
  TraceDiagnosisResult,
} from './types';

export interface TraceDiagnosisReleaseGateReport {
  passed: boolean;
  blockers: string[];
  metrics: {
    corpusPassed: boolean;
    forbiddenConclusionCount: number;
    missingEvidenceReferenceCount: number;
    unstableDiagnosisCount: number;
    sensitiveLeakCount: number;
    disabledRuleCoverage: number;
    deterministicOrderPassed: boolean;
  };
}

const CONFIDENCE_RANK: Record<TraceDiagnosisConfidence, number> = {
  observation: 0,
  medium: 1,
  high: 2,
  confirmed: 3,
};

const RULE_CATEGORY = new Map(TRACE_DIAGNOSIS_RULES.map(rule => [rule.id, rule.category]));
const FORBIDDEN_CONCLUSIONS = TRACE_DIAGNOSIS_RULES.flatMap(rule => rule.forbiddenConclusions);

function valueAtPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (key === 'length' && (Array.isArray(value) || typeof value === 'string')) return value.length;
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);
}

function confidenceMatches(
  confidence: TraceDiagnosisConfidence,
  expectation: TraceGoldenRuleExpectation,
): boolean {
  const rank = CONFIDENCE_RANK[confidence];
  return rank >= CONFIDENCE_RANK[expectation.confidence.min]
    && rank <= CONFIDENCE_RANK[expectation.confidence.max];
}

function matchedEvaluations(
  result: TraceDiagnosisResult,
  expectation: TraceGoldenRuleExpectation,
): RuleEvaluation[] {
  return result.evaluations.filter(evaluation => (
    evaluation.ruleId === expectation.ruleId && evaluation.status === expectation.status
  ));
}

function diagnosisMatches(
  diagnosis: TraceDiagnosis,
  expectation: TraceGoldenRuleExpectation,
): boolean {
  const evidenceMatches = expectation.evidence === 'ignored'
    || (expectation.evidence === 'required' && diagnosis.evidenceIds.length > 0)
    || (expectation.evidence === 'forbidden' && diagnosis.evidenceIds.length === 0);
  return diagnosis.category === expectation.category
    && confidenceMatches(diagnosis.confidence, expectation)
    && evidenceMatches
    && expectation.limitations.every(required => (
      diagnosis.limitations.some(actual => actual.includes(required))
    ));
}

function ruleExpectationMatches(
  result: TraceDiagnosisResult,
  expectation: TraceGoldenRuleExpectation,
): boolean {
  if (RULE_CATEGORY.get(expectation.ruleId) !== expectation.category) return false;
  const evaluations = matchedEvaluations(result, expectation);
  if (evaluations.length !== expectation.count) return false;
  if (expectation.status === 'disabled') {
    return expectation.disabledReason !== 'not-applicable'
      && evaluations.every(evaluation => (
        evaluation.status === 'disabled' && evaluation.reason === expectation.disabledReason
      ));
  }
  if (expectation.disabledReason !== 'not-applicable') return false;
  if (expectation.status === 'not-matched') return true;
  return evaluations.every(evaluation => (
    evaluation.status === 'matched' && diagnosisMatches(evaluation.diagnosis, expectation)
  ));
}

function caseStructurePassed(item: TraceGoldenCorpusCase): boolean {
  return item.expectation.factAssertions.every(assertion => (
    Object.is(valueAtPath(item.context, assertion.path), assertion.expected)
  )) && item.runs.every(result => item.expectation.requiredRules.every(expectation => (
    ruleExpectationMatches(result, expectation)
  )));
}

function hasFixedCorpusShape(corpus: readonly TraceGoldenCorpusCase[]): boolean {
  return corpus.length === TRACE_GOLDEN_CORPUS_IDS.length
    && corpus.every((item, index) => item.id === TRACE_GOLDEN_CORPUS_IDS[index])
    && new Set(corpus.map(item => item.id)).size === TRACE_GOLDEN_CORPUS_IDS.length;
}

function orderSignature(result: TraceDiagnosisResult): string {
  return JSON.stringify(result.diagnoses.map(diagnosis => diagnosis.id));
}

function unstableDiagnosisCount(corpus: readonly TraceGoldenCorpusCase[]): number {
  return corpus.reduce((total, item) => {
    const diagnosisIds = new Set(item.runs.flatMap(result => (
      result.diagnoses.map(diagnosis => diagnosis.id)
    )));
    return total + [...diagnosisIds].filter(id => {
      const signatures = item.runs.map(result => JSON.stringify(
        result.diagnoses.find(diagnosis => diagnosis.id === id),
      ));
      return signatures.slice(1).some(signature => signature !== signatures[0]);
    }).length;
  }, 0);
}

function forbiddenConclusionCount(corpus: readonly TraceGoldenCorpusCase[]): number {
  return corpus.reduce((total, item) => total + item.runs.reduce((runTotal, result) => {
    const forbiddenRuleMatches = result.diagnoses.filter(diagnosis => (
      item.expectation.forbiddenRules.includes(diagnosis.ruleId)
    )).length;
    const fullText = JSON.stringify(result.diagnoses);
    const forbiddenTextMatches = FORBIDDEN_CONCLUSIONS.filter(conclusion => (
      fullText.includes(conclusion)
    )).length;
    return runTotal + forbiddenRuleMatches + forbiddenTextMatches;
  }, 0), 0);
}

function missingEvidenceReferenceCount(corpus: readonly TraceGoldenCorpusCase[]): number {
  return corpus.reduce((total, item) => {
    const available = new Set(item.context.evidence.map(evidence => evidence.evidenceId));
    return total + item.runs.reduce((runTotal, result) => runTotal
      + result.diagnoses.reduce((diagnosisTotal, diagnosis) => diagnosisTotal
        + (diagnosis.evidenceIds.length === 0 ? 1 : 0)
        + diagnosis.evidenceIds.filter(id => !available.has(id)).length, 0), 0);
  }, 0);
}

function disabledRuleCoverage(corpus: readonly TraceGoldenCorpusCase[]): number {
  let expected = 0;
  let covered = 0;
  for (const item of corpus) {
    for (const rule of item.expectation.requiredRules.filter(value => value.status === 'disabled')) {
      for (const result of item.runs) {
        expected += 1;
        if (ruleExpectationMatches(result, rule)) covered += 1;
      }
    }
  }
  return expected === 0 ? 1 : covered / expected;
}

function sensitiveLeakCount(corpus: readonly TraceGoldenCorpusCase[]): number {
  return corpus.reduce((total, item) => total
    + item.runs.reduce((runTotal, result) => runTotal
      + findSensitiveDataLeaks(JSON.stringify(result.diagnoses)).length, 0), 0);
}

export function buildTraceDiagnosisReleaseGateReport(
  corpus: readonly TraceGoldenCorpusCase[],
): TraceDiagnosisReleaseGateReport {
  const corpusPassed = hasFixedCorpusShape(corpus) && corpus.every(caseStructurePassed);
  const forbiddenCount = forbiddenConclusionCount(corpus);
  const missingEvidenceCount = missingEvidenceReferenceCount(corpus);
  const unstableCount = unstableDiagnosisCount(corpus);
  const leakCount = sensitiveLeakCount(corpus);
  const disabledCoverage = disabledRuleCoverage(corpus);
  const deterministicOrderPassed = corpus.every(item => (
    item.runs.slice(1).every(result => orderSignature(result) === orderSignature(item.runs[0]))
  ));
  const metrics = {
    corpusPassed,
    forbiddenConclusionCount: forbiddenCount,
    missingEvidenceReferenceCount: missingEvidenceCount,
    unstableDiagnosisCount: unstableCount,
    sensitiveLeakCount: leakCount,
    disabledRuleCoverage: disabledCoverage,
    deterministicOrderPassed,
  };
  const blockers: string[] = [];
  if (!metrics.corpusPassed) blockers.push('Trace Golden Corpus 结构化 expectation 未全部通过');
  if (metrics.forbiddenConclusionCount > 0) blockers.push('Trace 诊断出现 forbidden rule 或 conclusion');
  if (metrics.missingEvidenceReferenceCount > 0) blockers.push('Trace 诊断包含缺失 evidence 引用');
  if (metrics.unstableDiagnosisCount > 0) blockers.push('Trace 诊断三次运行输出不稳定');
  if (metrics.sensitiveLeakCount > 0) blockers.push('Trace 完整诊断文本存在敏感泄漏');
  if (metrics.disabledRuleCoverage < 1) blockers.push('Trace disabled 规则覆盖率未达到 100%');
  if (!metrics.deterministicOrderPassed) blockers.push('Trace 诊断排序不确定');
  return { passed: blockers.length === 0, blockers, metrics };
}
