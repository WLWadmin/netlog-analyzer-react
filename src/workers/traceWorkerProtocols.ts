import type { TraceAnalysisResult } from '../diagnosis/trace';
import type {
  TracePublicError,
  TraceTaskProgress,
} from '../parsers/trace/types';

export type TraceUploadHint = 'trace' | 'json-auto';

export type TraceWorkerRequest = {
  type: 'inspect-trace-upload';
  taskId: string;
  file: File;
  hint: TraceUploadHint;
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
    };

export type TraceWorkerOutcome =
  | { kind: 'trace'; result: TraceAnalysisResult }
  | { kind: 'detected-source'; source: 'har' | 'netlog'; encoding: 'plain-json' | 'gzip-json' }
  | { kind: 'source-unresolved' };
