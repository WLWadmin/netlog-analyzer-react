import {
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import AnimationCompositionPanel from './AnimationCompositionPanel';

describe('AnimationCompositionPanel', () => {
  it('shows explicit state, associated evidence and non-causal limitation', async () => {
    const queryAdvancedAnalysis = jest.fn().mockResolvedValue({
      type: 'advanced-analysis-result',
      capability: 'animation-composition',
      status: 'available',
      evidenceIds: ['trace:event:1'],
      limitations: ['时间重叠只作范围关联，不证明动画导致帧或渲染活动。'],
      result: {
        kind: 'animation-composition',
        animations: [{
          animationId: 'trace:animation:1',
          startUs: 100,
          endUs: 300,
          state: 'composited',
          frameEventIds: ['trace:timeline:2'],
          renderingEventIds: ['trace:timeline:3'],
          evidenceIds: ['trace:event:1'],
          limitations: ['时间重叠只作范围关联，不证明动画导致帧或渲染活动。'],
        }],
      },
    });
    const onFocusRange = jest.fn();
    render(
      <AnimationCompositionPanel
        client={{ queryAdvancedAnalysis } as unknown as TraceWorkbenchClient}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={onFocusRange}
      />,
    );

    expect(await screen.findByText(/已合成/)).not.toBeNull();
    expect(screen.getByText(/关联帧 1 · 渲染活动 1/)).not.toBeNull();
    expect(screen.getAllByText(/不证明动画导致/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /定位动画/ }));
    expect(onFocusRange).toHaveBeenCalledWith({ startUs: 100, endUs: 300 });
  });

  it('shows unknown state when composition evidence is insufficient', async () => {
    const queryAdvancedAnalysis = jest.fn().mockResolvedValue({
      type: 'advanced-analysis-result',
      capability: 'animation-composition',
      status: 'insufficient',
      evidenceIds: ['trace:event:1'],
      limitations: ['动画事件没有明确 compositor 状态。'],
      result: {
        kind: 'animation-composition',
        animations: [{
          animationId: 'trace:animation:1',
          startUs: 100,
          endUs: 300,
          state: 'unknown',
          frameEventIds: [],
          renderingEventIds: [],
          evidenceIds: ['trace:event:1'],
          limitations: ['不根据时间重叠推断合成状态。'],
        }],
      },
    });
    render(
      <AnimationCompositionPanel
        client={{ queryAdvancedAnalysis } as unknown as TraceWorkbenchClient}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={jest.fn()}
      />,
    );

    expect(await screen.findByText(/状态未知/)).not.toBeNull();
    expect(screen.getByText(/证据不足/)).not.toBeNull();
  });
});
