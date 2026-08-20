import type { HarRequestEntry, HarTimingPhaseKey } from '../../harParser';
import { formatHarTime, getHarResponseStatus } from '../../harParser';
import { getHarRequestIssue } from '../../diagnosis/shared/harRequestIssue';

const ROLE_LABELS = {
  user: '用户',
  it: 'IT / 网络管理员',
  frontend: '前端',
  backend: '后端',
} as const;

const TIMING_ROWS: Array<{ key: HarTimingPhaseKey; label: string }> = [
  { key: 'blocked', label: 'Queueing' },
  { key: 'dns', label: 'DNS' },
  { key: 'connect', label: 'TCP' },
  { key: 'ssl', label: 'TLS' },
  { key: 'send', label: 'Request sent' },
  { key: 'wait', label: 'Waiting for server response' },
  { key: 'receive', label: 'Content Download' },
];

function cleanInline(value: unknown, maxLength = 240): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeHarUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return cleanInline(`${url.origin}${url.pathname}`, 500);
  } catch {
    return cleanInline(rawUrl.split(/[?#]/, 1)[0], 500);
  }
}

function formatTiming(entry: HarRequestEntry, key: HarTimingPhaseKey): string {
  if (entry.timingAvailability?.[key] === false) return '未记录';
  const value = entry.timings[key];
  if (value === 0) return '0 ms';
  return formatHarTime(value);
}

function formatStatus(entry: HarRequestEntry): string {
  const status = getHarResponseStatus(entry);
  if (status === undefined) return '未记录可用的 HTTP 状态码';
  if (status === 0) return '浏览器未拿到 HTTP 响应（不是服务端返回了 0）';
  return cleanInline(`${status} ${entry.statusText}`);
}

function formatServerTiming(entry: HarRequestEntry): string {
  if (!entry.serverTiming.length) return '未记录';
  return entry.serverTiming
    .map(item => {
      const name = cleanInline(item.name, 80) || 'unnamed';
      return item.dur === undefined ? name : `${name}=${formatHarTime(item.dur)}`;
    })
    .join(', ');
}

export function buildHarRequestCopyText(entry: HarRequestEntry): string {
  const issue = getHarRequestIssue(entry);
  const role = issue.roleHint ? ROLE_LABELS[issue.roleHint] : '无需优先转交';
  const timingLines = TIMING_ROWS.map(row => `  ${row.label}: ${formatTiming(entry, row.key)}`);

  return [
    'HAR 请求摘要',
    `URL: ${sanitizeHarUrl(entry.url) || '-'}`,
    `Method: ${cleanInline(entry.method) || '-'}`,
    `Status: ${formatStatus(entry)}`,
    `主问题: ${cleanInline(issue.label)}`,
    `失败现象: ${issue.kind === 'normal' ? '未发现明确失败现象' : cleanInline(issue.detail)}`,
    'Timing:',
    ...timingLines,
    `Remote Address: ${cleanInline(entry.remoteAddress) || '未记录'}`,
    `Protocol: ${cleanInline(entry.protocol) || '未记录'}`,
    `x-tt-logid: ${cleanInline(entry.xTtLogid) || '未记录'}`,
    `Server-Timing: ${formatServerTiming(entry)}`,
    `建议先看: ${role}`,
    '证据边界: HAR 可看到请求现象；若要确认 DNS、TLS、代理或系统网络栈原因，请补充 NetLog。',
  ].join('\n');
}
