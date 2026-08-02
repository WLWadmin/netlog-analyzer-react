import type { TraceDiagnosis } from './types';
import { selectTraceDiagnoses } from './selectTraceDiagnoses';

function diagnosis(overrides: Partial<TraceDiagnosis>): TraceDiagnosis {
  return {
    id: 'diagnosis',
    ruleId: 'M1',
    category: 'main-thread',
    severity: 'warning',
    score: 50,
    title: '诊断',
    conclusion: '结论',
    confidence: 'medium',
    evidenceIds: ['trace:event:1'],
    counterEvidence: [],
    advice: [],
    factIds: [],
    limitations: [],
    ...overrides,
  };
}

describe('selectTraceDiagnoses', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
    delete process.env.REACT_APP_ENABLE_TRACE_TIMELINE;
    delete process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS;
  });

  it('高分观察项不覆盖可作为主结论的诊断', () => {
    const selection = selectTraceDiagnoses([
      diagnosis({ id: 'network-observation', ruleId: 'N1', category: 'network', confidence: 'observation', score: 100 }),
      diagnosis({ id: 'security-observation', ruleId: 'S1', category: 'security', confidence: 'observation', score: 90 }),
      diagnosis({ id: 'main-thread', score: 60 }),
    ]);

    expect(selection.primary?.id).toBe('main-thread');
    expect(selection.secondary.map(item => item.id)).toEqual([
      'network-observation',
      'security-observation',
    ]);
  });

  it('只有观察项时不伪造主结论', () => {
    const selection = selectTraceDiagnoses([
      diagnosis({ id: 'network-observation', ruleId: 'N1', category: 'network', confidence: 'observation' }),
      diagnosis({ id: 'security-observation', ruleId: 'S1', category: 'security', confidence: 'observation' }),
    ]);

    expect(selection.primary).toBeUndefined();
    expect(selection.secondary).toHaveLength(2);
  });

  it('排序和选择不受输入顺序影响', () => {
    const diagnoses = [
      diagnosis({ id: 'b', score: 40 }),
      diagnosis({ id: 'a', score: 40 }),
      diagnosis({ id: 'critical', severity: 'critical', score: 40 }),
    ];

    expect(selectTraceDiagnoses(diagnoses).selected.map(item => item.id)).toEqual(
      selectTraceDiagnoses([...diagnoses].reverse()).selected.map(item => item.id),
    );
  });

  it('does not promote a higher raw score over stronger necessary evidence and fewer counters', () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    const selection = selectTraceDiagnoses([
      diagnosis({
        id: 'high-score-weak',
        score: 99,
        evidenceIds: [],
        limitations: ['缺少必要证据'],
      }),
      diagnosis({
        id: 'evidence-covered',
        score: 60,
        evidenceIds: ['trace:event:1'],
      }),
    ]);

    expect(selection.primary?.id).toBe('evidence-covered');
  });

  it('keeps the Stage 2 score ordering while expert analysis is disabled', () => {
    const selection = selectTraceDiagnoses([
      diagnosis({ id: 'higher-score', score: 99, evidenceIds: [] }),
      diagnosis({ id: 'evidence-covered', score: 60 }),
    ]);

    expect(selection.primary?.id).toBe('higher-score');
  });
});
