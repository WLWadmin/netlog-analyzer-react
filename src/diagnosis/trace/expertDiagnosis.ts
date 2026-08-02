import type { TraceDiagnosis } from './types';

export type ScriptActivityClassification =
  | 'first-party'
  | 'third-party'
  | 'browser-extension'
  | 'unknown';

export interface DiagnosisFinding {
  id: string;
  domain: TraceDiagnosis['category'];
  phenomenon: string;
  impact: string;
  attributionLevel:
    | 'confirmed'
    | 'highly-correlated'
    | 'possible-contributor'
    | 'observation'
    | 'insufficient';
  evidenceConfidence: 'high' | 'medium' | 'low' | 'insufficient';
  necessaryEvidenceIds: string[];
  supportingEvidenceIds: string[];
  counterEvidenceIds: string[];
  competingCauses: Array<{
    findingId: string;
    relationship: 'alternative' | 'contributor' | 'downstream-effect';
    reason: string;
  }>;
  limitations: string[];
  verificationSteps: string[];
  timeRange?: { startUs: number; endUs: number };
  entityIds: string[];
}

export function classifyScriptActivity(input: {
  pageOrigin?: string;
  scriptUrl?: string;
}): { classification: ScriptActivityClassification } {
  if (!input.scriptUrl) return { classification: 'unknown' };
  let script: URL;
  try {
    script = new URL(input.scriptUrl);
  } catch {
    return { classification: 'unknown' };
  }
  if (script.protocol === 'chrome-extension:' || script.protocol === 'moz-extension:') {
    return { classification: 'browser-extension' };
  }
  if (!input.pageOrigin) return { classification: 'unknown' };
  try {
    const page = new URL(input.pageOrigin);
    return {
      classification: page.origin === script.origin ? 'first-party' : 'third-party',
    };
  } catch {
    return { classification: 'unknown' };
  }
}

export function assessActivityContribution(input: {
  classification: ScriptActivityClassification;
  overlapsSymptom: boolean;
  cpuRatio: number;
  hasStackEvidence: boolean;
}): {
  classification: ScriptActivityClassification;
  level: 'highly-correlated' | 'possible-contributor' | 'observation';
  reason: string;
} {
  if (input.classification === 'unknown') {
    return {
      classification: input.classification,
      level: 'observation',
      reason: '缺少可信来源信息，当前不能判断该活动属于第三方或扩展贡献。',
    };
  }
  if (
    input.overlapsSymptom
    && input.hasStackEvidence
    && input.cpuRatio >= 0.5
  ) {
    return {
      classification: input.classification,
      level: 'highly-correlated',
      reason: '活动与症状时间重叠，且具备主要 CPU 占比和调用栈证据。',
    };
  }
  if (
    input.overlapsSymptom
    && input.hasStackEvidence
    && input.cpuRatio >= 0.2
  ) {
    return {
      classification: input.classification,
      level: 'possible-contributor',
      reason: '活动与症状重叠并具备调用栈证据，但尚未排除其他主要贡献者。',
    };
  }
  return {
    classification: input.classification,
    level: 'observation',
    reason: '仅观察到活动存在，当前证据不足以判断其对症状有影响。',
  };
}

function confidence(
  diagnosis: TraceDiagnosis,
): DiagnosisFinding['evidenceConfidence'] {
  if (diagnosis.evidenceIds.length === 0) return 'insufficient';
  if (diagnosis.confidence === 'confirmed' || diagnosis.confidence === 'high') {
    return diagnosis.counterEvidence.length === 0 ? 'high' : 'medium';
  }
  return diagnosis.confidence === 'medium' ? 'medium' : 'low';
}

function attribution(
  diagnosis: TraceDiagnosis,
): DiagnosisFinding['attributionLevel'] {
  if (diagnosis.evidenceIds.length === 0) return 'insufficient';
  if (diagnosis.confidence === 'observation') return 'observation';
  if (diagnosis.counterEvidence.length > 0 || diagnosis.limitations.length > 0) {
    return 'possible-contributor';
  }
  // Existing Trace rules establish correlation, not an exclusive causal chain.
  return diagnosis.confidence === 'high' || diagnosis.confidence === 'confirmed'
    ? 'highly-correlated'
    : 'possible-contributor';
}

export function buildDiagnosisFindings(
  diagnoses: readonly TraceDiagnosis[],
): DiagnosisFinding[] {
  const counterEvidenceCounts = new Map(diagnoses.map(diagnosis => (
    [`finding:${diagnosis.id}`, diagnosis.counterEvidence.length]
  )));
  const findings: DiagnosisFinding[] = diagnoses.map(diagnosis => ({
    id: `finding:${diagnosis.id}`,
    domain: diagnosis.category,
    phenomenon: diagnosis.title,
    impact: diagnosis.conclusion,
    attributionLevel: attribution(diagnosis),
    evidenceConfidence: confidence(diagnosis),
    necessaryEvidenceIds: diagnosis.evidenceIds.slice(0, 1),
    supportingEvidenceIds: diagnosis.evidenceIds.slice(1),
    // Existing rules provide sanitized counter-evidence text, not evidence IDs.
    // Do not manufacture references that cannot be resolved to raw evidence.
    counterEvidenceIds: [],
    competingCauses: [],
    limitations: [
      ...diagnosis.limitations,
      ...(diagnosis.counterEvidence.length > 0
        ? ['反证目前为规则文本，Trace 未提供可解析的反证证据 ID。']
        : []),
    ],
    verificationSteps: diagnosis.advice.length > 0
      ? [...diagnosis.advice]
      : ['补充同场景对照 Trace，并复核当前范围内的替代解释。'],
    entityIds: [...diagnosis.factIds],
  }));
  for (const finding of findings) {
    finding.competingCauses = findings
      .filter(candidate => candidate.id !== finding.id)
      .slice(0, 3)
      .map(candidate => ({
        findingId: candidate.id,
        relationship: 'alternative' as const,
        reason: '同一录制窗口存在其他候选原因，需要结合必要证据和反证竞争评估。',
      }));
  }
  return findings.sort((left, right) => {
    const evidenceDifference = right.necessaryEvidenceIds.length
      - left.necessaryEvidenceIds.length;
    const leftHasCounterEvidence = counterEvidenceCounts.get(left.id) ?? 0;
    const rightHasCounterEvidence = counterEvidenceCounts.get(right.id) ?? 0;
    const counterDifference = leftHasCounterEvidence - rightHasCounterEvidence;
    const limitationDifference = left.limitations.length - right.limitations.length;
    return evidenceDifference
      || counterDifference
      || limitationDifference
      || left.id.localeCompare(right.id);
  });
}
