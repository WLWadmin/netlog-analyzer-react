import type { TraceAnalysisResult } from '../diagnosis/trace';
import type {
  TracePublicError,
  TraceTaskProgress,
} from '../parsers/trace/types';
import type { TraceWorkbenchClient } from '../workbench/client';
import type {
  WorkbenchRequest,
  WorkbenchResponse,
  WorkbenchSourceRef,
} from '../workbench/protocol';

export type TraceUploadHint = 'trace' | 'json-auto';

export type TraceWorkerRequest =
  | {
      type: 'inspect-trace-upload';
      taskId: string;
      file: File;
      hint: TraceUploadHint;
      keepWorkbenchAlive: boolean;
    }
  | {
      type: 'cancel-trace-task';
      taskId: string;
    }
  | {
      type: 'workbench-request';
      taskId: string;
      request: WorkbenchRequest;
    }
  | {
      type: 'workbench-source-file';
      taskId: string;
      request: Extract<
        WorkbenchRequest,
        { type: 'add-source' | 'replace-source' | 'add-comparison-baseline' }
      >;
      file: File;
    };

export type TraceWorkerResponse =
  | {
      type: 'trace-progress';
      taskId: string;
      progress: TraceTaskProgress;
    }
  | {
      type: 'trace-analysis-result';
      taskId: string;
      result: TraceAnalysisResult;
      workbenchSource?: WorkbenchSourceRef;
    }
  | {
      type: 'detected-source';
      taskId: string;
      source: 'har' | 'netlog';
      encoding: 'plain-json' | 'gzip-json';
    }
  | {
      type: 'source-unresolved';
      taskId: string;
    }
  | {
      type: 'trace-error';
      taskId: string;
      error: TracePublicError;
    }
  | {
      type: 'workbench-response';
      taskId: string;
      response: WorkbenchResponse;
    };

export type TraceWorkerOutcome =
  | {
      kind: 'trace';
      result: TraceAnalysisResult;
      workbench?: TraceWorkbenchClient;
    }
  | { kind: 'detected-source'; source: 'har' | 'netlog'; encoding: 'plain-json' | 'gzip-json' }
  | { kind: 'source-unresolved' };
