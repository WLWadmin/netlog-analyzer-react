import type { TraceContextFacts, TraceIntakeSummary } from '../../parsers/trace/types';
import type { DiagnosisFinding } from './expertDiagnosis';

export type TraceDiagnosisSeverity = 'critical' | 'warning' | 'info';
export type TraceEvidenceStrength = 'direct' | 'derived' | 'clue';
export type TraceQualityCoverage = 'good' | 'partial' | 'insufficient';
export type TraceDiagnosisConfidence = 'confirmed' | 'high' | 'medium' | 'observation';

export type TraceRuleId =
  | 'Q1'
  | 'L1'
  | 'L2'
  | 'N1'
  | 'N2'
  | 'N3'
  | 'M1'
  | 'M2'
  | 'R1'
  | 'R2'
  | 'I1'
  | 'C1'
  | 'S1';

export type TraceRuleDisabledReason =
  | 'QUALITY_INSUFFICIENT'
  | 'REQUIRED_FACTS_MISSING'
  | 'CAPABILITY_DISABLED'
  | 'TIMING_DOMAIN_UNCALIBRATED'
  | 'DEPENDENCY_PATH_INCOMPLETE'
  | 'EVIDENCE_MISSING';

export type TraceDiagnosisCategory =
  | 'quality'
  | 'network'
  | 'main-thread'
  | 'interaction'
  | 'rendering'
  | 'loading'
  | 'security';

export interface TraceDiagnosisMetric {
  value: number;
  unit: 'ms' | 'ratio';
  warningThreshold: number;
  criticalThreshold: number;
}

export interface TraceDiagnosis {
  id: string;
  ruleId: TraceRuleId;
  category: TraceDiagnosisCategory;
  severity: TraceDiagnosisSeverity;
  score: number;
  title: string;
  conclusion: string;
  confidence: TraceDiagnosisConfidence;
  evidenceIds: string[];
  counterEvidence: string[];
  advice: string[];
  metric?: TraceDiagnosisMetric;
  navigationKey?: string;
  factIds: string[];
  limitations: string[];
}

export type RuleEvaluation =
  | {
    ruleId: TraceRuleId;
    status: 'matched';
    reason: string;
    diagnosis: TraceDiagnosis;
  }
  | {
    ruleId: TraceRuleId;
    status: 'not-matched';
    reason: string;
  }
  | {
    ruleId: TraceRuleId;
    status: 'disabled';
    reason: TraceRuleDisabledReason;
  };

export interface TraceDiagnosisRule {
  id: TraceRuleId;
  category: TraceDiagnosisCategory;
  requiredFacts: readonly string[];
  forbiddenConclusions: readonly string[];
  evaluate(context: TraceContextFacts): RuleEvaluation[];
}

export interface TraceDiagnosisResult {
  diagnoses: TraceDiagnosis[];
  evaluations: RuleEvaluation[];
  findings?: DiagnosisFinding[];
}

export interface TraceAnalysisResult {
  intake: TraceIntakeSummary;
  context: TraceContextFacts;
  diagnosis: TraceDiagnosisResult;
}
