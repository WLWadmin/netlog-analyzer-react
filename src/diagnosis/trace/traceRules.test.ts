import type { TraceContextFacts } from '../../parsers/trace/types';
import { interactionRules } from './rules/interactionRules';
import { loadingRules } from './rules/loadingRules';
import { mainThreadRules } from './rules/mainThreadRules';
import { networkDispatchRules } from './rules/networkDispatchRules';
import { qualityRules } from './rules/qualityRules';
import { renderingRules } from './rules/renderingRules';
import type { RuleEvaluation, TraceDiagnosisRule, TraceRuleId } from './types';

const evidence = (index: number) => `trace:event:${index}`;

function context(overrides: Partial<TraceContextFacts> = {}): TraceContextFacts {
  return {
    processes: [], threads: [], frames: [],
    navigations: [{
      key: 'nav', navigationId: 'nav', frameId: 'frame', outermostFrameId: 'frame',
      startUs: 0, endUs: 1_000_000, processSpans: [], evidenceIds: [evidence(0)], limitations: [],
    }],
    evidence: Array.from({ length: 20 }, (_, eventIndex) => ({
      evidenceId: evidence(eventIndex), eventIndex, origin: 'raw' as const,
    })),
    evidenceTotalCount: 20, evidenceReturnedCount: 20,
    quality: {
      level: 'good', captureWindow: 'available', navigationContext: 'available',
      processThreadMetadata: 'available', frameHierarchy: 'available',
      rendererMainThread: 'available', skippedEventCount: 0, warnings: [], disabledCapabilities: [],
    },
    warnings: [],
    ...overrides,
  };
}

function evaluation(rules: readonly TraceDiagnosisRule[], id: TraceRuleId, facts: TraceContextFacts): RuleEvaluation {
  const rule = rules.find(candidate => candidate.id === id);
  if (!rule) throw new Error(`Missing rule ${id}`);
  const result = rule.evaluate(facts)[0];
  if (!result) throw new Error(`Missing evaluation ${id}`);
  return result;
}

function matched(result: RuleEvaluation) {
  expect(result.status).toBe('matched');
  if (result.status !== 'matched') throw new Error('Expected matched evaluation');
  return result.diagnosis;
}

const request = {
  id: 'request', requestId: 'request', redirectIndex: 0,
  resultConfidence: 'high' as const,
  timing: { trace: { startUs: 0, endUs: 100_000, durationMs: 100 } },
  initiatorEvidenceIds: [], evidenceIds: [evidence(2)], limitations: [], dataEventCount: 0,
};

