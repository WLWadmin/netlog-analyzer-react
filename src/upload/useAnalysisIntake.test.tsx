import { act, renderHook, waitFor } from '@testing-library/react';
import { FileFormatRegistry } from './fileFormatRegistry';
import type {
  FileFormatAdapter,
  FileParserId,
  ParseInput,
  ProbeVerdict,
} from './fileFormatTypes';
import {
  analysisIntakeReducer,
  buildParserValidationProgress,
  RESULT_READY_HOLD_MS,
  useAnalysisIntake,
} from './useAnalysisIntake';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { cancelActiveAnalysisWorkerTasks } from '../workers/analysisWorkerRegistry';

jest.mock('../workers/analysisWorkerRegistry', () => ({
  cancelActiveAnalysisWorkerTasks: jest.fn(),
}));

const cancelActiveAnalysisWorkerTasksMock = cancelActiveAnalysisWorkerTasks as jest.Mock;

beforeAll(() => {
  Object.defineProperty(global, 'ReadableStream', {
    configurable: true,
    value: NodeReadableStream,
  });
});

function adapter(
  parserId: FileParserId,
  probeKind: ProbeVerdict['kind'],
  parse: jest.Mock,
): FileFormatAdapter {
  return {
    parserId,
    sourceKind: parserId === 'har@1' ? 'har' : 'netlog',
    family: 'network',
    extensions: ['.json'],
    probe: async () => ({
      kind: probeKind,
      parserId,
      evidenceCodes: [`${parserId}:probe`],
    } as ProbeVerdict),
    validate: async () => ({
      ok: probeKind !== 'no-match',
      evidenceCodes: [`${parserId}:validate`],
    }),
    parse,
  };
}

function input(taskId: string): ParseInput {
  return {
    taskId,
    fileName: 'sample.json',
    container: 'plain',
    value: { log: { entries: [] } },
    payload: { log: { entries: [] } },
  };
}

