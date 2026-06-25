import type { LogEntry } from '../../logParser';

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportLogEntriesAsJson(entries: LogEntry[], filenamePrefix = 'log-entries') {
  const payload = {
    exportTime: new Date().toISOString(),
    total: entries.length,
    // 只导出展示字段（不做任何诊断推断）
    entries: entries.map(e => ({
      id: e.id,
      timestamp: e.timestamp,
      timestampMs: e.timestampMs,
      worker: e.worker,
      level: e.level,
      method: e.method,
      url: e.url,
      domain: e.domain,
      path: e.path,
      status: e.status,
      statusCode: e.statusCode,
      statusText: e.statusText,
      duration: e.duration,
      durationText: e.durationText,
      friendlyName: e.friendlyName,
      headers: e.headers,
      body: e.body,
      bodyRaw: e.bodyRaw,
      rawLine: e.rawLine,
    })),
  };
  downloadTextFile(`${filenamePrefix}-${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
}

export function exportLogEntriesAsText(entries: LogEntry[], filenamePrefix = 'log-entries') {
  const content = entries.map(e => e.rawLine).join('\n');
  downloadTextFile(`${filenamePrefix}-${Date.now()}.txt`, content, 'text/plain;charset=utf-8');
}

