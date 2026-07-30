import { scoreTraceDiagnosis } from './traceScoring';

describe('Trace diagnosis scoring', () => {
  it('multiplies the four scoring factors', () => {
    expect(scoreTraceDiagnosis({
      severity: 'warning',
      evidenceStrength: 'derived',
      impactRatio: 0.5,
      qualityCoverage: 'partial',
    })).toBeCloseTo(0.7 * 0.75 * 0.5 * 0.7);
  });

  it('clamps impact ratio to zero and one', () => {
    expect(scoreTraceDiagnosis({
      severity: 'critical',
      evidenceStrength: 'direct',
      impactRatio: 2,
      qualityCoverage: 'good',
    })).toBe(1);
    expect(scoreTraceDiagnosis({
      severity: 'critical',
      evidenceStrength: 'direct',
      impactRatio: -1,
      qualityCoverage: 'good',
    })).toBe(0);
  });

  it('makes insufficient quality coverage score zero', () => {
    expect(scoreTraceDiagnosis({
      severity: 'critical',
      evidenceStrength: 'direct',
      impactRatio: 1,
      qualityCoverage: 'insufficient',
    })).toBe(0);
  });
});
