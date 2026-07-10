import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HarRequestEntry } from '../../harParser';
import HarRequestDetail from './HarRequestDetail';

jest.mock('antd', () => {
  const React = require('react');
  const Tabs = ({ items }: { items: Array<{ key: string; label: string; children: React.ReactNode }> }) => {
    const [activeKey, setActiveKey] = React.useState(items[0]?.key);
    const active = items.find(item => item.key === activeKey);
    return (
      <div>
        <div role="tablist">
          {items.map(item => (
            <button key={item.key} role="tab" aria-selected={item.key === activeKey} onClick={() => setActiveKey(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <div>{active?.children}</div>
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
  const React = require('react');
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

jest.mock('./HarTimingChart', () => ({ __esModule: true, default: () => <div>Timing chart</div> }));

function entry(): HarRequestEntry {
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
});
