import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { parseUploadedInput } from './upload/parseUploadedInput';

jest.mock('antd', () => {
  const React = require('react');
  const Layout = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Layout.Header = ({ children }: { children: React.ReactNode }) => <header>{children}</header>;
  Layout.Content = ({ children }: { children: React.ReactNode }) => <main>{children}</main>;
  return {
    Layout,
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    Dropdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

jest.mock('./workers/workerClient', () => ({
  isWorkerSupported: () => false,
  releaseRawDataInWorker: jest.fn(),
}));

jest.mock('./components/netlog/UploadZone', () => ({
  __esModule: true,
  default: ({ onFileLoaded, compact }: { onFileLoaded: (data: unknown, isTextLog?: boolean, repairInfo?: unknown, fileTypeHint?: 'netlog' | 'har' | 'log') => void; compact?: boolean }) => (
    <div>
      <button onClick={() => onFileLoaded({ events: [] }, false, undefined, 'netlog')}>{compact ? '追加 NetLog' : '上传 NetLog'}</button>
      <button onClick={() => onFileLoaded({ log: { entries: [] } }, false, undefined, 'har')}>{compact ? '追加 HAR' : '上传 HAR'}</button>
      <button onClick={() => onFileLoaded('[worker] Success GET:https://example.com +10ms', true, undefined, 'log')}>上传 Log</button>
    </div>
  ),
}));

jest.mock('./components/netlog/SummaryCards', () => ({ __esModule: true, default: () => <div>SummaryCards</div> }));
jest.mock('./components/netlog/NetLogRequestList', () => ({ __esModule: true, default: () => <div>NetLogRequestList</div> }));
jest.mock('./components/netlog/ConclusionActionTab', () => ({
  __esModule: true,
  default: ({ onUploadMissingFile }: { onUploadMissingFile?: (data: unknown, isTextLog?: boolean, repairInfo?: unknown, fileTypeHint?: 'netlog' | 'har' | 'log') => void }) => (
    <div>
      <span>ConclusionActionTab</span>
      <button onClick={() => onUploadMissingFile?.({ log: { entries: [] } }, false, undefined, 'har')}>从结论追加 HAR</button>
      <button onClick={() => onUploadMissingFile?.({ events: [] }, false, undefined, 'netlog')}>从结论追加 NetLog</button>
    </div>
  ),
}));
jest.mock('./components/netlog/EvidenceChainTab', () => ({ __esModule: true, default: () => <div>EvidenceChainTab</div> }));
jest.mock('./components/netlog/ExpertAnalysisTab', () => ({ __esModule: true, default: () => <div>ExpertAnalysisTab</div> }));
jest.mock('./components/netlog/NetlogWorkbenchNav', () => ({ __esModule: true, default: () => <div>NetlogWorkbenchNav</div> }));
jest.mock('./components/shared/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('./components/shared/AnalysisDisclaimer', () => ({ AnalysisDisclaimer: () => <div>AnalysisDisclaimer</div> }));
jest.mock('./components/shared/LoadingOverlay', () => ({ LoadingOverlay: () => null }));
jest.mock('./components/har/HarResultPage', () => ({ __esModule: true, default: () => <div>HarResultPage</div> }));
jest.mock('./components/log/LogResultPage', () => ({ __esModule: true, default: () => <div>LogResultPage</div> }));
jest.mock('./components/raw/RawEvidenceExplorer', () => ({ __esModule: true, default: () => <div>RawEvidenceExplorer</div> }));

const parseUploadedInputMock = parseUploadedInput as jest.Mock;

describe('App Phase 3 upload behavior', () => {
  beforeEach(() => {
    window.location.hash = '';
    parseUploadedInputMock.mockReset();
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

    await waitFor(() => expect(window.location.hash).toBe('#har/requests'));
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
    await waitFor(() => expect(window.location.hash).toBe('#har/requests'));
    await userEvent.click(screen.getByText('追加 NetLog'));

    await waitFor(() => expect(window.location.hash).toBe('#netlog/conclusion'));
  });
});
