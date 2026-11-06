import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { parseHar } from '../../harParser';
import { parseHarInput } from '../../utils/parseHarInput';
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
    response: { status: 200, _transferSize: size, content: {} },
  })) } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByRole('group', { name: '总传输大小' })).toHaveTextContent(value);
});

it('distinguishes cached transfer bytes, resource bytes and original file size', () => {
  const result = parseHar({ log: { entries: [{
    request: { url: 'https://example.test/script.js' },
    response: {
      status: 200, _transferSize: 0, _fromCache: 'disk',
      content: { size: 1024, text: 'c2NyaXB0', encoding: 'base64' },
    },
  }] } });
  render(<HarSummaryCards result={result} fileSize={2048} />);
  expect(screen.getByRole('group', { name: '总请求数' })).toHaveTextContent('HAR 文件 2.0 KB');
  expect(screen.getByRole('group', { name: '总传输大小' })).toHaveTextContent('0 B');
  expect(screen.getByRole('group', { name: '资源总大小' })).toHaveTextContent('1.0 KB');
  expect(screen.getByText(/已解析的 1 条请求均记录为磁盘缓存来源/)).toHaveTextContent('传输大小均为 0 B');
  expect(screen.getByText(/已解析请求中包含 1 条响应正文/)).toHaveTextContent('1 条采用 Base64 编码');
});

it('keeps zero resource sizes known and missing sizes unknown in a mixed capture', () => {
  const result = parseHar({ log: { entries: [
    { request: {}, response: { _transferSize: 0, _fromCache: 'disk', content: { size: 0 } } },
    { request: {}, response: { _transferSize: 100, content: { size: 512 } } },
    { request: {}, response: { content: {} } },
  ] } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByRole('group', { name: '总请求数' })).toHaveTextContent('HAR 文件 未记录');
  expect(screen.getByRole('group', { name: '资源总大小' })).toHaveTextContent('512 B');
  expect(screen.getByRole('group', { name: '资源总大小' })).toHaveTextContent('覆盖 2/3');
  expect(screen.getByText(/1 条请求记录为磁盘缓存来源/)).not.toHaveTextContent('传输大小均为 0 B');
});

it('does not invent a resource total or cache source for unknown evidence', () => {
  const result = parseHar({ log: { entries: [{ request: {}, response: { _transferSize: 0 } }] } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByRole('group', { name: '资源总大小' })).toHaveTextContent('无可用数据');
  expect(screen.getByRole('group', { name: '资源总大小' })).toHaveTextContent('覆盖 0/1');
  expect(screen.queryByText(/磁盘缓存来源/)).not.toBeInTheDocument();
});

it('does not count body or resource fallback sizes as recorded transfer bytes', () => {
  const result = parseHar({ log: { entries: [
    { request: {}, response: { bodySize: -1, content: { size: 1048576 } } },
    { request: {}, response: { headersSize: 128, bodySize: 512, content: { size: 1024 } } },
    { request: {}, response: { _transferSize: 0, content: { size: 2048 } } },
    { request: {}, _transferSize: 100, response: { content: { size: 100 } } },
  ] } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByRole('group', { name: '总传输大小' })).toHaveTextContent('100 B');
  expect(screen.getByRole('group', { name: '总传输大小' })).toHaveTextContent('覆盖 2/4');
  expect(screen.getByRole('group', { name: '资源总大小' })).toHaveTextContent('覆盖 4/4');
});

it('keeps transfer size unknown when only content size is recorded', () => {
  const result = parseHar({ log: { entries: [
    { request: {}, response: { content: { size: 1048576 } } },
  ] } });
  render(<HarSummaryCards result={result} />);
  expect(screen.getByRole('group', { name: '总传输大小' })).toHaveTextContent('无可用数据');
  expect(screen.getByRole('group', { name: '总传输大小' })).toHaveTextContent('覆盖 0/1');
  expect(screen.getByRole('group', { name: '资源总大小' })).toHaveTextContent('1.0 MB');
});

it.each(['repaired', 'quality-report'] as const)('limits size and body claims to retained requests (%s)', source => {
  const { result } = parseHarInput(JSON.stringify({ log: { entries: [
    { request: { url: 'https://example.test/kept' }, response: {
      status: 200, _transferSize: 0, _fromCache: 'disk',
      content: { size: 1024, text: 'Ym9keQ==', encoding: 'base64' },
    } },
    { request: { url: 'https://example.test/excluded' } },
  ] } }));
  expect(result.repairInfo?.repaired).toBe(true);
  expect(result.qualityReport?.scope).toBe('partial');
  if (source === 'quality-report') result.repairInfo = undefined;
  else result.qualityReport = undefined;
  render(<HarSummaryCards result={result} fileSize={2048} />);
  expect(screen.getByRole('group', { name: '已解析请求数' })).toHaveTextContent('HAR 文件 2.0 KB');
  expect(screen.getByRole('group', { name: '已解析传输大小合计' })).toHaveTextContent('已解析请求内覆盖 1/1');
  expect(screen.getByRole('group', { name: '已解析资源大小合计' })).toHaveTextContent('已解析请求内覆盖 1/1');
  expect(screen.getByText(/统计仅针对已解析请求，不代表原文件全部请求/)).toBeInTheDocument();
  expect(screen.getByText(/已解析请求中包含 1 条响应正文/)).toHaveTextContent('其中 1 条采用 Base64 编码');
  expect(screen.queryByText(/本次所有请求|文件包含 1 条/)).not.toBeInTheDocument();
});
