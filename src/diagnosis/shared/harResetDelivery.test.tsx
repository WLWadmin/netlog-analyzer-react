import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { diagnoseHar } from '../../harDiagnosis';
import type { HarAnalysisResult } from '../../harParser';
import HarNoviceDiagnosisOverview from '../../components/har/HarNoviceDiagnosisOverview';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { createExecutableFileFormatRegistry, createFileParseInput } from '../../upload/createFileFormatIntake';
import { confirmFileParser, prepareFileFormat } from '../../upload/fileFormatGateway';
import type { UploadedParseResult } from '../../upload/parseUploadedInput';
import { buildFinalDiagnosisSummary, buildHarDiagnosisSummary } from './index';

jest.mock('antd', () => {
  const Collapse = ({ items }: { items?: Array<{ key: string; label: React.ReactNode }> }) => (
    <section>{items?.map(item => <div key={item.key}>{item.label}</div>)}</section>
  );
  return {
    Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
      <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
    ),
    Alert: ({ message, description }: { message?: React.ReactNode; description?: React.ReactNode }) => <div>{message}{description}</div>,
    Collapse,
    message: { warning: jest.fn(), success: jest.fn(), error: jest.fn(), info: jest.fn() },
  };
});

jest.mock('@ant-design/icons', () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

// The expert report is outside this user task; the novice result and navigation stay real.
jest.mock('../../components/har/HarSummaryDiagnosis', () => () => null);

const syntheticUrl = 'https://example.invalid/read-only?token=FAKE_TOKEN_VALUE';

function resetEntry(index: number) {
  return {
    startedDateTime: `2026-10-08T00:00:0${index}.000Z`,
    time: 2000,
    _error: 'net::ERR_CONNECTION_RESET',
    _netError: 'ERR_CONNECTION_RESET',
    request: { method: 'GET', url: syntheticUrl, headers: [] },
    response: { status: 0, statusText: '', headers: [], content: { size: 0 } },
    timings: { blocked: 0, dns: 15, connect: 25, ssl: 10, send: 1, wait: 1959, receive: 0 },
  };
}

function healthyEntry() {
  return {
    startedDateTime: '2026-10-08T00:00:04.000Z',
    time: 100,
    request: { method: 'GET', url: 'https://example.invalid/health', headers: [] },
    response: { status: 200, statusText: 'OK', headers: [], content: { size: 2 } },
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 98, receive: 1 },
  };
}

async function parseLocalHar(entries: object[]): Promise<HarAnalysisResult> {
  const file = new File([JSON.stringify({ log: { version: '1.2', entries } })], 'synthetic-reset.har', { type: 'application/json' });
  const input = await createFileParseInput(file, 'reset-delivery');
  const registry = createExecutableFileFormatRegistry({ useWorker: false, traceEnabled: false });
  const prepared = await prepareFileFormat(input, registry);
  expect(prepared.kind).toBe('auto-ready');
  if (prepared.kind !== 'auto-ready') throw new Error('Expected an unambiguous HAR');
  expect(prepared.parserId).toBe('har@1');
  const parsed = await confirmFileParser<UploadedParseResult>(input, prepared.parserId, registry, {
    taskId: input.taskId,
    isCancelled: () => false,
  });
  expect(parsed.kind).toBe('har');
  if (parsed.kind !== 'har') throw new Error('Expected HAR parser result');
  return parsed.result;
}

const NavigationState = () => {
  const { intent } = useNavigation();
  return <output data-testid="navigation-intent">{JSON.stringify(intent)}</output>;
};

beforeAll(() => {
  Object.defineProperty(global, 'ReadableStream', { configurable: true, value: NodeReadableStream });
  Object.defineProperty(global, 'TextDecoder', { configurable: true, value: NodeTextDecoder });
  Object.defineProperty(global, 'TextEncoder', { configurable: true, value: NodeTextEncoder });
});

