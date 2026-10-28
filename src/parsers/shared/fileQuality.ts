import { isRecord, type NetlogEventRecord } from './rootFormatGuard';
import { harTimingContradictions } from './harTimingValidity';

export interface FileQualityLocation {
  jsonPath: string;
  requestId?: number;
  eventId?: number;
  sourceId?: number;
  originalLine?: number;
  originalColumn?: number;
}

export type FileQualityCode = 'structure' | 'missing' | 'number' | 'unavailable' | 'timestamp' | 'timing' | 'recovery' | 'syntax';

export interface FileQualityIssue {
  code: FileQualityCode;
  severity: 'warning' | 'fatal';
  count: number;
  samples: FileQualityLocation[];
}

export interface FileQualityReport {
  format: 'har' | 'netlog';
  status: 'checked' | 'issues' | 'fatal';
  checkedRecords: number;
  scope: 'records' | 'partial';
  issues: FileQualityIssue[];
}

// Fixed issue vocabulary and bounded locators keep Worker messages independent
// of file size. Never retain raw values, exception messages, URLs or headers.
export function createFileQualityCollector(format: FileQualityReport['format']) {
  const issues = new Map<FileQualityCode, FileQualityIssue>();
  let checkedRecords = 0;
  return {
    record() { checkedRecords += 1; },
    add(code: FileQualityCode, location: FileQualityLocation, severity: FileQualityIssue['severity'] = 'warning') {
      let issue = issues.get(code);
      if (!issue) {
        issue = { code, severity, count: 0, samples: [] };
        issues.set(code, issue);
      }
      if (severity === 'fatal') issue.severity = 'fatal';
      issue.count += 1;
      if (issue.samples.length < 8) issue.samples.push(location);
      else if (severity === 'fatal') issue.samples[7] = location;
    },
    finish(scope: FileQualityReport['scope'] = 'records'): FileQualityReport {
      const groups = Array.from(issues.values()).map(issue => ({ ...issue, samples: [...issue.samples] }));
      return {
        format, checkedRecords, scope, issues: groups,
        status: groups.some(issue => issue.severity === 'fatal') ? 'fatal' : groups.length ? 'issues' : 'checked',
      };
    },
  };
}

export type FileQualityCollector = ReturnType<typeof createFileQualityCollector>;

export class FileQualityError extends Error {
  constructor(public readonly qualityReport: FileQualityReport, message = '文件质量校验失败，请查看字段位置并重新导出文件。') {
    super(message);
    this.name = 'FileQualityError';
  }
}

export function fatalFileQuality(format: FileQualityReport['format'], code: FileQualityCode, jsonPath = '$'): FileQualityError {
  const collector = createFileQualityCollector(format);
  collector.add(code, { jsonPath }, 'fatal');
  return new FileQualityError(collector.finish('partial'));
}

export function parseNetlogJson(text: string): unknown {
  try { return JSON.parse(text); }
  catch (error) {
    if (error instanceof SyntaxError) throw fatalFileQuality('netlog', 'syntax');
    throw error;
  }
}

