import { parseLog, type AnalysisResult, type ParsedEvent } from '../parsers/netlog';
import { parseHar, type HarAnalysisResult } from '../harParser';
import { parseLogFile, type LogAnalysisResult } from '../logParser';
import {
  parseHarInWorker,
  parseLargeNetlogFileInWorker,
  parseLogInWorker,
  parseNetlogInWorker,
} from '../workers/workerClient';
import {
  fallbackNetlogDatasetState,
  unavailableNetlogDatasetState,
  type NetlogDatasetState,
} from '../workers/netlogDatasetTypes';
import type { TraceAnalysisResult } from '../diagnosis/trace';
import type { TraceTaskProgress } from '../parsers/trace/types';
import { cancelActiveTraceWorkerTask } from '../workers/traceWorkerRegistry';
import { TraceWorkerError } from '../workers/traceWorkerTask';
import { isTraceAnalysisEnabled } from './traceUploadFeature';
import type { AnalysisProgress } from './analysisProgress';
import type { TraceWorkbenchClient } from '../workbench/client';
import { isTraceWorkbenchEnabled } from '../workbench/featureFlag';
import {
  isFileStreamParseSession,
  type FileStreamParseSession,
} from './fileFormatTypes';

const LARGE_NETLOG_STREAM_BYTES = 100 * 1024 * 1024;

const TRACE_PROGRESS_LABELS: Record<TraceTaskProgress['phase'], string> = {
  'sniffing-source': '正在验证 Trace 结构',
  'reading-file': '正在读取 Trace 文件',
  decompressing: '正在解压 gzip Trace',
  'parsing-json': '正在解析 Trace JSON 结构',
  'validating-trace': '正在校验 Trace 结构',
  'summarizing-intake': '正在汇总 Trace 接入信息',
  'scan-events': '正在扫描 Trace 事件',
  'finalize-contexts': '正在整理 Trace 上下文',
  'build-facts': '正在构建 Trace 事实',
};

const TRACE_PROGRESS_PROJECTION: Record<TraceTaskProgress['phase'], {
  phase: AnalysisProgress['phase'];
  phaseIndex: number;
  phaseProgressStart: number;
  phaseProgressSpan: number;
}> = {
  'sniffing-source': { phase: 'validating', phaseIndex: 1, phaseProgressStart: 0, phaseProgressSpan: 0 },
  'reading-file': { phase: 'reading', phaseIndex: 1, phaseProgressStart: 0, phaseProgressSpan: 1 / 3 },
  decompressing: { phase: 'decompressing', phaseIndex: 1, phaseProgressStart: 0, phaseProgressSpan: 1 / 3 },
  'parsing-json': { phase: 'parsing-structure', phaseIndex: 1, phaseProgressStart: 1 / 3, phaseProgressSpan: 0 },
  'validating-trace': { phase: 'validating', phaseIndex: 1, phaseProgressStart: 2 / 3, phaseProgressSpan: 0 },
  'summarizing-intake': { phase: 'scanning-records', phaseIndex: 2, phaseProgressStart: 0, phaseProgressSpan: 0 },
  'scan-events': { phase: 'scanning-records', phaseIndex: 2, phaseProgressStart: 1 / 2, phaseProgressSpan: 1 / 2 },
  'finalize-contexts': { phase: 'building-facts', phaseIndex: 3, phaseProgressStart: 0, phaseProgressSpan: 0 },
  'build-facts': { phase: 'building-facts', phaseIndex: 3, phaseProgressStart: 1 / 2, phaseProgressSpan: 1 / 2 },
};

