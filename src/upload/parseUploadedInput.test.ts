import { parseUploadedInput } from './parseUploadedInput';
import { parseLog } from '../parsers/netlog';
import { isHarFile, parseHar } from '../harParser';
import { parseLogFile } from '../logParser';
import {
  parseHarInWorker,
  parseLargeNetlogFileInWorker,
  parseLogInWorker,
  parseNetlogInWorker,
} from '../workers/workerClient';

jest.mock('../parsers/netlog', () => ({
  parseLog: jest.fn(),
}));

jest.mock('../harParser', () => ({
  isHarFile: jest.fn(),
  parseHar: jest.fn(),
}));

jest.mock('../logParser', () => ({
  parseLogFile: jest.fn(),
}));

jest.mock('../workers/workerClient', () => ({
  parseHarInWorker: jest.fn(),
  parseLargeNetlogFileInWorker: jest.fn(),
  parseLogInWorker: jest.fn(),
  parseNetlogInWorker: jest.fn(),
}));

const parseLogMock = parseLog as jest.Mock;
const isHarFileMock = isHarFile as jest.Mock;
const parseHarMock = parseHar as jest.Mock;
const parseLogFileMock = parseLogFile as jest.Mock;
const parseHarInWorkerMock = parseHarInWorker as jest.Mock;
const parseLargeNetlogFileInWorkerMock = parseLargeNetlogFileInWorker as jest.Mock;
const parseLogInWorkerMock = parseLogInWorker as jest.Mock;
const parseNetlogInWorkerMock = parseNetlogInWorker as jest.Mock;

