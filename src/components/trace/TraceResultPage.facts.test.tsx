import { render, screen } from '@testing-library/react';
import type { TraceContextResult } from '../../parsers/trace/types';
import TraceResultPage from './TraceResultPage';

const zero = { total: 0, returned: 0, truncated: false };
const result: TraceContextResult = {
  intake: {
    format: 'chromium-trace-object', encoding: 'plain-json', jsonBytes: 10,
    eventCount: 20, captureStartUs: 0, captureEndUs: 100_000,
    availableFamilies: ['network', 'main-thread', 'rendering', 'interaction'], warnings: [],
  },
  context: {
    processes: [], threads: [], frames: [], navigations: [], evidence: [],
    evidenceTotalCount: 8, evidenceReturnedCount: 8,
    requests: [
      { id: 'r1', requestId: '1', redirectIndex: 0, result: 'http-error', resultConfidence: 'high', timing: { trace: { startUs: 1 } }, initiatorEvidenceIds: [], evidenceIds: [], limitations: [], dataEventCount: 0 },
      { id: 'r2', requestId: '2', redirectIndex: 0, result: 'success', resultConfidence: 'high', timing: { trace: { startUs: 2 } }, initiatorEvidenceIds: [], evidenceIds: [], limitations: ['dispatch-time-domain-unavailable'], dataEventCount: 0 },
    ],
    tasks: [{ id: 't1', processId: 1, threadId: 1, startUs: 1, durationMs: 60, blockingContributionMs: 10, selfTimeMs: 35, categorySelfTimeMs: {}, selfTimeConfidence: 'approximate', limitations: ['incomplete-phase-pairing'], evidenceIds: [] }],
    profiles: [],
    milestones: [{ id: 'm1', navigationKey: 'n1', name: 'LCP', timestampUs: 50_000, relativeUs: 49_000, candidate: true, evidenceIds: [] }],
    animationFrames: [{ id: 'f1', processId: 1, threadId: 1, startUs: 1, durationMs: 20, dropped: false, budgetMs: 16.7, overBudget: true, evidenceIds: [] }],
    animationFrameSummary: { completeness: 'complete', limitations: [], totalCount: 3, overBudgetCount: 2, maxDurationMs: 30, budgetMs: 16.7, budgetBasis: '60hz-reference', refreshRate: 'unknown' },
    rendering: [],
    interactions: [{ id: 'i1', interactionId: 1, startUs: 1, inputDelayMs: 10, processingDurationMs: 20, presentationDelayMs: 30, totalLatencyMs: 60, taskIds: ['t1'], renderingEventIds: [], frameIds: ['f1'], evidenceIds: [] }],
    interactionSummary: { completeness: 'complete', limitations: [], totalCount: 2, slowestInteractionId: 'i2', maxTotalLatencyMs: 90 },
    cpuHotspots: [{ id: 'h1', processId: 1, threadId: 1, profileId: 'p', nodeId: 7, functionName: 'work', sampleCount: 5, sampleTimeMs: 12, taskIds: ['t1'], evidenceIds: [] }],
    forcedReflowClues: [{ id: 'fr1', startUs: 1, confidence: 'explicit', taskId: 't1', evidenceIds: [] }],
    factCounts: {
      requests: { total: 3, returned: 2, truncated: true },
      tasks: { total: 1, returned: 1, truncated: false },
      profiles: zero, milestones: { total: 1, returned: 1, truncated: false },
      animationFrames: { total: 1, returned: 1, truncated: false }, rendering: zero,
      interactions: { total: 1, returned: 1, truncated: false },
      cpuHotspots: { total: 1, returned: 1, truncated: false },
      forcedReflowClues: { total: 1, returned: 1, truncated: false },
    },
    quality: { level: 'partial', captureWindow: 'partial', navigationContext: 'available', processThreadMetadata: 'partial', frameHierarchy: 'partial', rendererMainThread: 'available', skippedEventCount: 0, warnings: [], disabledCapabilities: [] },
    warnings: ['TRACE_FACTS_TRUNCATED'],
  },
};

describe('TraceResultPage facts', () => {
  it('shows bounded facts and limitations without root-cause wording', () => {
    render(<TraceResultPage result={result} />);

    expect(screen.getByRole('heading', { name: '请求结果' })).not.toBeNull();
    expect(screen.getByText('HTTP 错误 1')).not.toBeNull();
    expect(screen.getByText('成功 1')).not.toBeNull();
    expect(screen.getByText('60.0 ms / 自耗时 35.0 ms')).not.toBeNull();
    expect(screen.getByText('LCP 候选 49.0 ms')).not.toBeNull();
    expect(screen.getByText('20.0 ms / 预算 16.7 ms')).not.toBeNull();
    expect(screen.getByText('超预算 2 / 3，最长 30.0 ms')).not.toBeNull();
    expect(screen.getByText('16.7 ms 为 60 Hz 参考预算，实际刷新率未知')).not.toBeNull();
    expect(screen.getByText('明确 forced reflow 线索 1')).not.toBeNull();
    expect(screen.getByText('输入 10.0 / 处理 20.0 / 呈现 30.0 ms')).not.toBeNull();
    expect(screen.getByText('Trace 内最慢交互 90.0 ms')).not.toBeNull();
    expect(screen.getByText('采集窗口限制：部分可用，窗口外事件不在本次事实范围内')).not.toBeNull();
    expect(screen.getByText('work · 5 samples')).not.toBeNull();
    expect(screen.getByText('请求仅展示 2 / 3 条')).not.toBeNull();
    expect(screen.getByText('dispatch-time-domain-unavailable')).not.toBeNull();
    expect(screen.queryByText(/根因/)).toBeNull();
  });
});