async function readKnownNonTraceText(
  input: File | FileStreamParseSession,
): Promise<string> {
  if (isFileStreamParseSession(input)) {
    const reader = input.stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  }
  const file = input;
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

export type UploadFileTypeHint = 'netlog' | 'har' | 'log' | 'trace' | 'json-auto';

function isSingleScanDatasetEnabled(): boolean {
  if (process.env.REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET === '1') return true;
  if (process.env.REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET === '0') return false;
  try {
    if (typeof window !== 'undefined') {
      const override = window.localStorage?.getItem('netlog_single_scan_dataset');
      if (override === '1') return true;
      if (override === '0') return false;
    }
  } catch {
    return true;
  }
  return true;
}

export type UploadedParseResult =
  | {
      kind: 'netlog';
      result: AnalysisResult;
      events: ParsedEvent[];
      rawData?: unknown;
      rawDataId?: string;
      largeFileMode?: boolean;
      dataset?: NetlogDatasetState;
    }
  | {
      kind: 'har';
      result: HarAnalysisResult;
      rawData?: unknown;
      rawDataId?: string;
    }
  | {
      kind: 'log';
      result: LogAnalysisResult;
    }
  | {
      kind: 'trace';
      result: TraceAnalysisResult;
      workbench?: TraceWorkbenchClient;
    };

export async function parseUploadedInput(options: {
  data: unknown;
  isTextLog?: boolean;
  repairInfo?: HarAnalysisResult['repairInfo'];
  fileTypeHint?: UploadFileTypeHint;
  containerHint?: 'plain' | 'gzip';
  useWorker: boolean;
  taskId?: string;
  onProgress?: (phase: string) => void;
  onStructuredProgress?: (progress: AnalysisProgress) => void;
}): Promise<UploadedParseResult> {
  cancelActiveTraceWorkerTask();
  const {
    data,
    isTextLog = false,
    repairInfo,
    fileTypeHint: initialFileTypeHint,
    containerHint,
    useWorker,
    taskId = 'upload-task',
    onProgress,
    onStructuredProgress,
  } = options;
  let fileTypeHint = initialFileTypeHint;
  const streamSession = isFileStreamParseSession(data) ? data : undefined;
  const sourceFile = streamSession
    ? streamSession.file
    : typeof File !== 'undefined' && data instanceof File
      ? data
      : undefined;

  if (sourceFile?.name.toLowerCase().endsWith('.zip')) {
    throw new TraceWorkerError({
      code: 'TRACE_ZIP_UNSUPPORTED',
      stage: 'reading-file',
      message: '当前支持 gzip 压缩的 Trace，不支持 ZIP 压缩包。请先解压 ZIP，再上传其中的 JSON / Trace 文件。',
      recoverable: false,
    });
  }

  if (fileTypeHint === 'log' || isTextLog) {
    const isFile = Boolean(sourceFile);
    if (typeof data !== 'string' && !isFile) {
      throw new Error('Log 文件内容必须是文本');
    }
    const logInput = typeof data === 'string'
      ? data
      : streamSession ?? sourceFile!;
    if (useWorker) {
      const { result } = await parseLogInWorker(logInput, { onProgress, onStructuredProgress });
      return { kind: 'log', result };
    }
    const text = typeof logInput === 'string'
      ? logInput
      : await readKnownNonTraceText(logInput);
    return { kind: 'log', result: parseLogFile(text) };
  }

  if (fileTypeHint === 'trace' || fileTypeHint === 'json-auto') {
    if (!sourceFile) {
      throw new Error('Trace 上传必须以 File 交给专用 Worker');
    }
    if (!useWorker) {
      throw new Error('当前浏览器不支持 Worker，无法安全解析 Trace');
    }
    const { inspectTraceUploadInWorker } = await import('../workers/traceWorkerClient');
    const traceStartedAt = Date.now();
    const task = inspectTraceUploadInWorker(streamSession ?? sourceFile, {
      hint: fileTypeHint,
      container: streamSession?.container ?? containerHint,
      enableWorkbench: isTraceWorkbenchEnabled(),
      onProgress: (progress: TraceTaskProgress) => {
        onProgress?.(progress.phase);
        const projection = TRACE_PROGRESS_PROJECTION[progress.phase];
        const completed = progress.processedEvents ?? progress.processedBytes;
        const total = progress.totalEvents ?? progress.totalBytes;
        const unit = progress.processedEvents !== undefined ? 'events' : 'bytes';
        onStructuredProgress?.({
          taskId,
          parserId: 'chromium-performance-trace@1',
          phase: projection.phase,
          label: TRACE_PROGRESS_LABELS[progress.phase],
          mode: completed !== undefined && total !== undefined
            ? 'determinate'
            : 'indeterminate',
          ...(completed === undefined ? {} : { completed }),
          ...(total === undefined ? {} : { total }),
          ...(completed === undefined || total === undefined ? {} : { unit }),
          phaseIndex: projection.phaseIndex,
          phaseCount: 5,
          phaseProgressStart: projection.phaseProgressStart,
          phaseProgressSpan: projection.phaseProgressSpan,
          startedAt: traceStartedAt,
          updatedAt: Date.now(),
        });
      },
    });
    const outcome = await task.promise;
    if (outcome.kind === 'trace') {
      if (!isTraceAnalysisEnabled()) {
        await outcome.workbench?.close();
        throw new TraceWorkerError({
          code: 'TRACE_FEATURE_DISABLED',
          stage: 'validating-trace',
          message: '检测到 Chromium Performance Trace，当前版本尚未开放性能分析。',
          recoverable: false,
        });
      }
      return {
        kind: 'trace',
        result: outcome.result,
        ...(outcome.workbench ? { workbench: outcome.workbench } : {}),
      };
    }
    if (outcome.kind === 'source-unresolved') {
      throw new TraceWorkerError({
        code: 'TRACE_SOURCE_UNKNOWN',
        stage: 'sniffing-source',
        message: '无法确认 JSON 文件类型，请确认文件来自受支持的诊断工具。',
        recoverable: false,
      });
    } else {
      if (outcome.encoding !== 'plain-json') {
        throw new Error('当前不支持 gzip 压缩的 HAR 或 NetLog');
      }
      if (outcome.source === 'har') {
        const text = await readKnownNonTraceText(sourceFile);
        if (useWorker) {
          const { result, rawData, rawDataId } = await parseHarInWorker(
            text,
            repairInfo,
            { onProgress, onStructuredProgress },
          );
          return { kind: 'har', result, rawData, rawDataId };
        }
        const parsedData: unknown = JSON.parse(text);
        const result = parseHar(parsedData);
        if (repairInfo) result.repairInfo = repairInfo;
        return { kind: 'har', result, rawData: parsedData };
      }
      if (sourceFile.size >= LARGE_NETLOG_STREAM_BYTES) {
        fileTypeHint = 'netlog';
      } else {
        const text = await readKnownNonTraceText(sourceFile);
        if (useWorker) {
          const { events, result, rawData, rawDataId } = await parseNetlogInWorker(
            text,
            { onProgress, onStructuredProgress },
          );
          return {
            kind: 'netlog',
            result,
            events,
            rawData,
            rawDataId,
            dataset: unavailableNetlogDatasetState,
          };
        }
        const parsedData: unknown = JSON.parse(text);
        const { events, result } = parseLog(parsedData);
        return {
          kind: 'netlog',
          result,
          events,
          rawData: parsedData,
          dataset: unavailableNetlogDatasetState,
        };
      }
    }
  }

  if (!fileTypeHint) {
    throw new Error('未绑定文件解析器，请先完成格式确认');
  }

  const shouldParseHar = fileTypeHint === 'har';
  if (shouldParseHar) {
    if (useWorker) {
      const { result, rawData, rawDataId } = await parseHarInWorker(
        data,
        repairInfo,
        { onProgress, onStructuredProgress },
      );
      return { kind: 'har', result, rawData, rawDataId };
    }

    const harData = sourceFile
      ? await readKnownNonTraceText(streamSession ?? sourceFile)
      : data;
    const parsedData = typeof harData === 'string' ? JSON.parse(harData) : harData;
    const result = parseHar(parsedData);
    if (repairInfo) result.repairInfo = repairInfo;
    return { kind: 'har', result, rawData: parsedData };
  }

  if (sourceFile && fileTypeHint === 'netlog' && sourceFile.size >= LARGE_NETLOG_STREAM_BYTES) {
    if (!useWorker) {
      throw new Error('当前浏览器不支持 Worker，大文件 NetLog 无法安全解析');
    }
    const singleScanDataset = isSingleScanDatasetEnabled();
    console.info('[netlog-large]', {
      event: 'parseUploadedInput:large-netlog',
      fileSize: sourceFile.size,
      useWorker,
      singleScanDataset,
    });
    let largeNetlogResult: Awaited<ReturnType<typeof parseLargeNetlogFileInWorker>>;
    try {
      largeNetlogResult = await parseLargeNetlogFileInWorker(streamSession ?? sourceFile, {
        onProgress,
        onStructuredProgress,
        singleScanDataset,
      });
    } catch (error) {
      if (!singleScanDataset) throw error;
      console.warn('[netlog-large]', {
        event: 'parseUploadedInput:single-scan-fallback',
        fileSize: sourceFile.size,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      onProgress?.('Single scan Dataset 构建失败，正在回退到大文件摘要解析...');
      largeNetlogResult = await parseLargeNetlogFileInWorker(sourceFile, {
        onProgress,
        onStructuredProgress,
        singleScanDataset: false,
      });
    }
    const { events, result, datasetMeta } = largeNetlogResult;
    return {
      kind: 'netlog',
      result,
      events,
      rawData: undefined,
      rawDataId: undefined,
      largeFileMode: true,
      dataset: datasetMeta
        ? {
            status: 'ready',
            analysisId: datasetMeta.analysisId,
            eventCount: datasetMeta.eventCount,
            parseSkipStats: datasetMeta.parseSkipStats,
            socketLazyParamsStats: datasetMeta.socketLazyParamsStats,
            updatedAt: Date.now(),
          }
        : fallbackNetlogDatasetState,
    };
  }

  if (fileTypeHint !== 'netlog') {
    throw new Error('文件解析器绑定无效');
  }

  if (useWorker) {
    const { events, result, rawData, rawDataId } = await parseNetlogInWorker(
      data,
      { onProgress, onStructuredProgress },
    );
    return { kind: 'netlog', result, events, rawData, rawDataId, dataset: unavailableNetlogDatasetState };
  }

  const netlogData = sourceFile
    ? await readKnownNonTraceText(streamSession ?? sourceFile)
    : data;
  const parsedData = typeof netlogData === 'string'
    ? JSON.parse(netlogData)
    : netlogData;
  const { events, result } = parseLog(parsedData);
  return { kind: 'netlog', result, events, rawData: parsedData, dataset: unavailableNetlogDatasetState };
}
