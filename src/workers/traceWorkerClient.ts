import {
  createTraceWorkerTask,
  type TraceWorkerOptions,
  type TraceWorkerTask,
} from './traceWorkerTask';
import { replaceActiveTraceWorkerTask } from './traceWorkerRegistry';
import type { FileStreamParseSession } from '../upload/fileFormatTypes';

export {
  TRACE_WORKER_TIMEOUT_MS,
  TraceWorkerError,
  type TraceWorkerTask,
} from './traceWorkerTask';

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./traceAnalysisWorker.ts', import.meta.url));
}

export function inspectTraceUploadInWorker(
  file: File | FileStreamParseSession,
  options: TraceWorkerOptions,
): TraceWorkerTask {
  const task = createTraceWorkerTask(file, options, defaultWorkerFactory);
  return replaceActiveTraceWorkerTask(task);
}
