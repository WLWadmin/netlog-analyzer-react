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
  impactLabel: string;
  impactSummary: string;
  timeWindowLabel: string;
  evidenceStrengthLabel: string;
  evidenceSummaries: string[];
  causeLabel: string;
  causeSummary: string;
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

const IMPACT_LABEL: Record<TraceDiagnosis['severity'], string> = {
  critical: '高影响',
  warning: '中等影响',
  info: '低影响',
};

const IMPACT_SUMMARY: Record<TraceDiagnosisCategory, string> = {
  quality: '采集信息不足会降低后续判断的可靠性。',
  loading: '可能延长页面完成加载或进入可用状态的时间。',
  network: '可能造成资源加载失败、等待变长或页面内容不完整。',
  security: '可能影响相关请求的可用性，需要结合网络证据复核。',
  'main-thread': '可能造成页面卡顿或用户交互响应变慢。',
  rendering: '可能造成画面更新不流畅或视觉稳定性下降。',
  interaction: '可能造成点击、输入等操作反馈延迟。',
};

const CONTRIBUTOR_CONTEXT: Record<TraceDiagnosisCategory, string> = {
  quality: '当前首要限制是录制范围或上下文不完整；补齐采集后才能继续判断性能贡献因素。',
  loading: '这个里程碑偏晚是结果信号，还需要对齐同期请求、主线程和渲染事实才能定位贡献来源。',
  network: '这是请求层的异常或等待线索；Trace 本身不能继续确定 DNS、连接、TLS、代理或服务端根因。',
  security: '当前只能确认应用层响应或访问策略现象，不能据此确定具体安全策略或性能根因。',
  'main-thread': '这类主线程占用可能推迟页面更新和交互响应，是当前录制中应优先处理的贡献因素。',
  rendering: '这类渲染工作或布局线索可能使画面更新超出参考预算，但不能自动归因到具体线程或 DOM 操作。',
  interaction: '应优先检查延迟占比最大的阶段及其同期任务和渲染事件；单份 Trace 不代表线上用户分布。',
};

const EVIDENCE_STRENGTH: Record<TraceDiagnosisConfidence, string> = {
  confirmed: '直接证据',
  high: '较强证据',
  medium: '支持证据',
  observation: '现象线索',
};

function formatTime(timestampUs: number): string {
  return `${(timestampUs / 1_000_000).toFixed(2)} 秒`;
}

export function traceFactDomId(id: string): string {
  return `trace-fact-${encodeURIComponent(id)}`;
}

export function traceEvidenceDomId(id: string): string {
  return `trace-evidence-${encodeURIComponent(id)}`;
}

function toCard(
  diagnosis: TraceDiagnosis,
  evidenceById: Map<string, TraceAnalysisResult['context']['evidence'][number]>,
  usedEvidence: Set<string>,
  evidenceLimit: number,
  adviceLimit: number,
  captureStartUs: number | undefined,
): TraceDiagnosisCardViewModel {
  const factId = diagnosis.factIds[0] ?? (diagnosis.category === 'quality' ? 'quality' : undefined);
  const availableEvidenceIds = diagnosis.evidenceIds.filter(id => (
    evidenceById.has(id)
  ));
  const evidenceIds = availableEvidenceIds
    .filter(id => !usedEvidence.has(id))
    .slice(0, evidenceLimit);
  evidenceIds.forEach(id => usedEvidence.add(id));
  const availableEvidence = availableEvidenceIds.flatMap(id => {
    const item = evidenceById.get(id);
    return item ? [item] : [];
  });
  const displayedEvidence = evidenceIds.flatMap(id => {
    const item = evidenceById.get(id);
    return item ? [item] : [];
  });
  const timestamps = availableEvidence.flatMap(item => (
    item.timestampUs === undefined || captureStartUs === undefined
      ? []
      : [Math.max(0, item.timestampUs - captureStartUs)]
  ));
  const firstTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const lastTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  const timeWindowLabel = firstTimestamp === undefined || lastTimestamp === undefined
    ? '时间窗口不可用'
    : firstTimestamp === lastTimestamp
      ? `${formatTime(firstTimestamp)}附近`
      : `${formatTime(firstTimestamp)}–${formatTime(lastTimestamp)}`;
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
    impactLabel: IMPACT_LABEL[diagnosis.severity],
    impactSummary: IMPACT_SUMMARY[diagnosis.category],
    timeWindowLabel,
    evidenceStrengthLabel: EVIDENCE_STRENGTH[diagnosis.confidence],
    evidenceSummaries: displayedEvidence.map(item => {
      const time = item.timestampUs === undefined || captureStartUs === undefined
        ? '时间不可用'
        : formatTime(Math.max(0, item.timestampUs - captureStartUs));
      return `${item.name ?? 'Trace 事件'} · ${time}`;
    }),
    causeLabel: diagnosis.confidence === 'observation'
      || diagnosis.category === 'quality'
      || diagnosis.category === 'security'
      ? '判断边界'
      : '可能贡献因素',
    causeSummary: diagnosis.confidence === 'observation'
      ? `目前只能确认“${diagnosis.title}”这一现象。${CONTRIBUTOR_CONTEXT[diagnosis.category]}`
      : `${diagnosis.conclusion} ${CONTRIBUTOR_CONTEXT[diagnosis.category]}`,
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
  const evidenceById = new Map(
    result.context.evidence.map(item => [item.evidenceId, item]),
  );
  const { primary: primaryDiagnosis, selected } = selectTraceDiagnoses(
    result.diagnosis.diagnoses,
  );
  let remainingEvidence = 3;
  let remainingAdvice = 3;
  const usedEvidence = new Set<string>();
  const cards = selected.map(diagnosis => {
    const card = toCard(
      diagnosis,
      evidenceById,
      usedEvidence,
      remainingEvidence,
      remainingAdvice,
      result.intake.captureStartUs,
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
      ? {
          observationOnlyMessage:
            '目前只能确认现象，缺少足够的直接证据或可校准时间关系，暂不能判断确定原因。',
        }
      : {}),
  };
}
