import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { parseHar } from '../../harParser';
import HarSummaryDiagnosis from './HarSummaryDiagnosis';

jest.mock('antd', () => {
  const Box = ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => <section><div>{title}</div>{children}</section>;
  return {
    Card: Box, Tag: Box, Badge: Box, Row: Box, Col: Box, Tooltip: Box,
    Table: () => null, Progress: () => null,
    Collapse: Object.assign(Box, { Panel: Box }),
  };
});
jest.mock('../shared/DiagnosisPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../shared/FinalDiagnosisPanel', () => ({
  __esModule: true, default: () => null, FinalDiagnosisReferencePanel: () => null,
}));
jest.mock('../shared/DnsAndIpEvidencePanel', () => ({ __esModule: true, default: () => null }));

function result(waits: Array<number | undefined>) {
  return parseHar({ log: { entries: waits.map((wait, index) => ({
    time: 200,
    request: { method: 'GET', url: `https://example.test/${index}` },
    response: { status: 200, bodySize: index === 0 ? 100 : -1, content: {} },
    timings: { wait },
  })) } });
}

it('does not claim no failures when all response statuses are missing', () => {
  const parsed = parseHar({ log: { entries: [{ request: { url: 'https://example.test/' }, response: {} }] } });
  const { container } = render(<HarSummaryDiagnosis result={parsed} />);
  expect(container).not.toHaveTextContent('未发现失败请求');
  expect(container).toHaveTextContent('结果覆盖 0/1');
  expect(screen.getByRole('group', { name: 'HTTP/2 + HTTP/3 指标' })).toHaveTextContent('无可用数据');
  expect(screen.getByRole('group', { name: '缺失安全头指标' })).toHaveTextContent('无可用数据');
});
it('labels missing outcomes without claiming zero-duration phases are missing', () => {
  const parsed = parseHar({ log: { entries: [{
    request: { url: 'https://example.test/' }, response: {}, time: 0,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
  }] } });
  render(<HarSummaryDiagnosis result={parsed} />);
  expect(screen.getByText('辅助健康评估：请求结果无可用数据')).toBeInTheDocument();
  expect(screen.queryByText('辅助健康评估：无可用阶段数据')).not.toBeInTheDocument();
});

it('labels partial outcome coverage explicitly', () => {
  const parsed = parseHar({ log: { entries: [200, undefined].map((status, index) => ({
    request: { url: `https://example.test/${index}` }, response: { status }, time: 0,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
  })) } });
  render(<HarSummaryDiagnosis result={parsed} />);
  expect(screen.getByText('辅助健康评估：数据覆盖不足')).toBeInTheDocument();
});

it('counts an informational HTTP status as observed status evidence', () => {
  const parsed = parseHar({ log: { entries: [{
    request: { url: 'https://example.test/' }, response: { status: 101 }, time: 0,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
  }] } });
  const { container } = render(<HarSummaryDiagnosis result={parsed} />);
  expect(container).toHaveTextContent('已知 HTTP 状态分布 · 覆盖 1/1');
  expect(container).not.toHaveTextContent('HTTP 状态无可用数据');
});
it('renders absent stages without zero measurements or a healthy score', () => {
  const { container } = render(<HarSummaryDiagnosis result={result([undefined])} />);
  expect(screen.getByText('辅助健康评估：无可用阶段数据')).toBeInTheDocument();
  expect(screen.queryByText('综合评分')).not.toBeInTheDocument();
  expect(screen.queryByText('0ms')).not.toBeInTheDocument();
  expect(screen.getAllByText('无可用数据').length).toBeGreaterThanOrEqual(5);
  expect(container).not.toHaveTextContent('NaN');
  expect(container).not.toHaveTextContent('网络状态良好');
  expect(container).not.toHaveTextContent('未发现集中慢因');
  expect(container).not.toHaveTextContent('所有指标均在正常范围内');
  expect(container).not.toHaveTextContent('未发现明显问题');
  expect(container).not.toHaveTextContent('无慢请求');
});

it('renders measured zeros and coverage for mean, P95 and maximum', () => {
  render(<HarSummaryDiagnosis result={result([0, undefined])} />);
  expect(screen.getAllByText('0ms')).toHaveLength(3);
  // Each metric states the same valid-sample denominator.
  expect(screen.getAllByText(/（1\/2）/)).toHaveLength(3);
  expect(screen.getAllByText(/100 B · 已知大小合计 · 覆盖 1\/2/)).toHaveLength(2);
});

it('labels the displayed ten duplicate URLs with the full twelve-URL count', () => {
  const entries = Array.from({ length: 12 }, (_, index) => [0, 1].map(() => ({
    time: 100,
    request: { method: 'GET', url: `https://example.test/duplicate-${index}` },
    response: { status: 200, bodySize: 100, content: {} },
    timings: { send: 0, wait: 100, receive: 0 },
  }))).flat();
  render(<HarSummaryDiagnosis result={parseHar({ log: { entries } })} />);
  expect(screen.getByText('重复请求检测 · 显示前 10 / 共 12')).toBeInTheDocument();
});
