import type {
  TraceDiagnosisSeverity,
  TraceEvidenceStrength,
  TraceQualityCoverage,
} from './types';

const SEVERITY_WEIGHT: Record<TraceDiagnosisSeverity, number> = {
  critical: 1,
  warning: 0.7,
  info: 0.3,
};

const EVIDENCE_STRENGTH_WEIGHT: Record<TraceEvidenceStrength, number> = {
  direct: 1,
  derived: 0.75,
  clue: 0.45,
};

const QUALITY_COVERAGE_WEIGHT: Record<TraceQualityCoverage, number> = {
  good: 1,
  partial: 0.7,
  insufficient: 0,
};

export function scoreTraceDiagnosis(input: {
  severity: TraceDiagnosisSeverity;
  evidenceStrength: TraceEvidenceStrength;
  impactRatio: number;
  qualityCoverage: TraceQualityCoverage;
}): number {
  const impactRatio = Math.min(1, Math.max(0, input.impactRatio));
  return SEVERITY_WEIGHT[input.severity]
    * EVIDENCE_STRENGTH_WEIGHT[input.evidenceStrength]
    * impactRatio
    * QUALITY_COVERAGE_WEIGHT[input.qualityCoverage];
}
