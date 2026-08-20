import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LogAnalysisResult } from '../../logParser';
import LogParseCoveragePanel from './LogParseCoveragePanel';

function result(
  overrides: Partial<LogAnalysisResult> = {},
): LogAnalysisResult {
  return {
    entries: [],
    groups: [],
    stats: {
      total: 0,
      success: 0,
      error: 0,
      successRate: 0,
      errorTypes: [],
      domainDistribution: [],
      durationDistribution: [],
      levelDistribution: [],
    },
    insight: {
      summary: '测试摘要',
      severity: 'warning',
      detail: '测试详情',
    },
    totalNonEmptyLines: 4,
    parsedLines: 3,
    skippedLines: 1,
    parseCoverage: 75,
    skippedLineSamples: ['unrecognized raw line'],
    skippedLineEntries: [{ lineNumber: 4, rawLine: 'unrecognized raw line' }],
    ...overrides,
  };
}

describe('LogParseCoveragePanel', () => {
  it('shows parse coverage and unrecognized raw line samples', () => {
    render(<LogParseCoveragePanel result={result()} />);

    expect(screen.getByRole('region', { name: '日志解析覆盖率' }).getAttribute(
      'data-status',
    )).toBe('partial');
    expect(screen.getByText('解析覆盖率 75%')).not.toBeNull();
    expect(screen.getByText('非空行 4，已识别 3，未识别 1')).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('75');
    expect(screen.getByText('查看未识别原始行（1）')).not.toBeNull();
    expect(screen.getByText('第 4 行：')).not.toBeNull();
    expect(screen.getByText('unrecognized raw line')).not.toBeNull();
    expect(screen.getByText('未识别行未参与成功率、失败率和请求统计。')).not.toBeNull();
  });

  it('shows the complete state without an unrecognized sample section', () => {
    render(<LogParseCoveragePanel result={result({
      totalNonEmptyLines: 3,
      parsedLines: 3,
      skippedLines: 0,
      parseCoverage: 100,
      skippedLineSamples: [],
      skippedLineEntries: [],
    })} />);

    expect(screen.getByRole('region', { name: '日志解析覆盖率' }).getAttribute(
      'data-status',
    )).toBe('complete');
    expect(screen.getByText('全部识别')).not.toBeNull();
    expect(screen.queryByText(/查看未识别原始行/)).toBeNull();
  });

  it('lets the user reveal every unrecognized raw line in bounded UI batches', async () => {
    const skippedLineEntries = Array.from({ length: 25 }, (_, index) => ({
      lineNumber: index + 1,
      rawLine: `unrecognized-${index + 1}`,
    }));
    render(<LogParseCoveragePanel result={result({
      totalNonEmptyLines: 25,
      parsedLines: 0,
      skippedLines: 25,
      parseCoverage: 0,
      skippedLineSamples: skippedLineEntries.slice(0, 20).map(item => item.rawLine),
      skippedLineEntries,
    })} />);

    expect(screen.queryByText('unrecognized-25')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '再显示 5 行' }));
    expect(screen.getByText('unrecognized-25')).not.toBeNull();
  });
});
