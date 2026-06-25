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
    // Log 模块仅做展示与统计，不做网络原因诊断；insight 文案可能随分支不同而不同
    expect(result.insight.detail.length).toBeGreaterThan(0);
    expect(result.insight.detail).not.toContain('根因');
    expect(result.insight.detail).not.toContain('DNS');
  });
});
