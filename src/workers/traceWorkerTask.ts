import type {
  TracePublicError,
  TraceTaskProgress,
} from '../parsers/trace/types';
import { TraceWorkbenchClient } from '../workbench/client';
import type { WorkbenchRequest, WorkbenchResponse } from '../workbench/protocol';
import { isTraceWorkerResponse } from './traceWorkerProtocolGuards';
import type {
  TraceUploadHint,
  TraceWorkerOutcome,
  TraceWorkerRequest,
} from './traceWorkerProtocols';
import {
  isFileStreamParseSession,
  type FileStreamParseSession,
} from '../upload/fileFormatTypes';

export const TRACE_WORKER_TIMEOUT_MS = 5 * 60 * 1000;
const TRACE_WORKER_CANCEL_GRACE_MS = 50;
const WORKBENCH_QUERY_TIMEOUT_MS = 10_000;
const WORKBENCH_SOURCE_TIMEOUT_MS = 120_000;

export class TraceWorkerError extends Error {
  readonly detail: TracePublicError;

  constructor(detail: TracePublicError) {
    super(detail.message);
    this.name = 'TraceWorkerError';
    this.detail = detail;
  }
}

export interface TraceWorkerTask {
  promise: Promise<TraceWorkerOutcome>;
  done?: Promise<void>;
  cancel(): void;
}

export interface TraceWorkerOptions {
  hint: TraceUploadHint;
  container?: 'plain' | 'gzip';
  timeoutMs?: number;
  workbenchSourceTimeoutMs?: number;
  enableWorkbench?: boolean;
  onProgress?: (progress: TraceTaskProgress) => void;
}

type WorkerFactory = () => Worker;
let taskCounter = 0;

function workerFailure(message: string): TracePublicError {
  return {
    code: 'TRACE_WORKER_FAILED',
    stage: 'reading-file',
    message,
    recoverable: true,
  };
}

function failedTask(detail: TracePublicError): TraceWorkerTask {
  return {
    promise: Promise.reject(new TraceWorkerError(detail)),
    done: Promise.resolve(),
    cancel: () => undefined,
  };
}

