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

const LARGE_NETLOG_STREAM_BYTES = 100 * 1024 * 1024;

export type UploadFileTypeHint = 'netlog' | 'har' | 'log';

function isSingleScanDatasetEnabled(): boolean {
  if (process.env.REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET === '1') return true;
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem('netlog_single_scan_dataset') === '1';
  } catch {
    return false;
  }
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
    };

export async function parseUploadedInput(options: {
  data: unknown;
  isTextLog?: boolean;
  repairInfo?: HarAnalysisResult['repairInfo'];
  fileTypeHint?: UploadFileTypeHint;
  useWorker: boolean;
  onProgress?: (phase: string) => void;
}): Promise<UploadedParseResult> {
  const { data, isTextLog = false, repairInfo, fileTypeHint, useWorker, onProgress } = options;

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
    console.info('[netlog-large]', {
      event: 'parseUploadedInput:large-netlog',
      fileName: data.name,
      fileSize: data.size,
      useWorker,
    });
    const { events, result, datasetMeta } = await parseLargeNetlogFileInWorker(data, {
      onProgress,
      singleScanDataset: isSingleScanDatasetEnabled(),
    });
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
