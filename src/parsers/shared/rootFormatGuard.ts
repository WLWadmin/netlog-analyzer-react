type StrongRootFormat = 'har' | 'netlog' | 'trace';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface NetlogEventRecord extends Record<string, unknown> {
  source?: Record<string, unknown>;
  source_id?: number;
  source_type?: number;
  type: number;
  time: string | number;
}

export function isNetlogEventRecord(value: unknown): value is NetlogEventRecord {
  if (!isRecord(value)) return false;
  const source = value.source;
  const hasSource = isRecord(source)
    || (typeof value.source_id === 'number' && typeof value.source_type === 'number');
  return hasSource
    && typeof value.type === 'number'
    && (typeof value.time === 'string' || typeof value.time === 'number');
}

export function netlogEventsFromRoot(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.events)) return value.events;
  if (Array.isArray(value.logEvents)) return value.logEvents;
  return undefined;
}

function hasHarRoot(value: Record<string, unknown>): boolean {
  const log = value.log;
  return isRecord(log) && Array.isArray(log.entries);
}

function hasNetLogRoot(value: unknown): boolean {
  const events = netlogEventsFromRoot(value);
  if (!events) return false;
  if (isRecord(value) && isRecord(value.constants)) return true;
  return events.some(isNetlogEventRecord);
}

/**
 * The prefix probe only recommends a parser. This complete-object guard keeps a
 * bound parser from accepting a file that also proves another registered shape.
 */
export function assertNoCompetingRootFormat(
  value: unknown,
  expected: StrongRootFormat,
): void {
  if (!isRecord(value)) return;
  const detected: StrongRootFormat[] = [];
  if (hasHarRoot(value)) detected.push('har');
  if (hasNetLogRoot(value)) detected.push('netlog');
  if (Array.isArray(value.traceEvents)) detected.push('trace');
  if (detected.some(format => format !== expected)) {
    throw new Error('文件同时包含其他诊断格式结构');
  }
}
