import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { TraceDiagnosis } from '../../../diagnosis/trace';
import { TraceWorkbenchClient } from '../../../workbench/client';
import {
  WORKBENCH_SCHEMA_VERSION,
  type WorkbenchRequest,
  type WorkbenchResponse,
} from '../../../workbench/protocol';
import TraceTimelineWorkbench from './TraceTimelineWorkbench';

const diagnosis: TraceDiagnosis = {
  id: 'diagnosis-1',
  ruleId: 'R1',
  category: 'rendering',
  severity: 'warning',
  score: 70,
  title: 'Forced Reflow 观察',
  conclusion: 'Trace 记录到同步布局线索。',
  confidence: 'observation',
  evidenceIds: ['trace:event:2'],
  counterEvidence: [],
  advice: [],
  factIds: [],
  limitations: [],
};

async function createClient(
  missingNetwork = false,
  viewportFailures = 0,
  selectionFailures = 0,
) {
  const close = jest.fn();
  let viewportCount = 0;
  let selectionCount = 0;
  const dispatch = jest.fn(async (request: WorkbenchRequest): Promise<WorkbenchResponse> => {
    const session = {
      sessionId: 'session-1',
      sessionRevision: 1,
    };
    if (request.type === 'create-session') {
      return {
        type: 'session-created',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        ...session,
        session: {
          ...session,
          state: missingNetwork ? 'degraded' : 'ready',
          source: {
            sourceId: 'source',
            parserId: 'trace',
            fingerprint: 'trace:1:3',
          },
          capabilities: [
            'timeline-events',
            'event-detail',
            'raw-evidence',
            'rendering',
            'interactions',
            'frames',
            'screenshots',
            ...(missingNetwork ? [] : ['network' as const]),
          ],
          missingCapabilities: missingNetwork
            ? [{ capability: 'network' as const, reason: 'Trace 未包含网络事件' }]
            : [],
          range: { startUs: 0, endUs: 1_000_000 },
          eventCount: 3,
          trackEventCounts: {
            rendering: 1,
            ...(missingNetwork ? {} : { network: 1 }),
          },
          screenshotCount: 0,
        },
      };
    }
    if (request.type === 'query-viewport') {
      viewportCount += 1;
      if (viewportCount <= viewportFailures) {
        return {
          type: 'structured-error',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          ...session,
          error: {
            code: 'query-timeout',
            message: '当前范围查询超时',
            recoverable: true,
          },
        };
      }
      return {
        type: 'viewport-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        ...session,
        range: request.range,
        events: [{
          id: 'trace:timeline:2',
          trackId: 'rendering',
          startUs: 400_000,
          durationUs: 20_000,
          depth: 0,
          category: 'rendering',
          name: 'Layout',
        }],
        truncation: { truncated: false, returnedCount: 1, totalMatched: 1 },
      };
    }
    if (request.type === 'query-selection') {
      selectionCount += 1;
      if (selectionCount <= selectionFailures) {
        return {
          type: 'structured-error',
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
          requestId: request.requestId,
          ...session,
          error: {
            code: 'query-timeout',
            message: '选区查询超时',
            recoverable: true,
          },
        };
      }
      return {
        type: 'selection-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        ...session,
        range: request.range,
        matchedCount: 1,
        trackCounts: { rendering: 1 },
        statusCounts: { warning: 1 },
        truncation: { truncated: false, countedCount: 1, totalMatched: 1 },
      };
    }
    if (request.type === 'query-event-detail') {
      return {
        type: 'event-detail-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        ...session,
        detail: {
          id: request.eventId,
          trackId: 'rendering',
          startUs: 400_000,
          durationUs: 20_000,
          depth: 0,
          category: 'rendering',
          name: 'Layout',
          childIds: [],
          evidenceIds: ['trace:event:2'],
        },
      };
    }
    if (request.type === 'query-evidence') {
      return {
        type: 'evidence-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        ...session,
        evidence: {
          evidenceId: request.evidenceId,
          name: 'Layout',
          timestampUs: 400_000,
        },
      };
    }
    if (request.type === 'release-session') {
      return {
        type: 'session-released',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        ...session,
        releasedRequestCount: 0,
        revokedBlobUrlCount: 0,
        releasedBufferCount: 0,
      };
    }
    throw new Error(`Unexpected request ${request.type}`);
  });
  const client = new TraceWorkbenchClient({
    sourceId: 'source',
    parserId: 'trace',
    fingerprint: 'trace:1:3',
  }, { dispatch, close });
  await client.createSession();
  return { client, close, dispatch };
}

