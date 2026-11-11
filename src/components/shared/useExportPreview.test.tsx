import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { useExportPreview } from './useExportPreview';
import { downloadTextFile } from '../../utils/downloadTextFile';

jest.mock('../../utils/downloadTextFile', () => ({ downloadTextFile: jest.fn() }));
const mockActions = new Map<string, () => void>();
jest.mock('antd', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => {
    mockActions.set(String(children), onClick);
    return <button onClick={onClick}>{children}</button>;
  },
  Modal: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => <div role="dialog">{children}{footer}</div>,
  Checkbox: ({ children, checked, onChange }: { children: React.ReactNode; checked: boolean; onChange: React.ChangeEventHandler<HTMLInputElement> }) =>
    <label><input type="checkbox" checked={checked} onChange={onChange} />{children}</label>,
  message: { success: jest.fn(), error: jest.fn() },
}));

it('preview/copy/download share one snapshot, expert is opt-in and cached, new owner invalidates it', async () => {
  const buildExpert = jest.fn(() => 'FAKE_LOCAL_EXPERT');
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  function Harness({ owner }: { owner: string }) {
    const { openExportPreview, exportPreview } = useExportPreview(owner);
    return <><button onClick={() => openExportPreview({
      filename: 'test.txt', mime: 'text/plain;charset=utf-8', sharingText: 'safe snapshot',
      buildExpertText: buildExpert, expertFields: 'local text',
    })}>准备</button>{exportPreview}</>;
  }
  const { rerender } = render(<Harness owner="one" />);
  await userEvent.click(screen.getByText('准备'));
  expect(buildExpert).not.toHaveBeenCalled();
  expect(downloadTextFile).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toHaveValue('safe snapshot');
  await userEvent.click(screen.getByText('复制内容'));
  await userEvent.click(screen.getByText('下载文件'));
  expect(writeText).toHaveBeenCalledWith('safe snapshot');
  expect(downloadTextFile).toHaveBeenLastCalledWith('test.txt', 'safe snapshot', 'text/plain;charset=utf-8');
  await userEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('textbox')).toHaveValue('FAKE_LOCAL_EXPERT');
  await userEvent.click(screen.getByText('复制内容'));
  await userEvent.click(screen.getByText('下载文件'));
  expect(writeText).toHaveBeenLastCalledWith('FAKE_LOCAL_EXPERT');
  expect(downloadTextFile).toHaveBeenLastCalledWith('test.txt', 'FAKE_LOCAL_EXPERT', 'text/plain;charset=utf-8');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('checkbox'));
  expect(buildExpert).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByText('取消'));
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByText('准备'));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  rerender(<Harness owner="two" />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('bounds only the rendered preview and copies/downloads the entire immutable snapshot', async () => {
  const full = 'synthetic 中文 request\n'.repeat(20000) + 'LAST_RECORD';
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  function Harness() {
    const { openExportPreview, exportPreview } = useExportPreview('large');
    return <><button onClick={() => openExportPreview({
      filename: 'large.txt', mime: 'text/plain', sharingText: full,
      buildExpertText: () => full + 'EXPERT_LAST',
    })}>大导出</button>{exportPreview}</>;
  }
  render(<Harness />);
  await userEvent.click(screen.getByText('大导出'));
  const preview = (screen.getByRole('textbox') as HTMLTextAreaElement).value;
  expect(preview.length).toBeLessThanOrEqual(32768);
  expect(full.startsWith(preview)).toBe(true);
  expect(screen.getByText(/预览仅显示部分内容/)).toBeInTheDocument();
  await userEvent.click(screen.getByText('复制内容'));
  await userEvent.click(screen.getByText('下载文件'));
  expect(writeText).toHaveBeenLastCalledWith(full);
  expect(downloadTextFile).toHaveBeenLastCalledWith('large.txt', full, 'text/plain');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByText('下载文件'));
  expect(downloadTextFile).toHaveBeenLastCalledWith('large.txt', full + 'EXPERT_LAST', 'text/plain');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value.length).toBeLessThanOrEqual(32768);
});

it('freezes job metadata, avoids cutting a surrogate pair, and rejects late open from a previous owner', async () => {
  const full = 'a'.repeat(32767) + '😀LAST_RECORD';
  const job = { filename: 'original.txt', mime: 'text/plain', sharingText: full };
  let previousOpen: ReturnType<typeof useExportPreview>['openExportPreview'] | undefined;
  function Harness({ owner }: { owner: string }) {
    const { openExportPreview, exportPreview } = useExportPreview(owner);
    if (!previousOpen) previousOpen = openExportPreview;
    return <><button onClick={() => openExportPreview(job)}>准备快照</button>{exportPreview}</>;
  }
  const { rerender } = render(<Harness owner="original" />);
  await userEvent.click(screen.getByText('准备快照'));
  job.filename = 'changed.txt';
  job.sharingText = 'changed';
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('a'.repeat(32767));
  await userEvent.click(screen.getByText('下载文件'));
  expect(downloadTextFile).toHaveBeenLastCalledWith('original.txt', full, 'text/plain');
  rerender(<Harness owner="replacement" />);
  act(() => previousOpen?.(job));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('rejects retained callbacks after cancellation or replacement with another snapshot', async () => {
  jest.clearAllMocks();
  function Harness() {
    const { openExportPreview, exportPreview } = useExportPreview('one');
    return <><button onClick={() => openExportPreview({
      filename: 'one.txt', mime: 'text/plain', sharingText: 'complete one',
    })}>打开</button>{exportPreview}</>;
  }
  render(<Harness />);
  await userEvent.click(screen.getByText('打开'));
  const obsoleteDownload = mockActions.get('下载文件');
  await userEvent.click(screen.getByText('取消'));
  act(() => obsoleteDownload?.());
  expect(downloadTextFile).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('打开'));
  act(() => obsoleteDownload?.());
  expect(downloadTextFile).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('下载文件'));
  expect(downloadTextFile).toHaveBeenCalledTimes(1);
});
