import { formatNetlogWallTime } from '../../utils/netlogTime';
import {
  getNetErrorDescription,
  isHttp2Goaway,
  isHttp2GoawayRecv,
} from './constants';
import type {
  AnalysisResult,
  DiagnosisIssue,
  ParsedEvent,
  ProxyInfo,
  SslIssue,
} from './parser';

export function buildConnectionFailureIssue(
  failure: AnalysisResult['connectionFailures'][number],
  timeTickOffset?: number,
): DiagnosisIssue {
  const description = getNetErrorDescription(failure.error);
  return {
    severity: 'error',
    category: '连接失败',
    message: `请求失败: ${failure.url}`,
    detail: `错误码: ${failure.error} (${description})\n时间: ${formatNetlogWallTime(failure.time, timeTickOffset)}`,
    time: failure.time,
  };
}

export function buildSslDiagnosticIssue(issue: SslIssue): DiagnosisIssue {
  const categoryLabels: Record<SslIssue['category'], string> = {
    cert: '证书错误',
    timeout: 'TLS/SSL 握手超时',
    protocol: 'TLS/SSL 协议错误',
    connection: 'TLS/SSL 连接错误',
    other: 'TLS/SSL 错误',
  };
  const label = categoryLabels[issue.category];
  return {
    severity: 'error',
    category: 'SSL/TLS',
    message: `${label}: ${issue.host}`,
    detail: `错误码: ${issue.error} (${getNetErrorDescription(issue.error)})\n事件: ${issue.event.typeName}\n分类: ${label}`,
    time: issue.event.time,
  };
}

export function buildNetworkErrorIssues(
  errorSources: Record<string, number>,
): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];
  for (const [rawCode, count] of Object.entries(errorSources)) {
    const code = Number.parseInt(rawCode, 10);
    if (code !== 0) {
      issues.push({
        severity: 'error' as const,
        category: '网络错误',
        message: `${getNetErrorDescription(code)} (出现 ${count} 次)`,
        detail: `错误码: ${rawCode}`,
        time: 0,
      });
    }
  }
  return issues;
}

export function buildHttp2GoawayIssue(event: ParsedEvent): DiagnosisIssue | null {
  if (!isHttp2Goaway(event)) return null;
  return {
    severity: 'warning',
    category: 'HTTP/2',
    message: `HTTP/2 ${isHttp2GoawayRecv(event) ? '接收' : '发送'} GOAWAY 帧`,
    detail: `Last Stream ID: ${event.params.last_stream_id}, Error: ${event.params.error_code || event.params.status}`,
    time: event.time,
  };
}

export function buildQuicEventIssue(event: ParsedEvent): DiagnosisIssue | null {
  const error = event.params.error_code || event.params.net_error;
  if (!error) return null;
  return {
    severity: 'error',
    category: 'QUIC',
    message: `QUIC 连接错误: ${error}`,
    detail: JSON.stringify(event.params, null, 2),
    time: event.time,
  };
}

export function buildHttp2GoawaySummary(
  count: number,
  firstTime: number,
): DiagnosisIssue | null {
  if (count === 0) return null;
  return {
    severity: 'warning',
    category: 'HTTP/2',
    message: `检测到 ${count} 个 HTTP/2 GOAWAY 帧`,
    detail: '服务器主动关闭了 HTTP/2 连接，可能存在连接复用问题或服务器重启。',
    time: firstTime,
  };
}

export function buildProxySummary(
  proxyInfo: ProxyInfo,
  proxyEventCount: number,
  firstProxyEventTime: number,
): DiagnosisIssue | null {
  if (proxyInfo.hasProxy && proxyInfo.proxyList.length > 0) {
    let detail = `代理模式: ${proxyInfo.proxyType || '未知'}\n`;
    detail += `代理服务器: ${proxyInfo.proxyList.join(', ')}\n`;
    if (proxyInfo.pacUrl) detail += `PAC 地址: ${proxyInfo.pacUrl}\n`;
    const bypassList = proxyInfo.proxySettings?.bypass_list;
    if (Array.isArray(bypassList) && bypassList.length > 0) {
      detail += `\nBypass 列表 (${bypassList.length} 项):\n`;
      detail += bypassList.map((item: string) => `  - ${item}`).join('\n');
    }
    if (proxyInfo.vpnHints.length > 0) {
      detail += '\nVPN 检测线索:\n';
      detail += proxyInfo.vpnHints.map(hint => `  - ${hint}`).join('\n');
    }
    return {
      severity: 'warning',
      category: '代理',
      message: `检测到代理配置: ${proxyInfo.proxyList.join(', ')}`,
      detail,
      time: firstProxyEventTime,
    };
  }
  if (proxyEventCount > 0) {
    return {
      severity: 'ok',
      category: '代理',
      message: '未检测到代理配置',
      detail: '所有请求均为直连模式，未经过代理服务器。',
      time: firstProxyEventTime,
    };
  }
  return null;
}

export function buildCleanAssessmentIssue(): DiagnosisIssue {
  return {
    severity: 'ok',
    category: '总体评估',
    message: '未检测到明显网络问题',
    detail: '所有请求均正常完成，无错误或异常延迟。',
    time: 0,
  };
}
