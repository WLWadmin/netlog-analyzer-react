/// <reference lib="webworker" />

import {
  readTraceFileForWorker,
  TraceIntakeError,
  type TraceParsedInput,
} from '../parsers/trace/readTraceFile';
import { TraceAggregationCancelled } from '../parsers/trace/minimalTraceAggregator';
import type { TracePublicError } from '../parsers/trace/types';
import { WORKBENCH_SCHEMA_VERSION, type WorkbenchResponse } from '../workbench/protocol';
import { WorkbenchSessionKernel } from '../workbench/sessionKernel';
import { MinimalTraceEngineAdapter } from '../workbench/traceEngineAdapter';
import { isWorkbenchResponse } from '../workbench/spike/protocolGuards';
import { buildTraceAnalysisResult } from './buildTraceAnalysisResult';
import {
  isTraceWorkerRequest,
  isTraceWorkerResponse,
} from './traceWorkerProtocolGuards';
import type { TraceWorkerRequest, TraceWorkerResponse } from './traceWorkerProtocols';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

interface ActiveTraceTask {
  taskId: string;
  cancelled: boolean;
}

let activeTask: ActiveTraceTask | undefined;
let adapter: MinimalTraceEngineAdapter | undefined;
let sessionKernel: WorkbenchSessionKernel | undefined;

function post(response: TraceWorkerResponse, transfer: Transferable[] = []): void {
  if (!isTraceWorkerResponse(response)) {
    throw new Error('Trace Worker attempted to post an invalid response');
  }
  workerScope.postMessage(response, transfer);
}

function postWorkbench(taskId: string, response: WorkbenchResponse): void {
  if (!isWorkbenchResponse(response)) {
    throw new Error('Workbench response failed runtime validation');
  }
  const transfer = response.type === 'screenshot-result'
    ? [response.screenshot.bytes.buffer as ArrayBuffer]
    : [];
  post({ type: 'workbench-response', taskId, response }, transfer);
}

function releaseActiveTask(): void {
  if (activeTask) activeTask.cancelled = true;
  sessionKernel?.fail();
  adapter?.release();
  sessionKernel = undefined;
  adapter = undefined;
  activeTask = undefined;
}

