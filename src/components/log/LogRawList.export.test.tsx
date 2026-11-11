import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import LogRawList from './LogRawList';
import { parseLogFile } from '../../logParser';
import { downloadTextFile } from '../../utils/downloadTextFile';

jest.mock('../../utils/downloadTextFile', () => ({ downloadTextFile: jest.fn() }));
jest.mock('./LogRawContextModal', () => () => null);
jest.mock('@ant-design/icons', () => Object.fromEntries(
  ['SearchOutlined', 'FileTextOutlined', 'CheckCircleOutlined', 'CloseCircleOutlined',
    'FilterOutlined', 'ClockCircleOutlined'].map(name => [name, () => null]),
));
jest.mock('antd', () => ({
  Card: ({ children, extra }: { children: React.ReactNode; extra: React.ReactNode }) => <div>{extra}{children}</div>,
  Input: () => null, Select: () => null, DatePicker: { RangePicker: () => null },
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
  Modal: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => <div role="dialog">{children}{footer}</div>,
  message: { success: jest.fn(), error: jest.fn() },
}));

it('Go JSON defaults to the legacy data; copy/download keep all records and reset invalidates preview', async () => {
  const values = parseLogFile(Array.from({ length: 120 }, () =>
    '[synthetic] Info 2026-11-11 00:00:01 Got Success 200 GET:https://example.test/api | body -> null | +0ms',
  ).join('\n')).entries;
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const { rerender } = render(<LogRawList entries={values} />);
  await userEvent.click(screen.getByText('导出 JSON'));
  expect(screen.queryByRole('checkbox')).toBeNull();
  await userEvent.click(screen.getByText('复制内容'));
  await userEvent.click(screen.getByText('下载文件'));
  const text = (downloadTextFile as jest.Mock).mock.calls[0][1];
  expect(writeText).toHaveBeenLastCalledWith(text);
  expect(JSON.parse(text).entries.map((e: { id: string }) => e.id)).toEqual(values.map(e => e.id));
  expect(JSON.parse(text).entries).toEqual(JSON.parse(JSON.stringify(values)));
  expect(JSON.parse(text)).not.toHaveProperty('version');
  await userEvent.click(screen.getByText('取消'));
  await userEvent.click(screen.getByText('导出 JSON'));
  expect(screen.queryByRole('checkbox')).toBeNull();
  rerender(<LogRawList entries={[]} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
