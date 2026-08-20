import type {
  HarNumericField,
  HarRequestEntry,
  HarTimingPhaseKey,
} from '../../harParser';
import { HAR_DIAG_THRESHOLDS } from './harThresholds';

export type HarRequestAnomalyState =
  | 'anomaly'
  | 'within-reference'
  | 'not-applicable'
  | 'missing'
  | 'invalid';

export interface HarRequestAnomalyHint {
  key: HarTimingPhaseKey;
  label: string;
  state: HarRequestAnomalyState;
  actualValue?: number;
  thresholdValue: number;
  unit: 'ms';
  sourcePath: string;
  evidenceLevel: 'anomaly-hint' | 'needs-evidence';
  supplement: string;
}

export interface HarRequestEvidenceFact {
  label: string;
  detail: string;
  sourcePath: string;
}

export interface HarRequestEvidenceConclusion {
  summary: string;
  facts: HarRequestEvidenceFact[];
  requiredEvidence: string[];
}

interface TimingRule {
  key: HarTimingPhaseKey;
  label: string;
  thresholdValue: number;
}

const TIMING_RULES: TimingRule[] = [
  { key: 'blocked', label: 'Blocked', thresholdValue: HAR_DIAG_THRESHOLDS.blockedSlow },
  { key: 'dns', label: 'DNS', thresholdValue: HAR_DIAG_THRESHOLDS.dnsSlow },
  { key: 'connect', label: 'Connect', thresholdValue: HAR_DIAG_THRESHOLDS.connectSlow },
  { key: 'ssl', label: 'SSL', thresholdValue: HAR_DIAG_THRESHOLDS.sslSlow },
  { key: 'wait', label: 'Waiting', thresholdValue: HAR_DIAG_THRESHOLDS.ttfbSlow },
  { key: 'receive', label: 'Receive', thresholdValue: HAR_DIAG_THRESHOLDS.receiveSlow },
];

const SUPPLEMENT = '同次服务端日志；如需排除网络栈影响，再补充同次 NetLog';

function legacyNumericField(value: unknown): HarNumericField {
  if (value === undefined) return { state: 'missing' };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { state: 'invalid' };
  if (value === -1) return { state: 'not-available', value: -1 };
  if (value < 0) return { state: 'invalid' };
  return { state: 'value', value };
}

function entryJsonPath(entry: HarRequestEntry): string {
  return entry.standard?.jsonPath || `$.log.entries[${entry.id}]`;
}

function timingField(entry: HarRequestEntry, key: HarTimingPhaseKey): HarNumericField {
  return entry.standard?.timings[key] || legacyNumericField(entry.timings[key]);
}

function anomalyState(field: HarNumericField, thresholdValue: number): {
  state: HarRequestAnomalyState;
  actualValue?: number;
  evidenceLevel: HarRequestAnomalyHint['evidenceLevel'];
} {
  if (field.state === 'missing') {
    return { state: 'missing', evidenceLevel: 'needs-evidence' };
  }
  if (field.state === 'invalid') {
    return { state: 'invalid', evidenceLevel: 'needs-evidence' };
  }
  if (field.state === 'not-available') {
    return { state: 'not-applicable', evidenceLevel: 'needs-evidence' };
  }
  return {
    state: field.value > thresholdValue ? 'anomaly' : 'within-reference',
    actualValue: field.value,
    evidenceLevel: field.value > thresholdValue ? 'anomaly-hint' : 'needs-evidence',
  };
}

export function getHarRequestAnomalyHints(entry: HarRequestEntry): HarRequestAnomalyHint[] {
  return TIMING_RULES.map(rule => ({
    key: rule.key,
    label: rule.label,
    thresholdValue: rule.thresholdValue,
    unit: 'ms',
    sourcePath: `${entryJsonPath(entry)}.timings.${rule.key}`,
    supplement: SUPPLEMENT,
    ...anomalyState(timingField(entry, rule.key), rule.thresholdValue),
  }));
}

