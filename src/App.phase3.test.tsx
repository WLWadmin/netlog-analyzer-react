import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { parseUploadedInput } from './upload/parseUploadedInput';
import { importNetlogDatasetInWorker, isWorkerSupported, largeNetlogTimeout, releaseNetlogDatasetInWorker, releaseRawDataInWorker } from './workers/workerClient';
import { exportReport } from './parsers/netlog';
import { message } from 'antd';
import { cancelActiveTraceWorkerTask } from './workers/traceWorkerRegistry';

jest.mock('antd', () => {
  const React = require('react');
  const Layout = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Layout.Header = ({ children }: { children: React.ReactNode }) => <header>{children}</header>;
  Layout.Content = ({ children }: { children: React.ReactNode }) => <main>{children}</main>;
  return {
    Layout,
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    Dropdown: ({ children, menu }: { children: React.ReactNode; menu?: { items?: Array<{ key: string; label: string; onClick?: () => void }> } }) => (
      <>
        {children}
        {menu?.items?.map(item => (
          <button key={item.key} onClick={item.onClick}>{item.label}</button>
        ))}
      </>
    ),
    FloatButton: () => null,
    message: {
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock('@ant-design/icons', () => {
  const React = require('react');
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

jest.mock('./upload/parseUploadedInput', () => ({
  parseUploadedInput: jest.fn(),
}));

jest.mock('./upload/createFileFormatIntake', () => {
  const { FileFormatRegistry } = require('./upload/fileFormatRegistry');
  const parserIds = [
    'har@1',
    'chromium-netlog@1',
    'chromium-performance-trace@1',
    'go-service-log@1',
  ];
  return {
    createFileParseInput: async (file: File, taskId: string) => {
      const parserId = file.name.endsWith('.har')
        ? 'har@1'
        : file.name.endsWith('.log')
          ? 'go-service-log@1'
          : file.name.endsWith('.trace')
            ? 'chromium-performance-trace@1'
            : 'chromium-netlog@1';
      return {
        taskId,
        fileName: file.name,
        container: 'plain',
        value: { parserId },
        payload: file,
      };
    },
    createExecutableFileFormatRegistry: () => new FileFormatRegistry(
      parserIds.map((parserId: string) => ({
        parserId,
        sourceKind: 'netlog',
        family: 'network',
        extensions: [],
        probe: async (input: { value: { parserId: string } }) => ({
          kind: input.value.parserId === parserId ? 'definite-match' : 'no-match',
          parserId,
          evidenceCodes: [],
        }),
        validate: async () => ({ ok: true, evidenceCodes: [] }),
        parse: async (input: { payload: unknown }) => {
          const { parseUploadedInput } = require('./upload/parseUploadedInput');
          return parseUploadedInput({
            data: input.payload,
            fileTypeHint: parserId === 'har@1'
              ? 'har'
              : parserId === 'go-service-log@1'
                ? 'log'
                : parserId === 'chromium-performance-trace@1'
                  ? 'trace'
                  : 'netlog',
          });
        },
      })),
    ),
  };
});

jest.mock('./upload/useAnalysisIntake', () => ({
  useAnalysisIntake: ({
    onResult,
  }: {
    onResult: (result: unknown, parserId: string) => Promise<void>;
  }) => {
    const React = require('react');
    const [state, setState] = React.useState({ status: 'idle' });
    const taskRef = React.useRef(0);
    return {
      state,
      begin: () => setState({ status: 'probing' }),
      reportProgress: jest.fn(),
      prepare: async (input: {
        value: { parserId: string };
        payload: unknown;
      }) => {
        const task = ++taskRef.current;
        try {
          const { parseUploadedInput } = require('./upload/parseUploadedInput');
          const result = await parseUploadedInput({
            data: input.payload,
            fileTypeHint: input.value.parserId === 'har@1'
              ? 'har'
              : input.value.parserId === 'go-service-log@1'
                ? 'log'
                : input.value.parserId === 'chromium-performance-trace@1'
                  ? 'trace'
                  : 'netlog',
            onProgress: jest.fn(),
          });
          if (task !== taskRef.current) return;
          await onResult(result, input.value.parserId);
          if (task !== taskRef.current) return;
          setState({ status: 'completed' });
        } catch (error) {
          if (task !== taskRef.current) return;
          setState({
            status: 'failed',
            message: error instanceof Error
              ? error.message
              : error
                && typeof error === 'object'
                && 'message' in error
                ? String(error.message)
                : String(error),
          });
        }
      },
      confirm: jest.fn(),
      cancel: () => {
        taskRef.current += 1;
        setState({ status: 'idle' });
      },
      fail: (_taskId: string, message: string) => setState({
        status: 'failed',
        message,
      }),
    };
  },
}));

jest.mock('./parsers/netlog', () => ({
  exportReport: jest.fn(() => '# mock report'),
}));

jest.mock('./workers/workerClient', () => ({
  importNetlogDatasetInWorker: jest.fn(),
  isWorkerSupported: jest.fn(() => false),
  largeNetlogTimeout: jest.fn(() => 180_000),
  releaseNetlogDatasetInWorker: jest.fn(),
  releaseRawDataInWorker: jest.fn(),
}));

jest.mock('./workers/traceWorkerRegistry', () => ({
  cancelActiveTraceWorkerTask: jest.fn(),
}));

jest.mock('./components/netlog/UploadZone', () => ({
  __esModule: true,
  default: ({ onFileLoaded, compact }: { onFileLoaded: (data: unknown, isTextLog?: boolean, repairInfo?: unknown, fileTypeHint?: 'netlog' | 'har' | 'log' | 'trace' | 'json-auto') => void; compact?: boolean }) => (
    <div>
      <button onClick={() => onFileLoaded({ events: [] }, false, undefined, 'netlog')}>{compact ? '追加 NetLog' : '上传 NetLog'}</button>
      <button onClick={() => onFileLoaded(new File(['{"events":[]}'], 'large-netlog.json', { type: 'application/json' }), false, undefined, 'netlog')}>上传大 NetLog 文件</button>
      <button onClick={() => onFileLoaded({ log: { entries: [] } }, false, undefined, 'har')}>{compact ? '追加 HAR' : '上传 HAR'}</button>
      <button onClick={() => onFileLoaded('[worker] Success GET:https://example.com +10ms', true, undefined, 'log')}>上传 Log</button>
      <button onClick={() => onFileLoaded(new File(['{}'], 'sample.trace'), false, undefined, 'trace')}>{compact ? '追加 Trace' : '上传 Trace'}</button>
    </div>
  ),
}));

jest.mock('./components/upload/UploadEntry', () => ({
  __esModule: true,
  default: ({
    state,
    onFilesSelected,
    onConfirm,
  }: {
    state: {
      status: string;
      resolution?: {
        kind: string;
        candidate?: { parserId: string };
        candidates?: Array<{ parserId: string }>;
      };
    };
    onFilesSelected: (files: File[]) => void;
    onConfirm: (parserId: string) => void;
  }) => {
    const React = require('react');
    React.useEffect(() => {
      if (state.status !== 'awaiting-confirmation' || !state.resolution) return;
      const parserId = state.resolution.kind === 'recommended'
        ? state.resolution.candidate?.parserId
        : state.resolution.candidates?.[0]?.parserId;
      if (parserId) onConfirm(parserId);
    }, [state, onConfirm]);
    return (
      <section>
        <h1>导入诊断文件</h1>
        <span>文件不会上传服务器</span>
        {state.status === 'failed' ? (
          <div role="alert">{(state as { message?: string }).message}</div>
        ) : null}
        <button onClick={() => onFilesSelected([new File(['{}'], 'sample.json')])}>上传 NetLog</button>
        <button onClick={() => onFilesSelected([new File(['{}'], 'large-netlog.json')])}>上传大 NetLog 文件</button>
        <button onClick={() => onFilesSelected([new File(['{}'], 'sample.har')])}>上传 HAR</button>
        <button onClick={() => onFilesSelected([new File(['log'], 'sample.log')])}>上传 Log</button>
        <button onClick={() => onFilesSelected([new File(['{}'], 'sample.trace')])}>上传 Trace</button>
      </section>
    );
  },
}));

jest.mock('./components/netlog/SummaryCards', () => ({ __esModule: true, default: () => <div>SummaryCards</div> }));
jest.mock('./components/netlog/NetLogRequestList', () => ({ __esModule: true, default: () => <div>NetLogRequestList</div> }));
jest.mock('./components/netlog/ConclusionActionTab', () => ({
  __esModule: true,
  default: ({ onUploadMissingFile, onNavigate }: { onUploadMissingFile?: (data: unknown, isTextLog?: boolean, repairInfo?: unknown, fileTypeHint?: 'netlog' | 'har' | 'log') => void; onNavigate?: (tab: string, subTab?: string) => void }) => (
    <div>
      <span>ConclusionActionTab</span>
      <button onClick={() => onUploadMissingFile?.({ log: { entries: [] } }, false, undefined, 'har')}>从结论追加 HAR</button>
      <button onClick={() => onUploadMissingFile?.({ events: [] }, false, undefined, 'netlog')}>从结论追加 NetLog</button>
      <button onClick={() => onNavigate?.('evidence')}>切到证据链</button>
    </div>
  ),
}));
jest.mock('./components/netlog/EvidenceChainTab', () => ({
  __esModule: true,
  default: ({ onLookupConclusionsChange }: { onLookupConclusionsChange?: (conclusions: unknown[]) => void }) => {
    const React = require('react');
    React.useEffect(() => {
      onLookupConclusionsChange?.([
        {
          level: 'info',
          title: '客户端出口线索与服务端目标运营商不同',
          detail: 'CIP 侧运营商为中国移动，SIP 侧运营商为中国电信。',
          evidence: ['CIP：中国移动：183.205.137.81', 'SIP：中国电信：171.8.194.33'],
          nextAction: '结合同运营商线路验证。',
        },
      ]);
    }, [onLookupConclusionsChange]);
    return <div>EvidenceChainTab</div>;
  },
}));
jest.mock('./components/netlog/ExpertAnalysisTab', () => ({ __esModule: true, default: () => <div>ExpertAnalysisTab</div> }));
jest.mock('./components/netlog/NetlogWorkbenchNav', () => ({ __esModule: true, default: () => <div>NetlogWorkbenchNav</div> }));
jest.mock('./components/shared/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('./components/shared/AnalysisDisclaimer', () => ({ AnalysisDisclaimer: () => <div>AnalysisDisclaimer</div> }));
jest.mock('./components/shared/LoadingOverlay', () => ({ LoadingOverlay: () => null }));
jest.mock('./components/har/HarResultPage', () => ({ __esModule: true, default: () => <div>HarResultPage</div> }));
jest.mock('./components/log/LogResultPage', () => ({ __esModule: true, default: () => <div>LogResultPage</div> }));
jest.mock('./components/trace/TraceResultPage', () => ({ __esModule: true, default: () => <div>TraceResultPage</div> }));
jest.mock('./components/raw/RawEvidenceExplorer', () => ({ __esModule: true, default: () => <div>RawEvidenceExplorer</div> }));

const parseUploadedInputMock = parseUploadedInput as jest.Mock;
const isWorkerSupportedMock = isWorkerSupported as jest.Mock;
const largeNetlogTimeoutMock = largeNetlogTimeout as jest.Mock;
const importNetlogDatasetInWorkerMock = importNetlogDatasetInWorker as jest.Mock;
const releaseNetlogDatasetInWorkerMock = releaseNetlogDatasetInWorker as jest.Mock;
const releaseRawDataInWorkerMock = releaseRawDataInWorker as jest.Mock;
const exportReportMock = exportReport as jest.Mock;
const cancelActiveTraceWorkerTaskMock = cancelActiveTraceWorkerTask as jest.Mock;

describe('App Phase 3 upload behavior', () => {
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    window.location.hash = '';
    parseUploadedInputMock.mockReset();
    isWorkerSupportedMock.mockReturnValue(false);
    largeNetlogTimeoutMock.mockClear();
    largeNetlogTimeoutMock.mockReturnValue(180_000);
    releaseRawDataInWorkerMock.mockClear();
    releaseRawDataInWorkerMock.mockResolvedValue({ released: true });
    importNetlogDatasetInWorkerMock.mockClear();
    importNetlogDatasetInWorkerMock.mockResolvedValue({ analysisId: 'dataset-1', eventCount: 1 });
    releaseNetlogDatasetInWorkerMock.mockClear();
    releaseNetlogDatasetInWorkerMock.mockResolvedValue({ released: true });
    exportReportMock.mockClear();
    exportReportMock.mockReturnValue('# mock report');
    cancelActiveTraceWorkerTaskMock.mockClear();
    URL.createObjectURL = jest.fn(() => 'blob:mock');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
  });

  it('NetLog 首次上传后进入结论入口', async () => {
    parseUploadedInputMock.mockResolvedValue({
      kind: 'netlog',
      events: [{ id: 1 }],
      result: {
        totalEvents: 1,
        uniqueSources: 1,
        peakConcurrency: 1,
        urlRequests: [],
        errors: [],
        warnings: [],
        info: [],
        slowRequests: [],
      },
      rawData: { events: [] },
      rawDataId: 'netlog-1',
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传 NetLog'));

    await waitFor(() => expect(window.location.hash).toBe('#netlog/conclusion'));
    expect(screen.getByText('ConclusionActionTab')).not.toBeNull();
  });

  it('首页展示本地诊断控制台与唯一共享上传入口', () => {
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '1';
    render(<App />);

    expect(screen.getByText('导入诊断文件')).not.toBeNull();
    expect(screen.getByText('文件不会上传服务器')).not.toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getAllByText('上传 NetLog')).toHaveLength(1);
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
  });

  it('HAR 首次上传后进入请求入口', async () => {
    parseUploadedInputMock.mockResolvedValue({
      kind: 'har',
      result: { totalRequests: 1, entries: [] },
      rawData: { log: { entries: [] } },
      rawDataId: 'har-1',
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传 HAR'));

    await waitFor(() => expect(window.location.hash).toBe('#har/summary'));
  });

  it('Log 首次上传后进入概览入口', async () => {
    parseUploadedInputMock.mockResolvedValue({
      kind: 'log',
      result: { stats: { total: 1 }, entries: [], groups: [], insight: {} },
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传 Log'));

    await waitFor(() => expect(window.location.hash).toBe('#log/overview'));
  });

  it('Trace 首次上传进入独立 Trace 结果页', async () => {
    parseUploadedInputMock.mockResolvedValue({
      kind: 'trace',
      result: {
        format: 'chromium-trace-object',
        encoding: 'plain-json',
        jsonBytes: 20,
        eventCount: 1,
        availableFamilies: [],
        warnings: [],
      },
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传 Trace'));

    await waitFor(() => expect(window.location.hash).toBe('#trace/overview'));
    await waitFor(() => expect(screen.getByText('TraceResultPage')).not.toBeNull());
    expect(screen.queryByText('ConclusionActionTab')).toBeNull();
  });

  it('不再展示会自动切换数据源的问题场景', () => {
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '1';
    render(<App />);

    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/已切换到页面性能分析/)).toBeNull();
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
  });

  it('Trace 功能关闭时留在上传页并显示能力未开放提示', async () => {
    parseUploadedInputMock.mockRejectedValue({
      name: 'TraceWorkerError',
      message: '检测到 Chromium Performance Trace，当前版本尚未开放性能分析。',
      detail: { code: 'TRACE_FEATURE_DISABLED' },
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传 Trace'));

    await waitFor(() => expect(
      screen.getByRole('alert').textContent,
    ).toContain('检测到 Chromium Performance Trace，当前版本尚未开放性能分析。'));
    expect(window.location.hash).toBe('');
    expect(screen.queryByText('ConclusionActionTab')).toBeNull();
  });

  it('StrictMode effect 预清理后 Trace 结果仍能正常 settle', async () => {
    parseUploadedInputMock.mockResolvedValue({
      kind: 'trace',
      result: {
        format: 'chromium-trace-object',
        encoding: 'plain-json',
        jsonBytes: 20,
        eventCount: 1,
        availableFamilies: [],
        warnings: [],
      },
    });

    render(<React.StrictMode><App /></React.StrictMode>);
    await userEvent.click(screen.getByText('上传 Trace'));

    await waitFor(() => expect(window.location.hash).toBe('#trace/overview'));
  });

  it('追加 Trace 明确提示不参与 HAR/NetLog 联合诊断', async () => {
    parseUploadedInputMock
      .mockResolvedValueOnce({
        kind: 'har',
        result: { totalRequests: 1, entries: [] },
      })
      .mockResolvedValueOnce({
        kind: 'trace',
        result: {
          format: 'chromium-trace-object',
          encoding: 'plain-json',
          jsonBytes: 20,
          eventCount: 1,
          availableFamilies: [],
          warnings: [],
        },
      });

    render(<App />);
    await userEvent.click(screen.getByText('上传 HAR'));
    await waitFor(() => expect(window.location.hash).toBe('#har/summary'));
    await userEvent.click(screen.getByText('追加 Trace'));

    await waitFor(() => expect(message.warning).toHaveBeenCalledWith(
      'Trace 当前不参与 HAR/NetLog 联合诊断',
    ));
    expect(window.location.hash).toBe('#har/summary');
  });

  it('Trace 取消是正常控制流且不显示解析失败', async () => {
    parseUploadedInputMock.mockRejectedValue({
      detail: { code: 'TRACE_CANCELLED' },
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传 Trace'));

    await waitFor(() => expect(parseUploadedInputMock).toHaveBeenCalled());
    expect(message.error).not.toHaveBeenCalled();
  });

  it('新上传使旧 Trace 的 progress、success 和 error 全部失效', async () => {
    let resolveTrace!: (value: unknown) => void;
    let traceProgress!: (phase: string) => void;
    parseUploadedInputMock
      .mockImplementationOnce((options: { onProgress?: (phase: string) => void }) => {
        traceProgress = options.onProgress!;
        return new Promise(resolve => {
          resolveTrace = resolve;
        });
      })
      .mockResolvedValueOnce({
        kind: 'har',
        result: { totalRequests: 1, entries: [] },
      });

    render(<App />);
    await userEvent.click(screen.getByText('上传 Trace'));
    await userEvent.click(screen.getByText('上传 HAR'));
    await waitFor(() => expect(window.location.hash).toBe('#har/summary'));

    traceProgress('旧 Trace 进度');
    resolveTrace({
      kind: 'trace',
      result: {
        format: 'chromium-trace-object',
        encoding: 'plain-json',
        jsonBytes: 20,
        eventCount: 1,
        availableFamilies: [],
        warnings: [],
      },
    });
    await Promise.resolve();

    expect(window.location.hash).toBe('#har/summary');
    expect(screen.queryByText('TraceResultPage')).toBeNull();
  });

  it('reset 和 unmount 都取消活动 Trace Worker', async () => {
    parseUploadedInputMock
      .mockResolvedValueOnce({
        kind: 'har',
        result: { totalRequests: 1, entries: [] },
      })
      .mockImplementationOnce(() => new Promise(() => undefined));

    const view = render(<App />);
    await userEvent.click(screen.getByText('上传 HAR'));
    await waitFor(() => expect(window.location.hash).toBe('#har/summary'));
    await userEvent.click(screen.getByText('追加 Trace'));
    await userEvent.click(screen.getByText('重新上传'));
    expect(cancelActiveTraceWorkerTaskMock).toHaveBeenCalled();

    cancelActiveTraceWorkerTaskMock.mockClear();
    view.unmount();
    expect(cancelActiveTraceWorkerTaskMock).toHaveBeenCalledTimes(1);
  });

  it('先 NetLog 后追加 HAR，仍停留 NetLog 结论入口', async () => {
    parseUploadedInputMock
      .mockResolvedValueOnce({
        kind: 'netlog',
        events: [{ id: 1 }],
        result: {
          totalEvents: 1,
          uniqueSources: 1,
          peakConcurrency: 1,
          urlRequests: [],
          errors: [],
          warnings: [],
          info: [],
          slowRequests: [],
        },
        rawData: { events: [] },
        rawDataId: 'netlog-1',
      })
      .mockResolvedValueOnce({
        kind: 'har',
        result: { totalRequests: 1, entries: [] },
        rawData: { log: { entries: [] } },
        rawDataId: 'har-1',
      });

    render(<App />);
    await userEvent.click(screen.getByText('上传 NetLog'));
    await waitFor(() => expect(window.location.hash).toBe('#netlog/conclusion'));
    await userEvent.click(screen.getByText('从结论追加 HAR'));

    await waitFor(() => expect(window.location.hash).toBe('#netlog/conclusion'));
  });

  it('先 HAR 后追加 NetLog，切到 NetLog 结论入口', async () => {
    parseUploadedInputMock
      .mockResolvedValueOnce({
        kind: 'har',
        result: { totalRequests: 1, entries: [] },
        rawData: { log: { entries: [] } },
        rawDataId: 'har-1',
      })
      .mockResolvedValueOnce({
        kind: 'netlog',
        events: [{ id: 1 }],
        result: {
          totalEvents: 1,
          uniqueSources: 1,
          peakConcurrency: 1,
          urlRequests: [],
          errors: [],
          warnings: [],
          info: [],
          slowRequests: [],
        },
        rawData: { events: [] },
        rawDataId: 'netlog-1',
      });

    render(<App />);
    await userEvent.click(screen.getByText('上传 HAR'));
    await waitFor(() => expect(window.location.hash).toBe('#har/summary'));
    await userEvent.click(screen.getByText('追加 NetLog'));

    await waitFor(() => expect(window.location.hash).toBe('#netlog/conclusion'));
  });

  it('worker supported 时替换同类型 NetLog 会释放旧 rawDataId', async () => {
    isWorkerSupportedMock.mockReturnValue(true);
    parseUploadedInputMock
      .mockResolvedValueOnce({
        kind: 'netlog',
        events: [{ id: 1 }],
        result: {
          totalEvents: 1,
          uniqueSources: 1,
          peakConcurrency: 1,
          urlRequests: [],
          errors: [],
          warnings: [],
          info: [],
          slowRequests: [],
        },
        rawData: { events: [] },
        rawDataId: 'netlog-old',
      })
      .mockResolvedValueOnce({
        kind: 'netlog',
        events: [{ id: 2 }],
        result: {
          totalEvents: 1,
          uniqueSources: 1,
          peakConcurrency: 1,
          urlRequests: [],
          errors: [],
          warnings: [],
          info: [],
          slowRequests: [],
        },
        rawData: { events: [] },
        rawDataId: 'netlog-new',
      });

    render(<App />);
    await userEvent.click(screen.getByText('上传 NetLog'));
    await waitFor(() => expect(window.location.hash).toBe('#netlog/conclusion'));
    await userEvent.click(screen.getByText('从结论追加 NetLog'));

    await waitFor(() => expect(releaseRawDataInWorkerMock).toHaveBeenCalledWith({ rawDataId: 'netlog-old' }));
  });

  it('worker supported 且大文件 fallback 时会后台启动 Dataset 索引', async () => {
    isWorkerSupportedMock.mockReturnValue(true);
    parseUploadedInputMock.mockResolvedValue({
      kind: 'netlog',
      events: [],
      result: {
        totalEvents: 100000,
        uniqueSources: 1,
        peakConcurrency: 1,
        largeFileMode: {
          enabled: true,
          fileSize: 326_930_225,
          bytesRead: 326_930_225,
          parsedEvents: 123,
          skippedEvents: 0,
          truncatedEventsPreview: true,
          reachedEventsEnd: true,
        },
        urlRequests: [],
        errors: [],
        warnings: [],
        info: [],
        slowRequests: [],
      },
      rawData: undefined,
      rawDataId: undefined,
      dataset: {
        status: 'fallback',
        error: 'Dataset 模式尚未启用，当前使用大文件摘要 fallback。',
      },
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传大 NetLog 文件'));

    await waitFor(() => expect(importNetlogDatasetInWorkerMock).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ onProgress: expect.any(Function), timeout: 180_000 })
    ));
    await waitFor(() => expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[netlog-upload-flow]',
      expect.objectContaining({ event: 'upload-flow:dataset-ready', datasetEventCount: 1 })
    ));
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[netlog-upload-flow]',
      expect.objectContaining({ event: 'upload-flow:upload-start' })
    );
    expect(consoleInfoSpy.mock.calls.flat().join(' ')).not.toContain('large-netlog.json');
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[netlog-upload-flow]',
      expect.objectContaining({ event: 'upload-flow:summary-ready', eventsPreview: 0 })
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[netlog-upload-flow]',
      expect.objectContaining({ event: 'upload-flow:dataset-auto-start', datasetStatus: 'importing' })
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[netlog-upload-flow]',
      expect.objectContaining({ event: 'upload-flow:dataset-takeover', activeExpertViews: expect.arrayContaining(['events', 'data-loaded', 'dns', 'proxy', 'quic', 'http2', 'sockets', 'endpoint-evidence']) })
    );
    expect(largeNetlogTimeoutMock).toHaveBeenCalledWith(expect.any(Number));
  });

  it('大文件 single scan 已返回 ready Dataset 时不再后台二次索引', async () => {
    isWorkerSupportedMock.mockReturnValue(true);
    parseUploadedInputMock.mockResolvedValue({
      kind: 'netlog',
      events: [],
      result: {
        totalEvents: 123,
        uniqueSources: 1,
        peakConcurrency: 1,
        largeFileMode: {
          enabled: true,
          fileSize: 326_930_225,
          bytesRead: 326_930_225,
          parsedEvents: 123,
          skippedEvents: 0,
          truncatedEventsPreview: true,
          reachedEventsEnd: true,
        },
        urlRequests: [],
        errors: [],
        warnings: [],
        info: [],
        slowRequests: [],
      },
      rawData: undefined,
      rawDataId: undefined,
      dataset: {
        status: 'ready',
        analysisId: 'netlog-dataset-single-scan',
        eventCount: 123,
        updatedAt: Date.now(),
      },
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传大 NetLog 文件'));

    await waitFor(() => expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[netlog-upload-flow]',
      expect.objectContaining({
        event: 'upload-flow:dataset-ready',
        analysisId: 'netlog-dataset-single-scan',
        datasetEventCount: 123,
        singleScanDataset: true,
      })
    ));
    expect(importNetlogDatasetInWorkerMock).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalledWith(
      '[netlog-upload-flow]',
      expect.objectContaining({ event: 'upload-flow:dataset-auto-start' })
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[netlog-upload-flow]',
      expect.objectContaining({
        event: 'upload-flow:dataset-takeover',
        analysisId: 'netlog-dataset-single-scan',
        singleScanDataset: true,
      })
    );
  });

  it('worker supported 时重置会释放全部 rawData', async () => {
    isWorkerSupportedMock.mockReturnValue(true);
    parseUploadedInputMock.mockResolvedValue({
      kind: 'har',
      result: { totalRequests: 1, entries: [] },
      rawData: { log: { entries: [] } },
      rawDataId: 'har-1',
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传 HAR'));
    await waitFor(() => expect(window.location.hash).toBe('#har/summary'));
    releaseRawDataInWorkerMock.mockClear();
    releaseRawDataInWorkerMock.mockResolvedValue({ released: true });
    await userEvent.click(screen.getByText('重新上传'));

    await waitFor(() => expect(releaseRawDataInWorkerMock).toHaveBeenCalledWith({ all: true }));
    expect(releaseNetlogDatasetInWorkerMock).toHaveBeenCalledWith({ all: true });
  });

  it('导出 Markdown 时会传入当前 IP 查询结论', async () => {
    parseUploadedInputMock.mockResolvedValue({
      kind: 'netlog',
      events: [{ id: 1 }],
      result: {
        totalEvents: 1,
        uniqueSources: 1,
        peakConcurrency: 1,
        urlRequests: [],
        errors: [],
        warnings: [],
        info: [],
        slowRequests: [],
      },
      rawData: { events: [] },
      rawDataId: 'netlog-1',
    });

    render(<App />);
    await userEvent.click(screen.getByText('上传 NetLog'));
    await waitFor(() => expect(window.location.hash).toBe('#netlog/conclusion'));
    await userEvent.click(screen.getByText('切到证据链'));
    await waitFor(() => expect(window.location.hash).toBe('#netlog/evidence'));
    await userEvent.click(screen.getByText('Markdown 报告'));

    expect(exportReportMock).toHaveBeenCalledWith(expect.any(Object), {
      ipRoutingConclusions: [
        expect.objectContaining({
          title: '客户端出口线索与服务端目标运营商不同',
        }),
      ],
    });
  });
});
