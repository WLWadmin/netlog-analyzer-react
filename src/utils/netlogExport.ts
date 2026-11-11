import type { AnalysisResult, PhaseInfo, RequestTimeline } from '../parsers/netlog';

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

/** 沿用旧 JSON 字段契约；不遍历请求事件或读取 Worker dataset。 */
export function buildNetlogJsonExport(result: AnalysisResult, generatedAt = new Date()): string {
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
    proxyInfo: result.proxyInfo,
    requests: result.urlRequests.map(request => ({
      url: request.url,
      method: request.method,
      status: request.status,
      statusCode: request.statusCode,
      duration: request.duration,
      error: request.error,
      timeline: projectTimeline(request.timeline),
    })),
    errors: result.errors.map(error => ({
      severity: error.severity,
      category: error.category,
      message: error.message,
      detail: error.detail,
      time: error.time,
    })),
  };
  return JSON.stringify(data, null, 2);
}

/** 文本防公式执行，数值保持数值语义（包括负错误码和 0）。 */
export function encodeCsvCell(value: string | number | undefined): string {
  let text = value === undefined ? '' : String(value);
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildNetlogCsvExport(result: AnalysisResult): string {
  const headers = ['URL', 'Method', 'Status', 'StatusCode', 'Duration(ms)', 'Error', 'DNS(ms)', 'Connect(ms)', 'SSL(ms)', 'Send(ms)', 'Wait(ms)', 'Download(ms)'];
  const rows = result.urlRequests.map(request => [
    request.url, request.method, request.status, request.statusCode,
    request.duration, request.error, request.timeline.dns?.duration,
    request.timeline.connect?.duration, request.timeline.ssl?.duration,
    request.timeline.send?.duration, request.timeline.wait?.duration,
    request.timeline.download?.duration,
  ].map(encodeCsvCell).join(','));
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}
