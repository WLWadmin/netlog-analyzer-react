import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import TrackPluginPanel from './TrackPluginPanel';

describe('TrackPluginPanel', () => {
  it('installs, hides and removes a declarative session overlay', async () => {
    const installTrackPlugin = jest.fn().mockResolvedValue({
      type: 'track-plugin-result',
      operation: 'installed',
      plugin: {
        pluginId: 'layout-watch',
        label: 'Layout Watch',
        trackId: 'plugin:layout-watch',
      },
      range: { startUs: 0, endUs: 1_000 },
      projectedEvents: [{
        eventId: 'plugin:layout-watch:trace:timeline:1',
        sourceEventId: 'trace:timeline:1',
        evidenceIds: ['trace:event:1'],
        trackId: 'plugin:layout-watch',
        category: 'rendering',
        name: 'Layout',
        startUs: 10,
        durationUs: 5,
      }],
      evidenceIds: ['trace:event:1'],
      limitations: ['插件只能读取白名单投影。'],
      truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
    });
    const queryTrackPlugin = jest.fn().mockResolvedValue(undefined);
    const removeTrackPlugin = jest.fn().mockResolvedValue({
      type: 'track-plugin-result',
      operation: 'removed',
      pluginId: 'layout-watch',
    });
    const onOverlaysChange = jest.fn();
    render(
      <TrackPluginPanel
        client={{
          installTrackPlugin,
          queryTrackPlugin,
          removeTrackPlugin,
        } as unknown as TraceWorkbenchClient}
        range={{ startUs: 0, endUs: 1_000 }}
        onOverlaysChange={onOverlaysChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('插件 ID'), {
      target: { value: 'layout-watch' },
    });
    fireEvent.change(screen.getByLabelText('插件名称'), {
      target: { value: 'Layout Watch' },
    });
    fireEvent.change(screen.getByLabelText('插件查询值'), {
      target: { value: 'Layout' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加临时轨道' }));

    await waitFor(() => expect(installTrackPlugin).toHaveBeenCalledWith(
      { startUs: 0, endUs: 1_000 },
      {
        pluginId: 'layout-watch',
        label: 'Layout Watch',
        query: {
          clauses: [{ field: 'name', operator: 'contains', value: 'Layout' }],
        },
        maxEvents: 2_000,
      },
    ));
    await waitFor(() => expect(onOverlaysChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        pluginId: 'layout-watch',
        visible: true,
        events: [expect.objectContaining({
          sourceEventId: 'trace:timeline:1',
        })],
      }),
    ]));
    expect(screen.getByText('插件只能读取白名单投影。')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '隐藏 Layout Watch' }));
    expect(onOverlaysChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ visible: false }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: '移除 Layout Watch' }));
    await waitFor(() => expect(removeTrackPlugin).toHaveBeenCalledWith('layout-watch'));
    await waitFor(() => expect(onOverlaysChange).toHaveBeenLastCalledWith([]));
  });

  it('reports invalid manifests without sending a request', () => {
    const installTrackPlugin = jest.fn();
    render(
      <TrackPluginPanel
        client={{ installTrackPlugin } as unknown as TraceWorkbenchClient}
        range={{ startUs: 0, endUs: 1_000 }}
        onOverlaysChange={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('插件 ID'), {
      target: { value: 'INVALID_ID' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加临时轨道' }));
    expect(screen.getByRole('alert').textContent).toMatch(/插件 ID/);
    expect(installTrackPlugin).not.toHaveBeenCalled();
  });

  it('refreshes an installed plugin when its response arrives after a range change', async () => {
    let resolveInstall: ((response: object) => void) | undefined;
    const installTrackPlugin = jest.fn().mockReturnValue(new Promise(resolve => {
      resolveInstall = resolve;
    }));
    const queryTrackPlugin = jest.fn().mockResolvedValue({
      type: 'track-plugin-result',
      operation: 'refreshed',
      plugin: {
        pluginId: 'layout-watch',
        label: 'Layout Watch',
        trackId: 'plugin:layout-watch',
      },
      range: { startUs: 2_000, endUs: 3_000 },
      projectedEvents: [{
        eventId: 'plugin:layout-watch:trace:timeline:2',
        sourceEventId: 'trace:timeline:2',
        evidenceIds: [],
        trackId: 'plugin:layout-watch',
        category: 'rendering',
        name: 'NewRangeLayout',
        startUs: 2_100,
        durationUs: 5,
      }],
      evidenceIds: [],
      limitations: [],
      truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
    });
    const subject = {
      installTrackPlugin,
      queryTrackPlugin,
    } as unknown as TraceWorkbenchClient;
    const onOverlaysChange = jest.fn();
    const view = render(
      <TrackPluginPanel
        client={subject}
        range={{ startUs: 0, endUs: 1_000 }}
        onOverlaysChange={onOverlaysChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('插件 ID'), {
      target: { value: 'layout-watch' },
    });
    fireEvent.change(screen.getByLabelText('插件名称'), {
      target: { value: 'Layout Watch' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加临时轨道' }));
    view.rerender(
      <TrackPluginPanel
        client={subject}
        range={{ startUs: 2_000, endUs: 3_000 }}
        onOverlaysChange={onOverlaysChange}
      />,
    );
    resolveInstall?.({
      type: 'track-plugin-result',
      operation: 'installed',
      plugin: {
        pluginId: 'layout-watch',
        label: 'Layout Watch',
        trackId: 'plugin:layout-watch',
      },
      range: { startUs: 0, endUs: 1_000 },
      projectedEvents: [{
        eventId: 'plugin:layout-watch:trace:timeline:1',
        sourceEventId: 'trace:timeline:1',
        evidenceIds: [],
        trackId: 'plugin:layout-watch',
        category: 'rendering',
        name: 'OldRangeLayout',
        startUs: 100,
        durationUs: 5,
      }],
      evidenceIds: [],
      limitations: [],
      truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
    });

    await waitFor(() => expect(queryTrackPlugin).toHaveBeenCalledWith(
      'layout-watch',
      { startUs: 2_000, endUs: 3_000 },
    ));
    await waitFor(() => expect(onOverlaysChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        events: [expect.objectContaining({ name: 'NewRangeLayout' })],
      }),
    ]));
  });

  it('clears session overlays when the client changes', async () => {
    const firstClient = {
      installTrackPlugin: jest.fn().mockResolvedValue({
        type: 'track-plugin-result',
        operation: 'installed',
        plugin: {
          pluginId: 'session-only',
          label: 'Session Only',
          trackId: 'plugin:session-only',
        },
        range: { startUs: 0, endUs: 1_000 },
        projectedEvents: [],
        evidenceIds: [],
        limitations: [],
        truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
      }),
      queryTrackPlugin: jest.fn(),
    } as unknown as TraceWorkbenchClient;
    const secondClient = {
      queryTrackPlugin: jest.fn(),
    } as unknown as TraceWorkbenchClient;
    const onOverlaysChange = jest.fn();
    const view = render(
      <TrackPluginPanel
        client={firstClient}
        range={{ startUs: 0, endUs: 1_000 }}
        onOverlaysChange={onOverlaysChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('插件 ID'), {
      target: { value: 'session-only' },
    });
    fireEvent.change(screen.getByLabelText('插件名称'), {
      target: { value: 'Session Only' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加临时轨道' }));
    await waitFor(() => expect(onOverlaysChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ pluginId: 'session-only' }),
    ]));

    view.rerender(
      <TrackPluginPanel
        client={secondClient}
        range={{ startUs: 0, endUs: 1_000 }}
        onOverlaysChange={onOverlaysChange}
      />,
    );

    await waitFor(() => expect(onOverlaysChange).toHaveBeenLastCalledWith([]));
    expect(screen.queryByText('Session Only')).toBeNull();
    expect(secondClient.queryTrackPlugin).not.toHaveBeenCalled();
  });
});
