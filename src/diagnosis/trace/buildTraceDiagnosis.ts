import type { TraceContextFacts } from '../../parsers/trace/types';
import { isTraceExpertAnalysisEnabled } from '../../workbench/featureFlag';
import { sanitizeDiagnosisText } from '../shared/maskedExport';
import { buildDiagnosisFindings } from './expertDiagnosis';
import { TRACE_DIAGNOSIS_RULES } from './traceDiagnosisRules';
import type {
  RuleEvaluation,
  TraceDiagnosis,
  TraceDiagnosisResult,
  TraceDiagnosisRule,
  TraceDiagnosisSeverity,
} from './types';

const SEVERITY_RANK: Record<TraceDiagnosisSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

function sanitizeEvaluation(
  evaluation: RuleEvaluation,
  allowedEvidenceIds: ReadonlySet<string>,
): RuleEvaluation {
  if (evaluation.status !== 'matched') return evaluation;

  const diagnosis = evaluation.diagnosis;
  const evidenceIds = diagnosis.evidenceIds.filter(id => allowedEvidenceIds.has(id));
  if (evidenceIds.length === 0) {
    return {
      ruleId: evaluation.ruleId,
      status: 'disabled',
      reason: 'EVIDENCE_MISSING',
    };
  }

  return {
    ...evaluation,
    diagnosis: {
      ...diagnosis,
      title: sanitizeDiagnosisText(diagnosis.title),
      conclusion: sanitizeDiagnosisText(diagnosis.conclusion),
      evidenceIds,
      counterEvidence: diagnosis.counterEvidence.map(sanitizeDiagnosisText),
      advice: diagnosis.advice.map(sanitizeDiagnosisText),
      limitations: diagnosis.limitations.map(sanitizeDiagnosisText),
    },
  };
}

export function buildTraceDiagnosis(
  context: TraceContextFacts,
  rules: readonly TraceDiagnosisRule[] = TRACE_DIAGNOSIS_RULES,
): TraceDiagnosisResult {
  const allowedEvidenceIds = new Set(context.evidence.map(evidence => evidence.evidenceId));
  const evaluations = rules.flatMap(rule => rule.evaluate(context))
    .map(evaluation => sanitizeEvaluation(evaluation, allowedEvidenceIds));
  const diagnoses = evaluations
    .filter((evaluation): evaluation is Extract<RuleEvaluation, { status: 'matched' }> => (
      evaluation.status === 'matched'
    ))
    .map(evaluation => evaluation.diagnosis)
    .sort((left: TraceDiagnosis, right: TraceDiagnosis) => right.score - left.score
      || SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]
      || left.ruleId.localeCompare(right.ruleId)
      || left.id.localeCompare(right.id));

  const result: TraceDiagnosisResult = {
    diagnoses,
    evaluations,
  };
  if (isTraceExpertAnalysisEnabled()) {
    result.findings = buildDiagnosisFindings(diagnoses);
  }
  return result;
}
