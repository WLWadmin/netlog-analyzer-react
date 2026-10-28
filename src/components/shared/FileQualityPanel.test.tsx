import { fireEvent, render, screen } from '@testing-library/react';
import FileQualityPanel from './FileQualityPanel';
import UploadEntry from '../upload/UploadEntry';
import { fatalFileQuality, createFileQualityCollector } from '../../parsers/shared/fileQuality';
import { analysisIntakeReducer } from '../../upload/useAnalysisIntake';

jest.mock('../netlog/UploadZone', () => ({ __esModule: true, default: () => null }));

it('keeps fatal reports in intake state, ignores stale failures and exposes reset', () => {
  const error = fatalFileQuality('har', 'syntax');
  const state = analysisIntakeReducer({ status: 'probing', taskId: 'current' }, {
    type: 'failed', taskId: 'current', code: 'WORKER_FAILED', message: error.message, qualityReport: error.qualityReport,
  });
  expect(analysisIntakeReducer(state, {
    type: 'failed', taskId: 'old', code: 'WORKER_FAILED', message: 'old',
  })).toBe(state);
  const onReset = jest.fn();
  render(<UploadEntry traceEnabled state={state} parserMode="recommend"
    onReset={onReset} onParserModeChange={jest.fn()} onFilesSelected={jest.fn()} onConfirm={jest.fn()}
    onCancel={jest.fn()} onContinue={jest.fn()} />);
  expect(screen.getByRole('region', { name: '文件质量校验报告' })).not.toBeNull();
  expect(screen.getByText(/解析已停止/)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
  expect(onReset).toHaveBeenCalledTimes(1);
});

it('locates exact NetLog event/source and labels bounded samples honestly', () => {
  const collector = createFileQualityCollector('netlog');
  for (let eventId = 0; eventId < 12; eventId++) {
    collector.add('structure', { jsonPath: `$.events[${eventId}].params`, eventId, sourceId: 7 });
  }
  const onLocate = jest.fn();
  render(<FileQualityPanel report={collector.finish('partial')} onLocate={onLocate} />);
  expect(screen.getByText(/校验范围有限/)).not.toBeNull();
  expect(screen.getByText('仅展示 8 处示例位置，计数包含其余问题。')).not.toBeNull();
  fireEvent.click(screen.getByText('字段结构不完整或类型错误 · 12 处'));
  fireEvent.click(screen.getAllByRole('button', { name: '定位证据' })[0]);
  expect(onLocate).toHaveBeenCalledWith({ jsonPath: '$.events[0].params', eventId: 0, sourceId: 7 });
});
