import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type {
  TraceWorkbenchClient,
  TraceWorkbenchClientSnapshot,
} from '../../../workbench/client';
import { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';
import { createFileParseInput } from '../../../upload/createFileFormatIntake';
import TraceComparisonPanel from './TraceComparisonPanel';

jest.mock('../../../upload/createFileFormatIntake', () => ({
  createFileParseInput: jest.fn().mockResolvedValue({
    probeVerdicts: [{
      parserId: 'chromium-performance-trace@1',
      kind: 'definite-match',
      evidenceCodes: [],
    }],
  }),
}));

function client(snapshot: TraceWorkbenchClientSnapshot) {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    addComparisonBaseline: jest.fn().mockResolvedValue({
      type: 'comparison-baseline-result',
      baselineAvailable: true,
    }),
    removeComparisonBaseline: jest.fn().mockResolvedValue(undefined),
    queryTraceComparison: jest.fn().mockResolvedValue(snapshot.comparison),
  } as unknown as TraceWorkbenchClient & {
    addComparisonBaseline: jest.Mock;
    removeComparisonBaseline: jest.Mock;
    queryTraceComparison: jest.Mock;
  };
}

describe('TraceComparisonPanel', () => {
  beforeEach(() => {
    (createFileParseInput as jest.Mock).mockResolvedValue({
      probeVerdicts: [{
        parserId: 'chromium-performance-trace@1',
        kind: 'definite-match',
        evidenceCodes: [],
      }],
    });
  });

  it('shows incomparability and blocks a regression conclusion', () => {
    const subject = client({
      status: 'ready',
      queryErrors: {},
      discardedResponseCount: 0,
      comparisonBaseline: {
        type: 'comparison-baseline-result',
        schemaVersion: 1,
        requestId: 'baseline',
        sessionId: 'session',
        sessionRevision: 2,
        operation: 'added',
        baselineAvailable: true,
        limitations: [],
      },
      comparison: {
        type: 'trace-comparison-result',
        schemaVersion: 1,
        requestId: 'comparison',
        sessionId: 'session',
        sessionRevision: 2,
        status: 'sample-incomparable',
        range: { startUs: 0, endUs: 100 },
        regression: 'unavailable',
        metrics: [{
          metric: 'matched-events',
          current: 10,
          baseline: 100,
          deltaPercent: -90,
        }],
        evidenceIds: ['current:trace:event:1'],
        limitations: ['事件规模差异过大'],
      },
    });
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });

    render(<TraceComparisonPanel client={subject} store={store} />);

    expect(screen.getByText(/状态：样本不可比/)).not.toBeNull();
    expect(screen.getByText(/禁止输出性能退化结论/)).not.toBeNull();
    expect(screen.getByText(/事件规模差异过大/)).not.toBeNull();
    expect(screen.getByText(/仅在当前 Worker 会话内处理/)).not.toBeNull();
  });

  it('accepts only a definite local Trace and sends the file to the client', async () => {
    const subject = client({
      status: 'ready',
      queryErrors: {},
      discardedResponseCount: 0,
    });
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    render(<TraceComparisonPanel client={subject} store={store} />);
    const file = new File(['{"traceEvents":[]}'], 'baseline.trace');

    fireEvent.change(screen.getByLabelText('选择本地基线 Trace'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(subject.addComparisonBaseline).toHaveBeenCalledWith(file);
    });
    expect(subject.queryTraceComparison).toHaveBeenCalledWith({
      startUs: 0,
      endUs: 100,
    }, false);
  });

  it('coalesces rapid viewport changes before querying the baseline', async () => {
    jest.useFakeTimers();
    const subject = client({
      status: 'ready',
      queryErrors: {},
      discardedResponseCount: 0,
      comparisonBaseline: {
        type: 'comparison-baseline-result',
        schemaVersion: 1,
        requestId: 'baseline',
        sessionId: 'session',
        sessionRevision: 2,
        operation: 'added',
        baselineAvailable: true,
        sourceBytes: 100,
        eventCount: 2,
        limitations: [],
      },
    });
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    try {
      render(<TraceComparisonPanel client={subject} store={store} />);
      act(() => {
        store.setViewport({ startUs: 0, endUs: 80 });
        store.setViewport({ startUs: 10, endUs: 70 });
      });
      act(() => {
        jest.advanceTimersByTime(499);
      });
      expect(subject.queryTraceComparison).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(subject.queryTraceComparison).toHaveBeenCalledTimes(1);
      expect(subject.queryTraceComparison).toHaveBeenCalledWith({
        startUs: 10,
        endUs: 70,
      }, false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('requires explicit same-scenario confirmation before enabling a comparison claim', async () => {
    jest.useFakeTimers();
    const subject = client({
      status: 'ready',
      queryErrors: {},
      discardedResponseCount: 0,
      comparisonBaseline: {
        type: 'comparison-baseline-result',
        schemaVersion: 1,
        requestId: 'baseline',
        sessionId: 'session',
        sessionRevision: 2,
        operation: 'added',
        baselineAvailable: true,
        sourceBytes: 100,
        eventCount: 2,
        limitations: [],
      },
    });
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    try {
      render(<TraceComparisonPanel client={subject} store={store} />);
      fireEvent.click(screen.getByRole('checkbox', {
        name: '我确认当前 Trace 与基线 Trace 属于同一场景',
      }));
      await act(async () => {
        jest.advanceTimersByTime(500);
        await Promise.resolve();
      });
      expect(subject.queryTraceComparison).toHaveBeenCalledWith({
        startUs: 0,
        endUs: 100,
      }, true);
    } finally {
      jest.useRealTimers();
    }
  });
});