function yieldControl(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function inspectTrace(
  request: Extract<TraceWorkerRequest, { type: 'inspect-trace-upload' }>,
): Promise<void> {
  releaseActiveTask();
  const task: ActiveTraceTask = { taskId: request.taskId, cancelled: false };
  activeTask = task;
  try {
    let outcome: TraceParsedInput | undefined = await readTraceFileForWorker(request.file, {
      hint: request.hint,
      isCancelled: () => task.cancelled,
      yieldControl,
      onProgress: progress => post({
        type: 'trace-progress',
        taskId: request.taskId,
        progress,
      }),
    });
    if (outcome.kind === 'trace') {
      adapter = new MinimalTraceEngineAdapter(outcome.trace, {
        encoding: outcome.intake.encoding,
        jsonBytes: outcome.intake.jsonBytes,
        skippedEventCount: outcome.skippedEventCount,
        warnings: outcome.intake.warnings,
      });
      const facts = await adapter.analyze({
        isCancelled: () => task.cancelled,
        yieldControl,
        onProgress: progress => post({
          type: 'trace-progress',
          taskId: request.taskId,
          progress: {
            phase: progress.phase === 'indexing-events'
              ? 'build-facts'
              : progress.phase,
            ...(progress.completed === undefined
              ? {}
              : { processedEvents: progress.completed }),
            ...(progress.total === undefined
              ? {}
              : { totalEvents: progress.total }),
          },
        }),
      });
      outcome = undefined;
      const workbenchSource = request.keepWorkbenchAlive
        ? {
            sourceId: `trace-source:${request.taskId}`,
            parserId: 'trace' as const,
            fingerprint: `trace:${facts.intake.jsonBytes}:${facts.intake.eventCount}`,
          }
        : undefined;
      if (workbenchSource) {
        sessionKernel = new WorkbenchSessionKernel(adapter, workbenchSource);
      }
      post({
        type: 'trace-analysis-result',
        taskId: request.taskId,
        result: buildTraceAnalysisResult(facts),
        ...(workbenchSource ? { workbenchSource } : {}),
      });
      if (!workbenchSource) {
        adapter.release();
        adapter = undefined;
        activeTask = undefined;
      }
    } else if (outcome.kind === 'detected-source') {
      post({
        type: 'detected-source',
        taskId: request.taskId,
        source: outcome.source,
        encoding: outcome.encoding,
      });
      releaseActiveTask();
    } else {
      post({
        type: 'source-unresolved',
        taskId: request.taskId,
      });
      releaseActiveTask();
    }
  } catch (error) {
    const publicError: TracePublicError = error instanceof TraceIntakeError
      ? error.publicError
      : error instanceof TraceAggregationCancelled
        ? {
            code: 'TRACE_CANCELLED',
            stage: 'scan-events',
            message: '已取消 Trace 分析',
            recoverable: true,
          }
        : {
            code: 'TRACE_WORKER_FAILED',
            stage: 'reading-file',
            message: 'Trace Worker 处理失败',
            recoverable: true,
          };
    if (!task.cancelled) {
      post({ type: 'trace-error', taskId: request.taskId, error: publicError });
    }
    releaseActiveTask();
  }
}

async function dispatchWorkbench(
  request: Extract<TraceWorkerRequest, { type: 'workbench-request' }>,
): Promise<void> {
  if (!activeTask || activeTask.taskId !== request.taskId || !sessionKernel) {
    postWorkbench(request.taskId, {
      type: 'structured-error',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.request.requestId,
      ...('sessionId' in request.request
        ? {
            sessionId: request.request.sessionId,
            sessionRevision: request.request.sessionRevision,
          }
        : {}),
      error: {
        code: 'session-released',
        message: 'Workbench session is unavailable',
        recoverable: false,
      },
    });
    return;
  }
  try {
    const response = await sessionKernel.dispatch(
      request.request,
      progress => postWorkbench(request.taskId, progress),
    );
    postWorkbench(request.taskId, response);
  } catch {
    postWorkbench(request.taskId, {
      type: 'structured-error',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.request.requestId,
      ...('sessionId' in request.request
        ? {
            sessionId: request.request.sessionId,
            sessionRevision: request.request.sessionRevision,
          }
        : {}),
      error: {
        code: 'worker-failed',
        message: 'Workbench query failed',
        recoverable: true,
      },
    });
  }
}

async function dispatchWorkbenchSourceFile(
  request: Extract<TraceWorkerRequest, { type: 'workbench-source-file' }>,
): Promise<void> {
  if (!activeTask || activeTask.taskId !== request.taskId || !sessionKernel) {
    postWorkbench(request.taskId, {
      type: 'structured-error',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.request.requestId,
      sessionId: request.request.sessionId,
      sessionRevision: request.request.sessionRevision,
      error: {
        code: 'session-released',
        message: 'Workbench session is unavailable',
        recoverable: false,
      },
    });
    return;
  }
  try {
    const response = await sessionKernel.dispatchSourceFile(request.request, request.file);
    postWorkbench(request.taskId, response);
  } catch {
    postWorkbench(request.taskId, {
      type: 'structured-error',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: request.request.requestId,
      sessionId: request.request.sessionId,
      sessionRevision: request.request.sessionRevision,
      error: {
        code: 'worker-failed',
        message: 'Workbench source operation failed',
        recoverable: true,
      },
    });
  }
}

workerScope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isTraceWorkerRequest(request)) return;
  if (request.type === 'cancel-trace-task') {
    if (activeTask?.taskId === request.taskId) releaseActiveTask();
    return;
  }
  if (request.type === 'workbench-request') {
    void dispatchWorkbench(request);
    return;
  }
  if (request.type === 'workbench-source-file') {
    void dispatchWorkbenchSourceFile(request);
    return;
  }
  void inspectTrace(request);
});

export {};
