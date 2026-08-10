import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UploadZone from './UploadZone';

jest.mock('antd', () => {
  const React = require('react');
  const Upload = ({ children, accept }: {
    children: React.ReactNode;
    accept?: string;
  }) => <div data-testid="upload" data-accept={accept}>{children}</div>;
  Upload.Dragger = ({ children, accept, customRequest }: {
    children: React.ReactNode;
    accept?: string;
    customRequest?: (options: unknown) => void;
  }) => (
    <div data-testid="dragger" data-accept={accept}>
      {children}
      <button
        type="button"
        onClick={() => customRequest?.({
          file: new File(['{"events":[]}'], 'sample.json'),
          onSuccess: jest.fn(),
        })}
      >
        choose test file
      </button>
    </div>
  );
  return {
    Upload,
    Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
    Progress: () => null,
    message: { error: jest.fn() },
    notification: { error: jest.fn(), info: jest.fn(), warning: jest.fn() },
  };
});

jest.mock('@ant-design/icons', () => {
  const React = require('react');
  return new Proxy({}, { get: () => () => <span /> });
});

describe('UploadZone Trace feature flag', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
  });

  it('does not advertise or accept Trace when the flag is disabled', () => {
    render(<UploadZone onFileLoaded={jest.fn()} />);

    expect(screen.getByTestId('dragger').getAttribute('data-accept')).toBe(
      '.json,.har,.log',
    );
    expect(screen.queryByText(/Trace \/ gzip/)).toBeNull();
    expect(screen.queryByText('Trace 分析 Beta')).toBeNull();
  });

  it('advertises and accepts Trace when the flag is enabled', () => {
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '1';
    render(<UploadZone onFileLoaded={jest.fn()} />);

    expect(screen.getByTestId('dragger').getAttribute('data-accept')).toContain(
      '.trace',
    );
    expect(screen.getByText(/Trace \/ gzip/)).not.toBeNull();
    expect(screen.getByText('Trace 分析 Beta')).not.toBeNull();
  });

  it('passes the original File to the intake gateway without reading or choosing a parser', async () => {
    const onFilesSelected = jest.fn();
    const onFileLoaded = jest.fn();
    render(
      <UploadZone
        onFilesSelected={onFilesSelected}
        onFileLoaded={onFileLoaded}
      />,
    );

    fireEvent.click(screen.getByText('choose test file'));

    await waitFor(() => expect(onFilesSelected).toHaveBeenCalledTimes(1));
    expect(onFilesSelected.mock.calls[0][0][0]).toBeInstanceOf(File);
    expect(onFileLoaded).not.toHaveBeenCalled();
  });
});
