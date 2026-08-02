import {
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';
import InsightNavigator from './InsightNavigator';

describe('InsightNavigator', () => {
  it('shows evidence quality, limitations, verification and navigates', () => {
    const insight = {
      insightId: 'insight:1',
      priority: 1,
      phenomenon: 'Long task',
      evidenceQuality: 'high' as const,
      attributionLevel: 'possible-contributor' as const,
      candidateReasons: ['候选贡献关系'],
      limitations: ['时间重叠不能证明因果'],
      verificationSteps: ['复核证据路径'],
      timeRange: { startUs: 10_000, endUs: 20_000 },
      evidenceNodeIds: ['node:trace:timeline:1'],
    };
    const snapshot = {
      status: 'ready' as const,
      queryErrors: {},
      discardedResponseCount: 0,
      insights: {
        type: 'insights-result' as const,
        schemaVersion: 1 as const,
        requestId: 'insights',
        sessionId: 'session',
        sessionRevision: 1,
        sourceRevision: 0,
        range: { startUs: 0, endUs: 100_000 },
        insights: [insight],
        limitations: ['低置信关联不参与原因升级'],
        truncation: { truncated: false, totalMatched: 1, returnedCount: 1 },
      },
    };
    const client = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      queryInsights: jest.fn().mockResolvedValue(snapshot.insights),
    } as unknown as TraceWorkbenchClient;
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100_000 });
    const onNavigate = jest.fn();

    render(
      <InsightNavigator client={client} store={store} onNavigate={onNavigate} />,
    );

    expect(screen.getByText(/高质量证据/)).not.toBeNull();
    expect(screen.getByText(/时间重叠不能证明因果/)).not.toBeNull();
    expect(screen.getByText(/建议验证：复核证据路径/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Long task/ }));
    expect(onNavigate).toHaveBeenCalledWith(insight);
  });
});