describe('Trace diagnosis rules', () => {
  it('exports the fixed rules through the six PRD groups', () => {
    expect([...qualityRules, ...loadingRules, ...networkDispatchRules, ...mainThreadRules,
      ...renderingRules, ...interactionRules].map(rule => rule.id)).toEqual([
      'Q1', 'L1', 'L2', 'N1', 'N2', 'N3', 'C1', 'S1', 'M1', 'M2', 'R1', 'R2', 'I1',
    ]);
  });

  it('Q1 reports incomplete collection without claiming FCP or LCP did not exist', () => {
    const diagnosis = matched(evaluation(qualityRules, 'Q1', context({
      quality: { ...context().quality, level: 'partial', captureWindow: 'partial' },
    })));
    expect(diagnosis.confidence).toBe('observation');
    expect(diagnosis.conclusion).not.toMatch(/没有\s*(FCP|LCP)|FCP\/LCP\s*不存在/);
  });

  it('L1 keeps LCP candidate wording and L2 disables without a complete dependency path', () => {
    const facts = context({ milestones: [{
      id: 'milestone', navigationKey: 'nav', name: 'LCP', timestampUs: 4_000_000,
      relativeUs: 4_000_000, candidate: true, evidenceIds: [evidence(1)],
    }], requests: [{ ...request, result: 'success' }] });
    const l1 = matched(evaluation(loadingRules, 'L1', facts));
    expect(l1.conclusion).toContain('LCP Candidate');
    expect(evaluation(loadingRules, 'L2', facts)).toEqual({
      ruleId: 'L2', status: 'disabled', reason: 'DEPENDENCY_PATH_INCOMPLETE',
    });
  });

  it('N1 separates HTTP errors and N2 does not infer transport root causes', () => {
    const n1 = matched(evaluation(networkDispatchRules, 'N1', context({
      requests: [{ ...request, statusCode: 404, result: 'http-error' }],
    })));
    const n2 = matched(evaluation(networkDispatchRules, 'N2', context({
      requests: [{ ...request, failed: true, result: 'transport-failed' }],
    })));
    expect(n1.confidence).toBe('observation');
    expect(n1.conclusion).not.toContain('传输失败');
    expect(n2.conclusion).not.toMatch(/DNS|TLS|代理.*根因/);
  });

  it('N3 requires calibrated dispatch overlap and never labels it TTFB', () => {
    expect(evaluation(networkDispatchRules, 'N3', context({ requests: [{ ...request, result: 'success' }] }))).toEqual({
      ruleId: 'N3', status: 'disabled', reason: 'TIMING_DOMAIN_UNCALIBRATED',
    });
    expect(evaluation(networkDispatchRules, 'N3', context({ requests: [{
      ...request, result: 'success', dispatch: { dispatchWaitMs: 600, mainThreadOverlapMs: 0 },
    }] }))).toEqual({
      ruleId: 'N3', status: 'not-matched', reason: '时间域已校准，但未观察到主线程忙碌重叠。',
    });
    const diagnosis = matched(evaluation(networkDispatchRules, 'N3', context({ requests: [{
      ...request, result: 'success', dispatch: { dispatchWaitMs: 600, mainThreadOverlapMs: 400 },
    }] })));
    expect(diagnosis.conclusion).not.toContain('TTFB');
  });

  it('C1 keeps uncertain cancellation observational and S1 is not a performance root cause', () => {
    const c1 = matched(evaluation(networkDispatchRules, 'C1', context({ requests: [{
      ...request, result: 'cancelled', resultConfidence: 'medium',
    }] })));
    const s1 = matched(evaluation(networkDispatchRules, 'S1', context({ requests: [{
      ...request, result: 'http-error', statusCode: 403,
    }] })));
    expect(c1.confidence).toBe('observation');
    expect(s1.confidence).toBe('observation');
    expect(s1.limitations.join(' ')).toContain('不能作为性能根因');
  });

  it('M1 uses blocking contribution instead of TBT and M2 keeps bundle-level attribution', () => {
    const m1 = matched(evaluation(mainThreadRules, 'M1', context({ tasks: [{
      id: 'task', navigationKey: 'nav', processId: 1, threadId: 1, startUs: 0,
      durationMs: 300, blockingContributionMs: 250, selfTimeMs: 200,
      categorySelfTimeMs: { script: 200 }, selfTimeConfidence: 'exact', limitations: [],
      evidenceIds: [evidence(5)],
    }] })));
    const m2 = matched(evaluation(mainThreadRules, 'M2', context({ cpuHotspots: [{
      id: 'hotspot', processId: 1, threadId: 1, profileId: 'profile', nodeId: 1,
      functionName: 'bundleFunction', script: { origin: 'https://example.test', pathname: '/app.bundle.js' },
      lineNumber: 10, sampleCount: 10, sampleTimeMs: 220, taskIds: [], evidenceIds: [evidence(6)],
    }] })));
    expect(m1.conclusion).not.toContain('TBT');
    expect(m2.limitations.join(' ')).toContain('Source Map');
    expect(m2.conclusion).toContain('/app.bundle.js');
  });

  it('R1 stays observational for weak clues and R2 declares the 60Hz limitation', () => {
    const r1 = matched(evaluation(renderingRules, 'R1', context({ forcedReflowClues: [{
      id: 'clue', startUs: 0, confidence: 'observation', evidenceIds: [evidence(7)],
    }] })));
    const r2 = matched(evaluation(renderingRules, 'R2', context({
      animationFrames: [{ id: 'frame-fact', processId: 1, threadId: 2, startUs: 0,
        durationMs: 40, dropped: false, budgetMs: 16.7, overBudget: true, evidenceIds: [evidence(8)] }],
      animationFrameSummary: { completeness: 'complete', limitations: [], totalCount: 1,
        droppedCount: 0, overBudgetCount: 1, maxDurationMs: 40, budgetMs: 16.7,
        budgetBasis: '60hz-reference', refreshRate: 'unknown' },
    })));
    expect(r1.confidence).toBe('observation');
    expect(r1.conclusion).toContain('线索');
    expect(r2.limitations.join(' ')).toMatch(/60Hz|刷新率未知/);
    expect(r2.conclusion).not.toContain('主线程导致');
  });

  it('I1 disables without interactions and describes a Trace-local candidate', () => {
    expect(evaluation(interactionRules, 'I1', context())).toEqual({
      ruleId: 'I1', status: 'disabled', reason: 'REQUIRED_FACTS_MISSING',
    });
    const diagnosis = matched(evaluation(interactionRules, 'I1', context({ interactions: [{
      id: 'interaction', interactionId: 1, navigationKey: 'nav', startUs: 0,
      inputDelayMs: 50, processingDurationMs: 300, presentationDelayMs: 250,
      totalLatencyMs: 600, taskIds: [], renderingEventIds: [], frameIds: [], evidenceIds: [evidence(9)],
    }] })));
    expect(diagnosis.conclusion).toMatch(/Trace 内|候选/);
    expect(diagnosis.conclusion).not.toContain('线上 INP');
  });
});
