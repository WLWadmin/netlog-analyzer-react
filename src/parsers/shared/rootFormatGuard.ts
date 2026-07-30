type StrongRootFormat = 'har' | 'netlog' | 'trace';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasHarRoot(value: Record<string, unknown>): boolean {
  const log = value.log;
  return isObject(log) && Array.isArray(log.entries);
}

function hasNetLogRoot(value: Record<string, unknown>): boolean {
  return isObject(value.constants) && Array.isArray(value.events);
}

/**
 * The prefix probe only recommends a parser. This complete-object guard keeps a
 * bound parser from accepting a file that also proves another registered shape.
 */
export function assertNoCompetingRootFormat(
  value: unknown,
  expected: StrongRootFormat,
): void {
  if (!isObject(value)) return;
  const detected: StrongRootFormat[] = [];
  if (hasHarRoot(value)) detected.push('har');
  if (hasNetLogRoot(value)) detected.push('netlog');
  if (Array.isArray(value.traceEvents)) detected.push('trace');
  if (detected.some(format => format !== expected)) {
    throw new Error('文件同时包含其他诊断格式结构');
  }
}
