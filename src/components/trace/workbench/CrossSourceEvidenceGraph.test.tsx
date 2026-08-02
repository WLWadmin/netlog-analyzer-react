import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import { WORKBENCH_SCHEMA_VERSION } from '../../../workbench/protocol';
import { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';
import CrossSourceEvidenceGraph from './CrossSourceEvidenceGraph';

describe('CrossSourceEvidenceGraph', () => {
  it('renders bounded equivalent paths with confidence, conflicts and navigation', () => {
    const snapshot = {
      status: 'ready' as const,
      queryErrors: {},
      discardedResponseCount: 0,
      correlations: {
        type: 'correlation-result' as const,
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: 'correlations',
        sessionId: 'session',
        sessionRevision: 2,
        sourceRevision: 1,
        candidates: [],
        entities: [{
          entityId: 'har:request:1',
          sourceId: 'har:1',
          kind: 'request' as const,
          label: 'HAR 请求',
          safeKey: 'GET https://example.test/users/:id',
          method: 'GET',
          start: { value: 1_000, unit: 'us' as const },
          duration: { value: 500, unit: 'us' as const },
          evidenceIds: ['har:request:1'],
          limitations: [],
        }],
        truncation: { truncated: false, totalMatched: 0, returnedCount: 0 },
      },
      evidenceGraph: {
        type: 'evidence-graph-result' as const,
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: 'graph',
        sessionId: 'session',
        sessionRevision: 2,
        sourceRevision: 1,
        nodes: [{
          nodeId: 'node:har:request:1',
          kind: 'har-request' as const,
          label: 'HAR 请求',
          sourceId: 'har:1',
          entityId: 'har:request:1',
          facts: ['方法：GET'],
          timeRange: { startUs: 10_000, endUs: 20_000 },
          evidenceIds: ['har:request:1'],
          limitations: [],
        }],
        edges: [{
          edgeId: 'edge:1',
          fromNodeId: 'node:trace:request:1',
          toNodeId: 'node:har:request:1',
          kind: 'candidate-match' as const,
          label: '候选关联',
          confidence: 'medium' as const,
          relationship: 'candidate-contribution' as const,
          matchedFields: ['safe-request-key'],
          conflictingFields: ['navigation'],
          counterEvidence: ['时间重叠不能证明因果。'],
          alternativeExplanations: ['主线程工作量也可能贡献耗时。'],
          timeRange: { startUs: 10_000, endUs: 20_000 },
          limitations: ['导航不同，不能升级主因。'],
        }],
        limitations: ['时间校准不确定。'],
        truncation: { truncated: false, totalMatched: 2, returnedCount: 2 },
      },
    };
    const client = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      queryEvidenceGraph: jest.fn().mockResolvedValue(undefined),
    } as unknown as TraceWorkbenchClient;
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    const onEscape = jest.fn();
    const onNavigate = jest.fn((entityId: string) => store.highlightEntity(entityId));
    render(
      <CrossSourceEvidenceGraph
        client={client}
        store={store}
        onNavigate={onNavigate}
        onEscape={onEscape}
      />,
    );

    expect(screen.getByText(/中置信候选/)).not.toBeNull();
    expect(screen.getByText(/冲突：navigation/)).not.toBeNull();
    expect(screen.getByText(/事实：方法：GET/)).not.toBeNull();
    expect(screen.getByText(/反证：时间重叠不能证明因果/)).not.toBeNull();
    expect(screen.getByText(/替代解释：主线程工作量也可能贡献耗时/)).not.toBeNull();
    expect(screen.getByText(/仅候选贡献，不是已确认根因/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'HAR 请求' }));
    expect(onNavigate).toHaveBeenCalledWith('har:request:1');
    expect(store.getSnapshot().highlightedEntityId).toBe('har:request:1');
    expect(screen.getByText('脱敏请求键：GET https://example.test/users/:id'))
      .not.toBeNull();
    expect(screen.getByText('证据引用：har:request:1')).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('region', {
      name: 'Cross-source Evidence Graph',
    }), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalled();
  });

  it('does not send unrelated Stage 3 highlights as cross-source graph selections', async () => {
    const snapshot = {
      status: 'ready' as const,
      queryErrors: {},
      discardedResponseCount: 0,
      evidenceGraph: {
        type: 'evidence-graph-result' as const,
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: 'graph',
        sessionId: 'session',
        sessionRevision: 2,
        sourceRevision: 1,
        nodes: [],
        edges: [],
        limitations: [],
        truncation: { truncated: false, totalMatched: 0, returnedCount: 0 },
      },
    };
    const client = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      queryEvidenceGraph: jest.fn().mockResolvedValue(undefined),
    } as unknown as TraceWorkbenchClient;
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    store.highlightEntity('cpu-profile:unrelated');

    render(
      <CrossSourceEvidenceGraph
        client={client}
        store={store}
        onNavigate={jest.fn()}
        onEscape={jest.fn()}
      />,
    );

    await waitFor(() => expect(client.queryEvidenceGraph).toHaveBeenCalledWith({
      range: { startUs: 0, endUs: 100 },
      selectedEntityId: undefined,
      limit: 300,
    }));
  });
});
