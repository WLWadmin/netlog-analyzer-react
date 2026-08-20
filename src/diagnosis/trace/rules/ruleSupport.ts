import type { TraceContextFacts, TraceEventFamily } from '../../../parsers/trace/types';
import { scoreTraceDiagnosis } from '../traceScoring';
import type {
  RuleEvaluation,
  TraceDiagnosis,
  TraceDiagnosisCategory,
  TraceDiagnosisConfidence,
  TraceDiagnosisSeverity,
  TraceEvidenceStrength,
  TraceRuleDisabledReason,
  TraceRuleId,
} from '../types';

export function coverage(context: TraceContextFacts) {
  return context.quality.level;
}

export function disabled(ruleId: TraceRuleId, reason: TraceRuleDisabledReason): RuleEvaluation {
  return { ruleId, status: 'disabled', reason };
}

export function missingRequiredEventFamilies(
  context: TraceContextFacts,
  ruleId: TraceRuleId,
  required: readonly TraceEventFamily[],
  mode: 'all' | 'any' = 'all',
): RuleEvaluation | undefined {
  if (!context.eventFamilies) return undefined;
  const available = new Set(context.eventFamilies);
  const supported = mode === 'all'
    ? required.every(family => available.has(family))
    : required.some(family => available.has(family));
  return supported ? undefined : disabled(ruleId, 'CAPABILITY_DISABLED');
}

export function insufficientQuality(
  context: TraceContextFacts,
  ruleId: TraceRuleId,
): RuleEvaluation | undefined {
  return context.quality.level === 'insufficient'
    ? disabled(ruleId, 'QUALITY_INSUFFICIENT')
    : undefined;
}

export function notMatched(ruleId: TraceRuleId, reason: string): RuleEvaluation {
  return { ruleId, status: 'not-matched', reason };
}

export function matched(input: {
  context: TraceContextFacts;
  ruleId: TraceRuleId;
  category: TraceDiagnosisCategory;
  severity: TraceDiagnosisSeverity;
  evidenceStrength: TraceEvidenceStrength;
  impactRatio: number;
  title: string;
  conclusion: string;
  confidence: TraceDiagnosisConfidence;
  evidenceIds: string[];
  counterEvidence: string[];
  factIds: string[];
  advice: string[];
  limitations?: string[];
  navigationKey?: string;
  metric?: TraceDiagnosis['metric'];
}): RuleEvaluation {
  const evidenceIds = [...new Set(input.evidenceIds)];
  const anchor = evidenceIds[0] ?? 'missing-evidence';
  const diagnosis: TraceDiagnosis = {
    id: `trace:${input.ruleId}:${input.navigationKey ?? 'global'}:${anchor}`,
    ruleId: input.ruleId,
    category: input.category,
    severity: input.severity,
    score: scoreTraceDiagnosis({
      severity: input.severity,
      evidenceStrength: input.evidenceStrength,
      impactRatio: input.impactRatio,
      qualityCoverage: coverage(input.context),
    }),
    title: input.title,
    conclusion: input.conclusion,
    confidence: input.confidence,
    evidenceIds,
    counterEvidence: input.counterEvidence,
    advice: input.advice,
    factIds: input.factIds,
    limitations: input.limitations ?? [],
    ...(input.navigationKey ? { navigationKey: input.navigationKey } : {}),
    ...(input.metric ? { metric: input.metric } : {}),
  };
  return { ruleId: input.ruleId, status: 'matched', reason: '规则事实与阈值匹配。', diagnosis };
}
