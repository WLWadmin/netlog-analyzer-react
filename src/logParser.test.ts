import { parseLogFile } from './logParser';

describe('logParser', () => {
  test('parseLogFile should parse Go service log and keep display-only insight', () => {
    const content = [
      '[w1] Info 2026-06-25 12:00:00 Got Success 200 GET:https://example.com/api | header -> trace=1 | body -> {"statusCode":200} | +10ms',
      '[w1] Error 2026-06-25 12:00:01 Got Error statusCode:500 GET:https://example.com/api | +20ms',
    ].join('\n');

    const result = parseLogFile(content);
    expect(result.entries.length).toBe(2);
    expect(result.stats.total).toBe(2);
    expect(result.stats.error).toBe(1);
    expect(result).toMatchObject({
      totalNonEmptyLines: 2,
      parsedLines: 2,
      skippedLines: 0,
      parseCoverage: 100,
      skippedLineSamples: [],
      skippedLineEntries: [],
    });
    // Log 模块仅做展示与统计，不做网络原因诊断；insight 文案可能随分支不同而不同
    expect(result.insight.detail.length).toBeGreaterThan(0);
    expect(result.insight.detail).not.toContain('根因');
    expect(result.insight.detail).not.toContain('DNS');
  });

  test('reports parse coverage and keeps bounded samples for unrecognized non-empty lines', () => {
    const content = [
      'unrecognized service output',
      '',
      '[w1] Info 2026-06-25 12:00:00 Got Success 200 GET:https://example.com/api | +10ms',
    ].join('\n');

    const result = parseLogFile(content);

    expect(result).toMatchObject({
      totalNonEmptyLines: 2,
      parsedLines: 1,
      skippedLines: 1,
      parseCoverage: 50,
      skippedLineSamples: ['unrecognized service output'],
      skippedLineEntries: [{ lineNumber: 1, rawLine: 'unrecognized service output' }],
    });
    expect(result.insight).toMatchObject({
      summary: '已成功解析的 1 条请求中未发现失败；另有 1 行未识别。',
      severity: 'warning',
    });
    expect(result.insight.detail).toContain('未识别行未参与成功率和请求统计');
  });

  test('limits skipped line samples by count and per-line length', () => {
    const longLine = `unrecognized-${'x'.repeat(2500)}`;
    const content = [
      '[w1] Info 2026-06-25 12:00:00 Got Success 200 GET:https://example.com/api | +10ms',
      longLine,
      ...Array.from({ length: 24 }, (_, index) => `unrecognized-${index}`),
    ].join('\n');

    const result = parseLogFile(content);

    expect(result.totalNonEmptyLines).toBe(26);
    expect(result.parsedLines).toBe(1);
    expect(result.skippedLines).toBe(25);
    expect(result.parseCoverage).toBe(3.8);
    expect(result.skippedLineSamples).toHaveLength(20);
    expect(result.skippedLineEntries).toHaveLength(25);
    expect(result.skippedLineEntries[24]).toEqual({
      lineNumber: 26,
      rawLine: 'unrecognized-23',
    });
    expect(result.skippedLineSamples[0]).toHaveLength(2000);
    expect(result.skippedLineSamples[0]).toMatch(/…（已截断）$/);
  });

  test('does not report success when no non-empty line can be parsed', () => {
    const result = parseLogFile('[w1] Info malformed line');

    expect(result).toMatchObject({
      totalNonEmptyLines: 1,
      parsedLines: 0,
      skippedLines: 1,
      parseCoverage: 0,
      skippedLineSamples: ['[w1] Info malformed line'],
      skippedLineEntries: [{ lineNumber: 1, rawLine: '[w1] Info malformed line' }],
    });
    expect(result.insight.severity).toBe('warning');
    expect(result.insight.summary).toContain('未成功解析出请求');
    expect(result.insight.summary).not.toContain('未发现失败');
  });
});
