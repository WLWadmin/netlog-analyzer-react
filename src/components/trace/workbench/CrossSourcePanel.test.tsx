import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  TraceWorkbenchClient,
  TraceWorkbenchClientSnapshot,
} from '../../../workbench/client';
import type { SourceDescriptor } from '../../../workbench/crossSourceProtocol';
import { WORKBENCH_SCHEMA_VERSION } from '../../../workbench/protocol';
import { createFileParseInput } from '../../../upload/createFileFormatIntake';
import CrossSourcePanel from './CrossSourcePanel';

jest.mock('../../../upload/createFileFormatIntake', () => ({
  createFileParseInput: jest.fn().mockResolvedValue({
    probeVerdicts: [
      { parserId: 'har@1', kind: 'definite-match', evidenceCodes: [] },
      { parserId: 'chromium-netlog@1', kind: 'definite-match', evidenceCodes: [] },
    ],
  }),
}));

function client() {
  let snapshot: TraceWorkbenchClientSnapshot = {
    status: 'ready' as const,
    queryErrors: {},
    discardedResponseCount: 0,
    session: {
      sessionId: 'session',
      sessionRevision: 1,
      state: 'ready' as const,
      source: { sourceId: 'trace:1', parserId: 'trace' as const, fingerprint: 'trace' },
      capabilities: [],
      missingCapabilities: [],
      range: { startUs: 0, endUs: 100 },
      eventCount: 0,
      trackEventCounts: {},
      screenshotCount: 0,
    },
    sources: {
      type: 'sources-result' as const,
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'sources',
      sessionId: 'session',
      sessionRevision: 1,
      sourceRevision: 0,
      sources: [{
        sourceId: 'trace:1',
        kind: 'trace' as const,
        parserId: 'trace' as const,
        label: 'Trace 来源',
        state: 'ready' as const,
        byteLength: 100,
        clockDomain: {
          kind: 'trace-monotonic-us' as const,
          unit: 'us' as const,
          calibrated: true,
        },
        capabilities: ['requests' as const],
        limitations: [],
      }],
    },
  };
  const sourceChangeResult = () => ({
    type: 'source-change-result' as const,
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    requestId: 'source-change',
    sessionId: 'session',
    sessionRevision: (snapshot.session?.sessionRevision ?? 1) + 1,
    sourceRevision: (snapshot.sources?.sourceRevision ?? 0) + 1,
    operation: 'removed' as const,
    sources: snapshot.sources?.sources ?? [],
    revokedEdgeCount: 0,
    revokedFindingCount: 0,
  });
  const subject = {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    querySources: jest.fn().mockResolvedValue(undefined),
    queryAlignments: jest.fn().mockResolvedValue(undefined),
    queryCorrelations: jest.fn().mockResolvedValue(undefined),
    queryEvidenceGraph: jest.fn().mockResolvedValue(undefined),
    addSource: jest.fn().mockImplementation(async () => sourceChangeResult()),
    replaceSource: jest.fn().mockImplementation(async () => sourceChangeResult()),
    removeSource: jest.fn().mockImplementation(async () => sourceChangeResult()),
    setSnapshot(next: TraceWorkbenchClientSnapshot) {
      snapshot = next;
    },
  };
  return subject as unknown as TraceWorkbenchClient & typeof subject;
}

