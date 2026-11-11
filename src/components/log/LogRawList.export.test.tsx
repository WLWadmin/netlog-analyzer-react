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
  Checkbox: ({ children, checked, onChange }: { children: React.ReactNode; checked: boolean; onChange: React.ChangeEventHandler<HTMLInputElement> }) =>
    <label><input type="checkbox" checked={checked} onChange={onChange} />{children}</label>,
  message: { success: jest.fn(), error: jest.fn() },
}));

it('Go JSON clearly selects v1 or legacy expert; copy/download keep all records and reset invalidates preview', async () => {
  const values = parseLogFile(Array.from({ length: 120 }, () =>
    '[synthetic] Info 2026-11-11 00:00:01 Got Success 200 GET:https://example.test/api | body -> null | +0ms',
  ).join('\n')).entries;
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const { rerender } = render(<LogRawList entries={values} />);
  await userEvent.click(screen.getByText('导出 JSON'));
  expect(screen.getByText('当前格式：安全分享 JSON v1')).toBeInTheDocument();
  await userEvent.click(screen.getByText('复制内容'));
  await userEvent.click(screen.getByText('下载文件'));
  const safeText = (downloadTextFile as jest.Mock).mock.calls[0][1];
  expect(writeText).toHaveBeenLastCalledWith(safeText);
  expect(JSON.parse(safeText).data.entries.map((e: { id: string }) => e.id)).toEqual(values.map(e => e.id));
  await userEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('当前格式：专家兼容 JSON（旧结构）')).toBeInTheDocument();
  await userEvent.click(screen.getByText('复制内容'));
  await userEvent.click(screen.getByText('下载文件'));
  const expertText = (downloadTextFile as jest.Mock).mock.calls[1][1];
  expect(writeText).toHaveBeenLastCalledWith(expertText);
  expect(JSON.parse(expertText).entries).toEqual(JSON.parse(JSON.stringify(values)));
  expect(JSON.parse(expertText)).not.toHaveProperty('version');
  await userEvent.click(screen.getByText('取消'));
  await userEvent.click(screen.getByText('导出 JSON'));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  rerender(<LogRawList entries={[]} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
