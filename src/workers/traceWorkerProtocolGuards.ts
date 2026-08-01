import type { TraceTaskPhase } from '../parsers/trace/types';
import { isWorkbenchRequest, isWorkbenchResponse } from '../workbench/spike/protocolGuards';
import type {
  TraceWorkerRequest,
  TraceWorkerResponse,
} from './traceWorkerProtocols';

const TRACE_PHASES: TraceTaskPhase[] = [
  'sniffing-source',
  'reading-file',
  'decompressing',
  'parsing-json',
  'validating-trace',
  'summarizing-intake',
  'scan-events',
  'finalize-contexts',
  'build-facts',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSource(value: unknown): boolean {
  return isRecord(value)
    && isString(value.sourceId)
    && value.parserId === 'trace'
    && isString(value.fingerprint);
}

export function isTraceWorkerRequest(value: unknown): value is TraceWorkerRequest {
  if (!isRecord(value) || !isString(value.type) || !isString(value.taskId)) return false;
  if (value.type === 'cancel-trace-task') return true;
  if (value.type === 'workbench-request') return isWorkbenchRequest(value.request);
  return value.type === 'inspect-trace-upload'
    && (value.hint === 'trace' || value.hint === 'json-auto')
    && typeof value.keepWorkbenchAlive === 'boolean'
    && typeof File !== 'undefined'
    && value.file instanceof File;
}

export function isTraceWorkerResponse(value: unknown): value is TraceWorkerResponse {
  if (!isRecord(value) || !isString(value.type) || !isString(value.taskId)) return false;
  switch (value.type) {
    case 'trace-progress':
      return isRecord(value.progress)
        && typeof value.progress.phase === 'string'
        && TRACE_PHASES.includes(value.progress.phase as TraceTaskPhase)
        && (
          value.progress.processedBytes === undefined
          || isNonNegativeNumber(value.progress.processedBytes)
        )
        && (
          value.progress.totalBytes === undefined
          || isNonNegativeNumber(value.progress.totalBytes)
        )
        && (
          value.progress.processedEvents === undefined
          || isNonNegativeNumber(value.progress.processedEvents)
        )
        && (
          value.progress.totalEvents === undefined
          || isNonNegativeNumber(value.progress.totalEvents)
        );
    case 'trace-analysis-result':
      return isRecord(value.result)
        && isRecord(value.result.intake)
        && isRecord(value.result.context)
        && isRecord(value.result.diagnosis)
        && (value.workbenchSource === undefined || isSource(value.workbenchSource));
    case 'detected-source':
      return (value.source === 'har' || value.source === 'netlog')
        && (value.encoding === 'plain-json' || value.encoding === 'gzip-json');
    case 'source-unresolved':
      return true;
    case 'trace-error':
      return isRecord(value.error)
        && isString(value.error.code)
        && typeof value.error.stage === 'string'
        && TRACE_PHASES.includes(value.error.stage as TraceTaskPhase)
        && isString(value.error.message)
        && typeof value.error.recoverable === 'boolean';
    case 'workbench-response':
      return isWorkbenchResponse(value.response);
    default:
      return false;
  }
}
