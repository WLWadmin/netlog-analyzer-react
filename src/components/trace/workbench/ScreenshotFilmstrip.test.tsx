import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkbenchResponse } from '../../../workbench/protocol';
import ScreenshotFilmstrip from './ScreenshotFilmstrip';

describe('ScreenshotFilmstrip', () => {
  const queryScreenshotIndex = jest.fn<Promise<WorkbenchResponse>, []>();
  const queryScreenshot = jest.fn<Promise<WorkbenchResponse>, [string]>();
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation();
    jest.useRealTimers();
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
    queryScreenshot.mockReset().mockImplementation(async screenshotId => ({
      type: 'screenshot-result',
      schemaVersion: 1,
      requestId: 'shot',
      sessionId: 'session',
      sessionRevision: 1,
      screenshot: {
        screenshotId,
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    }));
    URL.createObjectURL = jest.fn(() => 'blob:workbench-shot');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    jest.useRealTimers();
  });

  it('is collapsed by default and preloads only the current bounded neighborhood', async () => {
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
    expect(await screen.findByText(/1 帧因损坏、重复或预算限制未载入/)).not.toBeNull();
    await waitFor(() => expect(queryScreenshot).toHaveBeenCalledWith('shot-1'));
    expect(await screen.findByAltText('录制截图，时间 1.25 秒')).not.toBeNull();
    const frame = screen.getByRole('button', { name: '查看录制截图，时间 1.25 秒' });
    const focus = jest.spyOn(frame, 'focus');
    fireEvent.click(frame);
    expect(onSelectTimestamp).toHaveBeenCalledWith(1_250_000);
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

  it('starts a fresh frame request when reopened before the old request settles', async () => {
    const resolvers: Array<(response: WorkbenchResponse) => void> = [];
    queryScreenshot.mockImplementation(() => new Promise(resolve => {
      resolvers.push(resolve);
    }));
    render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        screenshotCount={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await waitFor(() => expect(queryScreenshot).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '折叠截图胶片并释放内存' }));
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await waitFor(() => expect(queryScreenshot).toHaveBeenCalledTimes(2));

    resolvers[0]({
      type: 'screenshot-result',
      schemaVersion: 1,
      requestId: 'old',
      sessionId: 'session',
      sessionRevision: 1,
      screenshot: {
        screenshotId: 'shot-1',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1]),
      },
    });
    resolvers[1]({
      type: 'screenshot-result',
      schemaVersion: 1,
      requestId: 'new',
      sessionId: 'session',
      sessionRevision: 1,
      screenshot: {
        screenshotId: 'shot-1',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([2]),
      },
    });
    expect(await screen.findByAltText('当前录制截图，时间 1.25 秒')).not.toBeNull();
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

  it('does not reset the selected frame when callbacks rerender without an external timestamp', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'shot-0', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-1', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    const client = { queryScreenshot, queryScreenshotIndex };
    const view = render(
      <ScreenshotFilmstrip
        client={client}
        onCursorTimestamp={jest.fn()}
        screenshotCount={2}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    const player = await screen.findByRole('region', { name: '截图播放控制' });
    fireEvent.keyDown(player, { key: 'ArrowRight' });
    expect(screen.getByText('1.00 秒')).not.toBeNull();

    view.rerender(
      <ScreenshotFilmstrip
        client={client}
        onCursorTimestamp={jest.fn()}
        screenshotCount={2}
      />,
    );
    expect(screen.getByText('1.00 秒')).not.toBeNull();
  });

  it('keeps playback authoritative while Timeline hover remains unchanged', async () => {
    jest.useFakeTimers();
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'shot-0', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-1', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    const client = { queryScreenshot, queryScreenshotIndex };
    const view = render(
      <ScreenshotFilmstrip
        client={client}
        hoveredTimestampUs={0}
        screenshotCount={2}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await screen.findByText('0.00 秒');
    fireEvent.click(screen.getByRole('button', { name: '播放截图' }));
    act(() => { jest.advanceTimersByTime(1_000); });
    view.rerender(
      <ScreenshotFilmstrip
        client={client}
        hoveredTimestampUs={0}
        screenshotCount={2}
      />,
    );
    expect(screen.getByText('1.00 秒')).not.toBeNull();
  });

  it('applies a hover that changed during playback after playback pauses', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'shot-0', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-1', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-2', evidenceId: 'e2', timestampUs: 2_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    const client = { queryScreenshot, queryScreenshotIndex };
    const view = render(
      <ScreenshotFilmstrip
        client={client}
        hoveredTimestampUs={0}
        screenshotCount={3}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await screen.findByText('0.00 秒');
    fireEvent.click(screen.getByRole('button', { name: '播放截图' }));

    view.rerender(
      <ScreenshotFilmstrip
        client={client}
        hoveredTimestampUs={2_000_000}
        screenshotCount={3}
      />,
    );
    expect(screen.getByText('0.00 秒')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '暂停截图' }));
    expect(screen.getByText('2.00 秒')).not.toBeNull();
    expect(await screen.findByAltText('当前录制截图，时间 2.00 秒')).not.toBeNull();
  });

  it('allows the same Timeline hover to locate its frame again after hover clears', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'shot-0', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-1', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    const client = { queryScreenshot, queryScreenshotIndex };
    const view = render(
      <ScreenshotFilmstrip
        client={client}
        hoveredTimestampUs={1_000_000}
        screenshotCount={2}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await screen.findByText('1.00 秒');
    view.rerender(<ScreenshotFilmstrip client={client} screenshotCount={2} />);
    fireEvent.keyDown(
      screen.getByRole('region', { name: '截图播放控制' }),
      { key: 'ArrowLeft' },
    );
    expect(screen.getByText('0.00 秒')).not.toBeNull();

    view.rerender(
      <ScreenshotFilmstrip
        client={client}
        hoveredTimestampUs={1_000_000}
        screenshotCount={2}
      />,
    );
    expect(screen.getByText('1.00 秒')).not.toBeNull();
  });

  it('plays actual frames in timestamp order and changes only the scheduling speed', async () => {
    jest.useFakeTimers();
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'shot-2', evidenceId: 'e2', timestampUs: 2_000_000, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-0', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-1', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    queryScreenshot.mockImplementation(async screenshotId => ({
      type: 'screenshot-result',
      schemaVersion: 1,
      requestId: screenshotId,
      sessionId: 'session',
      sessionRevision: 1,
      screenshot: {
        screenshotId,
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1]),
      },
    }));
    const onSelectTimestamp = jest.fn();
    render(
      <ScreenshotFilmstrip
        captureRange={{ startUs: 0, endUs: 2_000_000 }}
        client={{ queryScreenshot, queryScreenshotIndex }}
        onSelectTimestamp={onSelectTimestamp}
        screenshotCount={3}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await screen.findByText('0.00 秒');

    fireEvent.click(screen.getByRole('button', { name: '播放截图' }));
    act(() => { jest.advanceTimersByTime(999); });
    expect(screen.getByText('0.00 秒')).not.toBeNull();
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.getByText('1.00 秒')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '2×' }));
    act(() => { jest.advanceTimersByTime(500); });
    expect(screen.getByText('2.00 秒')).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByAltText('当前录制截图，时间 2.00 秒')).not.toBeNull();
    expect(onSelectTimestamp.mock.calls.map(([timestamp]) => timestamp)).toEqual([
      1_000_000,
      2_000_000,
    ]);
  });

  it('supports pause, frame keyboard navigation and a draggable cursor', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'shot-0', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-1', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    const onSelectTimestamp = jest.fn();
    render(
      <ScreenshotFilmstrip
        captureRange={{ startUs: 0, endUs: 1_000_000 }}
        client={{ queryScreenshot, queryScreenshotIndex }}
        onSelectTimestamp={onSelectTimestamp}
        screenshotCount={2}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    const player = await screen.findByRole('region', { name: '截图播放控制' });
    fireEvent.keyDown(player, { key: 'ArrowRight' });
    expect(onSelectTimestamp).toHaveBeenLastCalledWith(1_000_000);
    fireEvent.keyDown(player, { key: 'ArrowLeft' });
    expect(onSelectTimestamp).toHaveBeenLastCalledWith(0);
    fireEvent.change(screen.getByRole('slider', { name: '截图时间游标' }), {
      target: { value: '750000' },
    });
    expect(onSelectTimestamp).toHaveBeenLastCalledWith(750_000);
    const callbackCount = onSelectTimestamp.mock.calls.length;
    fireEvent.keyDown(screen.getByRole('slider', { name: '截图时间游标' }), {
      key: 'ArrowRight',
    });
    expect(onSelectTimestamp).toHaveBeenCalledTimes(callbackCount);
    fireEvent.keyDown(player, { key: ' ' });
    expect(screen.getByRole('button', { name: '暂停截图' })).not.toBeNull();
    fireEvent.keyDown(player, { key: ' ' });
    expect(screen.getByRole('button', { name: '播放截图' })).not.toBeNull();
  });

  it('keeps only current and adjacent Blob URLs and resets on client change', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: Array.from({ length: 5 }, (_, index) => ({
        screenshotId: `shot-${index}`,
        evidenceId: `e${index}`,
        timestampUs: index * 1_000_000,
        encodedBytes: 4,
        decodedBytes: 64,
      })),
      rejectedCount: 0,
    });
    URL.createObjectURL = jest.fn(source => (
      `blob:${source instanceof Blob ? source.size : 0}:${queryScreenshot.mock.calls.length}`
    ));
    const firstClient = { queryScreenshot, queryScreenshotIndex };
    const view = render(
      <ScreenshotFilmstrip client={firstClient} screenshotCount={5} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await waitFor(() => expect(queryScreenshot).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: '加载录制截图，时间 4.00 秒' }));
    await waitFor(() => expect(queryScreenshot).toHaveBeenCalledWith('shot-4'));
    expect(URL.revokeObjectURL).toHaveBeenCalled();

    const nextIndex = jest.fn<Promise<WorkbenchResponse>, []>();
    const nextShot = jest.fn<Promise<WorkbenchResponse>, [string]>();
    view.rerender(
      <ScreenshotFilmstrip
        client={{ queryScreenshot: nextShot, queryScreenshotIndex: nextIndex }}
        screenshotCount={1}
      />,
    );
    expect(screen.getByRole('button', { name: '展开截图胶片' })).not.toBeNull();
    expect(screen.queryByText('4.00 秒')).toBeNull();
  });

  it('keeps a damaged frame local and leaves adjacent frames usable', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'bad', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'good', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    queryScreenshot.mockImplementation(async screenshotId => (
      screenshotId === 'bad'
        ? {
          type: 'capability-missing',
          schemaVersion: 1,
          requestId: 'bad',
          sessionId: 'session',
          sessionRevision: 1,
          capability: 'screenshots',
          reason: 'damaged',
        }
        : {
          type: 'screenshot-result',
          schemaVersion: 1,
          requestId: 'good',
          sessionId: 'session',
          sessionRevision: 1,
          screenshot: {
            screenshotId: 'good',
            mimeType: 'image/jpeg',
            bytes: new Uint8Array([1]),
          },
        }
    ));
    render(
      <ScreenshotFilmstrip client={{ queryScreenshot, queryScreenshotIndex }} screenshotCount={2} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    expect(await screen.findByText(/当前截图解码失败/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下一帧' }));
    expect(await screen.findByAltText('当前录制截图，时间 1.00 秒')).not.toBeNull();
  });

  it('rejects a screenshot response whose payload id does not match the requested frame', async () => {
    queryScreenshot.mockResolvedValue({
      type: 'screenshot-result',
      schemaVersion: 1,
      requestId: 'shot',
      sessionId: 'session',
      sessionRevision: 1,
      screenshot: {
        screenshotId: 'different-shot',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    });
    render(
      <ScreenshotFilmstrip
        client={{ queryScreenshot, queryScreenshotIndex }}
        screenshotCount={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));

    expect(await screen.findByText(/当前截图解码失败/)).not.toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('restores focus to the large-frame trigger after closing the dialog', async () => {
    render(
      <ScreenshotFilmstrip client={{ queryScreenshot, queryScreenshotIndex }} screenshotCount={1} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    const trigger = await screen.findByRole('button', { name: '查看当前截图大图' });
    const focus = jest.spyOn(trigger, 'focus');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('pauses playback and preserves the enlarged frame during external navigation', async () => {
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'shot-0', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-1', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    const client = { queryScreenshot, queryScreenshotIndex };
    const view = render(
      <ScreenshotFilmstrip client={client} screenshotCount={2} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    const trigger = await screen.findByRole('button', { name: '查看当前截图大图' });
    fireEvent.click(screen.getByRole('button', { name: '播放截图' }));
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: '播放截图' })).not.toBeNull();

    view.rerender(
      <ScreenshotFilmstrip
        client={client}
        focusedTimestampUs={1_000_000}
        screenshotCount={2}
      />,
    );
    expect(screen.getByRole('dialog', { name: '录制截图，时间 0.00 秒' })).not.toBeNull();
  });

  it('does not schedule playback for a single frame', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(window, 'setTimeout');
    render(
      <ScreenshotFilmstrip client={{ queryScreenshot, queryScreenshotIndex }} screenshotCount={1} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await screen.findByText('1.25 秒');
    setTimeoutSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '播放截图' }));
    expect(screen.getByRole('button', { name: '播放截图' })).not.toBeNull();
    expect((screen.getByRole('button', { name: '下一帧' }) as HTMLButtonElement).disabled).toBe(true);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it('clears an active playback timer when collapsed', async () => {
    jest.useFakeTimers();
    queryScreenshotIndex.mockResolvedValue({
      type: 'screenshot-index-result',
      schemaVersion: 1,
      requestId: 'index',
      sessionId: 'session',
      sessionRevision: 1,
      screenshots: [
        { screenshotId: 'shot-0', evidenceId: 'e0', timestampUs: 0, encodedBytes: 4, decodedBytes: 64 },
        { screenshotId: 'shot-1', evidenceId: 'e1', timestampUs: 1_000_000, encodedBytes: 4, decodedBytes: 64 },
      ],
      rejectedCount: 0,
    });
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    render(
      <ScreenshotFilmstrip client={{ queryScreenshot, queryScreenshotIndex }} screenshotCount={2} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开截图胶片' }));
    await screen.findByText('0.00 秒');
    fireEvent.click(screen.getByRole('button', { name: '播放截图' }));
    fireEvent.click(screen.getByRole('button', { name: '折叠截图胶片并释放内存' }));
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
