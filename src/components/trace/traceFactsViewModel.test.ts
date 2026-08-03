import type { TraceContextFacts, TraceRequestFacts } from '../../parsers/trace/types';
import {
  buildEvidenceFactsViewModel,
  buildMainThreadFactsViewModel,
  buildNetworkFactsViewModel,
  buildRenderingFactsViewModel,
} from './traceFactsViewModel';

const quality: TraceContextFacts['quality'] = {
  level: 'good',
  captureWindow: 'available',
  navigationContext: 'available',
  processThreadMetadata: 'available',
  frameHierarchy: 'available',
  rendererMainThread: 'available',
  skippedEventCount: 0,
  warnings: [],
  disabledCapabilities: [],
};

const context = (overrides: Partial<TraceContextFacts>): TraceContextFacts => ({
  processes: [],
  threads: [],
  frames: [],
  navigations: [],
  evidence: [],
  evidenceTotalCount: 0,
  evidenceReturnedCount: 0,
  quality,
  warnings: [],
  ...overrides,
});

const request = (
  id: string,
  result: TraceRequestFacts['result'],
  durationMs: number,
  startUs: number,
): TraceRequestFacts => ({
  id,
  requestId: id,
  redirectIndex: 0,
  result,
  resultConfidence: result === 'success' ? 'high' : 'medium',
  timing: { trace: { startUs, durationMs } },
  initiatorEvidenceIds: [],
  evidenceIds: [],
  limitations: [],
  dataEventCount: 0,
});

