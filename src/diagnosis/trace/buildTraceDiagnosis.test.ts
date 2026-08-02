import type { TraceContextFacts } from '../../parsers/trace/types';
import { buildTraceDiagnosis } from './buildTraceDiagnosis';
import type {
  RuleEvaluation,
  TraceDiagnosis,
  TraceDiagnosisRule,
  TraceRuleId,
} from './types';

const RULE_IDS: TraceRuleId[] = [
  'Q1', 'L1', 'L2', 'N1', 'N2', 'N3', 'M1',
  'M2', 'R1', 'R2', 'I1', 'C1', 'S1',
];

function context(): TraceContextFacts {
  return {
    processes: [],
    threads: [],
    frames: [],
    navigations: [],
    evidence: [{ evidenceId: 'trace:event:allowed', eventIndex: 0, origin: 'raw' }],
    evidenceTotalCount: 1,
    evidenceReturnedCount: 1,
    quality: {
      level: 'good',
      captureWindow: 'available',
      navigationContext: 'available',
      processThreadMetadata: 'available',
      frameHierarchy: 'available',
      rendererMainThread: 'available',
      skippedEventCount: 0,
      warnings: [],
      disabledCapabilities: [],
    },
    warnings: [],
  };
}

function diagnosis(overrides: Partial<TraceDiagnosis> = {}): TraceDiagnosis {
  return {
    id: 'trace:Q1:global:trace:event:allowed',
    ruleId: 'Q1',
    category: 'loading',
    severity: 'warning',
    score: 0.7,
    title: 'Title',
    conclusion: 'Conclusion',
    confidence: 'confirmed',
    evidenceIds: ['trace:event:allowed'],
    counterEvidence: [],
    advice: ['Advice'],
    factIds: [],
    limitations: [],
    ...overrides,
  };
}

function rule(id: TraceRuleId, evaluations: RuleEvaluation[]): TraceDiagnosisRule {
  return {
    id,
    category: id === 'S1' ? 'security' : 'loading',
    requiredFacts: ['requests'],
    forbiddenConclusions: ['Do not infer causation without direct evidence.'],
    evaluate: () => evaluations,
  };
}

describe('buildTraceDiagnosis', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
    delete process.env.REACT_APP_ENABLE_TRACE_TIMELINE;
    delete process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS;
  });

  it('supports the fixed 13 rule IDs', () => {
    expect(RULE_IDS).toHaveLength(13);
  });

  it('uses the fixed rule set by default', () => {
    const result = buildTraceDiagnosis(context());
    expect(result.evaluations.map(item => item.ruleId)).toEqual([
      'Q1', 'L1', 'L2', 'N1', 'N2', 'N3', 'C1', 'S1', 'M1', 'M2', 'R1', 'R2', 'I1',
    ]);
  });


  it('exposes rule category, required facts, and forbidden conclusions', () => {
    const traceRule = rule('S1', []);

    expect(traceRule).toMatchObject({
      category: 'security',
      requiredFacts: ['requests'],
      forbiddenConclusions: ['Do not infer causation without direct evidence.'],
    });
  });

  it('only orchestrates supplied rules and preserves fixed disabled reasons', () => {
    const result = buildTraceDiagnosis(context(), [
      rule('Q1', [{
        ruleId: 'Q1',
        status: 'disabled',
        reason: 'QUALITY_INSUFFICIENT',
      }]),
      rule('L1', [{
        ruleId: 'L1',
        status: 'not-matched',
        reason: 'Below threshold.',
      }]),
    ]);

    expect(result.diagnoses).toEqual([]);
    expect(result.evaluations).toEqual([
      { ruleId: 'Q1', status: 'disabled', reason: 'QUALITY_INSUFFICIENT' },
      { ruleId: 'L1', status: 'not-matched', reason: 'Below threshold.' },
    ]);
  });

  it('filters evidence IDs but preserves non-sensitive counter-evidence text', () => {
    const result = buildTraceDiagnosis(context(), [rule('Q1', [{
      ruleId: 'Q1',
      status: 'matched',
      reason: 'Matched.',
      diagnosis: diagnosis({
        evidenceIds: ['trace:event:blocked', 'trace:event:allowed'],
        counterEvidence: ['存在反向事实，结论需保留限制。'],
      }),
    }])]);

    expect(result.diagnoses[0].evidenceIds).toEqual(['trace:event:allowed']);
    expect(result.diagnoses[0].counterEvidence).toEqual(['存在反向事实，结论需保留限制。']);
  });

  it('disables matched output when no whitelisted evidence remains', () => {
    const result = buildTraceDiagnosis(context(), [rule('Q1', [{
      ruleId: 'Q1',
      status: 'matched',
      reason: 'Matched.',
      diagnosis: diagnosis({ evidenceIds: ['trace:event:blocked'] }),
    }])]);

    expect(result.diagnoses).toEqual([]);
    expect(result.evaluations).toEqual([{
      ruleId: 'Q1',
      status: 'disabled',
      reason: 'EVIDENCE_MISSING',
    }]);
  });


  it('uses shared masking for every diagnosis text field', () => {
    const sensitive = '/Users/example/private/app.js?token=FAKE_TOKEN_VALUE';
    const result = buildTraceDiagnosis(context(), [rule('Q1', [{
      ruleId: 'Q1', status: 'matched', reason: 'Matched.', diagnosis: diagnosis({
        title: sensitive,
        conclusion: `source=${sensitive}`,
        counterEvidence: [sensitive],
        advice: [`https://example.test/path?debug=private`],
        limitations: [`C:\\Users\\example\\private\\app.js`],
      }),
    }])]);
    const output = JSON.stringify(result.diagnoses[0]);
    expect(output).not.toContain('FAKE_TOKEN_VALUE');
    expect(output).not.toContain('/Users/example');
    expect(output).not.toContain('debug=private');
    expect(output).not.toContain('C:\\\\Users\\\\example');
    expect(output).toContain('[local path masked]');
    expect(output).toContain('[query masked]');
  });

  it('sorts by score, severity, ruleId, and id', () => {
    const evaluations = [
      diagnosis({ id: 'z', ruleId: 'L1', score: 0.5, severity: 'warning' }),
      diagnosis({ id: 'b', ruleId: 'Q1', score: 0.5, severity: 'critical' }),
      diagnosis({ id: 'a', ruleId: 'Q1', score: 0.5, severity: 'critical' }),
      diagnosis({ id: 'low', ruleId: 'S1', score: 0.4, severity: 'critical' }),
    ].map(item => ({
      ruleId: item.ruleId,
      status: 'matched' as const,
      reason: 'Matched.',
      diagnosis: item,
    }));
    const result = buildTraceDiagnosis(context(), [rule('Q1', evaluations)]);

    expect(result.diagnoses.map(item => item.id)).toEqual(['a', 'b', 'z', 'low']);
    expect(result.findings).toBeUndefined();
  });

  it('adds expert findings only when all three feature flags are enabled', () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    const item = diagnosis({ id: 'expert' });
    const result = buildTraceDiagnosis(context(), [rule('Q1', [{
      ruleId: 'Q1',
      status: 'matched',
      reason: 'Matched.',
      diagnosis: item,
    }])]);

    expect(result.findings?.map(finding => finding.id)).toEqual([
      'finding:expert',
    ]);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phenomenon: item.title,
        attributionLevel: 'highly-correlated',
      }),
    ]));
  });
});
