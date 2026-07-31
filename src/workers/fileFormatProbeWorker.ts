/// <reference lib="webworker" />

import {
  FileFormatProbeError,
  probeFileFormat,
} from '../upload/probeFileFormat';
import type {
  FileFormatProbeWorkerRequest,
  FileFormatProbeWorkerResponse,
} from './fileFormatProbeProtocols';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

function post(response: FileFormatProbeWorkerResponse): void {
  workerScope.postMessage(response);
}

workerScope.addEventListener(
  'message',
  async (event: MessageEvent<FileFormatProbeWorkerRequest>) => {
    const request = event.data;
    if (request.type !== 'probe-file-format') return;
    try {
      const outcome = await probeFileFormat(request.file, {
        onProgress: progress => post({
          type: 'file-format-progress',
          taskId: request.taskId,
          progress,
        }),
      });
      post({
        type: 'file-format-result',
        taskId: request.taskId,
        outcome,
      });
    } catch (error) {
      post({
        type: 'file-format-error',
        taskId: request.taskId,
        code: error instanceof FileFormatProbeError
          ? error.code
          : 'FILE_FORMAT_PROBE_FAILED',
        message: error instanceof Error ? error.message : '文件预检失败',
      });
    }
  },
);

export {};
