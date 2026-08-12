import type { UploadedParseResult } from './parseUploadedInput';
import {
  BUILT_IN_FORMAT_PROBES,
  FileFormatRegistry,
  probeRegisteredFormat,
} from './fileFormatRegistry';
import type {
  FileStreamParseSession,
  FileFormatAdapter,
  ParseContext,
  ParseInput,
  ProbeVerdict,
} from './fileFormatTypes';
import type {
  FileFormatProbeOutcome,
  FileFormatProbeProgress,
} from './probeFileFormat';
import type { AnalysisProgress } from './analysisProgress';

// Small files reuse one memory-backed File so probing and parsing do not read
// the original disk-backed Blob separately.
const FILE_SNAPSHOT_REUSE_MAX_BYTES = 20 * 1024 * 1024;

function readFileSnapshot(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

export async function createFileParseInput(
  file: File,
  taskId: string,
  options: {
    signal?: AbortSignal;
    onProgress?(progress: AnalysisProgress): void;
    probeFile?(
      file: File,
      options: {
        taskId: string;
        signal?: AbortSignal;
        onProgress?(progress: FileFormatProbeProgress): void;
      },
    ): Promise<FileFormatProbeOutcome>;
  } = {},
): Promise<ParseInput> {
  const startedAt = Date.now();
  const onProbeProgress = (progress: FileFormatProbeProgress) => {
    const determinate = progress.processedBytes !== undefined
      && progress.totalBytes !== undefined;
    options.onProgress?.({
      taskId,
      phase: progress.phase,
      label: progress.phase === 'container-check'
        ? '正在检查文件容器'
        : progress.phase === 'decompressing'
          ? '正在流式解压并预检文件'
          : progress.phase === 'reading'
            ? '正在读取文件结构'
            : '正在识别文件格式',
      mode: determinate ? 'determinate' : 'indeterminate',
      ...(determinate
        ? {
            completed: progress.processedBytes,
            total: progress.totalBytes,
            unit: 'bytes' as const,
          }
        : {}),
      phaseIndex: 0,
      phaseCount: 5,
      startedAt,
      updatedAt: Date.now(),
    });
  };
  const probeFile = options.probeFile ?? (
    typeof Worker === 'undefined'
      ? async (
          target: File,
          probeOptions: {
            onProgress?(progress: FileFormatProbeProgress): void;
          },
        ) => {
          const { probeFileFormat } = await import('./probeFileFormat');
          return probeFileFormat(target, probeOptions);
        }
      : async (
          target: File,
          probeOptions: {
            taskId: string;
            signal?: AbortSignal;
            onProgress?(progress: FileFormatProbeProgress): void;
          },
        ) => {
          const { probeFileFormatInWorker } = await import(
            '../workers/fileFormatProbeClient'
          );
          return probeFileFormatInWorker(target, probeOptions);
        }
  );
  let reusableFile = file;
  let streamSession: FileStreamParseSession | undefined;
  if (file.size <= FILE_SNAPSHOT_REUSE_MAX_BYTES) {
    options.onProgress?.({
      taskId,
      phase: 'reading',
      label: '正在读取文件快照',
      mode: 'indeterminate',
      phaseIndex: 0,
      phaseCount: 5,
      startedAt,
      updatedAt: Date.now(),
    });
    const snapshot = await readFileSnapshot(file);
    if (options.signal?.aborted) {
      throw new DOMException('文件预检已取消', 'AbortError');
    }
    reusableFile = new File([snapshot], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } else if (typeof file.stream === 'function') {
    const { probeFileFormatStreamSession } = await import('./probeFileFormat');
    const probed = await probeFileFormatStreamSession(file.stream(), {
      fileSize: file.size,
      signal: options.signal,
      onProgress: onProbeProgress,
    });
    if (options.signal?.aborted) {
      await probed.stream.cancel().catch(() => undefined);
      throw new DOMException('文件预检已取消', 'AbortError');
    }
    streamSession = {
      kind: 'file-stream-session',
      file,
      stream: probed.stream,
      container: probed.outcome.container,
    };
    return {
      taskId,
      fileName: file.name,
      container: probed.outcome.container,
      value: undefined,
      probeVerdicts: probed.outcome.verdicts,
      payload: streamSession,
    };
  }
  const outcome = await probeFile(reusableFile, {
    taskId,
    signal: options.signal,
    onProgress: onProbeProgress,
  });
  return {
    taskId,
    fileName: file.name,
    container: outcome.container,
    value: undefined,
    probeVerdicts: outcome.verdicts,
    payload: reusableFile,
  };
}

function isStrictMatch(verdict: ProbeVerdict): boolean {
  return verdict.kind === 'definite-match';
}

export function createExecutableFileFormatRegistry(options: {
  useWorker: boolean;
  traceEnabled?: boolean;
}): FileFormatRegistry {
  const adapters: FileFormatAdapter<UploadedParseResult>[] =
    BUILT_IN_FORMAT_PROBES
      .filter(probeAdapter => (
        options.traceEnabled !== false
        || probeAdapter.parserId !== 'chromium-performance-trace@1'
      ))
      .map(probeAdapter => ({
      ...probeAdapter,
      validate: async input => {
        const verdict = await probeRegisteredFormat(probeAdapter, input);
        return {
          ok: isStrictMatch(verdict),
          evidenceCodes: verdict.evidenceCodes,
        };
      },
      parse: async (input: ParseInput, context: ParseContext) => {
        const fileTypeHint = probeAdapter.parserId === 'har@1'
          ? 'har'
          : probeAdapter.parserId === 'chromium-netlog@1'
            ? 'netlog'
            : probeAdapter.parserId === 'chromium-performance-trace@1'
              ? 'trace'
              : 'log';
        const { parseUploadedInput } = await import('./parseUploadedInput');
        return parseUploadedInput({
          data: input.payload,
          fileTypeHint,
          isTextLog: probeAdapter.parserId === 'go-service-log@1',
          useWorker: options.useWorker,
          taskId: context.taskId,
          containerHint: input.container,
          onStructuredProgress: context.onProgress,
        });
      },
      }));
  return new FileFormatRegistry(adapters);
}
