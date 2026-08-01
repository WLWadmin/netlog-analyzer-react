import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkbenchResponse } from '../../../workbench/protocol';
import ScreenshotFilmstrip from './ScreenshotFilmstrip';

describe('ScreenshotFilmstrip', () => {
  const queryScreenshotIndex = jest.fn<Promise<WorkbenchResponse>, []>();
  const queryScreenshot = jest.fn<Promise<WorkbenchResponse>, [string]>();

  beforeEach(() => {
    queryScreenshotIndex.mockReset().mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [{
        screenshotId: 'shot-1',
        evidenceId: 'evidence-1',
        timestampUs: 1_250_000,
        encodedBytes: 4,
        decodedBytes: 64,
      }],
      rejectedCount: 1,
    });
    queryScreenshot.mockReset().mockResolvedValue({
      type: 'screenshot-result',
      schemaVersion: 1,
      requestId: 'shot',
      sessionId: 'session',
      sessionRevision: 1,
      screenshot: {
        screenshotId: 'shot-1',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    });
    URL.createObjectURL = jest.fn(() => 'blob:workbench-shot');
    URL.revokeObjectURL = jest.fn();
  });

  it('is collapsed by default and fetches only an explicitly requested frame', async () => {
    const onSelectTimestamp = jest.fn();
    render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        onSelectTimestamp={onSelectTimestamp}
        screenshotCount={1}
      />,
    );
    expect(queryScreenshotIndex).not.toHaveBeenCalled();
    expect(queryScreenshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await waitFor(() => expect(queryScreenshotIndex).toHaveBeenCalledTimes(1));
    expect(queryScreenshot).not.toHaveBeenCalled();
    expect(await screen.findByText(/1 帧因损坏、重复或预算限制未载入/)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '加载录制截图，时间 1.25 秒' }));
    await waitFor(() => expect(queryScreenshot).toHaveBeenCalledWith('shot-1'));
    expect(onSelectTimestamp).toHaveBeenCalledWith(1_250_000);
    expect(await screen.findByAltText('录制截图，时间 1.25 秒')).not.toBeNull();
    const frame = screen.getByRole('button', { name: '查看录制截图，时间 1.25 秒' });
    const focus = jest.spyOn(frame, 'focus');
    fireEvent.click(frame);
    expect(screen.getByRole('dialog', { name: '录制截图，时间 1.25 秒' })).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('revokes Blob URLs when collapsed and unmounted', async () => {
    const { unmount } = render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        screenshotCount={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await screen.findByRole('button', { name: '加载录制截图，时间 1.25 秒' });
    fireEvent.click(screen.getByRole('button', { name: '加载录制截图，时间 1.25 秒' }));
    await screen.findByAltText('录制截图，时间 1.25 秒');

    fireEvent.click(screen.getByRole('button', { name: '折叠截图胶片并释放内存' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:workbench-shot');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('ignores an index response that arrives while collapsed', async () => {
    let resolveIndex: ((response: WorkbenchResponse) => void) | undefined;
    queryScreenshotIndex.mockReturnValue(new Promise(resolve => {
      resolveIndex = resolve;
    }));
    render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        screenshotCount={1}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    fireEvent.click(screen.getByRole('button', { name: '折叠截图胶片并释放内存' }));
    resolveIndex?.({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'late-index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [],
      rejectedCount: 0,
    });
    await Promise.resolve();

    expect(screen.queryByRole('list')).toBeNull();
  });

  it('deduplicates concurrent frame requests and revokes a late Blob URL after collapse', async () => {
    let resolveScreenshot: ((response: WorkbenchResponse) => void) | undefined;
    queryScreenshot.mockReturnValue(new Promise(resolve => {
      resolveScreenshot = resolve;
    }));
    render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        screenshotCount={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    const load = await screen.findByRole('button', { name: '加载录制截图，时间 1.25 秒' });
    fireEvent.click(load);
    fireEvent.click(load);
    expect(queryScreenshot).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '折叠截图胶片并释放内存' }));

    resolveScreenshot?.({
      type: 'screenshot-result',
      schemaVersion: 1,
      requestId: 'late-shot',
      sessionId: 'session',
      sessionRevision: 1,
      screenshot: {
        screenshotId: 'shot-1',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    });
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:workbench-shot'));
    expect(screen.queryByAltText('录制截图，时间 1.25 秒')).toBeNull();
  });

  it('revokes a frame response that arrives after unmount', async () => {
    let resolveScreenshot: ((response: WorkbenchResponse) => void) | undefined;
    queryScreenshot.mockReturnValue(new Promise(resolve => {
      resolveScreenshot = resolve;
    }));
    const { unmount } = render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        screenshotCount={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    fireEvent.click(await screen.findByRole('button', { name: '加载录制截图，时间 1.25 秒' }));
    unmount();
    resolveScreenshot?.({
      type: 'screenshot-result',
      schemaVersion: 1,
      requestId: 'late-shot',
      sessionId: 'session',
      sessionRevision: 1,
      screenshot: {
        screenshotId: 'shot-1',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    });

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:workbench-shot'));
  });

  it('limits a large screenshot index to one focusable page', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: Array.from({ length: 250 }, (_, index) => ({
        screenshotId: `shot-${index}`,
        evidenceId: `evidence-${index}`,
        timestampUs: index * 1_000,
        encodedBytes: 4,
        decodedBytes: 64,
      })),
      rejectedCount: 0,
    });
    render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        screenshotCount={250}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));

    expect(await screen.findAllByRole('button', { name: /加载录制截图/ })).toHaveLength(100);
    expect(screen.getByText('第 1 / 3 页')).not.toBeNull();
  });

  it('loads the nearest screenshot after an expanded Timeline hover settles', async () => {
    render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        hoveredTimestampUs={1_260_000}
        screenshotCount={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));

    await waitFor(() => expect(queryScreenshot).toHaveBeenCalledWith('shot-1'));
    expect(await screen.findByAltText('录制截图，时间 1.25 秒')).not.toBeNull();
  });

  it('moves a paged filmstrip to the screenshot nearest the hovered time', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: Array.from({ length: 250 }, (_, index) => ({
        screenshotId: `shot-${index}`,
        evidenceId: `evidence-${index}`,
        timestampUs: index * 1_000,
        encodedBytes: 4,
        decodedBytes: 64,
      })),
      rejectedCount: 0,
    });
    render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        hoveredTimestampUs={201_000}
        screenshotCount={250}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));

    expect(await screen.findByText('第 3 / 3 页')).not.toBeNull();
    await waitFor(() => expect(queryScreenshot).toHaveBeenCalledWith('shot-201'));
  });
});