describe('TraceTimelineWorkbench', () => {
  beforeEach(() => {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      strokeRect: jest.fn(),
      fillText: jest.fn(),
      setTransform: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      fill: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
      set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
      set lineWidth(_value: number) {},
      set font(_value: string) {},
    } as unknown as CanvasRenderingContext2D);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('renders the Timeline MVP and navigates diagnosis to event and evidence', async () => {
    const { client, close, dispatch } = await createClient();
    render(<TraceTimelineWorkbench client={client} diagnoses={[diagnosis]} />);

    expect(screen.getByRole('heading', { name: 'Performance Timeline' })).not.toBeNull();
    expect(await screen.findByText(/已选择范围内返回 1 个事件/)).not.toBeNull();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'query-viewport',
      balanceByTrack: true,
    }));

    const trigger = screen.getByRole('button', { name: '定位诊断：Forced Reflow 观察' });
    const focus = jest.spyOn(trigger, 'focus');
    trigger.focus();
    focus.mockClear();
    fireEvent.click(trigger);
    expect(await screen.findByText(/事件详情 · Layout/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看原始证据白名单详情' }));
    expect(await screen.findByText(/证据 · Layout/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回先前视口' }));
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '关闭工作台' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it('hides unavailable tracks and displays the capability reason', async () => {
    const { client } = await createClient(true);
    render(<TraceTimelineWorkbench client={client} diagnoses={[]} />);

    expect(await screen.findByText(/网络：当前 Trace 未提供该类数据/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: '折叠 Network' })).toBeNull();
    expect(screen.getByText('窄屏事件列表')).not.toBeNull();
  });

  it('queries and displays a brush selection without replacing event selection', async () => {
    const { client, dispatch } = await createClient();
    render(<TraceTimelineWorkbench client={client} diagnoses={[]} />);
    await screen.findByText(/已选择范围内返回 1 个事件/);

    const canvas = screen.getByRole('application', { name: /Timeline 画布/ });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true });

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'query-selection',
        range: expect.objectContaining({ startUs: expect.any(Number) }),
      }),
    ));
    expect(await screen.findByText(/选区匹配 1 个事件/)).not.toBeNull();
    expect(screen.getAllByText(/已选择 Layout/)).toHaveLength(2);
  });

  it('keeps a structured selection error local to the detail region', async () => {
    const { client } = await createClient(false, 0, 1);
    render(<TraceTimelineWorkbench client={client} diagnoses={[]} />);
    await screen.findByText(/已选择范围内返回 1 个事件/);

    const canvas = screen.getByRole('application', { name: /Timeline 画布/ });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true });

    expect(await screen.findByText(/选区统计失败/)).not.toBeNull();
    expect(screen.queryByText(/当前范围更新失败/)).toBeNull();
  });

  it('saves and restores history for an ordinary event detail', async () => {
    const { client } = await createClient();
    render(<TraceTimelineWorkbench client={client} diagnoses={[]} />);
    const eventButton = await screen.findByRole('button', { name: 'Layout · 400.00 ms' });
    const focus = jest.spyOn(eventButton, 'focus');
    eventButton.focus();
    focus.mockClear();

    expect(screen.queryByRole('button', { name: '返回先前视口' })).toBeNull();
    fireEvent.click(eventButton);
    expect(await screen.findByText(/事件详情 · Layout/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回先前视口' }));

    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: '返回先前视口' })).toBeNull();
  });

  it('does not announce loading for a viewport query that settles within 300ms', async () => {
    const { client } = await createClient();
    render(<TraceTimelineWorkbench client={client} diagnoses={[]} />);

    await screen.findByText(/已选择范围内返回 1 个事件/);
    expect(screen.queryByText(/正在更新当前范围/)).toBeNull();
  });

  it('retries the same viewport after a recoverable query error', async () => {
    const { client, dispatch } = await createClient(false, 1);
    render(<TraceTimelineWorkbench client={client} diagnoses={[]} />);

    const retry = await screen.findByRole('button', { name: '重试当前范围' });
    fireEvent.click(retry);

    expect(await screen.findByText(/已选择范围内返回 1 个事件/)).not.toBeNull();
    expect(dispatch.mock.calls
      .map(([request]) => request)
      .filter(request => request.type === 'query-viewport')).toHaveLength(2);
  });

  it('shows fatal Worker recovery guidance without a main-thread fallback', async () => {
    const { client } = await createClient();
    render(<TraceTimelineWorkbench client={client} diagnoses={[]} />);
    await screen.findByText(/已选择范围内返回 1 个事件/);

    act(() => client.fail());

    expect(await screen.findByText(/不会自动回退到主线程解析/)).not.toBeNull();
  });
});
