import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  confirmFileParser,
  ParserMismatchError,
  prepareFileFormat,
} from './fileFormatGateway';
import { FileFormatRegistry } from './fileFormatRegistry';
import type {
  FileParserId,
  FormatResolution,
  ParseInput,
} from './fileFormatTypes';
import { isFileStreamParseSession } from './fileFormatTypes';
import {
  buildAnalysisProgress,
  isMonotonicProgress,
  type AnalysisProgress,
} from './analysisProgress';
import { cancelActiveAnalysisWorkerTasks } from '../workers/analysisWorkerRegistry';

export const RESULT_READY_HOLD_MS = 3_000;

export type IntakeState =
  | { status: 'idle' }
  | { status: 'probing'; taskId: string; progress?: AnalysisProgress }
  | {
      status: 'awaiting-confirmation';
      taskId: string;
      resolution: FormatResolution;
    }
  | { status: 'validating'; taskId: string; parserId: FileParserId; progress?: AnalysisProgress }
  | { status: 'parsing'; taskId: string; parserId: FileParserId; progress?: AnalysisProgress }
  | {
      status: 'ready';
      taskId: string;
      parserId: FileParserId;
      progress: AnalysisProgress;
      autoContinueAt: number;
    }
  | {
      status: 'failed';
      taskId: string;
      code: 'FORMAT_UNKNOWN' | 'FORMAT_AMBIGUOUS' | 'PARSER_MISMATCH' | 'WORKER_FAILED';
      message: string;
      resolution?: FormatResolution;
    }
  | { status: 'completed'; taskId: string; parserId: FileParserId };

type IntakeAction =
  | { type: 'reset' }
  | { type: 'probing'; taskId: string }
  | { type: 'awaiting-confirmation'; taskId: string; resolution: FormatResolution }
  | {
      type: 'validating';
      taskId: string;
      parserId: FileParserId;
      progress: AnalysisProgress;
    }
  | { type: 'parsing'; taskId: string; parserId: FileParserId }
  | { type: 'progress'; taskId: string; progress: AnalysisProgress }
  | {
      type: 'ready';
      taskId: string;
      parserId: FileParserId;
      progress: AnalysisProgress;
      autoContinueAt: number;
    }
  | {
      type: 'failed';
      taskId: string;
      code: Extract<IntakeState, { status: 'failed' }>['code'];
      message: string;
      resolution?: FormatResolution;
    }
  | { type: 'completed'; taskId: string; parserId: FileParserId };

function taskIdOf(state: IntakeState): string | undefined {
  return state.status === 'idle' ? undefined : state.taskId;
}

const PARSER_VALIDATION_LABELS: Record<FileParserId, string> = {
  'har@1': '正在验证 HAR 结构',
  'chromium-netlog@1': '正在验证 NetLog 结构',
  'chromium-performance-trace@1': '正在验证 Trace 结构',
  'go-service-log@1': '正在验证服务日志结构',
};

export function buildParserValidationProgress(
  taskId: string,
  parserId: FileParserId,
  startedAt: number,
  updatedAt = Date.now(),
): AnalysisProgress {
  return buildAnalysisProgress({
    taskId,
    parserId,
    phase: 'validating',
    label: PARSER_VALIDATION_LABELS[parserId],
    mode: 'indeterminate',
    phaseIndex: 1,
    phaseCount: 5,
    startedAt,
    updatedAt,
  });
}

export function analysisIntakeReducer(
  state: IntakeState,
  action: IntakeAction,
): IntakeState {
  if (action.type === 'reset') return { status: 'idle' };
  if (
    action.type !== 'probing'
    && taskIdOf(state) !== undefined
    && action.taskId !== taskIdOf(state)
  ) {
    return state;
  }
  switch (action.type) {
    case 'probing':
      return { status: 'probing', taskId: action.taskId };
    case 'awaiting-confirmation':
      return {
        status: 'awaiting-confirmation',
        taskId: action.taskId,
        resolution: action.resolution,
      };
    case 'validating':
      return {
        status: 'validating',
        taskId: action.taskId,
        parserId: action.parserId,
        progress: action.progress,
      };
    case 'parsing':
      return {
        status: 'parsing',
        taskId: action.taskId,
        parserId: action.parserId,
        ...('progress' in state && state.progress
          ? { progress: state.progress }
          : {}),
      };
    case 'progress':
      if (
        (
          state.status !== 'probing'
          && state.status !== 'validating'
          && state.status !== 'parsing'
        )
        || !isMonotonicProgress(state.progress, action.progress)
      ) {
        return state;
      }
      return { ...state, progress: action.progress };
    case 'ready':
      return {
        status: 'ready',
        taskId: action.taskId,
        parserId: action.parserId,
        progress: action.progress,
        autoContinueAt: action.autoContinueAt,
      };
    case 'failed':
      return {
        status: 'failed',
        taskId: action.taskId,
        code: action.code,
        message: action.message,
        ...(action.resolution ? { resolution: action.resolution } : {}),
      };
    case 'completed':
      return { status: 'completed', taskId: action.taskId, parserId: action.parserId };
  }
}

