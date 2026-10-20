import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import HarRecoveryPanel from './HarRecoveryPanel';
import { parseHarWithRepair } from '../../utils/harRepair';
import type { HarExcludedEntry } from '../../utils/harRepair';

// Match the existing component-test boundary: test our columns/content, while
// real Ant Design rendering is exercised by the desktop browser check.
jest.mock('antd', () => ({
  Alert: ({ message, description }: { message: React.ReactNode; description: React.ReactNode }) =>
    <section role="alert">{message}{description}</section>,
  Table: ({ dataSource, columns }: {
    dataSource: HarExcludedEntry[];
    columns: Array<{ key: string; dataIndex?: keyof HarExcludedEntry; render?: (value: unknown, item: HarExcludedEntry) => React.ReactNode }>;
  }) => <table><tbody>{dataSource.map(item =>
    <tr key={item.charStart}>{columns.map(column =>
      <td key={column.key}>{column.render ? column.render(undefined, item) : String(item[column.dataIndex!])}</td>
    )}</tr>
  )}</tbody></table>,
}));

it('shows excluded original ordinal, safe URL, location and masked details', () => {
  const result = parseHarWithRepair(JSON.stringify({
    log: { entries: [
      { request: {}, response: {} },
      { request: { url: 'https://user:password@example.test/path?token=SECRET#fragment' } },
    ] },
  }));
  const { container } = render(<HarRecoveryPanel info={result} />);
  expect(screen.getByText('第 2 条')).toBeInTheDocument();
  expect(screen.getByText('https://example.test/path')).toBeInTheDocument();
  expect(container.textContent).toContain('缺少 response');
  expect(container.textContent).toContain('UTF-16');
  for (const text of ['password', 'SECRET', '#fragment']) expect(container.textContent).not.toContain(text);
});

it('does not show a recovery percentage or a guessed request count for an unknown range', () => {
  const result = parseHarWithRepair('{"log":{"entries":[{"request":{},"response":{}},{"request":');
  const { container } = render(<HarRecoveryPanel info={result} />);
  expect(container.textContent).toContain('至少恢复 1 条');
  expect(container.textContent).toContain('未恢复片段 / 序号未知');
  expect(container.textContent).not.toContain('%');
});
