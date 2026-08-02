import type { TraceDiagnosis } from './types';
import { isTraceExpertAnalysisEnabled } from '../../workbench/featureFlag';

const SEVERITY_RANK: Record<TraceDiagnosis['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export interface SelectedTraceDiagnoses {
  primary?: TraceDiagnosis;
  secondary: TraceDiagnosis[];
  selected: TraceDiagnosis[];
}

function canBePrimary(diagnosis: TraceDiagnosis): boolean {
  return (!isTraceExpertAnalysisEnabled() || diagnosis.evidenceIds.length > 0)
    && diagnosis.confidence !== 'observation'
    && diagnosis.ruleId !== 'N1'
    && diagnosis.category !== 'security';
}

export function rankTraceDiagnoses(
  diagnoses: readonly TraceDiagnosis[],
): TraceDiagnosis[] {
  if (!isTraceExpertAnalysisEnabled()) {
    return [...diagnoses].sort((left, right) => right.score - left.score
      || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      || left.ruleId.localeCompare(right.ruleId)
      || left.id.localeCompare(right.id));
  }
  const evidenceCoverage = (diagnosis: TraceDiagnosis) => (
    Number(diagnosis.evidenceIds.length > 0) * 1_000
    + Math.min(diagnosis.evidenceIds.length, 3) * 100
    - diagnosis.counterEvidence.length * 80
    - diagnosis.limitations.length * 40
  );
  return [...diagnoses].sort((left, right) => (
    evidenceCoverage(right) - evidenceCoverage(left)
    || right.score - left.score
    || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || left.ruleId.localeCompare(right.ruleId)
    || left.id.localeCompare(right.id)
  ));
}

export function selectTraceDiagnoses(
  diagnoses: readonly TraceDiagnosis[],
  limit = 3,
): SelectedTraceDiagnoses {
  const ranked = rankTraceDiagnoses(diagnoses);
  const primary = ranked.find(canBePrimary);
  const selected = primary
    ? [primary, ...ranked.filter(item => item !== primary)].slice(0, limit)
    : ranked.slice(0, limit);

  return {
    primary,
    secondary: primary ? selected.slice(1) : selected,
    selected,
  };
}
