import {
  selectTraceDiagnoses,
  type TraceAnalysisResult,
  type TraceDiagnosis,
  type TraceDiagnosisCategory,
  type TraceDiagnosisConfidence,
} from '../../diagnosis/trace';
import type { TraceTab } from '../../utils/hashRouting';

export interface TraceFactTarget {
  tab: Exclude<TraceTab, 'conclusion' | 'evidence'>;
  factId: string;
}

export interface TraceEvidenceTarget {
  tab: 'evidence';
  evidenceId: string;
}

export interface TraceDiagnosisCardViewModel {
  id: string;
  ruleId: TraceDiagnosis['ruleId'];
  severity: TraceDiagnosis['severity'];
  severityLabel: string;
  title: string;
  confidence: TraceDiagnosis['confidence'];
  confidenceLabel: string;
  conclusion: string;
  summary: string;
  counterEvidence: string[];
  limitations: string[];
  evidenceIds: string[];
  advice: string[];
  factTarget?: TraceFactTarget;
  evidenceTarget?: TraceEvidenceTarget;
}

export interface TraceDiagnosisViewModel {
  primary?: TraceDiagnosisCardViewModel;
  secondary: TraceDiagnosisCardViewModel[];
  cards: TraceDiagnosisCardViewModel[];
  observationOnlyMessage?: string;
}

const FACT_TAB_BY_CATEGORY: Record<TraceDiagnosisCategory, TraceFactTarget['tab']> = {
  quality: 'overview', loading: 'overview', network: 'network', security: 'network',
  'main-thread': 'main-thread', rendering: 'rendering', interaction: 'interactions',
};

const CONFIDENCE_LABEL: Record<TraceDiagnosisConfidence, string> = {
  confirmed: '已确认', high: '高', medium: '中', observation: '观察',
};

const SEVERITY_LABEL: Record<TraceDiagnosis['severity'], string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
};

export function traceFactDomId(id: string): string {
  return `trace-fact-${encodeURIComponent(id)}`;
}

export function traceEvidenceDomId(id: string): string {
  return `trace-evidence-${encodeURIComponent(id)}`;
}

function toCard(
  diagnosis: TraceDiagnosis,
  availableEvidence: Set<string>,
  usedEvidence: Set<string>,
  evidenceLimit: number,
  adviceLimit: number,
): TraceDiagnosisCardViewModel {
  const factId = diagnosis.factIds[0] ?? (diagnosis.category === 'quality' ? 'quality' : undefined);
  const availableEvidenceIds = diagnosis.evidenceIds.filter(id => availableEvidence.has(id));
  const evidenceIds = availableEvidenceIds
    .filter(id => !usedEvidence.has(id))
    .slice(0, evidenceLimit);
  evidenceIds.forEach(id => usedEvidence.add(id));
  return {
    id: diagnosis.id,
    ruleId: diagnosis.ruleId,
    severity: diagnosis.severity,
    severityLabel: SEVERITY_LABEL[diagnosis.severity],
    title: diagnosis.title,
    confidence: diagnosis.confidence,
    confidenceLabel: CONFIDENCE_LABEL[diagnosis.confidence],
    conclusion: diagnosis.conclusion,
    summary: diagnosis.confidence === 'observation' ? `观察：${diagnosis.conclusion}` : diagnosis.conclusion,
    counterEvidence: diagnosis.counterEvidence.slice(0, 3),
    limitations: diagnosis.limitations.slice(0, 3),
    evidenceIds,
    advice: diagnosis.advice.slice(0, adviceLimit),
    ...(factId ? { factTarget: { tab: FACT_TAB_BY_CATEGORY[diagnosis.category], factId } } : {}),
    ...(availableEvidenceIds[0]
      ? { evidenceTarget: { tab: 'evidence' as const, evidenceId: availableEvidenceIds[0] } }
      : {}),
  };
}

export function buildTraceDiagnosisViewModel(result: TraceAnalysisResult): TraceDiagnosisViewModel {
  const availableEvidence = new Set(result.context.evidence.map(item => item.evidenceId));
  const { primary: primaryDiagnosis, selected } = selectTraceDiagnoses(
    result.diagnosis.diagnoses,
  );
  let remainingEvidence = 3;
  let remainingAdvice = 3;
  const usedEvidence = new Set<string>();
  const cards = selected.map(diagnosis => {
    const card = toCard(
      diagnosis,
      availableEvidence,
      usedEvidence,
      remainingEvidence,
      remainingAdvice,
    );
    remainingEvidence -= card.evidenceIds.length;
    remainingAdvice -= card.advice.length;
    return card;
  });
  const primary = primaryDiagnosis ? cards[0] : undefined;
  const secondary = primary ? cards.slice(1) : cards;
  return {
    primary,
    secondary,
    cards,
    ...(!primary && cards.length > 0
      ? { observationOnlyMessage: '证据不足，当前只能看到以下现象' }
      : {}),
  };
}
