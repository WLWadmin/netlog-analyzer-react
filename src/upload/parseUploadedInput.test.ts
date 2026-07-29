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
import { cancelActiveTraceWorkerTask } from '../workers/traceWorkerRegistry';
import type { TraceContextResult } from '../parsers/trace/types';

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

jest.mock('../workers/traceWorkerClient', () => ({
  inspectTraceUploadInWorker: jest.fn(),
}));

jest.mock('../workers/traceWorkerRegistry', () => ({
  cancelActiveTraceWorkerTask: jest.fn(),
}));

const inspectTraceUploadInWorkerMock = jest.requireMock('../workers/traceWorkerClient')
  .inspectTraceUploadInWorker as jest.Mock;

const parseLogMock = parseLog as jest.Mock;
const isHarFileMock = isHarFile as jest.Mock;
const parseHarMock = parseHar as jest.Mock;
const parseLogFileMock = parseLogFile as jest.Mock;
const parseHarInWorkerMock = parseHarInWorker as jest.Mock;
const parseLargeNetlogFileInWorkerMock = parseLargeNetlogFileInWorker as jest.Mock;
const parseLogInWorkerMock = parseLogInWorker as jest.Mock;
const parseNetlogInWorkerMock = parseNetlogInWorker as jest.Mock;
const cancelActiveTraceWorkerTaskMock = cancelActiveTraceWorkerTask as jest.Mock;

