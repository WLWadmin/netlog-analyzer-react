import type { LogEntry } from '../../logParser';
import { downloadTextFile } from '../../utils/downloadTextFile';
export function buildLogEntriesJson(entries: LogEntry[], generatedAt = new Date()) {
  const payload = {
    exportTime: generatedAt.toISOString(),
    total: entries.length,
    // 只导出展示字段（不做任何诊断推断）
    entries: entries.map(e => ({
      // parser ID 是本地关联键；筛选、排序和分页不能重新编号。
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
  return JSON.stringify(payload, null, 2);
}

export function buildLogEntriesText(entries: LogEntry[]) {
  return entries.map(e => e.rawLine).join('\n');
}

export function exportLogEntriesAsJson(entries: LogEntry[], filenamePrefix = 'log-entries') {
  downloadTextFile(`${filenamePrefix}-${Date.now()}.json`, buildLogEntriesJson(entries), 'application/json;charset=utf-8');
}
export function exportLogEntriesAsText(entries: LogEntry[], filenamePrefix = 'log-entries') {
  const content = buildLogEntriesText(entries);
  downloadTextFile(`${filenamePrefix}-${Date.now()}.txt`, content, 'text/plain;charset=utf-8');
}
