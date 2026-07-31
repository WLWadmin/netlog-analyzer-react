import type { UploadedParseResult } from './parseUploadedInput';
import {
  BUILT_IN_FORMAT_PROBES,
  FileFormatRegistry,
  probeRegisteredFormat,
} from './fileFormatRegistry';
import type {
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
  const outcome = await probeFile(file, {
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
    payload: file,
  };
}

function isStrictMatch(verdict: ProbeVerdict): boolean {
  return verdict.kind === 'definite-match';
}

export function createExecutableFileFormatRegistry(options: {
  useWorker: boolean;
}): FileFormatRegistry {
  const adapters: FileFormatAdapter<UploadedParseResult>[] =
    BUILT_IN_FORMAT_PROBES.map(probeAdapter => ({
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
          onStructuredProgress: context.onProgress,
        });
      },
    }));
  return new FileFormatRegistry(adapters);
}
