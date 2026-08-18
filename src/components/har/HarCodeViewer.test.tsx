import '@testing-library/jest-dom';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import HarCodeViewer from './HarCodeViewer';

jest.mock('antd', () => {
  return {
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  };
});

const source = Array.from({ length: 10002 }, (_, index) => `line-${index + 1}`).join('\n');

describe('HarCodeViewer', () => {
  it('truncates very long Preview content by default', () => {
    render(
      <HarCodeViewer
        source={source}
        mimeType="text/plain"
        rawType="text"
        url="https://example.test/file.txt"
        format={false}
      />,
    );

    expect(screen.getByLabelText('Text source preview')).toHaveTextContent('Preview truncated');
    expect(screen.getByLabelText('Text source preview')).not.toHaveTextContent('line-10002');
  });

  it('keeps complete Response content when truncation and line numbers are disabled', () => {
    render(
      <HarCodeViewer
        source={source}
        mimeType="text/plain"
        rawType="text"
        url="https://example.test/file.txt"
        format={false}
        truncateLines={false}
        showLineNumbers={false}
      />,
    );

    expect(screen.getByLabelText('Text source preview')).toHaveTextContent('line-10002');
    expect(screen.queryByText(/Preview truncated/)).not.toBeInTheDocument();
  });
});