describe('parseUploadedInput', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.clearAllMocks();
    isHarFileMock.mockReturnValue(false);
    inspectTraceUploadInWorkerMock.mockReset();
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '1';
    window.localStorage.clear();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
  });

  it('默认关闭 Trace 时普通 JSON 保持现有 NetLog 行为', async () => {
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
    parseNetlogInWorkerMock.mockResolvedValue({
      events: [],
      result: { totalEvents: 0 },
      rawData: { events: [] },
    });

    const result = await parseUploadedInput({
      data: '{"events":[]}',
      fileTypeHint: 'netlog',
      useWorker: true,
    });

    expect(result.kind).toBe('netlog');
    expect(inspectTraceUploadInWorkerMock).not.toHaveBeenCalled();
  });

  it.each([
    ['HAR', 'har', '{"log":{"entries":[]}}'],
    ['NetLog', 'netlog', '{"events":[]}'],
    ['Log', 'log', 'line'],
  ])('开始新的 %s 上传会取消活动 Trace', async (_label, hint, data) => {
    if (hint === 'har') {
      parseHarInWorkerMock.mockResolvedValue({ result: { totalRequests: 0 } });
    } else if (hint === 'netlog') {
      parseNetlogInWorkerMock.mockResolvedValue({ events: [], result: { totalEvents: 0 } });
    } else {
      parseLogInWorkerMock.mockResolvedValue({ result: { stats: { total: 1 } } });
    }

    await parseUploadedInput({
      data,
      fileTypeHint: hint as 'har' | 'netlog' | 'log',
      useWorker: true,
    });

    expect(cancelActiveTraceWorkerTaskMock).toHaveBeenCalledTimes(1);
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

  it('Trace File 通过动态 Worker 客户端返回有限上下文', async () => {
    const contextResult: TraceContextResult = {
      intake: {
        format: 'chromium-trace-object',
        encoding: 'plain-json',
        jsonBytes: 20,
        eventCount: 1,
        availableFamilies: ['main-thread'],
        warnings: [],
      },
      context: {
        processes: [],
        threads: [],
        frames: [],
        navigations: [],
        evidence: [],
        evidenceTotalCount: 0,
        evidenceReturnedCount: 0,
        quality: {
          level: 'insufficient',
          captureWindow: 'missing',
          navigationContext: 'missing',
          processThreadMetadata: 'missing',
          frameHierarchy: 'missing',
          rendererMainThread: 'missing',
          skippedEventCount: 0,
          warnings: [],
          disabledCapabilities: [],
        },
        warnings: [],
      },
    };
    inspectTraceUploadInWorkerMock.mockReturnValue({
      promise: Promise.resolve({ kind: 'trace', result: contextResult }),
      cancel: jest.fn(),
    });
    const file = new File(['{"traceEvents":[{}]}'], 'sample.trace');

    await expect(parseUploadedInput({
      data: file,
      fileTypeHint: 'trace',
      useWorker: true,
    })).resolves.toEqual({ kind: 'trace', result: contextResult });
    expect(inspectTraceUploadInWorkerMock).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ hint: 'trace' }),
    );
    expect(parseNetlogInWorkerMock).not.toHaveBeenCalled();
  });

  it.each([
    ['har', parseHarInWorkerMock],
    ['netlog', parseNetlogInWorkerMock],
  ])('json-auto 将 %s 正常分流回现有解析链', async (source, parserMock) => {
    inspectTraceUploadInWorkerMock.mockReturnValue({
      promise: Promise.resolve({
        kind: 'detected-source',
        source,
        encoding: 'plain-json',
      }),
      cancel: jest.fn(),
    });
    parserMock.mockResolvedValue(source === 'har'
      ? { result: { totalRequests: 0 }, rawData: { log: { entries: [] } } }
      : { result: { totalEvents: 0 }, events: [], rawData: { events: [] } });
    const contents = source === 'har'
      ? '{"log":{"entries":[]}}'
      : '{"events":[]}';

    const result = await parseUploadedInput({
      data: new File([contents], 'sample.json'),
      fileTypeHint: 'json-auto',
      useWorker: true,
    });

    expect(result.kind).toBe(source);
  });

  it('json-auto 识别大 NetLog 后仍走现有大文件 Worker', async () => {
    inspectTraceUploadInWorkerMock.mockReturnValue({
      promise: Promise.resolve({
        kind: 'detected-source',
        source: 'netlog',
        encoding: 'plain-json',
      }),
      cancel: jest.fn(),
    });
    parseLargeNetlogFileInWorkerMock.mockResolvedValue({
      events: [],
      result: { totalEvents: 0, largeFileMode: { enabled: true } },
    });
    const file = new File(['{"events":[]}'], 'large.json');
    Object.defineProperty(file, 'size', { value: 101 * 1024 * 1024 });

    const result = await parseUploadedInput({
      data: file,
      fileTypeHint: 'json-auto',
      useWorker: true,
    });

    expect(result.kind).toBe('netlog');
    expect(parseLargeNetlogFileInWorkerMock).toHaveBeenCalled();
  });

  it('json-auto 大型旧 JSON 候选交给现有大 NetLog parser 最终验证', async () => {
    inspectTraceUploadInWorkerMock.mockReturnValue({
      promise: Promise.resolve({
        kind: 'large-json-fallback',
        candidate: 'netlog',
      }),
      cancel: jest.fn(),
    });
    parseLargeNetlogFileInWorkerMock.mockResolvedValue({
      events: [],
      result: { totalEvents: 0, largeFileMode: { enabled: true } },
    });
    const file = new File(['{}'], 'large.json');
    Object.defineProperty(file, 'size', { value: 500 * 1024 * 1024 });

    await expect(parseUploadedInput({
      data: file,
      fileTypeHint: 'json-auto',
      useWorker: true,
    })).resolves.toEqual(expect.objectContaining({
      kind: 'netlog',
      largeFileMode: true,
    }));
    expect(parseLargeNetlogFileInWorkerMock).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ singleScanDataset: true }),
    );
  });

  it('大 NetLog File 默认走 single scan 大文件 worker 且不返回 rawDataId', async () => {
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
    expect(parseLargeNetlogFileInWorkerMock).toHaveBeenCalledWith(file, { onProgress, singleScanDataset: true });
    expect(parseNetlogInWorkerMock).not.toHaveBeenCalled();
  });

  it('localStorage 显式关闭 single scan 时大 NetLog 回到摘要 fallback 路径', async () => {
    const file = new File(['{}'], 'large-netlog.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 101 * 1024 * 1024 });
    window.localStorage.setItem('netlog_single_scan_dataset', '0');
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

    expect(result.kind).toBe('netlog');
    if (result.kind !== 'netlog') throw new Error('expected netlog result');
    expect(result.dataset).toEqual({
      status: 'fallback',
      error: 'Dataset 模式尚未启用，当前使用大文件摘要 fallback。',
    });
    expect(parseLargeNetlogFileInWorkerMock).toHaveBeenCalledWith(file, { onProgress, singleScanDataset: false });
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

  it('single scan flag 开启但失败时回退到大文件摘要 fallback', async () => {
    const file = new File(['{}'], 'large-netlog.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 101 * 1024 * 1024 });
    window.localStorage.setItem('netlog_single_scan_dataset', '1');
    parseLargeNetlogFileInWorkerMock
      .mockRejectedValueOnce(new Error('single scan failed'))
      .mockResolvedValueOnce({
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
    expect(parseLargeNetlogFileInWorkerMock).toHaveBeenNthCalledWith(1, file, { onProgress, singleScanDataset: true });
    expect(parseLargeNetlogFileInWorkerMock).toHaveBeenNthCalledWith(2, file, { onProgress, singleScanDataset: false });
    expect(onProgress).toHaveBeenCalledWith('Single scan Dataset 构建失败，正在回退到大文件摘要解析...');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[netlog-large]', expect.objectContaining({
      event: 'parseUploadedInput:single-scan-fallback',
      error: 'single scan failed',
    }));
  });
});
