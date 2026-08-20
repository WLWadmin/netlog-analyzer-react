import React, { useState } from 'react';
import type { LogAnalysisResult } from '../../logParser';

interface LogParseCoveragePanelProps {
  result: LogAnalysisResult;
}

const LogParseCoveragePanel: React.FC<LogParseCoveragePanelProps> = ({ result }) => {
  const [visibleSkippedLineCount, setVisibleSkippedLineCount] = useState(20);
  const {
    totalNonEmptyLines,
    parsedLines,
    skippedLines,
    parseCoverage,
    skippedLineSamples,
    skippedLineEntries,
  } = result;
  const partial = skippedLines > 0;
  const visibleSkippedLines = skippedLineEntries.slice(0, visibleSkippedLineCount);

  return (
    <section
      className="log-parse-coverage"
      data-status={partial ? 'partial' : 'complete'}
      aria-label="日志解析覆盖率"
    >
      <div className="log-parse-coverage-header">
        <div>
          <strong>解析覆盖率 {parseCoverage}%</strong>
          <div className="log-parse-coverage-counts">
            非空行 {totalNonEmptyLines}，已识别 {parsedLines}，未识别 {skippedLines}
          </div>
        </div>
        <span className="log-parse-coverage-status">
          {partial ? '部分识别' : '全部识别'}
        </span>
      </div>

      <progress
        className="log-parse-coverage-progress"
        max={100}
        value={parseCoverage}
        aria-label={`日志解析覆盖率 ${parseCoverage}%`}
      />

      {partial ? (
        <details className="log-skipped-lines">
          <summary>
            查看未识别原始行（{skippedLines}）
          </summary>
          <p>未识别行未参与成功率、失败率和请求统计。</p>
          <ol>
            {visibleSkippedLines.map(line => (
              <li key={line.lineNumber}>
                <span>第 {line.lineNumber} 行：</span>
                <code>{line.rawLine}</code>
              </li>
            ))}
          </ol>
          {visibleSkippedLines.length < skippedLineEntries.length && (
            <button
              type="button"
              className="log-skipped-lines-more"
              onClick={() => setVisibleSkippedLineCount(count => Math.min(
                count + 100,
                skippedLineEntries.length,
              ))}
            >
              再显示 {Math.min(100, skippedLineEntries.length - visibleSkippedLines.length)} 行
            </button>
          )}
          {skippedLineSamples.length < skippedLines && (
            <p>概览样本保留 {skippedLineSamples.length} 行；上方列表可分批查看全部未识别原始行。</p>
          )}
        </details>
      ) : (
        <p className="log-parse-coverage-note">
          全部非空行均已识别；统计结论仅覆盖当前文件记录。
        </p>
      )}
    </section>
  );
};

export default LogParseCoveragePanel;
