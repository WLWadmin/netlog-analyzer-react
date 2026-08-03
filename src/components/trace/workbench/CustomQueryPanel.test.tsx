import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import CustomQueryPanel from './CustomQueryPanel';

function client(response: object) {
  return {
    queryCustomEvents: jest.fn().mockResolvedValue(response),
  } as unknown as TraceWorkbenchClient;
}

describe('CustomQueryPanel', () => {
  const range = { startUs: 0, endUs: 1_000 };

  it('shows unavailable without treating it as an empty match', async () => {
    render(
      <CustomQueryPanel
        client={client({
          type: 'structured-error',
          error: {
            code: 'unsupported-capability',
            message: 'Stage 6 disabled',
          },
        })}
        range={range}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '运行自定义查询' }));
    expect(await screen.findByText(/能力不可用/)).not.toBeNull();
    expect(screen.queryByText('当前查询没有匹配事件。')).toBeNull();
  });

  it('supports empty results and adding or deleting bounded clauses', async () => {
    const subject = client({
      type: 'custom-query-result',
      range,
      events: [],
      evidenceIds: [],
      limitations: ['匹配数量不表示性能问题或根因。'],
      truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
    });
    render(
      <CustomQueryPanel
        client={subject}
        range={range}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加查询条件' }));
    expect(screen.getAllByLabelText('查询字段')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '删除查询条件' })[1]);
    expect(screen.getAllByLabelText('查询字段')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '运行自定义查询' }));

    expect(await screen.findByText('当前查询没有匹配事件。')).not.toBeNull();
    expect(subject.queryCustomEvents).toHaveBeenCalledWith(
      range,
      {
        clauses: [{
          field: 'name',
          operator: 'contains',
          value: 'Task',
        }],
      },
      2_000,
    );
  });

  it('reports truncation and locates or opens a projected event', async () => {
    const focus = jest.fn();
    const open = jest.fn();
    render(
      <CustomQueryPanel
        client={client({
          type: 'custom-query-result',
          range,
          events: [{
            id: 'trace:timeline:1',
            trackId: 'main',
            startUs: 100,
            durationUs: 20,
            depth: 0,
            category: 'task',
            name: 'RunTask',
          }],
          evidenceIds: ['trace:event:1'],
          limitations: ['结果已截断。'],
          truncation: {
            truncated: true,
            returnedCount: 1,
            totalMatched: 2_001,
            continuation: 'trace:timeline:1',
          },
        })}
        range={range}
        onFocusRange={focus}
        onOpenEvent={open}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '运行自定义查询' }));
    expect(await screen.findByText(/已截断.*2001/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '定位 RunTask' }));
    expect(focus).toHaveBeenCalledWith({ startUs: 100, endUs: 120 });
    fireEvent.click(screen.getByRole('button', { name: '打开 RunTask 详情' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('trace:timeline:1'));
  });

  it('keeps the response bounded while rendering only a review window', async () => {
    const events = Array.from({ length: 2_000 }, (_, index) => ({
      id: `trace:timeline:${index}`,
      trackId: 'main',
      startUs: index,
      durationUs: 1,
      depth: 0,
      category: 'task',
      name: `RunTask ${index}`,
    }));
    render(
      <CustomQueryPanel
        client={client({
          type: 'custom-query-result',
          range,
          events,
          evidenceIds: [],
          limitations: [],
          truncation: {
            truncated: true,
            returnedCount: 2_000,
            totalMatched: 20_000,
            continuation: 'trace:timeline:1999',
          },
        })}
        range={range}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '运行自定义查询' }));
    expect(await screen.findByText(/仅展示前 100 条/)).not.toBeNull();
    expect(screen.queryByText(/继续翻页/)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    expect(screen.queryByText('RunTask 100')).toBeNull();
  });

  it('shows server limitations and clears results when the query changes', async () => {
    render(
      <CustomQueryPanel
        client={client({
          type: 'custom-query-result',
          range,
          events: [{
            id: 'trace:timeline:1',
            trackId: 'main',
            startUs: 100,
            durationUs: 20,
            depth: 0,
            category: 'task',
            name: 'RunTask',
          }],
          evidenceIds: [],
          limitations: ['证据引用已按 2000 项上限截断。'],
          truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
        })}
        range={range}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '运行自定义查询' }));
    expect(await screen.findByText(/证据引用已按 2000 项上限截断/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText('查询值'), {
      target: { value: 'Layout' },
    });
    expect(screen.queryByText(/RunTask/)).toBeNull();
  });

  it('clears old-range results when the selected range changes', async () => {
    const subject = client({
      type: 'custom-query-result',
      range,
      events: [{
        id: 'trace:timeline:1',
        trackId: 'main',
        startUs: 100,
        durationUs: 20,
        depth: 0,
        category: 'task',
        name: 'OldRangeTask',
      }],
      evidenceIds: [],
      limitations: [],
      truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
    });
    const view = render(
      <CustomQueryPanel
        client={subject}
        range={range}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '运行自定义查询' }));
    expect(await screen.findByText(/OldRangeTask/)).not.toBeNull();

    view.rerender(
      <CustomQueryPanel
        client={subject}
        range={{ startUs: 2_000, endUs: 3_000 }}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );
    expect(screen.queryByText(/OldRangeTask/)).toBeNull();
  });

  it('does not commit a query response that arrives after the range changed', async () => {
    let resolveQuery: ((response: object) => void) | undefined;
    const subject = {
      queryCustomEvents: jest.fn().mockReturnValue(new Promise(resolve => {
        resolveQuery = resolve;
      })),
    } as unknown as TraceWorkbenchClient;
    const view = render(
      <CustomQueryPanel
        client={subject}
        range={range}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '运行自定义查询' }));
    view.rerender(
      <CustomQueryPanel
        client={subject}
        range={{ startUs: 2_000, endUs: 3_000 }}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );
    resolveQuery?.({
      type: 'custom-query-result',
      range,
      events: [{
        id: 'trace:timeline:1',
        trackId: 'main',
        startUs: 100,
        durationUs: 20,
        depth: 0,
        category: 'task',
        name: 'LateOldRangeTask',
      }],
      evidenceIds: [],
      limitations: [],
      truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
    });
    await Promise.resolve();

    expect(screen.queryByText(/LateOldRangeTask/)).toBeNull();
  });

  it('does not commit a query response from a replaced client', async () => {
    let resolveQuery: ((response: object) => void) | undefined;
    const firstClient = {
      queryCustomEvents: jest.fn().mockReturnValue(new Promise(resolve => {
        resolveQuery = resolve;
      })),
    } as unknown as TraceWorkbenchClient;
    const secondClient = client({
      type: 'custom-query-result',
      range,
      events: [],
      evidenceIds: [],
      limitations: [],
      truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
    });
    const view = render(
      <CustomQueryPanel
        client={firstClient}
        range={range}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '运行自定义查询' }));
    view.rerender(
      <CustomQueryPanel
        client={secondClient}
        range={range}
        onFocusRange={jest.fn()}
        onOpenEvent={jest.fn()}
      />,
    );
    resolveQuery?.({
      type: 'custom-query-result',
      range,
      events: [{
        id: 'trace:timeline:1',
        trackId: 'main',
        startUs: 100,
        durationUs: 20,
        depth: 0,
        category: 'task',
        name: 'OldClientTask',
      }],
      evidenceIds: [],
      limitations: [],
      truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
    });
    await Promise.resolve();

    expect(screen.queryByText(/OldClientTask/)).toBeNull();
  });
});