describe('CrossSourcePanel', () => {
  beforeEach(() => {
    (createFileParseInput as jest.Mock).mockResolvedValue({
      probeVerdicts: [
        { parserId: 'har@1', kind: 'definite-match', evidenceCodes: [] },
        { parserId: 'chromium-netlog@1', kind: 'definite-match', evidenceCodes: [] },
      ],
    });
  });

  it('shows source clock and alignment state without internal enums', async () => {
    const subject = client();
    render(<CrossSourcePanel client={subject} />);

    fireEvent.click(screen.getByRole('button', { name: '管理来源（1）' }));
    expect(await screen.findByText('Trace 来源')).not.toBeNull();
    expect(screen.getByText(/Trace 单调时钟/)).not.toBeNull();
    expect(screen.queryByText('trace-monotonic-us')).toBeNull();
  });

  it('requires explicit confirmation before replacing the same source kind', async () => {
    const subject = client();
    const current = subject.getSnapshot();
    subject.setSnapshot({
      ...current,
      sources: {
        ...current.sources!,
        sources: [
          ...current.sources!.sources,
          {
            sourceId: 'har:1',
            kind: 'har',
            parserId: 'har@1',
            label: 'HAR 来源',
            state: 'ready',
            byteLength: 100,
            clockDomain: { kind: 'har-epoch-ms', unit: 'ms', calibrated: true },
            capabilities: ['requests'],
            limitations: [],
          } satisfies SourceDescriptor,
        ],
      },
    });
    render(<CrossSourcePanel client={subject} />);
    fireEvent.click(screen.getByRole('button', { name: '管理来源（2）' }));
    const input = screen.getByLabelText('追加 HAR 文件');
    fireEvent.change(input, {
      target: {
        files: [new File([
          '{"log":{"entries":[]}}',
        ], 'replacement.har', { type: 'application/json' })],
      },
    });

    expect(await screen.findByText(/已存在 HAR 来源/)).not.toBeNull();
    expect(subject.replaceSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消替换' }));
    expect(subject.replaceSource).not.toHaveBeenCalled();
  });

  it('removes a source through the Worker and refreshes dependent queries', async () => {
    const subject = client();
    const current = subject.getSnapshot();
    subject.setSnapshot({
      ...current,
      sources: {
        ...current.sources!,
        sources: [
          ...current.sources!.sources,
          {
            sourceId: 'netlog:1',
            kind: 'netlog',
            parserId: 'chromium-netlog@1',
            label: 'NetLog 来源',
            state: 'degraded',
            byteLength: 100,
            clockDomain: { kind: 'unknown', unit: 'ms', calibrated: false },
            capabilities: ['requests'],
            limitations: ['NetLog time origin 缺失'],
          } satisfies SourceDescriptor,
        ],
      },
    });
    render(<CrossSourcePanel client={subject} />);
    fireEvent.click(screen.getByRole('button', { name: '管理来源（2）' }));
    fireEvent.click(screen.getByRole('button', { name: '移除 NetLog 来源' }));

    await waitFor(() => expect(subject.removeSource).toHaveBeenCalledWith('netlog:1'));
    expect(subject.queryAlignments).toHaveBeenCalled();
    expect(subject.queryCorrelations).toHaveBeenCalled();
    expect(subject.queryEvidenceGraph).toHaveBeenCalled();
  });

  it('does not treat unknown JSON as NetLog', async () => {
    (createFileParseInput as jest.Mock).mockResolvedValue({
      probeVerdicts: [{
        parserId: 'chromium-netlog@1',
        kind: 'possible-match',
        evidenceCodes: ['generic-json'],
      }],
    });
    const subject = client();
    render(<CrossSourcePanel client={subject} />);
    fireEvent.click(screen.getByRole('button', { name: '管理来源（1）' }));
    fireEvent.change(screen.getByLabelText('追加 NetLog 文件'), {
      target: {
        files: [new File(['{"unknown":true}'], 'unknown.json')],
      },
    });

    expect((await screen.findByRole('alert')).textContent)
      .toContain('未通过 NetLog 专用格式校验');
    expect(subject.addSource).not.toHaveBeenCalled();
  });

  it('surfaces a recoverable Worker source error instead of refreshing as success', async () => {
    const subject = client();
    subject.addSource.mockResolvedValueOnce({
      type: 'structured-error',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'add-error',
      sessionId: 'session',
      sessionRevision: 1,
      error: {
        code: 'worker-failed',
        message: '来源解析失败',
        recoverable: true,
      },
    });
    render(<CrossSourcePanel client={subject} />);
    fireEvent.click(screen.getByRole('button', { name: '管理来源（1）' }));
    fireEvent.change(screen.getByLabelText('追加 HAR 文件'), {
      target: {
        files: [new File(['{"log":{"entries":[]}}'], 'source.har')],
      },
    });

    expect((await screen.findByRole('alert')).textContent).toContain('来源解析失败');
    expect(subject.queryAlignments).not.toHaveBeenCalled();
  });
});
