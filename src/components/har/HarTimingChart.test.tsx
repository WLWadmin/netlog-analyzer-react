import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { parseHar } from '../../harParser';
import HarTimingChart from './HarTimingChart';

jest.mock('antd', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

function entry(timings: Record<string, number>, time?: number) {
  return parseHar({ log: { entries: [{
    request: { url: 'https://example.test/', headers: [] }, response: { status: 200, headers: [], content: {} },
    ...(time === undefined ? {} : { time }), timings,
  }] } }).entries[0];
}

it('shows exact missing paths and avoids a distributed-time or normality claim', () => {
  render(<HarTimingChart entry={entry({}, 100)} />);
  expect(screen.getByRole('note')).toHaveTextContent('$.log.entries[0].timings.send：缺失');
  expect(screen.getByRole('note')).toHaveTextContent('$.log.entries[0].timings.wait：缺失');
  expect(screen.getByRole('note')).toHaveTextContent('$.log.entries[0].timings.receive：缺失');
  expect(screen.queryByText(/各阶段耗时较分散/)).not.toBeInTheDocument();
});

it('keeps known durations visible but suppresses bars whose predecessor is missing', () => {
  const { container } = render(<HarTimingChart entry={entry({ wait: 50, receive: 50 }, 100)} />);
  expect(screen.getAllByText('50 ms')).toHaveLength(2);
  expect(container.querySelector('[style*="background: rgb(74, 222, 128)"]')).toBeNull();
  expect(container.querySelector('[style*="background: rgb(22, 163, 74)"]')).toBeNull();
});

it('shows recorded zeros without a missing-phase warning and flags missing totals', () => {
  const { rerender } = render(<HarTimingChart entry={entry({ send: 0, wait: 0, receive: 0 }, 0)} />);
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
  expect(screen.queryByText('HAR 未记录可展示的 Timing 阶段。')).not.toBeInTheDocument();
  rerender(<HarTimingChart entry={entry({ send: 0, wait: 0, receive: 0 })} />);
  expect(screen.getByRole('note')).toHaveTextContent('$.log.entries[0].time：缺失');
});

it('keeps contradictory durations visible without bars or a request-start position', () => {
  const { container } = render(<HarTimingChart entry={entry({ send: 0, wait: 8000, receive: 0 }, 1)} />);
  expect(screen.getByRole('note')).toHaveTextContent('Timing 数据矛盾');
  expect(screen.getByRole('note')).toHaveTextContent('$.log.entries[0].timings');
  expect(screen.getAllByText('8.00 s')).toHaveLength(2);
  expect(container.querySelector('[style*="background: rgb(74, 222, 128)"]')).toBeNull();
  expect(screen.queryByText(/主要耗时/)).not.toBeInTheDocument();
});
