import { fireEvent, render, screen } from '@testing-library/react';
import { TraceWorkbenchClient } from '../../workbench/client';
import {
  WORKBENCH_SCHEMA_VERSION,
  type WorkbenchRequest,
  type WorkbenchResponse,
} from '../../workbench/protocol';
import TraceWorkbenchInternalPanel from './TraceWorkbenchInternalPanel';

function client() {
  const dispatch = async (request: WorkbenchRequest): Promise<WorkbenchResponse> => {
    if (request.type === 'create-session') {
      return {
        type: 'session-created',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: 'session',
        sessionRevision: 1,
        session: {
          sessionId: 'session',
          sessionRevision: 1,
          state: 'ready',
          source: request.source,
          capabilities: ['timeline-events', 'event-detail', 'raw-evidence'],
          missingCapabilities: [],
          range: { startUs: 0, endUs: 1_000 },
          eventCount: 0,
          trackEventCounts: {},
          screenshotCount: 0,
        },
      };
    }
    if (request.type === 'query-viewport') {
      return {
        type: 'viewport-result',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: request.requestId,
        sessionId: request.sessionId,
        sessionRevision: request.sessionRevision,
        range: request.range,
        events: [],
        truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
      };
    }
    throw new Error('unexpected request');
  };
  return new TraceWorkbenchClient({
    sourceId: 'source',
    parserId: 'trace',
    fingerprint: 'trace:1:0',
  }, { dispatch, close: jest.fn() });
}

describe('TraceWorkbenchInternalPanel', () => {
  beforeEach(() => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    delete process.env.REACT_APP_ENABLE_TRACE_TIMELINE;
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
    delete process.env.REACT_APP_ENABLE_TRACE_TIMELINE;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('keeps the stage 1 minimal panel when the Timeline flag is disabled', async () => {
    render(<TraceWorkbenchInternalPanel client={client()} diagnoses={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '打开交互式性能分析' }));

    expect(await screen.findByRole('heading', { name: '最小视口查询' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Performance Timeline' })).toBeNull();
  });

  it('enters the Timeline MVP only after the user creates a session', async () => {
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    render(<TraceWorkbenchInternalPanel client={client()} diagnoses={[]} />);
    expect(screen.queryByRole('heading', { name: 'Performance Timeline' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '打开交互式性能分析' }));
    expect(await screen.findByRole('heading', { name: 'Performance Timeline' })).not.toBeNull();
  });

  it('does not expose internal session language in the user action', () => {
    render(<TraceWorkbenchInternalPanel client={client()} diagnoses={[]} />);

    expect(screen.getByRole('button', {
      name: '打开交互式性能分析',
    })).not.toBeNull();
    expect(screen.queryByText('创建分析工作台会话')).toBeNull();
  });
});
