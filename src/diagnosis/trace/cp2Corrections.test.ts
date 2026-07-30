import type { TraceContextFacts, TraceRequestFacts } from '../../parsers/trace/types';
import { buildTraceDiagnosis } from './buildTraceDiagnosis';
import { interactionRules } from './rules/interactionRules';
import { loadingRules } from './rules/loadingRules';
import { mainThreadRules } from './rules/mainThreadRules';
import { networkDispatchRules } from './rules/networkDispatchRules';
import { qualityRules } from './rules/qualityRules';
import { renderingRules } from './rules/renderingRules';
import type { RuleEvaluation, TraceDiagnosisRule, TraceRuleId } from './types';

const evidence = (index: number) => `trace:event:${index}`;
const allRules = [...qualityRules, ...loadingRules, ...networkDispatchRules,
  ...mainThreadRules, ...renderingRules, ...interactionRules];

function context(overrides: Partial<TraceContextFacts> = {}): TraceContextFacts {
  return {
    processes: [], threads: [], frames: [],
    navigations: [{ key: 'nav', navigationId: 'nav', frameId: 'frame', outermostFrameId: 'frame',
      startUs: 0, endUs: 5_000_000, processSpans: [], evidenceIds: [evidence(0)], limitations: [] }],
    evidence: Array.from({ length: 30 }, (_, eventIndex) => ({
      evidenceId: evidence(eventIndex), eventIndex, origin: 'raw' as const,
    })),
    evidenceTotalCount: 30, evidenceReturnedCount: 30,
    quality: { level: 'good', captureWindow: 'available', navigationContext: 'available',
      processThreadMetadata: 'available', frameHierarchy: 'available', rendererMainThread: 'available',
      skippedEventCount: 0, warnings: [], disabledCapabilities: [] },
    warnings: [],
    ...overrides,
  };
}

function evaluation(ruleId: TraceRuleId, facts: TraceContextFacts): RuleEvaluation {
  const rule = allRules.find(candidate => candidate.id === ruleId);
  if (!rule) throw new Error(`Missing rule ${ruleId}`);
  const result = rule.evaluate(facts)[0];
  if (!result) throw new Error(`Missing evaluation ${ruleId}`);
  return result;
}

function matched(result: RuleEvaluation) {
  expect(result.status).toBe('matched');
  if (result.status !== 'matched') throw new Error('Expected matched evaluation');
  return result.diagnosis;
}

function request(input: Partial<TraceRequestFacts> & Pick<TraceRequestFacts, 'id' | 'requestId'>): TraceRequestFacts {
  return {
    redirectIndex: 0,
    result: 'success',
    resultConfidence: 'high',
    timing: { trace: { startUs: 0, endUs: 100_000, durationMs: 100 } },
    initiatorEvidenceIds: [], evidenceIds: [evidence(1)], limitations: [], dataEventCount: 0,
    ...input,
  };
}

