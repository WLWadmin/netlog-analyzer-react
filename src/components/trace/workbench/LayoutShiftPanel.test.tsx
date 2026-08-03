import {
  act,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import LayoutShiftPanel from './LayoutShiftPanel';

describe('LayoutShiftPanel', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows cluster range, score, members and limitations', async () => {
    const queryAdvancedAnalysis = jest.fn().mockResolvedValue({
      type: 'advanced-analysis-result',
      capability: 'layout-shifts',
      status: 'available',
      evidenceIds: ['trace:event:1', 'trace:event:2'],
      limitations: ['不映射原页面 DOM，不推断布局偏移根因。'],
      result: {
        kind: 'layout-shifts',
        clusters: [{
          clusterId: 'trace:layout-shift-cluster:1',
          startUs: 100,
          endUs: 900,
          cumulativeScore: 0.25,
          memberEventIds: ['trace:timeline:1', 'trace:timeline:2'],
          evidenceIds: ['trace:event:1', 'trace:event:2'],
          limitations: ['不映射原页面 DOM，不推断布局偏移根因。'],
        }],
      },
    });
    const onFocusRange = jest.fn();
    render(
      <LayoutShiftPanel
        client={{ queryAdvancedAnalysis } as unknown as TraceWorkbenchClient}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={onFocusRange}
      />,
    );

    expect(await screen.findByText(/累计值 0.2500/)).not.toBeNull();
    expect(screen.getByText(/成员事件 2/)).not.toBeNull();
    expect(screen.getAllByText(/不映射原页面 DOM/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /定位布局偏移簇/ }));
    expect(onFocusRange).toHaveBeenCalledWith({ startUs: 100, endUs: 900 });
  });

  it('shows an unavailable explanation when no explicit event exists', async () => {
    const queryAdvancedAnalysis = jest.fn().mockResolvedValue({
      type: 'advanced-analysis-result',
      capability: 'layout-shifts',
      status: 'unavailable',
      evidenceIds: [],
      limitations: ['当前范围没有明确的 LayoutShift 事件，CLS 能力不可用。'],
      result: { kind: 'layout-shifts', clusters: [] },
    });
    render(
      <LayoutShiftPanel
        client={{ queryAdvancedAnalysis } as unknown as TraceWorkbenchClient}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={jest.fn()}
      />,
    );

    expect(await screen.findByText(/CLS 能力不可用/)).not.toBeNull();
  });

  it('queries only the final range after rapid viewport changes', () => {
    jest.useFakeTimers();
    const queryAdvancedAnalysis = jest.fn().mockReturnValue(new Promise(
      () => undefined,
    ));
    const subject = {
      queryAdvancedAnalysis,
    } as unknown as TraceWorkbenchClient;
    const view = render(
      <LayoutShiftPanel
        client={subject}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={jest.fn()}
      />,
    );

    view.rerender(
      <LayoutShiftPanel
        client={subject}
        range={{ startUs: 1_000, endUs: 2_000 }}
        onFocusRange={jest.fn()}
      />,
    );
    view.rerender(
      <LayoutShiftPanel
        client={subject}
        range={{ startUs: 2_000, endUs: 3_000 }}
        onFocusRange={jest.fn()}
      />,
    );
    expect(queryAdvancedAnalysis).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(150));
    expect(queryAdvancedAnalysis).toHaveBeenCalledTimes(1);
    expect(queryAdvancedAnalysis).toHaveBeenCalledWith(
      'layout-shifts',
      { startUs: 2_000, endUs: 3_000 },
    );
  });
});
