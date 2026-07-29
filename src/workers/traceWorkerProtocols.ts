import type {
  TraceContextResult,
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
      type: 'trace-context-result';
      taskId: string;
      result: TraceContextResult;
    }
  | {
      type: 'detected-source';
      taskId: string;
      source: 'har' | 'netlog';
      encoding: 'plain-json' | 'gzip-json';
    }
  | {
      type: 'large-json-fallback';
      taskId: string;
      candidate: 'netlog';
    }
  | {
      type: 'trace-error';
      taskId: string;
      error: TracePublicError;
    };

export type TraceWorkerOutcome =
  | { kind: 'trace'; result: TraceContextResult }
  | { kind: 'detected-source'; source: 'har' | 'netlog'; encoding: 'plain-json' | 'gzip-json' }
  | { kind: 'large-json-fallback'; candidate: 'netlog' };