interface UseAnalysisIntakeOptions {
  registry: FileFormatRegistry;
  onResult?(result: unknown, parserId: FileParserId): void | Promise<void>;
}

export function useAnalysisIntake({
  registry,
  onResult,
}: UseAnalysisIntakeOptions) {
  const [state, dispatch] = useReducer(analysisIntakeReducer, { status: 'idle' });
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const activeInputRef = useRef<ParseInput | undefined>(undefined);
  const taskStartedAtRef = useRef<number | undefined>(undefined);
  const pendingResultRef = useRef<{
    taskId: string;
    parserId: FileParserId;
    result: unknown;
    timer?: ReturnType<typeof setTimeout>;
  } | undefined>(undefined);

  const isActive = useCallback(
    (taskId: string) => activeTaskIdRef.current === taskId,
    [],
  );

  const clearPendingResult = useCallback(() => {
    const pending = pendingResultRef.current;
    if (pending?.timer) clearTimeout(pending.timer);
    pendingResultRef.current = undefined;
  }, []);

  const releaseActiveInput = useCallback(() => {
    const payload = activeInputRef.current?.payload;
    if (isFileStreamParseSession(payload) && !payload.stream.locked) {
      void payload.stream.cancel().catch(() => undefined);
    }
    activeInputRef.current = undefined;
  }, []);

  const begin = useCallback((taskId: string) => {
    clearPendingResult();
    if (activeTaskIdRef.current) cancelActiveAnalysisWorkerTasks();
    releaseActiveInput();
    activeTaskIdRef.current = taskId;
    taskStartedAtRef.current = Date.now();
    dispatch({ type: 'probing', taskId });
  }, [clearPendingResult, releaseActiveInput]);

  const reportProgress = useCallback((
    taskId: string,
    progress: AnalysisProgress,
  ) => {
    if (isActive(taskId)) {
      dispatch({ type: 'progress', taskId, progress });
    }
  }, [isActive]);

  const continueToResult = useCallback(async () => {
    const pending = pendingResultRef.current;
    if (!pending) return;
    pendingResultRef.current = undefined;
    if (pending.timer) clearTimeout(pending.timer);
    if (!isActive(pending.taskId)) return;
    try {
      await onResult?.(pending.result, pending.parserId);
      if (!isActive(pending.taskId)) return;
      dispatch({
        type: 'completed',
        taskId: pending.taskId,
        parserId: pending.parserId,
      });
    } catch (error) {
      if (!isActive(pending.taskId)) return;
      dispatch({
        type: 'failed',
        taskId: pending.taskId,
        code: 'WORKER_FAILED',
        message: error instanceof Error ? error.message : '结果页面打开失败',
      });
    }
  }, [isActive, onResult]);

  const execute = useCallback(async (
    input: ParseInput,
    parserId: FileParserId,
  ) => {
    const taskId = input.taskId;
    if (!isActive(taskId)) return;
    dispatch({
      type: 'validating',
      taskId,
      parserId,
      progress: buildParserValidationProgress(
        taskId,
        parserId,
        taskStartedAtRef.current ?? Date.now(),
      ),
    });
    try {
      const result = await confirmFileParser(
        input,
        parserId,
        registry,
        {
          taskId,
          isCancelled: () => !isActive(taskId),
          onProgress: progress => {
            if (isActive(taskId)) dispatch({ type: 'progress', taskId, progress });
          },
        },
        () => {
          if (isActive(taskId)) dispatch({ type: 'parsing', taskId, parserId });
        },
      );
      if (!isActive(taskId)) return;
      const readyAt = Date.now();
      const readyProgress = buildAnalysisProgress({
        taskId,
        parserId,
        phase: 'preparing-result',
        label: '分析完成，正在准备结果页面',
        mode: 'determinate',
        completed: 1,
        total: 1,
        unit: 'rules',
        phaseIndex: 4,
        phaseCount: 5,
        startedAt: taskStartedAtRef.current ?? readyAt,
        updatedAt: readyAt,
        resultReady: true,
      });
      const pending = {
        taskId,
        parserId,
        result,
      } as NonNullable<typeof pendingResultRef.current>;
      pendingResultRef.current = pending;
      dispatch({
        type: 'ready',
        taskId,
        parserId,
        progress: readyProgress,
        autoContinueAt: readyAt + RESULT_READY_HOLD_MS,
      });
      pending.timer = setTimeout(() => {
        void continueToResult();
      }, RESULT_READY_HOLD_MS);
    } catch (error) {
      if (!isActive(taskId)) return;
      dispatch({
        type: 'failed',
        taskId,
        code: error instanceof ParserMismatchError ? 'PARSER_MISMATCH' : 'WORKER_FAILED',
        message: error instanceof Error ? error.message : '文件解析失败',
      });
    }
  }, [continueToResult, isActive, registry]);

  const prepare = useCallback(async (
    input: ParseInput,
    requestedParserId?: FileParserId,
  ) => {
    const isNewTask = activeTaskIdRef.current !== input.taskId;
    clearPendingResult();
    if (isNewTask) releaseActiveInput();
    activeTaskIdRef.current = input.taskId;
    activeInputRef.current = input;
    if (isNewTask || taskStartedAtRef.current === undefined) {
      taskStartedAtRef.current = Date.now();
    }
    if (isNewTask) {
      dispatch({ type: 'probing', taskId: input.taskId });
    }
    try {
      const prepared = await prepareFileFormat(input, registry, requestedParserId);
      if (!isActive(input.taskId)) return;
      if (prepared.kind === 'expert-ready' || prepared.kind === 'auto-ready') {
        await execute(input, prepared.parserId);
        return;
      }
      if (prepared.kind === 'parser-mismatch') {
        dispatch({
          type: 'failed',
          taskId: input.taskId,
          code: 'PARSER_MISMATCH',
          message: '文件结构与所选打开方式不匹配',
          resolution: prepared.resolution,
        });
        return;
      }
      const code = prepared.resolution.kind === 'unsupported'
        ? 'FORMAT_UNKNOWN'
        : prepared.resolution.kind === 'needs-choice'
          ? 'FORMAT_AMBIGUOUS'
          : undefined;
      if (code) {
        dispatch({
          type: 'awaiting-confirmation',
          taskId: input.taskId,
          resolution: prepared.resolution,
        });
        return;
      }
      dispatch({
        type: 'awaiting-confirmation',
        taskId: input.taskId,
        resolution: prepared.resolution,
      });
    } catch (error) {
      if (!isActive(input.taskId)) return;
      dispatch({
        type: 'failed',
        taskId: input.taskId,
        code: 'WORKER_FAILED',
        message: error instanceof Error ? error.message : '文件预检失败',
      });
    }
  }, [clearPendingResult, execute, isActive, registry, releaseActiveInput]);

  const confirm = useCallback(async (parserId: FileParserId) => {
    const input = activeInputRef.current;
    if (!input || !isActive(input.taskId)) return;
    await execute(input, parserId);
  }, [execute, isActive]);

  const cancel = useCallback(() => {
    clearPendingResult();
    if (activeTaskIdRef.current) cancelActiveAnalysisWorkerTasks();
    releaseActiveInput();
    activeTaskIdRef.current = undefined;
    taskStartedAtRef.current = undefined;
    dispatch({ type: 'reset' });
  }, [clearPendingResult, releaseActiveInput]);

  const fail = useCallback((taskId: string, message: string) => {
    clearPendingResult();
    releaseActiveInput();
    activeTaskIdRef.current = taskId;
    dispatch({ type: 'probing', taskId });
    dispatch({
      type: 'failed',
      taskId,
      code: 'WORKER_FAILED',
      message,
    });
  }, [clearPendingResult, releaseActiveInput]);

  useEffect(() => () => {
    clearPendingResult();
    releaseActiveInput();
  }, [clearPendingResult, releaseActiveInput]);

  return {
    state,
    begin,
    reportProgress,
    prepare,
    confirm,
    continueToResult,
    cancel,
    fail,
  };
}