export function buildHarRequestEvidenceConclusion(
  entry: HarRequestEntry,
): HarRequestEvidenceConclusion {
  const hints = getHarRequestAnomalyHints(entry);
  const primaryHint = hints
    .filter((hint): hint is HarRequestAnomalyHint & { actualValue: number } => (
      hint.state === 'anomaly' && hint.actualValue !== undefined
    ))
    .sort((left, right) => (
      (right.actualValue / right.thresholdValue) - (left.actualValue / left.thresholdValue)
    ))[0];
  const facts: HarRequestEvidenceFact[] = [];
  const requiredEvidence: string[] = [];
  const jsonPath = entryJsonPath(entry);
  const statusField = entry.standard?.response.status
    ?? legacyNumericField(entry.status);
  const hasStatusZero = statusField.state === 'value' && statusField.value === 0;

  if (hasStatusZero) {
    facts.push({
      label: 'HTTP 响应状态',
      detail: '浏览器没有取得 HTTP 响应，不是服务端返回状态码 0。',
      sourcePath: `${jsonPath}.response.status`,
    });
  } else if (statusField.state === 'value') {
    facts.push({
      label: 'HTTP 响应状态',
      detail: `HAR 记录的 HTTP 状态码为 ${statusField.value}。`,
      sourcePath: `${jsonPath}.response.status`,
    });
  } else {
    facts.push({
      label: 'HTTP 响应状态',
      detail: 'HAR 未提供可用的 HTTP 状态码，不能据此判断是否取得 HTTP 响应。',
      sourcePath: `${jsonPath}.response.status`,
    });
  }

  if (entry.extensions?.netError !== undefined) {
    facts.push({
      label: 'Chromium NetError',
      detail: `浏览器导出的 Chromium 非标准网络错误事实：${String(entry.extensions.netError)}。`,
      sourcePath: entry.extensions.netErrorSourcePath ?? `${jsonPath}._netError`,
    });
  }

  if (entry.blockedReason) {
    facts.push({
      label: 'Blocked Reason',
      detail: `浏览器导出记录的阻止原因：${entry.blockedReason}。`,
      sourcePath: entry.extensions?.blockedReasonSourcePath ?? `${jsonPath}._blockedReason`,
    });
  }

  const remoteAddress = entry.standard?.serverIPAddress
    || (entry.remoteAddress !== '-' ? entry.remoteAddress : undefined);
  if (remoteAddress) {
    facts.push({
      label: '远端连接地址',
      detail: `浏览器记录的远端连接地址：${remoteAddress}。该字段本身不能确认源站、CDN 或故障节点归属。`,
      sourcePath: `${jsonPath}.serverIPAddress`,
    });
  }

  if (entry.serverTiming.length > 0) {
    facts.push({
      label: 'Server-Timing',
      detail: 'Server-Timing 是服务端通过响应头提供的自报指标，可用于与同次服务端日志交叉核验，不能单独确认内部组件或责任方。',
      sourcePath: `${jsonPath}.response.headers`,
    });
  }

  if (hasStatusZero || entry.extensions?.netError !== undefined) {
    requiredEvidence.push('同次 NetLog，用于确认 DNS、连接、TLS、代理或系统网络栈证据');
  }
  if (primaryHint?.key === 'wait' || entry.serverTiming.length > 0) {
    requiredEvidence.push('同次服务端日志，用于核验服务端处理阶段和 Server-Timing 自报指标');
  }

  const assessableHintCount = hints.filter(
    hint => hint.state === 'anomaly' || hint.state === 'within-reference',
  ).length;
  const unavailableHintCount = hints.length - assessableHintCount;
  const summary = primaryHint
    ? `${primaryHint.label} 阶段耗时异常：${primaryHint.actualValue} ms，参考阈值 ${primaryHint.thresholdValue} ms。该阈值仅用于异常提示。`
    : assessableHintCount === 0
      ? 'HAR Timing 证据不足，未提供可评估的阶段耗时。'
      : unavailableHintCount > 0
        ? '可用 HAR Timing 阶段未超过参考阈值，但部分阶段缺失或不可用。'
        : '未发现超过参考阈值的 HAR Timing 阶段；这不代表请求链路不存在其他问题。';

  return {
    summary,
    facts,
    requiredEvidence,
  };
}
