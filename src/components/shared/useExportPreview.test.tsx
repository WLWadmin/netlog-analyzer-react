import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { useExportPreview } from './useExportPreview';
import { downloadTextFile } from '../../utils/downloadTextFile';

jest.mock('../../utils/downloadTextFile', () => ({ downloadTextFile: jest.fn() }));
jest.mock('antd', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
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
