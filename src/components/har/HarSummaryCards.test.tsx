import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { parseHar } from '../../harParser';
import HarSummaryCards from './HarSummaryCards';

it('does not report no failures or zero slow requests without outcome and duration samples', () => {
  const result = parseHar({ log: { entries: [{ request: { url: 'https://example.test/' }, response: {} }] } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByRole('group', { name: '失败请求' })).toHaveTextContent('无可用数据');
  expect(screen.getByRole('group', { name: '慢请求' })).toHaveTextContent('无可用数据');
  expect(screen.queryByText('无失败')).not.toBeInTheDocument();
});

it('does not render an empty capture span as less than one millisecond', () => {
  render(<HarSummaryCards result={parseHar({ log: { entries: [] } })} />);
  expect(screen.getByRole('group', { name: '请求时间跨度' })).toHaveTextContent('无可用数据');
});

jest.mock('antd', () => ({
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Col: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../shared/SummaryCard', () => ({
  SummaryCard: ({ title, value, suffix }: { title: string; value: React.ReactNode; suffix: string }) =>
    <div role="group" aria-label={title}>{title}{value}<span>{suffix}</span></div>,
}));

it.each([
  [undefined, '已知请求子集跨度 · 覆盖 1/2'],
  [100, '已记录请求的起止跨度 · 覆盖 2/2'],
])('labels the span according to request coverage (second duration %s)', (time, label) => {
  const result = parseHar({ log: { entries: [100, time].map((duration, index) => ({
    startedDateTime: index === 0 ? '2026-10-28T00:00:00.000Z' : '2026-10-28T00:01:00.000Z',
    time: duration,
    request: { url: 'https://example.test/' }, response: { status: 200 },
  })) } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.queryByText('首尾请求时间跨度')).not.toBeInTheDocument();
});

it('labels a completely unknown span without implying any measured subset', () => {
  const result = parseHar({ log: { entries: [{
    startedDateTime: '2026-10-28T00:00:00.000Z',
    request: { url: 'https://example.test/' }, response: { status: 200 },
  }] } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByText('无可用请求起止时间 · 覆盖 0/1')).toBeInTheDocument();
});

it.each([
  [[100, -1], '100 B', '已知大小合计 · 覆盖 1/2'],
  [[-1, -1], '无可用数据', '已知大小合计 · 覆盖 0/2'],
  [[0, 0], '0 B', '已知大小合计 · 覆盖 2/2'],
])('labels size totals with known coverage (%s)', (sizes, value, label) => {
  const result = parseHar({ log: { entries: sizes.map(size => ({
    request: { url: 'https://example.test/' },
    response: { status: 200, bodySize: size, content: {} },
  })) } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByRole('group', { name: '总传输大小' })).toHaveTextContent(value);
});
