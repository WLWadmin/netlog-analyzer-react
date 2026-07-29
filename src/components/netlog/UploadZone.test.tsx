import React from 'react';
import { render, screen } from '@testing-library/react';
import UploadZone from './UploadZone';

jest.mock('antd', () => {
  const React = require('react');
  const Upload = ({ children, accept }: {
    children: React.ReactNode;
    accept?: string;
  }) => <div data-testid="upload" data-accept={accept}>{children}</div>;
  Upload.Dragger = ({ children, accept }: {
    children: React.ReactNode;
    accept?: string;
  }) => <div data-testid="dragger" data-accept={accept}>{children}</div>;
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
    expect(screen.queryByText(/Performance 导出的/)).toBeNull();
  });

  it('advertises and accepts Trace when the flag is enabled', () => {
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '1';
    render(<UploadZone onFileLoaded={jest.fn()} />);

    expect(screen.getByTestId('dragger').getAttribute('data-accept')).toContain(
      '.trace',
    );
    expect(screen.getByText(/Performance 导出的/)).not.toBeNull();
  });
});
