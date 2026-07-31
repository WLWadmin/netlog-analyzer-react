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
    evidenceIds: [],
    counterEvidence: [],
    advice: [],
    factIds: [],
    limitations: [],
    ...overrides,
  };
}

describe('selectTraceDiagnoses', () => {
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
});