describe('HAR connection reset delivery', () => {
  it('takes a local mixed HAR through the real parser, limited conclusion, first action, request navigation and safe handoff', async () => {
    const result = await parseLocalHar([resetEntry(0), resetEntry(1), resetEntry(2), healthyEntry()]);
    expect(result.totalRequests).toBe(4);
    expect(result.failedCount).toBe(3);
    expect(result.entries.slice(0, 3).map(entry => entry.netErrorText)).toEqual([
      'ERR_CONNECTION_RESET', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_RESET',
    ]);

    const summary = buildFinalDiagnosisSummary(buildHarDiagnosisSummary(result, diagnoseHar(result)), 'har');
    expect(summary.headline[0]).toMatchObject({ kind: 'symptom-only', category: 'connect' });
    expect(summary.headline[0].title).toContain('3 个请求连接被重置');
    expect(summary.headline[0].title).not.toMatch(/耗时较长|服务端|代理|防火墙/);
    expect(summary.headline[0].problem).toContain('不能确认哪一方重置连接');
    expect(summary.headline[0].keyEvidence.some(evidence => evidence.requestIds?.some(id => id < 3))).toBe(true);
    expect(summary.actionPlan.find(group => group.role === 'user')?.actions[0]?.title).toBe('切换网络对比连接');

    const onOpenRequests = jest.fn();
    const previousClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    try {
      render(
        <NavigationProvider>
          <HarNoviceDiagnosisOverview result={result} onOpenRequests={onOpenRequests} />
          <NavigationState />
        </NavigationProvider>
      );
      expect(screen.getByRole('heading', { name: /3 个请求连接被重置/ })).toBeInTheDocument();
      expect(screen.getByText(/不能确认哪一方重置连接/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: '切换网络对比连接' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '查看关联请求' }));
      expect(onOpenRequests).toHaveBeenCalledTimes(1);
      expect(JSON.parse(screen.getByTestId('navigation-intent').textContent || '{}')).toMatchObject({
        tab: 'requests',
        fileType: 'har',
        filters: { requestIds: [0, 1, 2] },
        highlight: { requestIds: [0, 1, 2] },
        scrollTo: { type: 'request', id: 0 },
      });
      fireEvent.click(screen.getByRole('button', { name: '复制给 IT / 客服' }));
      const handoff = screen.getByLabelText('手动选择以下全文复制') as HTMLTextAreaElement;
      expect(handoff.value).toContain('ERR_CONNECTION_RESET');
      expect(handoff.value).toContain('不能确认哪一方重置连接');
      expect(handoff.value).toContain('切换网络对比连接');
      expect(handoff.value).toContain('请求引用 ID：0、1、2');
      expect(handoff.value).not.toContain('FAKE_TOKEN_VALUE');
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: previousClipboard });
    }
  });

  it('keeps one reset as a request phenomenon without claiming a resetter', async () => {
    const result = await parseLocalHar([resetEntry(0)]);
    const summary = buildFinalDiagnosisSummary(buildHarDiagnosisSummary(result, diagnoseHar(result)), 'har');
    expect(summary.headline[0]).toMatchObject({ kind: 'symptom-only', category: 'connect' });
    expect(summary.headline[0].title).toContain('1 个请求连接被重置');
    expect(summary.expertCards.some(card => card.limitations?.some(text => text.includes('需补充 NetLog')))).toBe(true);
  });

  it('does not turn status=0 without an error field into connection reset', async () => {
    const { _error, _netError, ...entryWithoutError } = resetEntry(0);
    const result = await parseLocalHar([entryWithoutError]);
    const summary = buildFinalDiagnosisSummary(buildHarDiagnosisSummary(result, diagnoseHar(result)), 'har');
    expect(summary.headline[0]?.title || '').not.toContain('连接被重置');
    expect(summary.expertCards.some(card => card.category === 'connect')).toBe(false);
  });

  it('does not invent an abnormal reset for a healthy capture', async () => {
    const result = await parseLocalHar([healthyEntry()]);
    const summary = buildFinalDiagnosisSummary(buildHarDiagnosisSummary(result, diagnoseHar(result)), 'har');
    expect(result.failedCount).toBe(0);
    expect(summary.headline.some(item => item.title.includes('连接被重置'))).toBe(false);
  });

  it('routes an empty or malformed HAR to format recovery rather than a false diagnosis', async () => {
    const registry = createExecutableFileFormatRegistry({ useWorker: false, traceEnabled: false });
    const emptyInput = await createFileParseInput(new File(['{"log":{"entries":[]}}'], 'empty.har'), 'empty-har');
    const preparedEmpty = await prepareFileFormat(emptyInput, registry);
    expect(preparedEmpty).toMatchObject({ kind: 'auto-ready', parserId: 'har@1' });
    const emptyResult = await confirmFileParser<UploadedParseResult>(emptyInput, 'har@1', registry, {
      taskId: emptyInput.taskId,
      isCancelled: () => false,
    });
    expect(emptyResult).toMatchObject({ kind: 'har', result: { totalRequests: 0 } });
    const damagedInput = await createFileParseInput(new File(['{"log":'], 'damaged.har'), 'damaged-har');
    expect((await prepareFileFormat(damagedInput, registry)).kind).toBe('awaiting-confirmation');
  });
});
