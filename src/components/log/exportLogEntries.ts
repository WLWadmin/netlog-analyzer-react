import type { LogEntry } from '../../logParser';
import { downloadTextFile } from '../../utils/downloadTextFile';
import { createSharingTextSanitizer } from '../../diagnosis/shared/maskedExport';
import { inspectSharingField } from '../../utils/sharingFieldState';

// 完整匹配受控时间语法，不重算时区或 timestampMs，也不放行日期后的任意文本。
// 通用敏感词检测会误把横线日期识别为电话；只对未知时间文本沿用脱敏。
const RECORDED_TIMESTAMP = /^(?:\d{4}([/-])(?:0?[1-9]|1[0-2])\1(?:0?[1-9]|[12]\d|3[01])[ T])?(?:[01]?\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;
function sharingTimestamp(value: string, sanitize: (text: string) => string): string {
  return RECORDED_TIMESTAMP.test(value) ? value : sanitize(value);
}

export function buildLogEntriesJson(entries: LogEntry[], expert = false, generatedAt = new Date()) {
  const sanitize = createSharingTextSanitizer();
  const text = (value: string) => expert ? value : sanitize(value);
  const payload = {
    exportTime: generatedAt.toISOString(),
    total: entries.length,
    // 只导出展示字段（不做任何诊断推断）
    entries: entries.map(e => ({
      // parser ID 是本地关联键；筛选、排序和分页不能重新编号。
      id: e.id,
      timestamp: expert ? e.timestamp : sharingTimestamp(e.timestamp, sanitize),
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
      ...(expert ? { headers: e.headers, body: e.body, bodyRaw: e.bodyRaw } : {
        redactions: {
          headers: inspectSharingField(e, 'headers'),
          body: inspectSharingField(e, 'body'),
          bodyRaw: inspectSharingField(e, 'bodyRaw'),
        },
      }),
      rawLine: expert ? e.rawLine : '[expert only]',
    })),
  };
  return JSON.stringify(expert ? payload : {
    schema: 'netlog-analyzer-sharing', version: 1, profile: 'safe-sharing', kind: 'go',
    data: { ...payload, identity: { scope: 'analysis-local', crossFileUnique: false } },
  }, null, 2);
}

export function buildLogEntriesText(entries: LogEntry[], expert = false) {
  if (expert) return entries.map(e => e.rawLine).join('\n');
  const sanitize = createSharingTextSanitizer();
  return entries.map(e =>
    `${e.id} ${sharingTimestamp(e.timestamp, sanitize)} ${e.level} ${sanitize(e.method)} ${sanitize(e.url, true) ?? '[address missing]'} ${e.status} ${e.statusCode ?? ''} ${e.duration}ms [raw line: expert only]`
  ).join('\n');
}

export function exportLogEntriesAsJson(entries: LogEntry[], filenamePrefix = 'log-entries') {
  downloadTextFile(`${filenamePrefix}-${Date.now()}.json`, buildLogEntriesJson(entries), 'application/json;charset=utf-8');
}
export function exportLogEntriesAsText(entries: LogEntry[], filenamePrefix = 'log-entries') {
  const content = buildLogEntriesText(entries);
  downloadTextFile(`${filenamePrefix}-${Date.now()}.txt`, content, 'text/plain;charset=utf-8');
}