describe('parseUploadedInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isHarFileMock.mockReturnValue(false);
    window.localStorage.clear();
  });

  it('log 文本走 log 分支', async () => {
    const logResult = { stats: { total: 1 } };
    parseLogFileMock.mockReturnValue(logResult);

    const result = await parseUploadedInput({
      data: '[worker] Success GET:https://example.com +10ms',
      isTextLog: true,
      useWorker: false,
    });

    expect(result).toEqual({ kind: 'log', result: logResult });
    expect(parseLogFileMock).toHaveBeenCalled();
  });

  it('fileTypeHint=har 时走 HAR 分支并透传 repairInfo', async () => {
    const repairInfo = { repaired: true, recoveredEntries: 1, totalEntries: 1, droppedEntries: 0, recoveryRate: 1, reason: 'test', warnings: [] };
    const harResult = { totalRequests: 1 };
    parseHarMock.mockReturnValue(harResult);

    const result = await parseUploadedInput({
      data: JSON.stringify({ log: { entries: [] } }),
      fileTypeHint: 'har',
      repairInfo,
      useWorker: false,
    });

    expect(result).toEqual({
      kind: 'har',
      result: { totalRequests: 1, repairInfo },
      rawData: { log: { entries: [] } },
    });
    expect(parseHarMock).toHaveBeenCalledWith({ log: { entries: [] } });
  });

  it('HAR object 走 HAR 分支', async () => {
    const harData = { log: { entries: [] } };
    const harResult = { totalRequests: 0 };
    isHarFileMock.mockReturnValue(true);
    parseHarMock.mockReturnValue(harResult);

    const result = await parseUploadedInput({ data: harData, useWorker: false });

    expect(result).toEqual({ kind: 'har', result: harResult, rawData: harData });
  });

  it('默认 JSON 走 NetLog 分支', async () => {
    const netlogData = { events: [] };
    const netlogResult = { totalEvents: 0 };
    const events: unknown[] = [];
    parseLogMock.mockReturnValue({ events, result: netlogResult });

    const result = await parseUploadedInput({
      data: JSON.stringify(netlogData),
      useWorker: false,
    });

    expect(result).toEqual({
      kind: 'netlog',
      result: netlogResult,
      events,
      rawData: netlogData,
      dataset: { status: 'unavailable' },
    });
    expect(parseLogMock).toHaveBeenCalledWith(netlogData);
  });

  it('useWorker=true 时调用 NetLog worker 并返回 rawDataId', async () => {
    parseNetlogInWorkerMock.mockResolvedValue({
      events: [{ id: 1 }],
      result: { totalEvents: 1 },
      rawData: { events: [] },
      rawDataId: 'netlog-1',
      dataset: { status: 'unavailable' },
    });
    const onProgress = jest.fn();

    const result = await parseUploadedInput({ data: { events: [] }, useWorker: true, onProgress });

    expect(result).toEqual({
      kind: 'netlog',
      events: [{ id: 1 }],
      result: { totalEvents: 1 },
      rawData: { events: [] },
      rawDataId: 'netlog-1',
      dataset: { status: 'unavailable' },
    });
    expect(parseNetlogInWorkerMock).toHaveBeenCalledWith({ events: [] }, { onProgress });
  });

  it('useWorker=true 时调用 HAR worker 并返回 rawDataId', async () => {
    const repairInfo = { repaired: true, recoveredEntries: 1, totalEntries: 1, droppedEntries: 0, recoveryRate: 1, reason: 'test', warnings: [] };
    parseHarInWorkerMock.mockResolvedValue({
      result: { totalRequests: 1 },
      rawData: { log: { entries: [] } },
      rawDataId: 'har-1',
    });

    const result = await parseUploadedInput({
      data: { log: { entries: [] } },
      repairInfo,
      fileTypeHint: 'har',
      useWorker: true,
    });

    expect(result).toEqual({
      kind: 'har',
      result: { totalRequests: 1 },
      rawData: { log: { entries: [] } },
      rawDataId: 'har-1',
    });
    expect(parseHarInWorkerMock).toHaveBeenCalledWith({ log: { entries: [] } }, repairInfo, { onProgress: undefined });
  });

  it('useWorker=true 时调用 Log worker', async () => {
    parseLogInWorkerMock.mockResolvedValue({ result: { stats: { total: 1 } } });

    const result = await parseUploadedInput({
      data: '[worker] Success GET:https://example.com +10ms',
      fileTypeHint: 'log',
      useWorker: true,
    });

    expect(result).toEqual({ kind: 'log', result: { stats: { total: 1 } } });
    expect(parseLogInWorkerMock).toHaveBeenCalled();
  });

  it('大 NetLog File 走流式大文件 worker 且不返回 rawDataId', async () => {
    const file = new File(['{}'], 'large-netlog.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 101 * 1024 * 1024 });
    parseLargeNetlogFileInWorkerMock.mockResolvedValue({
      events: [{ id: 1 }],
      result: { totalEvents: 1, largeFileMode: { enabled: true } },
    });
    const onProgress = jest.fn();

    const result = await parseUploadedInput({
      data: file,
      fileTypeHint: 'netlog',
      useWorker: true,
      onProgress,
    });

    expect(result).toEqual({
      kind: 'netlog',
      events: [{ id: 1 }],
      result: { totalEvents: 1, largeFileMode: { enabled: true } },
      rawData: undefined,
      rawDataId: undefined,
      largeFileMode: true,
      dataset: {
        status: 'fallback',
        error: 'Dataset 模式尚未启用，当前使用大文件摘要 fallback。',
      },
    });
    expect(parseLargeNetlogFileInWorkerMock).toHaveBeenCalledWith(file, { onProgress, singleScanDataset: false });
    expect(parseNetlogInWorkerMock).not.toHaveBeenCalled();
  });

  it('single scan flag 开启时大 NetLog 返回 ready Dataset 状态', async () => {
    const file = new File(['{}'], 'large-netlog.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 101 * 1024 * 1024 });
    window.localStorage.setItem('netlog_single_scan_dataset', '1');
    parseLargeNetlogFileInWorkerMock.mockResolvedValue({
      events: [],
      result: { totalEvents: 1, largeFileMode: { enabled: true } },
      datasetMeta: {
        analysisId: 'netlog-dataset-1',
        fileName: 'large-netlog.json',
        fileSize: 101 * 1024 * 1024,
        fileType: 'application/json',
        importedAt: 1,
        status: 'ready',
        eventCount: 123,
      },
    });
    const onProgress = jest.fn();

    const result = await parseUploadedInput({
      data: file,
      fileTypeHint: 'netlog',
      useWorker: true,
      onProgress,
    });

    expect(result).toEqual({
      kind: 'netlog',
      events: [],
      result: { totalEvents: 1, largeFileMode: { enabled: true } },
      rawData: undefined,
      rawDataId: undefined,
      largeFileMode: true,
      dataset: {
        status: 'ready',
        analysisId: 'netlog-dataset-1',
        eventCount: 123,
        updatedAt: expect.any(Number),
      },
    });
    expect(parseLargeNetlogFileInWorkerMock).toHaveBeenCalledWith(file, { onProgress, singleScanDataset: true });
    expect(parseNetlogInWorkerMock).not.toHaveBeenCalled();
  });
});
