import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { AdvancedAnalysisResultResponse } from '../../../workbench/protocol';
import MemoryTrendPanel from './MemoryTrendPanel';

function client(response: AdvancedAnalysisResultResponse) {
  return {
    queryAdvancedAnalysis: jest.fn().mockResolvedValue(response),
  } as unknown as TraceWorkbenchClient & {
    queryAdvancedAnalysis: jest.Mock;
  };
}

describe('MemoryTrendPanel', () => {
  it('shows byte samples, GC summary and focuses a GC range', async () => {
    const subject = client({
      type: 'advanced-analysis-result',
      schemaVersion: 1,
      requestId: 'memory',
      sessionId: 'session',
      sessionRevision: 1,
      capability: 'memory-trend',
      status: 'available',
      evidenceIds: ['trace:event:1', 'trace:event:2'],
      limitations: ['不确认内存泄漏。'],
      result: {
        kind: 'memory-trend',
        samples: [{
          timestampUs: 100,
          metric: 'js-heap-used',
          bytes: 1_024,
          evidenceIds: ['trace:event:1'],
        }],
        gcEvents: [{
          eventId: 'trace:gc:2',
          type: 'minor',
          startUs: 200,
          durationUs: 20,
          interactionEventIds: ['trace:timeline:3'],
          longTaskEventIds: [],
          evidenceIds: ['trace:event:2'],
        }],
        summary: {
          gcCount: 1,
          totalPauseUs: 20,
          maxPauseUs: 20,
        },
      },
    });
    const onFocusRange = jest.fn();

    render(
      <MemoryTrendPanel
        client={subject}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={onFocusRange}
      />,
    );

    expect(await screen.findByText(/GC 1 次/)).not.toBeNull();
    expect(screen.getByText(/JS Heap Used.*1.00 KiB/)).not.toBeNull();
    expect(screen.getByText(/交互上下文 1/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /定位 GC/ }));
    expect(onFocusRange).toHaveBeenCalledWith({ startUs: 200, endUs: 220 });
    expect(subject.queryAdvancedAnalysis).toHaveBeenCalledWith(
      'memory-trend',
      { startUs: 0, endUs: 1_000 },
    );
  });

  it('shows GC-only evidence as insufficient instead of a memory trend', async () => {
    const subject = client({
      type: 'advanced-analysis-result',
      schemaVersion: 1,
      requestId: 'memory',
      sessionId: 'session',
      sessionRevision: 1,
      capability: 'memory-trend',
      status: 'insufficient',
      evidenceIds: ['trace:event:2'],
      limitations: ['有 GC 事件，但没有明确内存计数器。'],
      result: {
        kind: 'memory-trend',
        samples: [],
        gcEvents: [],
        summary: { gcCount: 0, totalPauseUs: 0, maxPauseUs: 0 },
      },
    });

    render(
      <MemoryTrendPanel
        client={subject}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/证据不足/)).not.toBeNull();
    });
    expect(screen.queryByText(/内存趋势增长/)).toBeNull();
  });

  it('clears the previous range while a new query is pending', async () => {
    let resolveNext: ((response: AdvancedAnalysisResultResponse) => void) | undefined;
    const firstResponse: AdvancedAnalysisResultResponse = {
      type: 'advanced-analysis-result',
      schemaVersion: 1,
      requestId: 'memory-first',
      sessionId: 'session',
      sessionRevision: 1,
      capability: 'memory-trend',
      status: 'available',
      evidenceIds: ['trace:event:1'],
      limitations: [],
      result: {
        kind: 'memory-trend',
        samples: [{
          timestampUs: 100,
          metric: 'js-heap-used',
          bytes: 1_024,
          evidenceIds: ['trace:event:1'],
        }],
        gcEvents: [],
        summary: { gcCount: 0, totalPauseUs: 0, maxPauseUs: 0 },
      },
    };
    const queryAdvancedAnalysis = jest.fn()
      .mockResolvedValueOnce(firstResponse)
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveNext = resolve;
      }));
    const subject = { queryAdvancedAnalysis } as unknown as TraceWorkbenchClient;
    const { rerender } = render(
      <MemoryTrendPanel
        client={subject}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={jest.fn()}
      />,
    );
    expect(await screen.findByText(/1.00 KiB/)).not.toBeNull();

    rerender(
      <MemoryTrendPanel
        client={subject}
        range={{ startUs: 1_000, endUs: 2_000 }}
        onFocusRange={jest.fn()}
      />,
    );

    expect(screen.queryByText(/1.00 KiB/)).toBeNull();
    expect(screen.getByText(/正在检查/)).not.toBeNull();
    await act(async () => {
      resolveNext?.({
        ...firstResponse,
        requestId: 'memory-next',
        status: 'unavailable',
        evidenceIds: [],
        limitations: ['当前范围无证据。'],
        result: {
          kind: 'memory-trend',
          samples: [],
          gcEvents: [],
          summary: { gcCount: 0, totalPauseUs: 0, maxPauseUs: 0 },
        },
      });
    });
  });
});
