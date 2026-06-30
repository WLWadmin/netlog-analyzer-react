import { parseLog, type AnalysisResult, type ParsedEvent } from '../parsers/netlog';
import { isHarFile, parseHar, type HarAnalysisResult } from '../harParser';
import { parseLogFile, type LogAnalysisResult } from '../logParser';
import {
  parseHarInWorker,
  parseLogInWorker,
  parseNetlogInWorker,
} from '../workers/workerClient';

export type UploadFileTypeHint = 'netlog' | 'har' | 'log';

export type UploadedParseResult =
  | {
      kind: 'netlog';
      result: AnalysisResult;
      events: ParsedEvent[];
      rawData?: unknown;
      rawDataId?: string;
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

  if (useWorker) {
    const { events, result, rawData, rawDataId } = await parseNetlogInWorker(data, { onProgress });
    return { kind: 'netlog', result, events, rawData, rawDataId };
  }

  const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  const { events, result } = parseLog(parsedData);
  return { kind: 'netlog', result, events, rawData: parsedData };
}
