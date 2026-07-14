import type { HarRequestEntry, HarTimingPhaseKey } from '../../harParser';
import { formatHarTime } from '../../harParser';
import { getNetErrorDescription } from '../../parsers/netlog/constants';
import { classifyNetError } from '../../parsers/netlog/errorClassifier';
import { HAR_DIAG_THRESHOLDS } from './harThresholds';
import { getHarTimingPhase, normalizeHarTiming, type HarDisplayTimingPhaseKey } from './harTimingNormalization';

export interface HarRequestIssue {
  label: string;
  detail: string;
  severity: 'normal' | 'info' | 'warning' | 'critical';
  kind:
    | 'normal'
    | 'slow'
    | 'http-error'
    | 'net-error'
    | 'blocked'
    | 'cors'
    | 'auth'
    | 'server-error'
    | 'status-zero'
    | 'unknown-failure';
  roleHint?: 'user' | 'it' | 'frontend' | 'backend';
  phase?: HarTimingPhaseKey;
  durationMs?: number;
}

interface PhaseRule {
  phase: HarTimingPhaseKey;
  normalizedPhase: HarDisplayTimingPhaseKey;
  threshold: number;
  label: string;
  detailName: string;
}

const SLOW_PHASE_RULES: PhaseRule[] = [
  { phase: 'blocked', normalizedPhase: 'queueing', threshold: HAR_DIAG_THRESHOLDS.blockedSlow, label: 'Queueing 慢', detailName: '浏览器排队/连接槽调度' },
  { phase: 'blocked', normalizedPhase: 'stalled', threshold: HAR_DIAG_THRESHOLDS.blockedSlow, label: 'Stalled 慢', detailName: '浏览器 blocked/stalled' },
  { phase: 'dns', normalizedPhase: 'dns', threshold: HAR_DIAG_THRESHOLDS.dnsSlow, label: 'DNS 慢', detailName: '域名解析' },
  { phase: 'connect', normalizedPhase: 'tcp', threshold: HAR_DIAG_THRESHOLDS.connectSlow, label: 'TCP 建连慢', detailName: 'TCP 建连' },
  { phase: 'ssl', normalizedPhase: 'ssl', threshold: HAR_DIAG_THRESHOLDS.sslSlow, label: 'TLS 慢', detailName: 'TLS 握手' },
  { phase: 'wait', normalizedPhase: 'wait', threshold: HAR_DIAG_THRESHOLDS.ttfbSlow, label: 'TTFB 慢', detailName: 'Waiting for server response' },
  { phase: 'receive', normalizedPhase: 'receive', threshold: HAR_DIAG_THRESHOLDS.receiveSlow, label: '下载慢', detailName: 'Content Download' },
];

function roleFromNetError(entry: HarRequestEntry): HarRequestIssue['roleHint'] {
  if (entry.netErrorCode === undefined) return 'user';
  const category = classifyNetError(entry.netErrorCode).catName;
  if (category === 'DNS' || category === '连接' || category === '证书' || category === '代理' || category === '阻止') return 'it';
  if (category === '协议') return 'it';
  return 'user';
}

function describeNetError(entry: HarRequestEntry): string {
  if (entry.netErrorCode !== undefined) {
    return getNetErrorDescription(entry.netErrorCode);
  }
  return entry.netErrorText || entry.failureText || '浏览器网络错误';
}

function isAbortedRequest(entry: HarRequestEntry): boolean {
  return entry.netErrorCode === -3
    || [entry.netErrorText, entry.failureText].some(value => /ERR_ABORTED/i.test(value || ''));
}

function hasCorsPreflightSignal(entry: HarRequestEntry): boolean {
  const text = [
    entry.failureText,
    entry.netErrorText,
    entry.blockedReason,
    entry.statusText,
    entry.rawType,
    entry.method,
  ].filter(Boolean).join(' ').toLowerCase();

  return text.includes('cors')
    || text.includes('preflight')
    || entry.method.toUpperCase() === 'OPTIONS'
    || entry.rawType.toLowerCase() === 'preflight';
}

function getSlowPhaseIssue(entry: HarRequestEntry): HarRequestIssue | undefined {
  let primary: (PhaseRule & { durationMs: number }) | undefined;
  const normalized = normalizeHarTiming(entry);

  for (const rule of SLOW_PHASE_RULES) {
    const phase = getHarTimingPhase(normalized, rule.normalizedPhase);
    if (!phase?.available) continue;
    const durationMs = phase.durationMs || 0;
    if (durationMs <= rule.threshold) continue;
    if (!primary || durationMs > primary.durationMs) {
      primary = { ...rule, durationMs };
    }
  }

  if (primary) {
    return {
      label: `${primary.label} ${formatHarTime(primary.durationMs)}`,
      detail: `${primary.detailName} 阶段耗时 ${formatHarTime(primary.durationMs)}，建议优先排查该阶段相关链路。HAR 只能说明请求现象，必要时补充 NetLog 确认。`,
      severity: 'warning',
      kind: 'slow',
      roleHint: primary.phase === 'wait' ? 'backend' : primary.phase === 'blocked' ? 'frontend' : 'it',
      phase: primary.phase,
      durationMs: primary.durationMs,
    };
  }

  if (entry.time > HAR_DIAG_THRESHOLDS.totalSlow) {
    return {
      label: `总耗时偏高 ${formatHarTime(entry.time)}`,
      detail: `总耗时 ${formatHarTime(entry.time)}，但未发现单一阶段明显超过阈值。`,
      severity: 'info',
      kind: 'slow',
      durationMs: entry.time,
    };
  }

  return undefined;
}

