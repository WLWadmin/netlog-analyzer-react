import { fireEvent, render, screen } from '@testing-library/react';
import AnalysisProgressPanel from './AnalysisProgressPanel';

describe('AnalysisProgressPanel', () => {
  it('renders real work counts and determinate aria values', () => {
    render(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          phase: 'scanning-records',
          label: '正在扫描 Trace 事件',
          mode: 'determinate',
          completed: 84,
          total: 130,
          unit: 'events',
          phaseIndex: 2,
          phaseCount: 5,
          startedAt: 1,
          updatedAt: 2,
        }}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText('已处理 84 / 130 个事件')).not.toBeNull();
    expect(screen.getByText('52%')).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('52');
    expect(screen.queryByText('文件接入')).toBeNull();
  });

  it('shows workflow completion for work that has no measurable inner units', () => {
    render(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          phase: 'parsing-structure',
          label: '正在解析 JSON 结构',
          mode: 'indeterminate',
          phaseIndex: 1,
          phaseCount: 5,
          startedAt: 1,
          updatedAt: 2,
        }}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText('20%')).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('20');
    expect(screen.getByText('正在执行不可拆分的本地任务')).not.toBeNull();
  });

  it('keeps completed activity visible after the current phase changes', () => {
    const { rerender } = render(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          phase: 'probing-format',
          label: '正在识别文件格式',
          mode: 'determinate',
          completed: 10,
          total: 100,
          unit: 'bytes',
          phaseIndex: 0,
          phaseCount: 5,
          startedAt: 1,
          updatedAt: 2,
        }}
        onCancel={jest.fn()}
      />,
    );

    rerender(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          parserId: 'har@1',
          phase: 'parsing-structure',
          label: '正在解析 HAR JSON 结构',
          mode: 'indeterminate',
          phaseIndex: 1,
          phaseCount: 5,
          startedAt: 1,
          updatedAt: 3,
        }}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText('已完成：识别文件格式')).not.toBeNull();
    expect(screen.getByText('当前：正在解析 HAR JSON 结构')).not.toBeNull();
    expect(screen.getAllByText(/秒/).length).toBeGreaterThan(0);
  });

  it('does not move the visible percent or activity back for the same task', () => {
    const { rerender } = render(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          phase: 'validating',
          label: '正在验证 Trace 结构',
          mode: 'indeterminate',
          phaseIndex: 1,
          phaseCount: 5,
          startedAt: 1,
          updatedAt: 2,
        }}
        onCancel={jest.fn()}
      />,
    );

    rerender(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          phase: 'probing-format',
          label: '正在识别文件格式',
          mode: 'determinate',
          completed: 0,
          total: 100,
          unit: 'bytes',
          phaseIndex: 0,
          phaseCount: 5,
          startedAt: 1,
          updatedAt: 3,
        }}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText('20%')).not.toBeNull();
    expect(screen.getByText('当前：正在验证 Trace 结构')).not.toBeNull();
    expect(screen.queryByText('当前：正在识别文件格式')).toBeNull();
  });

  it('advances bounded worker subphase labels without lowering the visible percent', () => {
    const { rerender } = render(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          phase: 'reading',
          label: '正在读取 Trace 文件',
          mode: 'determinate',
          completed: 100,
          total: 100,
          unit: 'bytes',
          phaseIndex: 1,
          phaseCount: 5,
          phaseProgressStart: 0,
          phaseProgressSpan: 1 / 3,
          startedAt: 1,
          updatedAt: 2,
        }}
        onCancel={jest.fn()}
      />,
    );

    rerender(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          phase: 'parsing-structure',
          label: '正在解析 Trace JSON 结构',
          mode: 'indeterminate',
          phaseIndex: 1,
          phaseCount: 5,
          phaseProgressStart: 1 / 3,
          phaseProgressSpan: 0,
          startedAt: 1,
          updatedAt: 3,
        }}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText('26%')).not.toBeNull();
    expect(screen.getByText('当前：正在解析 Trace JSON 结构')).not.toBeNull();
    expect(screen.getByText('已完成：读取 Trace 文件')).not.toBeNull();
  });

  it('shows a five-second result handoff and supports entering immediately', () => {
    const onContinue = jest.fn();
    render(
      <AnalysisProgressPanel
        progress={{
          taskId: 'task-1',
          parserId: 'har@1',
          phase: 'preparing-result',
          label: '分析完成，正在准备结果页面',
          mode: 'determinate',
          completed: 1,
          total: 1,
          unit: 'rules',
          phaseIndex: 4,
          phaseCount: 5,
          startedAt: 1,
          updatedAt: 2,
          resultReady: true,
        }}
        autoContinueAt={Date.now() + 5_000}
        onCancel={jest.fn()}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText('100%')).not.toBeNull();
    expect(screen.getByText('5 秒后自动进入结果页面')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '立即查看结果' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