describe('CP2 corrections', () => {
  it('disables every non-Q1 rule before other evaluation when quality is insufficient', () => {
    const facts = context({ quality: { ...context().quality, level: 'insufficient' } });
    for (const rule of allRules.filter(candidate => candidate.id !== 'Q1')) {
      expect(rule.evaluate(facts)).toEqual([{
        ruleId: rule.id, status: 'disabled', reason: 'QUALITY_INSUFFICIENT',
      }]);
    }
  });

  it('keeps non-sensitive counter-evidence text through the builder without evidence filtering', () => {
    const rule: TraceDiagnosisRule = {
      id: 'N1', category: 'network', requiredFacts: [], forbiddenConclusions: [],
      evaluate: () => [{ ruleId: 'N1', status: 'matched', reason: 'matched', diagnosis: {
        id: 'diagnosis', ruleId: 'N1', category: 'network', severity: 'warning', score: 1,
        title: 'HTTP error', conclusion: 'HTTP 404', confidence: 'observation',
        evidenceIds: [evidence(1)], counterEvidence: ['存在 HTTP 响应，不能归类为传输失败。'],
        advice: [], factIds: [], limitations: [],
      } }],
    };
    expect(buildTraceDiagnosis(context(), [rule]).diagnoses[0].counterEvidence).toEqual([
      '存在 HTTP 响应，不能归类为传输失败。',
    ]);
  });

  it('L2 disables request-only chains until Network and CPU dependency edges are available', () => {
    const root = request({ id: 'root', requestId: 'root', navigationKey: 'nav',
      timing: { trace: { startUs: 0, endUs: 500_000, durationMs: 500 } }, evidenceIds: [evidence(2)] });
    const child = request({ id: 'child', requestId: 'child', navigationKey: 'nav', initiatorRequestId: 'root',
      initiatorEvidenceIds: [evidence(2)], timing: { trace: { startUs: 500_000, endUs: 2_500_000, durationMs: 2_000 } },
      evidenceIds: [evidence(3)] });
    expect(evaluation('L2', context({ requests: [root, child] }))).toEqual({
      ruleId: 'L2', status: 'disabled', reason: 'DEPENDENCY_PATH_INCOMPLETE',
    });
  });

  it.each([
    ['script', { script: 180 }, '脚本 self time'],
    ['gc', { gc: 220 }, 'GC self time'],
  ] as const)('M2 supports task %s self-time facts', (_category, categorySelfTimeMs, expected) => {
    const diagnosis = matched(evaluation('M2', context({ tasks: [{
      id: 'task', navigationKey: 'nav', processId: 1, threadId: 1, startUs: 0,
      durationMs: 300, blockingContributionMs: 250, selfTimeMs: Object.values(categorySelfTimeMs)[0],
      categorySelfTimeMs, selfTimeConfidence: 'exact', limitations: [], evidenceIds: [evidence(4)],
    }] })));
    expect(diagnosis.conclusion).toContain(expected);
    expect(diagnosis.factIds).toEqual(['task']);
  });

  it('M2 ignores CPU sampling noise below the hotspot threshold', () => {
    expect(evaluation('M2', context({ cpuHotspots: [{
      id: 'hotspot', processId: 1, threadId: 1, profileId: 'profile', nodeId: 1,
      functionName: 'tinySample', lineNumber: 1, sampleCount: 1, sampleTimeMs: 0.1,
      taskIds: [], evidenceIds: [evidence(5)],
    }] }))).toEqual({
      ruleId: 'M2', status: 'not-matched', reason: 'CPU 采样热点未超过阈值。',
    });
  });

  it.each(['Layout', 'Paint', 'RasterTask'] as const)('R2 supports %s facts without frame facts', name => {
    const diagnosis = matched(evaluation('R2', context({ rendering: [{
      id: `rendering-${name}`, navigationKey: 'nav', name, processId: 1, threadId: 1,
      startUs: 0, durationMs: 250, evidenceIds: [evidence(5)],
    }] })));
    expect(diagnosis.conclusion).toContain(name);
    expect(diagnosis.factIds).toEqual([`rendering-${name}`]);
  });

  it('all matched non-Q1 rule paths provide fixed counter-evidence statements', () => {
    const n1 = matched(evaluation('N1', context({ requests: [request({
      id: 'http', requestId: 'http', statusCode: 404, result: 'http-error',
    })] })));
    const m2 = matched(evaluation('M2', context({ tasks: [{
      id: 'task', navigationKey: 'nav', processId: 1, threadId: 1, startUs: 0,
      durationMs: 300, blockingContributionMs: 250, selfTimeMs: 200,
      categorySelfTimeMs: { script: 200 }, selfTimeConfidence: 'exact', limitations: [],
      evidenceIds: [evidence(6)],
    }] })));
    const r2 = matched(evaluation('R2', context({ rendering: [{
      id: 'layout', navigationKey: 'nav', name: 'Layout', processId: 1, threadId: 1,
      startUs: 0, durationMs: 250, evidenceIds: [evidence(7)],
    }] })));
    expect(n1.counterEvidence).toEqual(['存在 HTTP 响应，不能归类为网络传输失败。']);
    expect(m2.counterEvidence).toEqual(['该分类来自 Trace self time，不代表完整业务调用栈。']);
    expect(r2.counterEvidence).toEqual(['未将该渲染事件自动归因到主线程或 compositor。']);
  });
});