describe('trace facts view models', () => {
  it('aggregates network outcomes and keeps a deterministic bounded priority list', () => {
    const requests = [
      request('success-slow', 'success', 900, 30),
      request('success-fast', 'success', 10, 10),
      request('http', 'http-error', 200, 50),
      request('transport', 'transport-failed', 100, 40),
      request('cancelled', 'cancelled', 80, 20),
      request('incomplete', 'incomplete-at-trace-end', 70, 60),
      request('unknown', 'unknown-failure', 60, 70),
    ];

    const viewModel = buildNetworkFactsViewModel(context({ requests }));

    expect(viewModel.counts).toEqual({
      total: 7,
      success: 2,
      httpError: 1,
      transportFailed: 1,
      cancelled: 1,
      incomplete: 1,
      unknownFailure: 1,
    });
    expect(viewModel.priority.map(item => item.id)).toEqual([
      'transport',
      'http',
      'cancelled',
      'incomplete',
      'unknown',
    ]);
    expect(viewModel.priority).toHaveLength(5);

    const zeroOverlap = {
      ...request('zero-overlap', 'success', 20, 80),
      dispatch: { dispatchWaitMs: 5, mainThreadOverlapMs: 0 },
    };
    const overlapView = buildNetworkFactsViewModel(context({ requests: [zeroOverlap] }));
    expect(overlapView.dispatchOverlapCount).toBe(0);
  });

  it('pins a deep-linked request without exceeding the default limit', () => {
    const requests = Array.from({ length: 12 }, (_, index) => (
      request(`failure-${index}`, 'http-error', 100 - index, index)
    ));

    const viewModel = buildNetworkFactsViewModel(context({ requests }), 'failure-11');

    expect(viewModel.priority).toHaveLength(5);
    expect(viewModel.priority[0].id).toBe('failure-11');
    expect(new Set(viewModel.priority.map(item => item.id)).size).toBe(5);

    const normalTarget = {
      ...request('normal-target', 'success', 0, 100),
      timing: { trace: { startUs: 100 } },
    };
    const normalModel = buildNetworkFactsViewModel(
      context({ requests: [...requests, normalTarget] }),
      normalTarget.id,
    );
    expect(normalModel.priority[0].id).toBe('normal-target');
  });

  it('computes repeatable main-thread statistics and distinguishes missing profiles', () => {
    const viewModel = buildMainThreadFactsViewModel(context({
      tasks: [
        {
          id: 'task-b', processId: 1, threadId: 1, startUs: 20, durationMs: 80,
          blockingContributionMs: 30, selfTimeMs: 40, categorySelfTimeMs: {},
          selfTimeConfidence: 'exact', limitations: [], evidenceIds: [],
        },
        {
          id: 'task-a', processId: 1, threadId: 1, startUs: 10, durationMs: 80,
          blockingContributionMs: 20, selfTimeMs: 35, categorySelfTimeMs: {},
          selfTimeConfidence: 'exact', limitations: [], evidenceIds: [],
        },
      ],
      profiles: [],
      cpuHotspots: [],
    }));

    expect(viewModel.summary).toMatchObject({
      longTaskCount: 2,
      totalBlockingContributionMs: 50,
      longestTaskMs: 80,
      profileCapability: 'missing',
    });
    expect(viewModel.priorityTasks.map(item => item.id)).toEqual(['task-b', 'task-a']);
    expect(viewModel.priority.map(entry => entry.item.id)).toEqual(['task-b', 'task-a']);
    expect(viewModel.capabilityMessage).toMatch(/缺少 CPU Profile/);
    expect(viewModel.capabilityMessage).not.toMatch(/没有问题/);

    const profileModel = buildMainThreadFactsViewModel(context({
      tasks: [],
      cpuHotspots: [],
      profiles: [{
        id: 'profile-target',
        processId: 1,
        threadId: 1,
        profileId: 'profile',
        startUs: 0,
        endUs: 10,
        nodeCount: 1,
        sampleCount: 1,
        evidenceIds: [],
        limitations: [],
      }],
    }), 'profile-target');
    expect(profileModel.targetProfile?.id).toBe('profile-target');
    expect(profileModel.priority[0]).toMatchObject({
      kind: 'profile',
      item: { id: 'profile-target' },
    });
  });

  it('prioritizes abnormal rendering facts and keeps normal frames out of Top 5', () => {
    const view = buildRenderingFactsViewModel(context({
      animationFrames: [
        {
          id: 'normal', processId: 1, threadId: 1, startUs: 1, durationMs: 10,
          dropped: false, budgetMs: 16.7, overBudget: false, evidenceIds: [],
        },
        {
          id: 'over', processId: 1, threadId: 1, startUs: 2, durationMs: 30,
          dropped: false, budgetMs: 16.7, overBudget: true, evidenceIds: [],
        },
        {
          id: 'dropped', processId: 1, threadId: 1, startUs: 3, durationMs: 20,
          dropped: true, budgetMs: 16.7, overBudget: true, evidenceIds: [],
        },
      ],
      animationFrameSummary: {
        completeness: 'complete',
        limitations: [],
        totalCount: 3,
        droppedCount: 1,
        overBudgetCount: 2,
        maxDurationMs: 30,
        budgetMs: 16.7,
        budgetBasis: '60hz-reference',
        refreshRate: 'unknown',
      },
      rendering: [],
      forcedReflowClues: [],
    }));

    expect(view.summary.overBudgetRatio).toBeCloseTo(2 / 3);
    expect(view.priorityFrames.map(item => item.id)).toEqual(['dropped', 'over']);
    expect(view.priority.map(entry => entry.item.id)).toEqual(['dropped', 'over']);
    expect(view.priorityFrames.map(item => item.id)).not.toContain('normal');
    expect(view.budgetNote).toMatch(/60 Hz 参考预算/);

    const utils = buildRenderingFactsViewModel(context({
      animationFrames: view.allFrames,
    }), 'normal');
    expect(utils.priorityFrames[0].id).toBe('normal');
  });

  it('classifies evidence from existing fact references instead of event-name guesses', () => {
    const evidenceViewModel = buildEvidenceFactsViewModel(context({
      evidence: [
        { evidenceId: 'network', eventIndex: 1, origin: 'raw', name: 'UnknownName' },
        { evidenceId: 'main', eventIndex: 2, origin: 'raw', name: 'UnknownName' },
        { evidenceId: 'other', eventIndex: 3, origin: 'raw', name: 'ResourceEvent' },
        { evidenceId: 'shared', eventIndex: 4, origin: 'raw', name: 'UnknownName' },
      ],
      requests: [{
        ...request('request', 'success', 10, 1),
        evidenceIds: ['network', 'shared'],
      }],
      tasks: [{
        id: 'task', processId: 1, threadId: 1, startUs: 1, durationMs: 60,
        blockingContributionMs: 10, selfTimeMs: 40, categorySelfTimeMs: {},
        selfTimeConfidence: 'exact', limitations: [], evidenceIds: ['main', 'shared'],
      }],
    }));

    expect(evidenceViewModel.categoryByEvidenceId.get('network')).toBe('网络');
    expect(evidenceViewModel.categoryByEvidenceId.get('main')).toBe('主线程 / CPU');
    expect(evidenceViewModel.categoryByEvidenceId.get('other')).toBe('其他');
    expect(evidenceViewModel.categoryByEvidenceId.get('shared')).toBe('网络 / 主线程 / CPU');
    expect(evidenceViewModel).toMatchObject({
      availableCount: 4,
      totalCount: 4,
      truncated: false,
    });
    expect(evidenceViewModel.counts).toMatchObject({
      网络: 2,
      '主线程 / CPU': 2,
      其他: 1,
    });

    const truncated = buildEvidenceFactsViewModel(context({
      evidence: [{ evidenceId: 'one', eventIndex: 1, origin: 'raw' }],
      evidenceReturnedCount: 1,
      evidenceTotalCount: 5,
    }));
    expect(truncated).toMatchObject({
      availableCount: 1,
      totalCount: 5,
      truncated: true,
    });
  });
});
