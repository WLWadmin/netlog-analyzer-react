import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import { WORKBENCH_SCHEMA_VERSION } from '../../../workbench/protocol';
import { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';
import ExpertAnalysisDrawer from './ExpertAnalysisDrawer';

describe('ExpertAnalysisDrawer', () => {
  it('navigates bounded search results without rewriting the brush', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    store.setSelection({ startUs: 10, endUs: 20 });
    const openEvent = jest.fn();
    const snapshot = {
      status: 'ready' as const,
      queryErrors: {},
      discardedResponseCount: 0,
      search: {
        type: 'search-result' as const,
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: 'search-1',
        sessionId: 'session',
        sessionRevision: 1,
        range: { startUs: 10, endUs: 20 },
        query: 'layout',
        events: [
          {
            id: 'event-1',
            trackId: 'rendering',
            startUs: 11,
            durationUs: 1,
            depth: 0,
            category: 'rendering',
            name: 'Layout',
          },
          {
            id: 'event-2',
            trackId: 'rendering',
            startUs: 12,
            durationUs: 1,
            depth: 0,
            category: 'rendering',
            name: 'Layout callback',
          },
        ],
        currentIndex: 1,
        truncation: { truncated: false, returnedCount: 2, totalMatched: 2 },
      },
    };
    const client = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      queryFlameChart: jest.fn(),
      queryCallTree: jest.fn(),
      queryBottomUp: jest.fn(),
      queryEventLog: jest.fn(),
      querySearch: jest.fn(),
    } as unknown as TraceWorkbenchClient;
    render(
      <ExpertAnalysisDrawer
        client={client}
        store={store}
        onOpenEvent={openEvent}
        onEscape={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '下一个' }));
    expect(openEvent).toHaveBeenLastCalledWith('event-2');
    expect(screen.getByText(/当前 2/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '上一个' }));
    expect(openEvent).toHaveBeenLastCalledWith('event-1');
    expect(store.getSnapshot().selection).toEqual({ startUs: 10, endUs: 20 });
  });

  it('shares CPU entity highlighting and opens resolvable raw evidence', async () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    const openEvent = jest.fn();
    const snapshot = {
      status: 'ready' as const,
      queryErrors: {},
      discardedResponseCount: 0,
      callTree: {
        type: 'call-tree-result' as const,
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: 'call-tree-1',
        sessionId: 'session',
        sessionRevision: 1,
        range: { startUs: 0, endUs: 100 },
        capability: 'available' as const,
        limitations: [],
        nodes: [{
          id: 'cpu:call-tree:profile:1/2',
          nodeId: 2,
          entityId: 'cpu:node:profile:2',
          parentId: 'cpu:call-tree:profile:1',
          functionName: 'work',
          selfTimeUs: 20,
          totalTimeUs: 30,
          sampleHits: 1,
          depth: 1,
          evidenceIds: ['trace:event:7'],
        }],
        truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
      },
    };
    const client = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      queryFlameChart: jest.fn().mockResolvedValue(undefined),
      queryCallTree: jest.fn().mockResolvedValue(undefined),
      queryBottomUp: jest.fn().mockResolvedValue(undefined),
      queryEventLog: jest.fn().mockResolvedValue(undefined),
      querySearch: jest.fn().mockResolvedValue(undefined),
      clearSearch: jest.fn(),
    } as unknown as TraceWorkbenchClient;
    render(
      <ExpertAnalysisDrawer
        client={client}
        store={store}
        onOpenEvent={openEvent}
        onEscape={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Call Tree' }));
    await waitFor(() => expect(client.queryCallTree).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    expect(store.getSnapshot().highlightedEntityId).toBe('cpu:node:profile:2');
    fireEvent.click(screen.getByRole('button', { name: '查看原始证据' }));
    expect(openEvent).toHaveBeenCalledWith('trace:timeline:7');
  });
});