export function checkHarEntry(collector: FileQualityCollector, value: unknown, requestId: number): boolean {
  collector.record();
  const root = `$.log.entries[${requestId}]`;
  const location = (path: string) => ({ jsonPath: `${root}.${path}`, requestId });
  if (!isRecord(value)) {
    collector.add('structure', { jsonPath: root, requestId }, 'fatal');
    return false;
  }
  const numeric = (record: Record<string, unknown>, key: string, path: string, required = false) => {
    const raw = record[key];
    if (raw === undefined) {
      if (required) collector.add('missing', location(path));
      return undefined;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < -1) {
      collector.add('number', location(path));
      return undefined;
    }
    if (raw === -1) {
      if (required) collector.add('unavailable', location(path));
      return undefined;
    }
    if (raw < 0) {
      collector.add('number', location(path));
      return undefined;
    }
    return raw;
  };
  let valid = true;
  const unsafeStructure = (path: string) => {
    collector.add('structure', location(path), 'fatal');
    valid = false;
  };
  for (const key of ['request', 'response'] as const) {
    if (!isRecord(value[key])) unsafeStructure(key);
  }
  const request = isRecord(value.request) ? value.request : {};
  const response = isRecord(value.response) ? value.response : {};
  for (const key of ['method', 'url']) {
    if (request[key] === undefined || request[key] === '') collector.add('missing', location(`request.${key}`));
    else if (typeof request[key] !== 'string') unsafeStructure(`request.${key}`);
  }
  for (const [record, key, path] of [
    [request, 'httpVersion', 'request.httpVersion'],
    [response, 'httpVersion', 'response.httpVersion'],
    [response, 'statusText', 'response.statusText'],
    [value, '_resourceType', '_resourceType'],
  ] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'string') unsafeStructure(path);
  }
  numeric(response, 'status', 'response.status', true);
  for (const [prefix, record] of [['request', request], ['response', response]] as const) {
    numeric(record, 'headersSize', `${prefix}.headersSize`);
    numeric(record, 'bodySize', `${prefix}.bodySize`);
    for (const key of ['headers', 'cookies']) {
      if (record[key] !== undefined && !Array.isArray(record[key])) collector.add('structure', location(`${prefix}.${key}`));
    }
  }
  if (response.content !== undefined && !isRecord(response.content)) collector.add('structure', location('response.content'));
  if (isRecord(response.content)) {
    for (const key of ['mimeType', 'encoding']) {
      if (response.content[key] !== undefined && typeof response.content[key] !== 'string') unsafeStructure(`response.content.${key}`);
    }
    numeric(response.content, 'size', 'response.content.size');
    // compression can be negative (compressed representation larger than body).
    if (response.content.compression !== undefined && (typeof response.content.compression !== 'number' || !Number.isFinite(response.content.compression))) {
      collector.add('number', location('response.content.compression'));
    }
  }
  if (typeof value.startedDateTime !== 'string' || !Number.isFinite(Date.parse(value.startedDateTime))) {
    collector.add('timestamp', location('startedDateTime'));
  }
  numeric(value, 'time', 'time', true);
  if (value.timings !== undefined && !isRecord(value.timings)) collector.add('structure', location('timings'));
  const timings = isRecord(value.timings) ? value.timings : {};
  for (const key of ['blocked', 'dns', 'connect', 'send', 'wait', 'receive', 'ssl']) {
    numeric(timings, key, `timings.${key}`, ['send', 'wait', 'receive'].includes(key));
  }
  harTimingContradictions(value.time, timings).forEach(path => collector.add('timing', location(path)));
  return valid;
}

export function checkNetlogEvent(collector: FileQualityCollector, value: unknown, eventId: number, root = '$.events'): value is NetlogEventRecord {
  collector.record();
  const base = `${root}[${eventId}]`;
  if (!isRecord(value)) {
    collector.add('structure', { jsonPath: base, eventId }, 'fatal');
    return false;
  }
  const source = isRecord(value.source) ? value.source : undefined;
  const sourceId = source?.id ?? value.source_id;
  const location = (path: string): FileQualityLocation => ({
    jsonPath: `${base}.${path}`, eventId,
    ...(typeof sourceId === 'number' && Number.isSafeInteger(sourceId) && sourceId >= 0 ? { sourceId } : {}),
  });
  let valid = true;
  const invalid = (path: string, missing: boolean) => {
    collector.add(missing ? 'missing' : 'number', location(path), 'fatal');
    valid = false;
  };
  const time = value.time;
  const parsedTime = typeof time === 'string' && time.trim() !== '' ? Number(time) : time;
  if (typeof parsedTime !== 'number' || !Number.isFinite(parsedTime) || parsedTime < 0) invalid('time', time === undefined);
  for (const [path, field] of [
    ['type', value.type],
    [source ? 'source.id' : 'source_id', sourceId],
    [source ? 'source.type' : 'source_type', source?.type ?? value.source_type],
  ] as const) {
    if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) invalid(path, field === undefined);
  }
  if (value.phase !== undefined && (typeof value.phase !== 'number' || ![0, 1, 2].includes(value.phase))) {
    collector.add('number', location('phase'), 'fatal');
    valid = false;
  }
  if (value.params !== undefined && !isRecord(value.params)) collector.add('structure', location('params'));
  return valid;
}
