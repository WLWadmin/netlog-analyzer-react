import { fireEvent, render, screen } from '@testing-library/react';
import UploadEntry from './UploadEntry';

jest.mock('../netlog/UploadZone', () => ({
  __esModule: true,
  default: ({ multiple }: { multiple: boolean }) => (
    <div data-testid="shared-upload" data-multiple={String(multiple)} />
  ),
}));

describe('UploadEntry', () => {
  const baseProps = {
    traceEnabled: true,
    parserMode: 'recommend' as const,
    onParserModeChange: jest.fn(),
    onFilesSelected: jest.fn(),
    onConfirm: jest.fn(),
    onReset: jest.fn(),
    onCancel: jest.fn(),
    onContinue: jest.fn(),
  };

  it('uses one shared upload zone and exposes local trust boundaries', () => {
    const { container } = render(
      <UploadEntry
        {...baseProps}
        state={{ status: 'idle' }}
      />,
    );

    expect(screen.getAllByTestId('shared-upload')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '导入诊断文件' })).not.toBeNull();
    expect(screen.queryByText('浏览器证据诊断工作台')).toBeNull();
    expect(screen.getByText('文件不会上传服务器')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="shared-upload"]')).toHaveLength(1);
    expect(container.querySelector('select')).toBeNull();
  });

  it('updates the parser mode through the expert selector', () => {
    const onParserModeChange = jest.fn();
    render(
      <UploadEntry
        {...baseProps}
        state={{ status: 'idle' }}
        onParserModeChange={onParserModeChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '指定文件格式' }));
    fireEvent.click(screen.getByRole('button', { name: 'HAR' }));
    expect(onParserModeChange).toHaveBeenCalledWith('har@1');
  });

  it('keeps the parsing fallback at the structure phase boundary', () => {
    render(
      <UploadEntry
        {...baseProps}
        state={{
          status: 'parsing',
          taskId: 'task-1',
          parserId: 'har@1',
        }}
      />,
    );

    expect(screen.getByText('20%')).not.toBeNull();
    expect(screen.getByText('正在解析文件结构')).not.toBeNull();
  });

  it('shows ambiguous candidates in place without a second upload zone', () => {
    render(
      <UploadEntry
        {...baseProps}
        state={{
          status: 'awaiting-confirmation',
          taskId: 'task-1',
          resolution: {
            kind: 'needs-choice',
            candidates: [
              {
                kind: 'possible-match',
                parserId: 'har@1',
                evidenceCodes: ['HAR_LOG_OBJECT', 'HAR_ENTRIES_ARRAY'],
              },
              {
                kind: 'possible-match',
                parserId: 'chromium-netlog@1',
                evidenceCodes: ['NETLOG_EVENTS_ARRAY'],
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText('请选择文件格式')).not.toBeNull();
    expect(screen.getByRole('button', { name: '使用 HAR 打开' })).not.toBeNull();
    expect(screen.queryByTestId('shared-upload')).toBeNull();
  });
});