export function createTraceWorkerTask(
  input: File | FileStreamParseSession,
  options: TraceWorkerOptions,
  createWorker: WorkerFactory,
): TraceWorkerTask {
  const file = isFileStreamParseSession(input) ? input.file : input;
  const taskId = `trace-task-${++taskCounter}`;
  let worker: Worker;
  try {
    worker = createWorker();
  } catch {
    return failedTask(workerFailure('Trace Worker 创建失败'));
  }
  let uploadSettled = false;
  let closed = false;
  let uploadTimer: ReturnType<typeof setTimeout>;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveTask: (outcome: TraceWorkerOutcome) => void = () => undefined;
  let rejectTask: (reason: TraceWorkerError) => void = () => undefined;
  let resolveDone: () => void = () => undefined;
  let workbenchClient: TraceWorkbenchClient | undefined;
  const pendingWorkbench = new Map<string, {
    timer: ReturnType<typeof setTimeout>;
    resolve(response: WorkbenchResponse): void;
    reject(error: Error): void;
  }>();

  const rejectWorkbench = (error: Error) => {
    for (const pending of pendingWorkbench.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pendingWorkbench.clear();
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(uploadTimer);
    if (cancelTimer) clearTimeout(cancelTimer);
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onWorkerError);
    worker.removeEventListener('messageerror', onMessageError);
    worker.terminate();
    rejectWorkbench(new Error('Trace Workbench Worker closed'));
    resolveDone();
  };

  const failWorker = (detail: TracePublicError) => {
    if (!uploadSettled) {
      uploadSettled = true;
      rejectTask(new TraceWorkerError(detail));
    }
    workbenchClient?.fail();
    cleanup();
  };

  const settleSuccess = (outcome: TraceWorkerOutcome, keepAlive: boolean) => {
    if (uploadSettled) return;
    uploadSettled = true;
    clearTimeout(uploadTimer);
    resolveTask(outcome);
    if (!keepAlive) cleanup();
  };

  const dispatchWorkbench = (request: WorkbenchRequest): Promise<WorkbenchResponse> => {
    if (closed) return Promise.reject(new Error('Trace Workbench Worker is closed'));
    if (pendingWorkbench.has(request.requestId)) {
      return Promise.reject(new Error('Duplicate Workbench requestId'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingWorkbench.delete(request.requestId);
        reject(new Error('Workbench query timed out'));
      }, WORKBENCH_QUERY_TIMEOUT_MS);
      pendingWorkbench.set(request.requestId, { timer, resolve, reject });
      try {
        worker.postMessage({
          type: 'workbench-request',
          taskId,
          request,
        } satisfies TraceWorkerRequest);
      } catch {
        clearTimeout(timer);
        pendingWorkbench.delete(request.requestId);
        reject(new Error('Workbench request could not be sent'));
      }
    });
  };

  const dispatchWorkbenchSourceFile = (
    request: Extract<
      WorkbenchRequest,
      { type: 'add-source' | 'replace-source' | 'add-comparison-baseline' }
    >,
    file: File,
  ): Promise<WorkbenchResponse> => {
    if (closed) return Promise.reject(new Error('Trace Workbench Worker is closed'));
    if (pendingWorkbench.has(request.requestId)) {
      return Promise.reject(new Error('Duplicate Workbench requestId'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingWorkbench.delete(request.requestId);
        reject(new Error(
          '来源操作超时，Workbench 会话已关闭。请重新打开工作台或重新上传文件。',
        ));
        failWorker({
          code: 'TRACE_WORKER_FAILED',
          stage: 'reading-file',
          message: 'Workbench 来源操作超时，会话已失败关闭',
          recoverable: true,
        });
      }, options.workbenchSourceTimeoutMs ?? WORKBENCH_SOURCE_TIMEOUT_MS);
      pendingWorkbench.set(request.requestId, { timer, resolve, reject });
      try {
        worker.postMessage({
          type: 'workbench-source-file',
          taskId,
          request,
          file,
        } satisfies TraceWorkerRequest);
      } catch {
        clearTimeout(timer);
        pendingWorkbench.delete(request.requestId);
        reject(new Error('Workbench source file could not be sent'));
      }
    });
  };

  function onMessage(event: MessageEvent<unknown>) {
    const raw = event.data;
    if (
      raw === null
      || typeof raw !== 'object'
      || !('taskId' in raw)
      || raw.taskId !== taskId
      || closed
    ) {
      return;
    }
    if (!isTraceWorkerResponse(raw)) {
      failWorker(workerFailure('Trace Worker 返回了无效消息'));
      return;
    }
    if (raw.type === 'workbench-response') {
      const response = raw.response;
      if (response.type === 'progress') {
        workbenchClient?.handleProgress(response);
        return;
      }
      const pending = pendingWorkbench.get(response.requestId);
      if (!pending) return;
      pendingWorkbench.delete(response.requestId);
      clearTimeout(pending.timer);
      pending.resolve(response);
      return;
    }
    if (uploadSettled) return;
    if (raw.type === 'trace-progress') {
      options.onProgress?.(raw.progress);
    } else if (raw.type === 'trace-analysis-result') {
      if (options.enableWorkbench && raw.workbenchSource) {
        workbenchClient = new TraceWorkbenchClient(raw.workbenchSource, {
          dispatch: dispatchWorkbench,
          dispatchSourceFile: dispatchWorkbenchSourceFile,
          close: cleanup,
        });
      }
      settleSuccess({
        kind: 'trace',
        result: raw.result,
        ...(workbenchClient ? { workbench: workbenchClient } : {}),
      }, workbenchClient !== undefined);
    } else if (raw.type === 'detected-source') {
      settleSuccess({
        kind: 'detected-source',
        source: raw.source,
        encoding: raw.encoding,
      }, false);
    } else if (raw.type === 'source-unresolved') {
      settleSuccess({ kind: 'source-unresolved' }, false);
    } else if (raw.type === 'trace-error') {
      failWorker(raw.error);
    }
  }

  function onWorkerError() {
    failWorker({
      code: 'TRACE_WORKER_FAILED',
      stage: 'reading-file',
      message: 'Trace Worker 运行失败',
      recoverable: true,
    });
  }

  function onMessageError() {
    failWorker({
      code: 'TRACE_WORKER_FAILED',
      stage: 'reading-file',
      message: 'Trace Worker 消息读取失败',
      recoverable: true,
    });
  }

  const promise = new Promise<TraceWorkerOutcome>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  const done = new Promise<void>(resolve => {
    resolveDone = resolve;
  });
  uploadTimer = setTimeout(() => {
    if (uploadSettled) return;
    uploadSettled = true;
    rejectTask(new TraceWorkerError({
      code: 'TRACE_TIMEOUT',
      stage: 'reading-file',
      message: 'Trace 分析超时',
      recoverable: true,
    }));
    try {
      worker.postMessage({ type: 'cancel-trace-task', taskId } satisfies TraceWorkerRequest);
    } finally {
      cancelTimer = setTimeout(cleanup, TRACE_WORKER_CANCEL_GRACE_MS);
    }
  }, options.timeoutMs ?? TRACE_WORKER_TIMEOUT_MS);

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onWorkerError);
  worker.addEventListener('messageerror', onMessageError);
  const request: TraceWorkerRequest = {
    type: 'inspect-trace-upload',
    taskId,
    file,
    ...(isFileStreamParseSession(input) ? { stream: input.stream } : {}),
    ...(isFileStreamParseSession(input) || options.container
      ? { container: isFileStreamParseSession(input) ? input.container : options.container }
      : {}),
    hint: options.hint,
    keepWorkbenchAlive: options.enableWorkbench === true,
  };
  try {
    if (isFileStreamParseSession(input)) {
      try {
        worker.postMessage(request, [input.stream as unknown as Transferable]);
      } catch {
        if (!input.stream.locked) {
          void input.stream.cancel().catch(() => undefined);
        }
        const { stream: _stream, ...fallbackRequest } = request;
        worker.postMessage(fallbackRequest);
      }
    } else {
      worker.postMessage(request);
    }
  } catch {
    failWorker(workerFailure('Trace Worker 消息发送失败'));
  }

  return {
    promise,
    done,
    cancel() {
      if (closed) return;
      if (!uploadSettled) {
        uploadSettled = true;
        clearTimeout(uploadTimer);
        rejectTask(new TraceWorkerError({
          code: 'TRACE_CANCELLED',
          stage: 'reading-file',
          message: '已取消 Trace 分析',
          recoverable: true,
        }));
      }
      workbenchClient?.fail();
      try {
        worker.postMessage({ type: 'cancel-trace-task', taskId } satisfies TraceWorkerRequest);
      } finally {
        cancelTimer = setTimeout(cleanup, TRACE_WORKER_CANCEL_GRACE_MS);
      }
    },
  };
}
