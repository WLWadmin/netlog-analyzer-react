import type {
  TraceContextFacts,
  TraceFrameFacts,
  TraceRequestFacts,
} from '../../parsers/trace/types';
import { buildTraceDiagnosis } from './buildTraceDiagnosis';
import type {
  TraceDiagnosisCategory,
  TraceDiagnosisConfidence,
  TraceDiagnosisResult,
  TraceRuleDisabledReason,
  TraceRuleId,
} from './types';

export const TRACE_GOLDEN_CORPUS_IDS = [
  '正常单导航', '404/500', 'failed无response', '导航overlap', '尾部未完成',
  '多renderer', 'OOPIF', '长任务嵌套', '完整N3', '缺timing', 'ProfileChunk',
  '慢交互', '弱reflow', '导航后采集', 'security', '截断/缺evidence', '敏感泄漏',
] as const;

export type TraceGoldenCorpusId = typeof TRACE_GOLDEN_CORPUS_IDS[number];

export interface TraceGoldenRuleExpectation {
  ruleId: TraceRuleId;
  status: 'matched' | 'not-matched' | 'disabled';
  count: number;
  confidence: { min: TraceDiagnosisConfidence; max: TraceDiagnosisConfidence };
  category: TraceDiagnosisCategory;
  evidence: 'required' | 'forbidden' | 'ignored';
  limitations: string[];
  disabledReason: TraceRuleDisabledReason | 'not-applicable';
}

export interface TraceGoldenFactAssertion {
  path: string;
  expected: unknown;
}

export interface TraceGoldenExpectation {
  requiredRules: TraceGoldenRuleExpectation[];
  forbiddenRules: TraceRuleId[];
  factAssertions: TraceGoldenFactAssertion[];
}

export interface TraceGoldenCorpusCase {
  id: TraceGoldenCorpusId;
  context: TraceContextFacts;
  expectation: TraceGoldenExpectation;
  runs: [TraceDiagnosisResult, TraceDiagnosisResult, TraceDiagnosisResult];
}

const evidenceId = (index: number) => `trace:event:${index}`;
const evidence = Array.from({ length: 40 }, (_, eventIndex) => ({
  evidenceId: evidenceId(eventIndex), eventIndex, origin: 'raw' as const,
}));

function context(overrides: Partial<TraceContextFacts> = {}): TraceContextFacts {
  return {
    processes: [], threads: [], frames: [],
    navigations: [{
      key: 'nav', navigationId: 'nav', frameId: 'frame', outermostFrameId: 'frame',
      startUs: 0, endUs: 5_000_000, processSpans: [], evidenceIds: [evidenceId(0)],
      limitations: [],
    }],
    evidence: [...evidence], evidenceTotalCount: evidence.length,
    evidenceReturnedCount: evidence.length,
    quality: {
      level: 'good', captureWindow: 'available', navigationContext: 'available',
      processThreadMetadata: 'available', frameHierarchy: 'available',
      rendererMainThread: 'available', skippedEventCount: 0, warnings: [],
      disabledCapabilities: [],
    },
    warnings: [],
    ...overrides,
  };
}

function request(overrides: Partial<TraceRequestFacts> = {}): TraceRequestFacts {
  return {
    id: 'request', requestId: 'request', redirectIndex: 0, result: 'success',
    resultConfidence: 'high',
    timing: { trace: { startUs: 0, endUs: 100_000, durationMs: 100 } },
    initiatorEvidenceIds: [], evidenceIds: [evidenceId(2)], limitations: [],
    dataEventCount: 0,
    ...overrides,
  };
}

function frames(): TraceFrameFacts[] {
  return [{
    frameId: 'outer', outermostFrameId: 'outer', isOutermost: true,
    processSpans: [], evidenceIds: [evidenceId(10)],
  }, {
    frameId: 'child', parentFrameId: 'outer', outermostFrameId: 'outer',
    isOutermost: false, processSpans: [], evidenceIds: [evidenceId(11)],
  }];
}

