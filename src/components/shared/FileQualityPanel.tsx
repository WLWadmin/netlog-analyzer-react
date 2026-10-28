import type { FileQualityLocation, FileQualityReport } from '../../parsers/shared/fileQuality';
import './fileQualityPanel.css';

const labels = {
  structure: '字段结构不完整或类型错误',
  missing: '必需字段缺失',
  number: '数值类型或范围无效',
  unavailable: '必需数据标记为不可用（-1）',
  timestamp: '请求开始时间缺失或无效',
  timing: 'Timing 阶段与总耗时存在矛盾',
  recovery: '文件经过修复，原始损坏范围需复核',
  syntax: 'JSON 结构损坏或不完整',
};

export default function FileQualityPanel({ report, onLocate }: {
  report?: FileQualityReport;
  onLocate?: (location: FileQualityLocation) => void;
}) {
  if (!report) return null;
  return (
    <section className="file-quality-panel" aria-label="文件质量校验报告" data-quality-status={report.status}>
        <strong>文件质量校验报告</strong>
        <p>{report.status === 'fatal' ? '解析已停止。' : report.status === 'issues' ? '已发现文件质量问题。' : '当前规则未发现可感知的字段错误。'}
          已检查 {report.checkedRecords.toLocaleString()} 条{report.format === 'har' ? '请求' : '事件'}。
          {report.scope === 'partial' ? '校验范围有限：仅覆盖已解析记录，未完整验证原始文件或快速路径。' : '校验覆盖本次解析的全部记录。'}
          当前校验针对关键字段，不包含全部扩展字段和元数据。校验结果不代表网络正常，也不保证发现所有文件错误。</p>
        {report.issues.map(issue => <details key={issue.code}>
          <summary>{labels[issue.code]} · {issue.count.toLocaleString()} 处{issue.severity === 'fatal' ? ' · 无法继续' : ''}</summary>
          <ul>{issue.samples.map((sample, index) => <li key={index}>
            <code>{sample.jsonPath}</code>{sample.originalLine !== undefined ? <> · 原始文件第 {sample.originalLine} 行，第 {sample.originalColumn} 列</> : null}
            {onLocate && (sample.requestId !== undefined || sample.eventId !== undefined)
              ? <> <button type="button" onClick={() => onLocate(sample)}>定位证据</button></> : null}
          </li>)}</ul>
          {issue.count > issue.samples.length ? <p>仅展示 {issue.samples.length} 处示例位置{issue.severity === 'fatal' ? '（包含致命错误位置）' : ''}，计数包含其余问题。</p> : null}
        </details>)}
        {report.status !== 'checked' ? <p>缺失或非法字段不能视为 0ms、请求失败或确定根因。请保留原始文件，并重新导出同次复现的日志；耗时、排序和关联结论需结合上述字段复核。</p> : null}
    </section>
  );
}
