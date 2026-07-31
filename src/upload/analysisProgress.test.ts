import {
  buildAnalysisProgress,
  isMonotonicProgress,
  progressRatio,
} from './analysisProgress';

describe('analysis progress contract', () => {
  it('requires real work units for determinate progress', () => {
    expect(() => buildAnalysisProgress({
      taskId: 'task-1',
      phase: 'scanning-records',
      mode: 'determinate',
      label: '正在扫描事件',
      phaseIndex: 2,
      phaseCount: 5,
      startedAt: 1,
      updatedAt: 2,
    })).toThrow('determinate progress requires completed, total and unit');
  });

  it('uses the current workflow boundary for an indeterminate phase', () => {
    const progress = buildAnalysisProgress({
      taskId: 'task-1',
      phase: 'parsing-structure',
      mode: 'indeterminate',
      label: '正在解析 JSON 结构',
      phaseIndex: 1,
      phaseCount: 5,
      startedAt: 1,
      updatedAt: 2,
    });

    expect(progressRatio(progress)).toBe(0.2);
  });

  it('starts an active workflow at one percent instead of an uninformative spinner', () => {
    const progress = buildAnalysisProgress({
      taskId: 'task-1',
      phase: 'container-check',
      mode: 'indeterminate',
      label: '正在检查文件容器',
      phaseIndex: 0,
      phaseCount: 5,
      startedAt: 1,
      updatedAt: 2,
    });

    expect(progressRatio(progress)).toBe(0.01);
  });

  it('combines measured phase work with the completed workflow share', () => {
    const progress = buildAnalysisProgress({
      taskId: 'task-1',
      phase: 'scanning-records',
      mode: 'determinate',
      label: '正在扫描事件',
      completed: 50,
      total: 100,
      unit: 'events',
      phaseIndex: 2,
      phaseCount: 5,
      startedAt: 1,
      updatedAt: 2,
    });

    expect(progressRatio(progress)).toBe(0.5);
  });

  it('accepts monotonic phase and completed values only', () => {
    const previous = buildAnalysisProgress({
      taskId: 'task-1',
      phase: 'scanning-records',
      mode: 'determinate',
      label: '正在扫描事件',
      completed: 10,
      total: 100,
      unit: 'events',
      phaseIndex: 2,
      phaseCount: 5,
      startedAt: 1,
      updatedAt: 2,
    });
    const next = { ...previous, completed: 20, updatedAt: 3 };

    expect(isMonotonicProgress(previous, next)).toBe(true);
    expect(isMonotonicProgress(previous, { ...next, completed: 9 })).toBe(false);
    expect(isMonotonicProgress(previous, { ...next, phaseIndex: 1 })).toBe(false);
  });

  it('never reports 100 percent before completed state', () => {
    const progress = buildAnalysisProgress({
      taskId: 'task-1',
      phase: 'preparing-result',
      mode: 'determinate',
      label: '正在准备结果',
      completed: 100,
      total: 100,
      unit: 'rules',
      phaseIndex: 4,
      phaseCount: 5,
      startedAt: 1,
      updatedAt: 2,
      resultReady: true,
    });

    expect(progressRatio(progress)).toBe(1);
  });
});
