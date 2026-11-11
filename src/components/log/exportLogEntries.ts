import type { LogEntry } from '../../logParser';
import { downloadTextFile } from '../../utils/downloadTextFile';
import { createSharingTextSanitizer } from '../../diagnosis/shared/maskedExport';

export function buildLogEntriesJson(entries: LogEntry[], expert = false, generatedAt = new Date()) {
  const sanitize = createSharingTextSanitizer();
  const text = (value: string) => expert ? value : sanitize(value);
  const payload = {
    exportTime: generatedAt.toISOString(),
    total: entries.length,
    // 只导出展示字段（不做任何诊断推断）
    entries: entries.map((e, index) => ({
      id: expert ? e.id : `entry-${index + 1}`,
      timestamp: text(e.timestamp),
      timestampMs: e.timestampMs,
      worker: expert ? e.worker : '[worker masked]',
      level: e.level,
      method: text(e.method),
      url: expert ? e.url : sanitize(e.url, true),
      domain: text(e.domain),
      path: expert ? e.path : '[path masked]',
      status: e.status,
      statusCode: e.statusCode,
      statusText: e.statusText === undefined ? undefined : text(e.statusText),
      duration: e.duration,
      durationText: text(e.durationText),
      friendlyName: text(e.friendlyName),
      headers: expert ? e.headers : '[expert only]',
      body: expert ? e.body : '[expert only]',
      bodyRaw: expert ? e.bodyRaw : '[expert only]',
      rawLine: expert ? e.rawLine : '[expert only]',
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function buildLogEntriesText(entries: LogEntry[], expert = false) {
  if (expert) return entries.map(e => e.rawLine).join('\n');
  const sanitize = createSharingTextSanitizer();
  return entries.map((e, index) =>
    `entry-${index + 1} ${sanitize(e.timestamp)} ${e.level} ${sanitize(e.method)} ${sanitize(e.url, true)} ${e.status} ${e.statusCode ?? ''} ${e.duration}ms [raw line: expert only]`
  ).join('\n');
}

export function exportLogEntriesAsJson(entries: LogEntry[], filenamePrefix = 'log-entries') {
  downloadTextFile(`${filenamePrefix}-${Date.now()}.json`, buildLogEntriesJson(entries), 'application/json;charset=utf-8');
}
export function exportLogEntriesAsText(entries: LogEntry[], filenamePrefix = 'log-entries') {
  const content = buildLogEntriesText(entries);
  downloadTextFile(`${filenamePrefix}-${Date.now()}.txt`, content, 'text/plain;charset=utf-8');
}