function ruleExpectation(input: {
  ruleId: TraceRuleId;
  status: 'matched' | 'not-matched' | 'disabled';
  category: TraceDiagnosisCategory;
  count?: number;
  confidence?: { min: TraceDiagnosisConfidence; max: TraceDiagnosisConfidence };
  evidence?: 'required' | 'forbidden' | 'ignored';
  limitations?: string[];
  disabledReason?: TraceRuleDisabledReason;
}): TraceGoldenRuleExpectation {
  return {
    ruleId: input.ruleId,
    status: input.status,
    count: input.count ?? 1,
    confidence: input.confidence ?? { min: 'observation', max: 'confirmed' },
    category: input.category,
    evidence: input.evidence ?? 'ignored',
    limitations: input.limitations ?? [],
    disabledReason: input.disabledReason ?? 'not-applicable',
  };
}

function expectation(
  requiredRules: TraceGoldenRuleExpectation[],
  forbiddenRules: TraceRuleId[],
  factAssertions: TraceGoldenFactAssertion[],
): TraceGoldenExpectation {
  return { requiredRules, forbiddenRules, factAssertions };
}

function inputs(): Array<{
  id: TraceGoldenCorpusId;
  context: TraceContextFacts;
  expectation: TraceGoldenExpectation;
}> {
  return [{
    id: '正常单导航',
    expectation: expectation([
      ruleExpectation({ ruleId: 'Q1', status: 'not-matched', category: 'quality' }),
      ruleExpectation({ ruleId: 'L1', status: 'not-matched', category: 'loading' }),
    ], [], [{ path: 'milestones.length', expected: 2 }]),
    context: context({ milestones: [{
      id: 'fcp', navigationKey: 'nav', name: 'FCP', timestampUs: 800_000,
      relativeUs: 800_000, candidate: false, evidenceIds: [evidenceId(1)],
    }, {
      id: 'lcp', navigationKey: 'nav', name: 'LCP', timestampUs: 1_500_000,
      relativeUs: 1_500_000, candidate: true, evidenceIds: [evidenceId(2)],
    }] }),
  }, {
    id: '404/500',
    expectation: expectation([ruleExpectation({
      ruleId: 'N1', status: 'matched', count: 2, category: 'network',
      confidence: { min: 'observation', max: 'observation' }, evidence: 'required',
      limitations: ['HTTP 状态不能证明底层网络传输根因'],
    })], ['N2'], [{ path: 'requests.length', expected: 2 }]),
    context: context({ requests: [
      request({ id: 'http-404', requestId: 'http-404', statusCode: 404,
        result: 'http-error', evidenceIds: [evidenceId(3)] }),
      request({ id: 'http-500', requestId: 'http-500', statusCode: 500,
        result: 'http-error', evidenceIds: [evidenceId(4)] }),
    ] }),
  }, {
    id: 'failed无response',
    expectation: expectation([ruleExpectation({
      ruleId: 'N2', status: 'matched', category: 'network',
      confidence: { min: 'observation', max: 'observation' }, evidence: 'required',
      limitations: ['不推断 DNS、TLS、代理或服务端根因'],
    })], ['N1'], [{ path: 'requests.0.result', expected: 'transport-failed' }]),
    context: context({ requests: [request({ failed: true, result: 'transport-failed',
      resultConfidence: 'medium', evidenceIds: [evidenceId(5)] })] }),
  }, {
    id: '导航overlap',
    expectation: expectation([ruleExpectation({
      ruleId: 'C1', status: 'matched', category: 'network',
      confidence: { min: 'observation', max: 'observation' }, evidence: 'required',
      limitations: ['导航重叠不能单独证明取消原因'],
    })], [], [{ path: 'requests.0.resultConfidence', expected: 'medium' }]),
    context: context({ requests: [request({ result: 'cancelled', resultConfidence: 'medium',
      evidenceIds: [evidenceId(6)] })] }),
  }, {
    id: '尾部未完成',
    expectation: expectation([ruleExpectation({
      ruleId: 'N2', status: 'not-matched', category: 'network', evidence: 'forbidden',
    })], ['C1'], [{ path: 'requests.0.result', expected: 'incomplete-at-trace-end' }]),
    context: context({ requests: [request({ result: 'incomplete-at-trace-end',
      resultConfidence: 'observation', evidenceIds: [evidenceId(7)],
      limitations: ['trace-ended-before-request-finished'] })] }),
  }, {
    id: '多renderer',
    expectation: expectation([ruleExpectation({
      ruleId: 'Q1', status: 'not-matched', category: 'quality',
    })], [], [
      { path: 'navigations.0.processSpans.length', expected: 2 },
      { path: 'tasks.length', expected: 2 },
    ]),
    context: context({
      navigations: [{
        key: 'nav', navigationId: 'nav', frameId: 'frame', outermostFrameId: 'frame',
        startUs: 0, endUs: 5_000_000, evidenceIds: [evidenceId(0)], limitations: [],
        processSpans: [{ processId: 10, startUs: 0, endUs: 2_000_000,
          mainThreadId: 101, confidence: 'direct', evidenceIds: [evidenceId(8)] },
        { processId: 20, startUs: 2_000_000, endUs: 5_000_000,
          mainThreadId: 201, confidence: 'direct', evidenceIds: [evidenceId(9)] }],
      }],
      tasks: [{ id: 'task-a', navigationKey: 'nav', processId: 10, threadId: 101,
        startUs: 100_000, durationMs: 60, blockingContributionMs: 10, selfTimeMs: 60,
        categorySelfTimeMs: { script: 60 }, selfTimeConfidence: 'exact', limitations: [],
        evidenceIds: [evidenceId(8)] },
      { id: 'task-b', navigationKey: 'nav', processId: 20, threadId: 201,
        startUs: 2_100_000, durationMs: 60, blockingContributionMs: 10, selfTimeMs: 60,
        categorySelfTimeMs: { script: 60 }, selfTimeConfidence: 'exact', limitations: [],
        evidenceIds: [evidenceId(9)] }],
    }),
  }, {
    id: 'OOPIF',
    expectation: expectation([ruleExpectation({
      ruleId: 'Q1', status: 'not-matched', category: 'quality',
    })], [], [
      { path: 'frames.1.isOutermost', expected: false },
      { path: 'frames.1.outermostFrameId', expected: 'outer' },
    ]),
    context: context({ frames: frames() }),
  }, {
    id: '长任务嵌套',
    expectation: expectation([ruleExpectation({
      ruleId: 'M1', status: 'matched', category: 'main-thread',
      confidence: { min: 'confirmed', max: 'confirmed' }, evidence: 'required',
      limitations: ['不计算 Web Vitals 总阻塞时间'],
    })], [], [
      { path: 'tasks.0.selfTimeMs', expected: 180 },
      { path: 'tasks.0.categorySelfTimeMs.script', expected: 120 },
      { path: 'tasks.0.categorySelfTimeMs.rendering', expected: 60 },
    ]),
    context: context({ tasks: [{
      id: 'nested-task', navigationKey: 'nav', processId: 10, threadId: 101,
      startUs: 0, durationMs: 300, blockingContributionMs: 250, selfTimeMs: 180,
      categorySelfTimeMs: { script: 120, rendering: 60 }, selfTimeConfidence: 'exact',
      limitations: [], evidenceIds: [evidenceId(12), evidenceId(13)],
    }] }),
  }, {
    id: '完整N3',
    expectation: expectation([ruleExpectation({
      ruleId: 'N3', status: 'matched', category: 'network',
      confidence: { min: 'high', max: 'high' }, evidence: 'required',
      limitations: ['不代表网络首字节时间'],
    })], [], [{ path: 'requests.0.dispatch.mainThreadOverlapMs', expected: 420 }]),
    context: context({ requests: [request({ navigationKey: 'nav',
      dispatch: { dispatchWaitMs: 600, mainThreadOverlapMs: 420 },
      evidenceIds: [evidenceId(14)] })] }),
  }, {
    id: '缺timing',
    expectation: expectation([ruleExpectation({
      ruleId: 'N3', status: 'disabled', category: 'network', evidence: 'forbidden',
      disabledReason: 'TIMING_DOMAIN_UNCALIBRATED',
    })], [], [{ path: 'requests.0.limitations.0', expected: 'dispatch-time-domain-unavailable' }]),
    context: context({ requests: [request({ navigationKey: 'nav',
      limitations: ['dispatch-time-domain-unavailable'], evidenceIds: [evidenceId(15)] })] }),
  }, {
    id: 'ProfileChunk',
    expectation: expectation([ruleExpectation({
      ruleId: 'M2', status: 'matched', category: 'main-thread',
      confidence: { min: 'medium', max: 'medium' }, evidence: 'required',
      limitations: ['Source Map'],
    })], [], [{ path: 'cpuHotspots.0.sampleTimeMs', expected: 240 }]),
    context: context({ cpuHotspots: [{
      id: 'hotspot', processId: 10, threadId: 101, profileId: 'profile', nodeId: 1,
      functionName: '(anonymous)', script: { origin: 'https://example.test', pathname: '/app.js' },
      sampleCount: 30, sampleTimeMs: 240, navigationKey: 'nav', taskIds: [],
      evidenceIds: [evidenceId(16), evidenceId(17)],
    }] }),
  }, {
    id: '慢交互',
    expectation: expectation([ruleExpectation({
      ruleId: 'I1', status: 'matched', category: 'interaction',
      confidence: { min: 'high', max: 'high' }, evidence: 'required',
      limitations: ['不代表真实用户分布'],
    })], [], [{ path: 'interactions.0.totalLatencyMs', expected: 600 }]),
    context: context({ interactions: [{
      id: 'interaction', interactionId: 1, navigationKey: 'nav', startUs: 0,
      inputDelayMs: 80, processingDurationMs: 300, presentationDelayMs: 220,
      totalLatencyMs: 600, taskIds: [], renderingEventIds: [], frameIds: [],
      evidenceIds: [evidenceId(18)],
    }] }),
  }, {
    id: '弱reflow',
    expectation: expectation([ruleExpectation({
      ruleId: 'R1', status: 'matched', category: 'rendering',
      confidence: { min: 'observation', max: 'observation' }, evidence: 'required',
      limitations: ['不能确定具体 DOM API 根因'],
    })], [], [{ path: 'forcedReflowClues.0.confidence', expected: 'observation' }]),
    context: context({ forcedReflowClues: [{ id: 'reflow', navigationKey: 'nav',
      startUs: 100, confidence: 'observation', evidenceIds: [evidenceId(19)] }] }),
  }, {
    id: '导航后采集',
    expectation: expectation([ruleExpectation({
      ruleId: 'Q1', status: 'matched', category: 'quality',
      confidence: { min: 'observation', max: 'observation' }, evidence: 'required',
      limitations: ['不能依据缺失事件'],
    })], [], [{ path: 'quality.level', expected: 'partial' }]),
    context: context({ quality: {
      ...context().quality, level: 'partial', captureWindow: 'partial',
    } }),
  }, {
    id: 'security',
    expectation: expectation([ruleExpectation({
      ruleId: 'S1', status: 'matched', category: 'security',
      confidence: { min: 'observation', max: 'observation' }, evidence: 'required',
      limitations: ['不能作为性能根因'],
    })], [], [{ path: 'requests.0.statusCode', expected: 403 }]),
    context: context({ requests: [request({ statusCode: 403, result: 'http-error',
      evidenceIds: [evidenceId(20)] })] }),
  }, {
    id: '截断/缺evidence',
    expectation: expectation([ruleExpectation({
      ruleId: 'N1', status: 'disabled', category: 'network', evidence: 'forbidden',
      disabledReason: 'EVIDENCE_MISSING',
    })], [], [{ path: 'evidenceReturnedCount', expected: 0 }]),
    context: context({
      requests: [request({ statusCode: 500, result: 'http-error',
        evidenceIds: ['trace:event:not-returned'] })],
      evidence: [], evidenceReturnedCount: 0, evidenceTotalCount: 1,
      warnings: ['TRACE_EVIDENCE_TRUNCATED'],
    }),
  }, {
    id: '敏感泄漏',
    expectation: expectation([ruleExpectation({
      ruleId: 'M2', status: 'matched', category: 'main-thread',
      confidence: { min: 'medium', max: 'medium' }, evidence: 'required',
      limitations: ['Source Map'],
    })], [], [{ path: 'cpuHotspots.0.sampleTimeMs', expected: 240 }]),
    context: context({ cpuHotspots: [{
      id: 'sensitive-hotspot', processId: 10, threadId: 101, profileId: 'sensitive-profile',
      nodeId: 1, functionName: 'privateHandler',
      script: { origin: 'file://', pathname: '/Users/example/private/app.js?token=FAKE_TOKEN_VALUE&query=private' },
      sampleCount: 30, sampleTimeMs: 240, navigationKey: 'nav', taskIds: [],
      evidenceIds: [evidenceId(21)],
    }] }),
  }];
}

export function buildTraceGoldenCorpus(): TraceGoldenCorpusCase[] {
  return inputs().map(item => ({
    id: item.id,
    context: item.context,
    expectation: item.expectation,
    runs: [
      buildTraceDiagnosis(item.context),
      buildTraceDiagnosis(item.context),
      buildTraceDiagnosis(item.context),
    ],
  }));
}
