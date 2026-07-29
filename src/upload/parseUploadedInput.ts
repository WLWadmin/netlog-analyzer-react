import { parseLog, type AnalysisResult, type ParsedEvent } from '../parsers/netlog';
import { isHarFile, parseHar, type HarAnalysisResult } from '../harParser';
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
import type { TraceContextResult, TraceTaskProgress } from '../parsers/trace/types';
import { cancelActiveTraceWorkerTask } from '../workers/traceWorkerRegistry';
import { isTraceAnalysisEnabled } from './traceUploadFeature';

const LARGE_NETLOG_STREAM_BYTES = 100 * 1024 * 1024;

function readKnownNonTraceText(file: File): Promise<string> {
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
      result: TraceContextResult;
    };

export async function parseUploadedInput(options: {
  data: unknown;
  isTextLog?: boolean;
  repairInfo?: HarAnalysisResult['repairInfo'];
  fileTypeHint?: UploadFileTypeHint;
  useWorker: boolean;
  onProgress?: (phase: string) => void;
}): Promise<UploadedParseResult> {
  cancelActiveTraceWorkerTask();
  const {
    data,
    isTextLog = false,
    repairInfo,
    fileTypeHint: initialFileTypeHint,
    useWorker,
    onProgress,
  } = options;
  let fileTypeHint = initialFileTypeHint;

  if (fileTypeHint === 'log' || isTextLog) {
    if (typeof data !== 'string') {
      throw new Error('Log 文件内容必须是文本');
    }
    if (useWorker) {
      const { result } = await parseLogInWorker(data, { onProgress });
      return { kind: 'log', result };
    }
    return { kind: 'log', result: parseLogFile(data) };
  }

  if (fileTypeHint === 'trace' || fileTypeHint === 'json-auto') {
    if (!isTraceAnalysisEnabled()) {
      throw new Error('Trace 分析功能尚未启用');
    }
    if (typeof File === 'undefined' || !(data instanceof File)) {
      throw new Error('Trace 上传必须以 File 交给专用 Worker');
    }
    if (!useWorker) {
      throw new Error('当前浏览器不支持 Worker，无法安全解析 Trace');
    }
    const { inspectTraceUploadInWorker } = await import('../workers/traceWorkerClient');
    const task = inspectTraceUploadInWorker(data, {
      hint: fileTypeHint,
      onProgress: (progress: TraceTaskProgress) => onProgress?.(progress.phase),
    });
    const outcome = await task.promise;
    if (outcome.kind === 'trace') {
      return { kind: 'trace', result: outcome.result };
    }
    if (outcome.kind === 'large-json-fallback') {
      fileTypeHint = 'netlog';
    } else {
      if (outcome.encoding !== 'plain-json') {
        throw new Error('当前不支持 gzip 压缩的 HAR 或 NetLog');
      }
      if (outcome.source === 'har') {
        const text = await readKnownNonTraceText(data);
        if (useWorker) {
          const { result, rawData, rawDataId } = await parseHarInWorker(text, repairInfo, { onProgress });
          return { kind: 'har', result, rawData, rawDataId };
        }
        const parsedData: unknown = JSON.parse(text);
        const result = parseHar(parsedData);
        if (repairInfo) result.repairInfo = repairInfo;
        return { kind: 'har', result, rawData: parsedData };
      }
      if (data.size >= LARGE_NETLOG_STREAM_BYTES) {
        fileTypeHint = 'netlog';
      } else {
        const text = await readKnownNonTraceText(data);
        if (useWorker) {
          const { events, result, rawData, rawDataId } = await parseNetlogInWorker(text, { onProgress });
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

  const shouldParseHar = fileTypeHint === 'har' || (typeof data !== 'string' && isHarFile(data));
  if (shouldParseHar) {
    if (useWorker) {
      const { result, rawData, rawDataId } = await parseHarInWorker(data, repairInfo, { onProgress });
      return { kind: 'har', result, rawData, rawDataId };
    }

    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    const result = parseHar(parsedData);
    if (repairInfo) result.repairInfo = repairInfo;
    return { kind: 'har', result, rawData: parsedData };
  }

  if (typeof File !== 'undefined' && data instanceof File && fileTypeHint === 'netlog' && data.size >= LARGE_NETLOG_STREAM_BYTES) {
    if (!useWorker) {
      throw new Error('当前浏览器不支持 Worker，大文件 NetLog 无法安全解析');
    }
    const singleScanDataset = isSingleScanDatasetEnabled();
    console.info('[netlog-large]', {
      event: 'parseUploadedInput:large-netlog',
      fileName: data.name,
      fileSize: data.size,
      useWorker,
      singleScanDataset,
    });
    let largeNetlogResult: Awaited<ReturnType<typeof parseLargeNetlogFileInWorker>>;
    try {
      largeNetlogResult = await parseLargeNetlogFileInWorker(data, {
        onProgress,
        singleScanDataset,
      });
    } catch (error) {
      if (!singleScanDataset) throw error;
      console.warn('[netlog-large]', {
        event: 'parseUploadedInput:single-scan-fallback',
        fileName: data.name,
        fileSize: data.size,
        error: error instanceof Error ? error.message : String(error),
      });
      onProgress?.('Single scan Dataset 构建失败，正在回退到大文件摘要解析...');
      largeNetlogResult = await parseLargeNetlogFileInWorker(data, {
        onProgress,
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

  if (useWorker) {
    const { events, result, rawData, rawDataId } = await parseNetlogInWorker(data, { onProgress });
    return { kind: 'netlog', result, events, rawData, rawDataId, dataset: unavailableNetlogDatasetState };
  }

  const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  const { events, result } = parseLog(parsedData);
  return { kind: 'netlog', result, events, rawData: parsedData, dataset: unavailableNetlogDatasetState };
}
