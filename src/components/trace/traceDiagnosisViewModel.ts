import {
  buildDiagnosisFindings,
  selectTraceDiagnoses,
  type DiagnosisFinding,
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
  attributionStatus: 'confirmed' | 'needs-validation' | 'unresolved';
  attributionLabel: string;
  attributionSummary: string;
  conclusion: string;
  summary: string;
  impactLabel: string;
  impactSummary: string;
  timeWindowLabel: string;
  evidenceStrengthLabel: string;
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
  confirmed: '事实已确认',
  high: '事实证据较强',
  medium: '事实证据有限',
  observation: '仅确认现象',
};

interface AttributionPresentation {
  status: TraceDiagnosisCardViewModel['attributionStatus'];
  label: string;
  summary: string;
}

const ATTRIBUTION: Record<DiagnosisFinding['attributionLevel'], AttributionPresentation> = {
  confirmed: {
    status: 'confirmed',
    label: '已确认原因',
    summary: '已经形成可定位的因果证据，可以直接查看并处理该原因。',
  },
  'highly-correlated': {
    status: 'needs-validation',
    label: '高度相关，仍待确认',
    summary: '现有证据与问题高度相关，但尚未形成唯一、完整的因果链。',
  },
  'possible-contributor': {
    status: 'needs-validation',
    label: '原因尚未定位',
    summary: '已经确认发生了这个性能现象，但还没有找到它背后的具体原因。',
  },
  observation: {
    status: 'unresolved',
    label: '无法确认原因',
    summary: '当前文件只能确认存在相关现象，不能判断它是否造成了用户问题。',
  },
  insufficient: {
    status: 'unresolved',
    label: '证据不足，无法归因',
    summary: '当前文件缺少完成归因所需的必要证据。',
  },
};

const ATTRIBUTION_GAP_BY_RULE: Partial<Record<TraceDiagnosis['ruleId'], string>> = {
  M1: '已经确认发生长任务，但当前证据没有定位到造成它的具体脚本、函数或执行来源。',
  M2: '已经发现脚本或垃圾回收活动线索，但还需要源码位置和同期任务证据才能确认原因。',
};

const MISSING_CONFIRMED_CAUSE: AttributionPresentation = {
  status: 'unresolved',
  label: '原因信息缺失',
  summary: '归因记录没有提供可展示的具体原因，因此不能标记为已确认原因。',
};

function attributionPresentation(finding: DiagnosisFinding): AttributionPresentation {
  const cause = finding.cause?.trim();
  if (finding.attributionLevel === 'confirmed' && !cause) {
    return MISSING_CONFIRMED_CAUSE;
  }
  const presentation = ATTRIBUTION[finding.attributionLevel];
  return finding.attributionLevel === 'confirmed'
    ? { ...presentation, summary: `已确认原因：${cause}` }
    : presentation;
}

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
  finding: DiagnosisFinding,
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
  const attribution = attributionPresentation(finding);
  const explicitCause = finding.cause?.trim();
  const limitation = diagnosis.limitations[0];
  const causeSummary = attribution.status === 'confirmed'
    ? explicitCause ?? MISSING_CONFIRMED_CAUSE.summary
    : attribution.status === 'needs-validation'
      ? ATTRIBUTION_GAP_BY_RULE[diagnosis.ruleId]
        ?? `${diagnosis.conclusion} ${limitation
          ? `当前限制是：${limitation}`
          : '现有线索还需要补充或交叉验证，不能直接认定为具体原因。'}`
      : `${diagnosis.conclusion} ${limitation
        ? `无法确认是因为：${limitation}`
        : CONTRIBUTOR_CONTEXT[diagnosis.category]}`;
  const fallbackAdvice = attribution.status === 'confirmed'
    ? '查看相关记录，按结论处理后重新录制验证。'
    : attribution.status === 'needs-validation'
      ? '查看相关记录并补充判断依据，确认后再处理。'
      : '查看无法确认的原因，按缺失信息补充录制内容。';
  const advice = (diagnosis.advice.length > 0 ? diagnosis.advice : [fallbackAdvice])
    .slice(0, adviceLimit);
  return {
    id: diagnosis.id,
    ruleId: diagnosis.ruleId,
    severity: diagnosis.severity,
    severityLabel: SEVERITY_LABEL[diagnosis.severity],
    title: diagnosis.title,
    confidence: diagnosis.confidence,
    confidenceLabel: CONFIDENCE_LABEL[diagnosis.confidence],
    attributionStatus: attribution.status,
    attributionLabel: attribution.label,
    attributionSummary: attribution.summary,
    conclusion: diagnosis.conclusion,
    summary: `${attribution.label}：${diagnosis.conclusion}`,
    impactLabel: attribution.status === 'unresolved'
      ? '影响未确认'
      : attribution.status === 'confirmed'
        ? IMPACT_LABEL[diagnosis.severity]
        : `${IMPACT_LABEL[diagnosis.severity]}现象`,
    impactSummary: IMPACT_SUMMARY[diagnosis.category],
    timeWindowLabel,
    evidenceStrengthLabel: EVIDENCE_STRENGTH[diagnosis.confidence],
    causeLabel: attribution.status === 'confirmed'
      ? '确认的具体原因'
      : attribution.status === 'needs-validation'
        ? '为什么还不能确认原因'
        : '为什么无法确认',
    causeSummary,
    counterEvidence: diagnosis.counterEvidence.slice(0, 3),
    limitations: diagnosis.limitations.slice(0, 3),
    evidenceIds,
    advice,
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
  const findings = result.diagnosis.findings
    ?? buildDiagnosisFindings(result.diagnosis.diagnoses);
  const findingByDiagnosisId = new Map(findings.map(finding => [finding.id, finding]));
  let remainingEvidence = 3;
  let remainingAdvice = 3;
  const usedEvidence = new Set<string>();
  const cards = selected.map(diagnosis => {
    const card = toCard(
      diagnosis,
      findingByDiagnosisId.get(`finding:${diagnosis.id}`)
        ?? buildDiagnosisFindings([diagnosis])[0],
      evidenceById,
      usedEvidence,
      remainingEvidence,
      Math.min(1, remainingAdvice),
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
            '目前只能确认现象，缺少完成归因所需的信息。请按每条结论的下一步补充录制内容。',
        }
      : {}),
  };
}
