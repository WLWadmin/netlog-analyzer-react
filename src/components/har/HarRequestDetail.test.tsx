import React from 'react';
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseHar, type HarRequestEntry } from '../../harParser';
import HarRequestDetail from './HarRequestDetail';
import { loadHarResponseBody } from './harResponseBodyGateway';

jest.mock('./harResponseBodyGateway', () => ({
  loadHarResponseBody: jest.fn(),
}));

jest.mock('antd', () => {
  const React = require('react');
  const Tabs = ({ items }: { items: Array<{ key: string; label: string; children: React.ReactNode }> }) => {
    const [activeKey, setActiveKey] = React.useState(items[0]?.key);
    const { children: activeContent } = items.find(
      item => item.key === activeKey,
    ) ?? {};
    return (
      <div>
        <div role="tablist">
          {items.map(item => (
            <button key={item.key} role="tab" aria-selected={item.key === activeKey} onClick={() => setActiveKey(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <div>{activeContent}</div>
      </div>
    );
  };
  return {
    Tabs,
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    message: { success: jest.fn(), error: jest.fn() },
  };
});

jest.mock('@ant-design/icons', () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

jest.mock('./HarTimingChart', () => ({ __esModule: true, default: () => <div>Timing chart</div> }));

function entry(overrides: Partial<HarRequestEntry> = {}): HarRequestEntry {
  return {
    id: 1,
    name: 'api',
    url: 'https://example.com/api?token=SECRET_QUERY',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '203.0.113.10',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: 'application/json',
    size: 20,
    contentSize: 20,
    time: 120,
    startedDateTime: '2026-07-10T00:00:00.000Z',
    startMs: 1000,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 118, receive: 1 },
    timingAvailability: { blocked: true, dns: false, connect: false, ssl: false, send: true, wait: true, receive: true },
    requestHeaders: [{ name: 'authorization', value: 'Bearer SECRET_AUTH' }],
    responseHeaders: [],
    responseBody: '{"ok":true}',
    responseEncoding: '',
    queryString: [{ name: 'token', value: 'SECRET_QUERY' }],
    requestCookies: [{ name: 'session', value: 'SECRET_COOKIE', httpOnly: true }],
    responseCookies: [],
    initiator: { type: 'script', url: 'https://example.com/app.js?debug=SECRET_QUERY' },
    serverTiming: [],
    xTtLogid: '',
    xTtCip: '',
    xLscSourceIp: '',
    isFailed: false,
    isSlow: false,
    ...overrides,
    standard: overrides.standard ?? parseHar({
      log: {
        entries: [{
          request: { method: 'GET', url: 'https://example.test/', headers: [] },
          response: { status: overrides.status ?? 200, headers: [], content: {} },
          timings: { send: 0, wait: 0, receive: 0 },
        }],
      },
    }).entries[0].standard,
  };
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
});

describe('HarRequestDetail', () => {
  it('provides Response, Initiator and Cookies tabs with explicit cookie reveal', async () => {
    render(<HarRequestDetail entry={entry()} />);

    expect(screen.getByRole('tab', { name: 'Response' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Initiator' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cookies' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Cookies' }));
    expect(screen.queryByText('SECRET_COOKIE')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '显示完整值' }));
    expect(screen.getByText('SECRET_COOKIE')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Initiator' }));
    expect(screen.getByText('https://example.com/app.js')).toBeInTheDocument();
    expect(screen.queryByText('SECRET_QUERY')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Response' }));
    expect(screen.getByText('{"ok":true}')).toBeInTheDocument();
  });

  it('does not let an old deferred body request overwrite the newly selected entry', async () => {
    let resolveOldBody: ((value: any) => void) | undefined;
    (loadHarResponseBody as jest.Mock).mockReturnValueOnce(new Promise(resolve => {
      resolveOldBody = resolve;
    }));
    const oldEntry = entry({
      id: 1,
      responseBody: '',
      mimeType: 'text/plain',
      responseBodyDescriptor: { state: 'deferred', originalLength: 5 * 1024 * 1024, mimeType: 'text/plain' },
    });
    const newEntry = entry({
      id: 2,
      responseBody: 'new-response-body',
      mimeType: 'text/plain',
      responseBodyDescriptor: { state: 'inline', originalLength: 17, mimeType: 'text/plain' },
    });
    const { rerender } = render(<HarRequestDetail entry={oldEntry} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    await userEvent.click(screen.getByRole('button', { name: '加载响应内容' }));
    rerender(<HarRequestDetail entry={newEntry} />);

    await act(async () => {
      resolveOldBody?.({
        state: 'available',
        text: 'old-response-body',
        encoding: '',
        mimeType: 'text/plain',
        originalLength: 17,
      });
      await Promise.resolve();
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Response' }));

    expect(screen.getByText('new-response-body')).toBeInTheDocument();
    expect(screen.queryByText('old-response-body')).not.toBeInTheDocument();
  });

  it('shows request evidence facts with their raw HAR paths', async () => {
    (loadHarResponseBody as jest.Mock).mockResolvedValueOnce({ state: 'missing' });
    const parsed = parseHar({ log: { entries: [{
      request: { method: 'GET', url: 'https://example.test/', headers: [] },
      response: { status: 0, headers: [], content: {} },
      _netError: -105,
      timings: { send: 0, wait: 0, receive: 0 },
    }] } }).entries[0];

    render(<HarRequestDetail entry={parsed} />);
    await act(async () => {
      await Promise.resolve();
    });
    await userEvent.click(screen.getByRole('tab', { name: '诊断' }));

    expect(screen.getByText('HTTP 响应状态')).toBeInTheDocument();
    expect(screen.getByText('$.log.entries[0].response.status')).toBeInTheDocument();
    expect(screen.getByText('$.log.entries[0]._netError')).toBeInTheDocument();
  });

  it('does not present a missing status as status=0', async () => {
    (loadHarResponseBody as jest.Mock).mockResolvedValueOnce({ state: 'missing' });
    const parsed = parseHar({ log: { entries: [{
      request: { method: 'GET', url: 'https://example.test/', headers: [] },
      response: { headers: [], content: {} },
      timings: {},
    }] } }).entries[0];

    render(<HarRequestDetail entry={parsed} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('未记录')).toBeInTheDocument();
    expect(screen.queryByText('失败/未完成')).not.toBeInTheDocument();
    expect(screen.queryByText('status=0 未拿到响应')).not.toBeInTheDocument();
  });

  it('shows every anomaly hint with value, threshold, state, source and supplement', async () => {
    (loadHarResponseBody as jest.Mock).mockResolvedValueOnce({ state: 'missing' });
    const parsed = parseHar({ log: { entries: [{
      request: { method: 'GET', url: 'https://example.test/', headers: [] },
      response: { status: 200, headers: [], content: {} },
      timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: 1100, receive: 100 },
    }] } }).entries[0];

    render(<HarRequestDetail entry={parsed} />);
    await act(async () => {
      await Promise.resolve();
    });
    await userEvent.click(screen.getByRole('tab', { name: '诊断' }));

    expect(screen.getByText('Waiting：超过参考阈值')).toBeInTheDocument();
    expect(screen.getByText(/实际值：1100 ms · 参考阈值：800 ms · 证据等级：异常提示/)).toBeInTheDocument();
    expect(screen.getByText('DNS：不适用（HAR 记录为 -1）')).toBeInTheDocument();
    expect(screen.getByText('$.log.entries[0].timings.wait')).toBeInTheDocument();
    expect(screen.getAllByText(/同次服务端日志/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Send：/)).not.toBeInTheDocument();
  });
});
