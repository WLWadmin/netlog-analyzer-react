/// <reference lib="webworker" />

import {
  readTraceFileForWorker,
  TraceIntakeError,
  type TraceParsedInput,
} from '../parsers/trace/readTraceFile';
import {
  MinimalTraceAggregator,
  TraceAggregationCancelled,
} from '../parsers/trace/minimalTraceAggregator';
import type { TracePublicError } from '../parsers/trace/types';
import { buildTraceAnalysisResult } from './buildTraceAnalysisResult';
import type { TraceWorkerRequest, TraceWorkerResponse } from './traceWorkerProtocols';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

function post(response: TraceWorkerResponse): void {
  workerScope.postMessage(response);
}

workerScope.addEventListener('message', async (event: MessageEvent<TraceWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'inspect-trace-upload') return;

  try {
    let outcome: TraceParsedInput | undefined = await readTraceFileForWorker(request.file, {
      hint: request.hint,
      onProgress: progress => post({
        type: 'trace-progress',
        taskId: request.taskId,
        progress,
      }),
    });
    if (outcome.kind === 'trace') {
      const aggregator = new MinimalTraceAggregator({
        encoding: outcome.intake.encoding,
        jsonBytes: outcome.intake.jsonBytes,
        skippedEventCount: outcome.skippedEventCount,
        warnings: outcome.intake.warnings,
      });
      const aggregated = await aggregator.aggregate(outcome.trace, {
        isCancelled: () => false,
        onProgress: progress => post({
          type: 'trace-progress',
          taskId: request.taskId,
          progress: {
            phase: progress.phase,
            ...(progress.processed === undefined
              ? {}
              : { processedEvents: progress.processed }),
            ...(progress.total === undefined
              ? {}
              : { totalEvents: progress.total }),
          },
        }),
      });
      outcome = undefined;
      post({
        type: 'trace-analysis-result',
        taskId: request.taskId,
        result: buildTraceAnalysisResult(aggregated.facts),
      });
    } else if (outcome.kind === 'detected-source') {
      post({
        type: 'detected-source',
        taskId: request.taskId,
        source: outcome.source,
        encoding: outcome.encoding,
      });
    } else {
      post({
        type: 'source-unresolved',
        taskId: request.taskId,
      });
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
    post({ type: 'trace-error', taskId: request.taskId, error: publicError });
  }
});

export {};