export function getHarRequestIssue(entry: HarRequestEntry): HarRequestIssue {
  if (isAbortedRequest(entry)) {
    const slowIssue = getSlowPhaseIssue(entry);
    if (slowIssue) {
      return {
        ...slowIssue,
        detail: `${slowIssue.detail} 请求随后被取消（ERR_ABORTED）；取消是结果，不足以证明插件、安全策略或底层网络错误。`,
      };
    }
    return {
      label: '请求已取消（ERR_ABORTED）',
      detail: '浏览器记录到请求被取消。HAR 无法区分前端主动取消、页面生命周期变化或统一超时，需要结合前端日志或 NetLog 确认。',
      severity: 'warning',
      kind: entry.status === 0 ? 'status-zero' : 'unknown-failure',
      roleHint: 'frontend',
    };
  }

  if (entry.netErrorText || entry.netErrorCode !== undefined) {
    const label = entry.netErrorText || describeNetError(entry);
    return {
      label,
      detail: `${describeNetError(entry)}。这是浏览器记录到的网络错误，建议结合 NetLog 确认 DNS、连接、证书、代理或系统网络栈原因。`,
      severity: 'critical',
      kind: 'net-error',
      roleHint: roleFromNetError(entry),
    };
  }

  if (entry.blockedReason) {
    return {
      label: `浏览器阻止：${entry.blockedReason}`,
      detail: `浏览器或安全策略记录了阻止原因：${entry.blockedReason}。建议优先排查浏览器策略、插件、安全软件、CSP/CORS 或企业网关策略。`,
      severity: 'warning',
      kind: 'blocked',
      roleHint: 'frontend',
    };
  }

  if (entry.status >= 500 && entry.status < 600) {
    return {
      label: `HTTP ${entry.status} 服务端错误`,
      detail: `服务端返回 HTTP ${entry.status}，建议结合服务端日志、接口稳定性和请求时间点排查。`,
      severity: 'critical',
      kind: 'server-error',
      roleHint: 'backend',
    };
  }

  if (entry.status === 401 || entry.status === 403) {
    return {
      label: `HTTP ${entry.status} 鉴权或权限问题`,
      detail: `服务端返回 HTTP ${entry.status}，建议优先检查登录态、鉴权、权限配置或前后端接口约定。`,
      severity: 'warning',
      kind: 'auth',
      roleHint: 'frontend',
    };
  }

  if (entry.status === 407) {
    return {
      label: 'HTTP 407 代理鉴权问题',
      detail: '代理要求鉴权，建议优先检查企业代理、VPN、PAC 或代理账号配置。',
      severity: 'warning',
      kind: 'auth',
      roleHint: 'it',
    };
  }

  if (entry.status >= 400 && entry.status < 500) {
    return {
      label: `HTTP ${entry.status} 请求错误`,
      detail: `服务端返回 HTTP ${entry.status}，建议检查请求路径、参数、权限或接口约定。`,
      severity: 'warning',
      kind: 'http-error',
      roleHint: 'frontend',
    };
  }

  if (entry.status === 0 && hasCorsPreflightSignal(entry)) {
    return {
      label: 'CORS 预检疑似失败',
      detail: '浏览器没有拿到 HTTP 响应，不是服务端返回了 0。当前请求带有 CORS 或预检线索，建议优先检查跨域配置，并补充 NetLog 确认网络栈原因。',
      severity: 'warning',
      kind: 'cors',
      roleHint: 'frontend',
    };
  }

  if (entry.status === 0) {
    return {
      label: 'status=0 未拿到响应',
      detail: '浏览器没有拿到 HTTP 响应，不是服务端返回了 0。HAR 只能说明请求现象，建议补充 NetLog 确认 DNS、TLS、代理或系统网络栈原因。',
      severity: 'warning',
      kind: 'status-zero',
      roleHint: 'user',
    };
  }

  const slowIssue = getSlowPhaseIssue(entry);
  if (slowIssue) return slowIssue;

  if (entry.isFailed) {
    return {
      label: '未知失败',
      detail: '请求被标记为失败，但 HAR 中缺少可直接解释的状态码或网络错误字段。',
      severity: 'warning',
      kind: 'unknown-failure',
    };
  }

  return {
    label: '正常',
    detail: '未发现明显失败或慢请求现象。',
    severity: 'normal',
    kind: 'normal',
  };
}
