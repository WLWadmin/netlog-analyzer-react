import {
  act,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { AdvancedAnalysisResultResponse } from '../../../workbench/protocol';
import GpuRasterPanel from './GpuRasterPanel';

function client(response: AdvancedAnalysisResultResponse) {
  return {
    queryAdvancedAnalysis: jest.fn().mockResolvedValue(response),
  } as unknown as TraceWorkbenchClient & {
    queryAdvancedAnalysis: jest.Mock;
  };
}

describe('GpuRasterPanel', () => {
  it('summarizes recorded activity and focuses an interval', async () => {
    const subject = client({
      type: 'advanced-analysis-result',
      schemaVersion: 1,
      requestId: 'gpu-raster',
      sessionId: 'session',
      sessionRevision: 1,
      capability: 'gpu-raster',
      status: 'available',
      evidenceIds: ['trace:event:1'],
      limitations: ['不推断硬件瓶颈。'],
      result: {
        kind: 'gpu-raster',
        intervals: [{
          eventId: 'trace:gpu-raster:1',
          activity: 'raster',
          startUs: 100,
          durationUs: 20,
          evidenceIds: ['trace:event:1'],
        }],
        summary: {
          intervalCount: 1,
          gpuIntervalCount: 0,
          rasterIntervalCount: 1,
          totalDurationUs: 20,
          maxDurationUs: 20,
        },
      },
    });
    const onFocusRange = jest.fn();

    render(
      <GpuRasterPanel
        client={subject}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={onFocusRange}
      />,
    );

    expect(await screen.findByText(/记录到 1 个 GPU\/Raster 区间/)).not.toBeNull();
    expect(screen.getByText(/Raster 1/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /定位 GPU\/Raster/ }));
    expect(onFocusRange).toHaveBeenCalledWith({ startUs: 100, endUs: 120 });
    expect(subject.queryAdvancedAnalysis).toHaveBeenCalledWith(
      'gpu-raster',
      { startUs: 0, endUs: 1_000 },
    );
  });

  it('shows an explicit unavailable state when evidence is absent', async () => {
    const subject = client({
      type: 'advanced-analysis-result',
      schemaVersion: 1,
      requestId: 'gpu-raster',
      sessionId: 'session',
      sessionRevision: 1,
      capability: 'gpu-raster',
      status: 'unavailable',
      evidenceIds: [],
      limitations: ['当前范围没有明确 GPU/Raster 事件。'],
      result: {
        kind: 'gpu-raster',
        intervals: [],
        summary: {
          intervalCount: 0,
          gpuIntervalCount: 0,
          rasterIntervalCount: 0,
          totalDurationUs: 0,
          maxDurationUs: 0,
        },
      },
    });

    render(
      <GpuRasterPanel
        client={subject}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={jest.fn()}
      />,
    );

    expect(await screen.findByText(/能力不可用/)).not.toBeNull();
    expect(screen.queryByText(/GPU 利用率/)).toBeNull();
  });

  it('clears the previous range while a new query is pending', async () => {
    let resolveNext: ((response: AdvancedAnalysisResultResponse) => void) | undefined;
    const firstResponse: AdvancedAnalysisResultResponse = {
      type: 'advanced-analysis-result',
      schemaVersion: 1,
      requestId: 'gpu-first',
      sessionId: 'session',
      sessionRevision: 1,
      capability: 'gpu-raster',
      status: 'available',
      evidenceIds: ['trace:event:1'],
      limitations: [],
      result: {
        kind: 'gpu-raster',
        intervals: [{
          eventId: 'trace:gpu-raster:1',
          activity: 'gpu',
          startUs: 100,
          durationUs: 10,
          evidenceIds: ['trace:event:1'],
        }],
        summary: {
          intervalCount: 1,
          gpuIntervalCount: 1,
          rasterIntervalCount: 0,
          totalDurationUs: 10,
          maxDurationUs: 10,
        },
      },
    };
    const queryAdvancedAnalysis = jest.fn()
      .mockResolvedValueOnce(firstResponse)
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveNext = resolve;
      }));
    const subject = { queryAdvancedAnalysis } as unknown as TraceWorkbenchClient;
    const { rerender } = render(
      <GpuRasterPanel
        client={subject}
        range={{ startUs: 0, endUs: 1_000 }}
        onFocusRange={jest.fn()}
      />,
    );
    expect(await screen.findByText(/记录到 1 个/)).not.toBeNull();

    rerender(
      <GpuRasterPanel
        client={subject}
        range={{ startUs: 1_000, endUs: 2_000 }}
        onFocusRange={jest.fn()}
      />,
    );

    expect(screen.queryByText(/记录到 1 个/)).toBeNull();
    expect(screen.getByText(/正在检查/)).not.toBeNull();
    await act(async () => {
      resolveNext?.({
        ...firstResponse,
        requestId: 'gpu-next',
        status: 'unavailable',
        evidenceIds: [],
        limitations: ['当前范围无证据。'],
        result: {
          kind: 'gpu-raster',
          intervals: [],
          summary: {
            intervalCount: 0,
            gpuIntervalCount: 0,
            rasterIntervalCount: 0,
            totalDurationUs: 0,
            maxDurationUs: 0,
          },
        },
      });
    });
  });
});
