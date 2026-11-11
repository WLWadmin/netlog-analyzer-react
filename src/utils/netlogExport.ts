import type { AnalysisResult, PhaseInfo, RequestTimeline } from '../parsers/netlog';
import { createSharingTextSanitizer } from '../diagnosis/shared/maskedExport';
import { inspectSharingField } from './sharingFieldState';

function projectPhase(phase?: PhaseInfo) {
  return phase && { start: phase.start, end: phase.end, duration: phase.duration };
}

function projectTimeline(timeline: RequestTimeline) {
  return {
    dns: projectPhase(timeline.dns),
    connect: projectPhase(timeline.connect),
    ssl: projectPhase(timeline.ssl),
    send: projectPhase(timeline.send),
    wait: projectPhase(timeline.wait),
    download: projectPhase(timeline.download),
  };
}

/** 固定 DTO，不遍历请求事件/Worker dataset；专家模式保留旧出口字段。 */
export function buildNetlogJsonExport(result: AnalysisResult, expert = false, generatedAt = new Date()): string {
  const sanitize = createSharingTextSanitizer();
  const text = (value: string) => expert ? value : sanitize(value);
  const proxy = result.proxyInfo;
  const data = {
    exportTime: generatedAt.toISOString(),
    overview: {
      totalEvents: result.totalEvents,
      uniqueSources: result.uniqueSources,
      peakConcurrency: result.peakConcurrency,
      urlRequestCount: result.urlRequests.length,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      slowRequestCount: result.slowRequests.length,
    },
    proxyInfo: expert ? proxy : proxy && {
      hasProxy: proxy.hasProxy,
      proxyType: proxy.proxyType === null ? null : text(proxy.proxyType ?? ''),
      // v1 明示状态并移除旧值槽位，避免字符串伪装为原 object/null。
      redactions: {
        proxySettings: inspectSharingField(proxy, 'proxySettings'),
        effectiveProxy: inspectSharingField(proxy, 'effectiveProxy'),
        originalProxy: inspectSharingField(proxy, 'originalProxy'),
      },
      pacUrl: proxy.pacUrl == null ? proxy.pacUrl : sanitize(proxy.pacUrl, true),
      proxyList: proxy.proxyList?.map(() => '[expert only]'),
      proxyFallback: proxy.proxyFallback == null ? proxy.proxyFallback : '[expert only]',
      isVPN: proxy.isVPN,
      vpnHints: proxy.vpnHints?.map(text),
    },
    requests: result.urlRequests.map(request => ({
      url: expert ? request.url : sanitize(request.url, true),
      method: text(request.method),
      status: request.status === undefined ? undefined : text(request.status),
      statusCode: request.statusCode,
      duration: request.duration,
      error: request.error,
      timeline: projectTimeline(request.timeline),
    })),
    errors: result.errors.map(error => ({
      severity: error.severity,
      category: text(error.category),
      message: text(error.message),
      // detail 是开放原始文本，不应靠敏感词列表猜测其安全性。
      detail: expert ? error.detail : '[expert only]',
      time: error.time,
    })),
  };
  return JSON.stringify(expert ? data : {
    schema: 'netlog-analyzer-sharing', version: 1, profile: 'safe-sharing', kind: 'netlog', data,
  }, null, 2);
}

/** 文本防公式执行，数值保持数值语义（包括负错误码和 0）。 */
export function encodeCsvCell(value: string | number | undefined): string {
  let text = value === undefined ? '' : String(value);
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildNetlogCsvExport(result: AnalysisResult, expert = false): string {
  const sanitize = createSharingTextSanitizer();
  const text = (value?: string) => value === undefined || expert ? value : sanitize(value);
  const headers = ['URL', 'Method', 'Status', 'StatusCode', 'Duration(ms)', 'Error', 'DNS(ms)', 'Connect(ms)', 'SSL(ms)', 'Send(ms)', 'Wait(ms)', 'Download(ms)'];
  const rows = result.urlRequests.map(request => [
    expert ? request.url : sanitize(request.url, true), text(request.method), text(request.status), request.statusCode,
    request.duration, request.error, request.timeline.dns?.duration,
    request.timeline.connect?.duration, request.timeline.ssl?.duration,
    request.timeline.send?.duration, request.timeline.wait?.duration,
    request.timeline.download?.duration,
  ].map(encodeCsvCell).join(','));
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}