describe('useAnalysisIntake', () => {
  afterEach(() => {
    jest.useRealTimers();
    cancelActiveAnalysisWorkerTasksMock.mockClear();
  });

  it('automatically executes one unique strong recommendation', async () => {
    const parse = jest.fn().mockResolvedValue({ kind: 'har' });
    const onResult = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'definite-match', parse),
    ]);
    const { result } = renderHook(() => useAnalysisIntake({ registry, onResult }));

    await act(async () => {
      await result.current.prepare(input('task-1'));
    });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    expect(result.current.state).toEqual(expect.objectContaining({
      status: 'ready',
      taskId: 'task-1',
      parserId: 'har@1',
      progress: expect.objectContaining({ resultReady: true }),
    }));

    await act(async () => {
      await result.current.continueToResult();
      await result.current.continueToResult();
    });

    expect(onResult).toHaveBeenCalledWith({ kind: 'har' }, 'har@1');
    expect(result.current.state).toEqual({
      status: 'completed',
      taskId: 'task-1',
      parserId: 'har@1',
    });
  });

  it('commits parser validation at phase one before parser progress arrives', () => {
    const state = analysisIntakeReducer(
      { status: 'probing', taskId: 'task-1' },
      {
        type: 'validating',
        taskId: 'task-1',
        parserId: 'chromium-performance-trace@1',
        progress: buildParserValidationProgress(
          'task-1',
          'chromium-performance-trace@1',
          1,
          2,
        ),
      },
    );

    expect(state).toEqual(expect.objectContaining({
      status: 'validating',
      progress: expect.objectContaining({
        phase: 'validating',
        phaseIndex: 1,
        label: '正在验证 Trace 结构',
      }),
    }));
  });

  it('rejects a phase-zero update after parser validation begins', () => {
    const validating = analysisIntakeReducer(
      { status: 'probing', taskId: 'task-1' },
      {
        type: 'validating',
        taskId: 'task-1',
        parserId: 'chromium-performance-trace@1',
        progress: buildParserValidationProgress(
          'task-1',
          'chromium-performance-trace@1',
          1,
          2,
        ),
      },
    );
    const regressed = analysisIntakeReducer(validating, {
      type: 'progress',
      taskId: 'task-1',
      progress: {
        taskId: 'task-1',
        parserId: 'chromium-performance-trace@1',
        phase: 'probing-format',
        label: '正在识别文件格式',
        mode: 'determinate',
        completed: 0,
        total: 100,
        unit: 'bytes',
        phaseIndex: 0,
        phaseCount: 5,
        startedAt: 1,
        updatedAt: 2,
      },
    });

    expect(regressed).toEqual(validating);
  });

  it('automatically commits the ready result after three seconds', async () => {
    jest.useFakeTimers();
    const parse = jest.fn().mockResolvedValue({ kind: 'har' });
    const onResult = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'definite-match', parse),
    ]);
    const { result, unmount } = renderHook(() => useAnalysisIntake({ registry, onResult }));

    await act(async () => {
      await result.current.prepare(input('task-1'));
    });
    expect(result.current.state.status).toBe('ready');
    expect(onResult).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(RESULT_READY_HOLD_MS);
      await Promise.resolve();
    });

    expect(onResult).toHaveBeenCalledWith({ kind: 'har' }, 'har@1');
    expect(result.current.state.status).toBe('completed');
    unmount();
  });

  it('waits for a choice when the probe remains ambiguous', async () => {
    const harParse = jest.fn();
    const netlogParse = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'possible-match', harParse),
      adapter('chromium-netlog@1', 'possible-match', netlogParse),
    ]);
    const { result } = renderHook(() => useAnalysisIntake({ registry }));

    await act(async () => {
      await result.current.prepare(input('task-1'));
    });

    expect(result.current.state.status).toBe('awaiting-confirmation');
    expect(harParse).not.toHaveBeenCalled();
    expect(netlogParse).not.toHaveBeenCalled();
  });

  it('executes only the parser selected from ambiguous candidates', async () => {
    const parse = jest.fn().mockResolvedValue({ kind: 'har' });
    const onResult = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'possible-match', parse),
      adapter('chromium-netlog@1', 'possible-match', jest.fn()),
    ]);
    const { result } = renderHook(() => useAnalysisIntake({ registry, onResult }));

    await act(async () => {
      await result.current.prepare(input('task-1'));
      await result.current.confirm('har@1');
    });

    expect(result.current.state.status).toBe('ready');
    expect(onResult).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.continueToResult();
    });

    expect(onResult).toHaveBeenCalledWith({ kind: 'har' }, 'har@1');
    expect(result.current.state).toEqual({
      status: 'completed',
      taskId: 'task-1',
      parserId: 'har@1',
    });
  });

  it('ignores stale completion from an older task', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const first = new Promise(resolve => {
      resolveFirst = resolve;
    });
    const parse = jest.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ kind: 'har', id: 2 });
    const onResult = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'definite-match', parse),
    ]);
    const { result } = renderHook(() => useAnalysisIntake({ registry, onResult }));

    let firstPreparation: Promise<void>;
    act(() => {
      firstPreparation = result.current.prepare(input('task-1'), 'har@1');
    });
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.prepare(input('task-2'), 'har@1');
      resolveFirst({ kind: 'har', id: 1 });
      await firstPreparation;
    });

    expect(result.current.state.status).toBe('ready');
    expect(onResult).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.continueToResult();
    });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ kind: 'har', id: 2 }, 'har@1');
    expect(result.current.state).toEqual({
      status: 'completed',
      taskId: 'task-2',
      parserId: 'har@1',
    });
  });

  it('cancel returns to idle and ignores late parser completion', async () => {
    let resolveParse: (value: unknown) => void = () => undefined;
    const parse = jest.fn().mockReturnValue(new Promise(resolve => {
      resolveParse = resolve;
    }));
    const onResult = jest.fn();
    const registry = new FileFormatRegistry([
      adapter('har@1', 'definite-match', parse),
    ]);
    const { result } = renderHook(() => useAnalysisIntake({ registry, onResult }));

    act(() => {
      void result.current.prepare(input('task-1'), 'har@1');
    });
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    act(() => result.current.cancel());
    await act(async () => {
      resolveParse({ kind: 'har' });
    });
    await waitFor(() => expect(result.current.state.status).toBe('idle'));
    expect(onResult).not.toHaveBeenCalled();
    expect(cancelActiveAnalysisWorkerTasksMock).toHaveBeenCalledTimes(1);
  });

  it('cancels an untransferred large-file stream when intake is cancelled', async () => {
    const cancelStream = jest.fn();
    const stream = new ReadableStream<Uint8Array>({
      cancel: cancelStream,
    });
    const parse = jest.fn().mockReturnValue(new Promise(() => undefined));
    const registry = new FileFormatRegistry([
      adapter('har@1', 'definite-match', parse),
    ]);
    const { result } = renderHook(() => useAnalysisIntake({ registry }));
    const largeInput: ParseInput = {
      ...input('task-stream'),
      payload: {
        kind: 'file-stream-session',
        file: new File([], 'large.har'),
        stream,
        container: 'plain',
      },
    };

    act(() => {
      void result.current.prepare(largeInput, 'har@1');
    });
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    act(() => result.current.cancel());

    await waitFor(() => expect(cancelStream).toHaveBeenCalledTimes(1));
    expect(result.current.state.status).toBe('idle');
  });
});
