import { fireEvent, render, screen } from '@testing-library/react';
import ParserModeSelect from './ParserModeSelect';

describe('ParserModeSelect', () => {
  it('highlights automatic detection and progressively reveals explicit formats', () => {
    const onChange = jest.fn();
    render(<ParserModeSelect value="recommend" traceEnabled onChange={onChange} />);

    expect(
      screen.getByRole('button', { name: '自动识别（推荐）' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByRole('button', { name: 'Performance Trace' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '指定文件格式' }));
    fireEvent.click(screen.getByRole('button', { name: 'NetLog' }));
    expect(onChange).toHaveBeenCalledWith('chromium-netlog@1');
    expect(screen.getByRole('button', { name: 'Performance Trace' })).not.toBeNull();
  });

  it('does not advertise Trace when the feature is disabled', () => {
    render(<ParserModeSelect value="recommend" traceEnabled={false} onChange={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '指定文件格式' }));
    expect(screen.queryByRole('button', { name: 'Performance Trace' })).toBeNull();
  });

  it('returns to automatic recognition and collapses the manual formats', () => {
    const onChange = jest.fn();
    render(<ParserModeSelect value="har@1" traceEnabled onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'HAR' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '自动识别（推荐）' }));
    expect(onChange).toHaveBeenCalledWith('recommend');
    expect(screen.queryByRole('button', { name: 'HAR' })).toBeNull();
  });
});
