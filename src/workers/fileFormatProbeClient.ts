import type {
  FileFormatProbeOutcome,
  FileFormatProbeProgress,
} from '../upload/probeFileFormat';
import type {
  FileFormatProbeWorkerRequest,
  FileFormatProbeWorkerResponse,
} from './fileFormatProbeProtocols';

interface FileFormatProbeClientOptions {
  taskId: string;
  signal?: AbortSignal;
  onProgress?(progress: FileFormatProbeProgress): void;
}

function createWorker(): Worker {
  return new Worker(new URL('./fileFormatProbeWorker.ts', import.meta.url));
}

export function probeFileFormatInWorker(
  file: File,
  options: FileFormatProbeClientOptions,
): Promise<FileFormatProbeOutcome> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', handleAbort);
      worker.terminate();
      callback();
    };
    const handleAbort = () => finish(() => reject(new DOMException(
      '文件预检已取消',
      'AbortError',
    )));

    worker.addEventListener(
      'message',
      (event: MessageEvent<FileFormatProbeWorkerResponse>) => {
        const response = event.data;
        if (response.taskId !== options.taskId) return;
        if (response.type === 'file-format-progress') {
          options.onProgress?.(response.progress);
          return;
        }
        if (response.type === 'file-format-result') {
          finish(() => resolve(response.outcome));
          return;
        }
        finish(() => reject(new Error(response.message)));
      },
    );
    worker.addEventListener('error', () => {
      finish(() => reject(new Error('文件格式预检 Worker 运行失败')));
    });
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
      return;
    }
    const request: FileFormatProbeWorkerRequest = {
      type: 'probe-file-format',
      taskId: options.taskId,
      file,
    };
    worker.postMessage(request);
  });
}
