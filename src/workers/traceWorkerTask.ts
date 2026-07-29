import type {
  TraceContextResult,
  TracePublicError,
  TraceTaskProgress,
} from '../parsers/trace/types';
import type {
  TraceUploadHint,
  TraceWorkerOutcome,
  TraceWorkerRequest,
  TraceWorkerResponse,
} from './traceWorkerProtocols';

export const TRACE_WORKER_TIMEOUT_MS = 5 * 60 * 1000;

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
  cancel(): void;
}

export interface TraceWorkerOptions {
  hint: TraceUploadHint;
  timeoutMs?: number;
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
    cancel: () => undefined,
  };
}

export function createTraceWorkerTask(
  file: File,
  options: TraceWorkerOptions,
  createWorker: WorkerFactory,
): TraceWorkerTask {
  const taskId = `trace-task-${++taskCounter}`;
  let worker: Worker;
  try {
    worker = createWorker();
  } catch {
    return failedTask(workerFailure('Trace Worker 创建失败'));
  }
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  let resolveTask: (outcome: TraceWorkerOutcome) => void = () => undefined;
  let rejectTask: (reason: TraceWorkerError) => void = () => undefined;

  const cleanup = () => {
    clearTimeout(timer);
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onWorkerError);
    worker.removeEventListener('messageerror', onMessageError);
    worker.terminate();
  };

  const settleError = (detail: TracePublicError) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectTask(new TraceWorkerError(detail));
  };

  const settleSuccess = (outcome: TraceWorkerOutcome) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveTask(outcome);
  };

  function onMessage(event: MessageEvent<TraceWorkerResponse>) {
    const response: unknown = event.data;
    if (
      response === null
      || typeof response !== 'object'
      || !('taskId' in response)
      || response.taskId !== taskId
      || settled
    ) {
      return;
    }
    if (!('type' in response) || typeof response.type !== 'string') {
      settleError(workerFailure('Trace Worker 返回了无效消息'));
      return;
    }
    if (response.type === 'trace-progress') {
      if (!('progress' in response) || response.progress === null || typeof response.progress !== 'object') {
        settleError(workerFailure('Trace Worker 返回了无效消息'));
        return;
      }
      options.onProgress?.(response.progress as TraceTaskProgress);
    } else if (response.type === 'trace-context-result') {
      if (!('result' in response) || response.result === null || typeof response.result !== 'object') {
        settleError(workerFailure('Trace Worker 返回了无效消息'));
        return;
      }
      settleSuccess({ kind: 'trace', result: response.result as TraceContextResult });
    } else if (response.type === 'detected-source') {
      if (
        !('source' in response)
        || (response.source !== 'har' && response.source !== 'netlog')
        || !('encoding' in response)
        || (response.encoding !== 'plain-json' && response.encoding !== 'gzip-json')
      ) {
        settleError(workerFailure('Trace Worker 返回了无效消息'));
        return;
      }
      settleSuccess({
        kind: 'detected-source',
        source: response.source,
        encoding: response.encoding,
      });
    } else if (response.type === 'large-json-fallback') {
      settleSuccess({ kind: 'large-json-fallback', candidate: 'netlog' });
    } else if (response.type === 'trace-error') {
      if (!('error' in response) || response.error === null || typeof response.error !== 'object') {
        settleError(workerFailure('Trace Worker 返回了无效消息'));
        return;
      }
      settleError(response.error as TracePublicError);
    } else {
      settleError(workerFailure('Trace Worker 返回了无效消息'));
    }
  }

  function onWorkerError() {
    settleError({
      code: 'TRACE_WORKER_FAILED',
      stage: 'reading-file',
      message: 'Trace Worker 运行失败',
      recoverable: true,
    });
  }

  function onMessageError() {
    settleError({
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
  timer = setTimeout(() => settleError({
    code: 'TRACE_TIMEOUT',
    stage: 'reading-file',
    message: 'Trace 分析超时',
    recoverable: true,
  }), options.timeoutMs ?? TRACE_WORKER_TIMEOUT_MS);

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onWorkerError);
  worker.addEventListener('messageerror', onMessageError);
  const request: TraceWorkerRequest = {
    type: 'inspect-trace-upload',
    taskId,
    file,
    hint: options.hint,
  };
  try {
    worker.postMessage(request);
  } catch {
    settleError(workerFailure('Trace Worker 消息发送失败'));
  }

  return {
    promise,
    cancel() {
      settleError({
        code: 'TRACE_CANCELLED',
        stage: 'reading-file',
        message: '已取消 Trace 分析',
        recoverable: true,
      });
    },
  };
}
