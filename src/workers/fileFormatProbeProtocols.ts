import type {
  FileFormatProbeOutcome,
  FileFormatProbeProgress,
} from '../upload/probeFileFormat';

export type FileFormatProbeWorkerRequest = {
  type: 'probe-file-format';
  taskId: string;
  file: File;
};

export type FileFormatProbeWorkerResponse =
  | {
      type: 'file-format-progress';
      taskId: string;
      progress: FileFormatProbeProgress;
    }
  | {
      type: 'file-format-result';
      taskId: string;
      outcome: FileFormatProbeOutcome;
    }
  | {
      type: 'file-format-error';
      taskId: string;
      code: string;
      message: string;
    };
