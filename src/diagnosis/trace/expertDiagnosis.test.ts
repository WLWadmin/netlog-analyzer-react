import {
  assessActivityContribution,
  buildDiagnosisFindings,
  classifyScriptActivity,
} from './expertDiagnosis';
import type { TraceDiagnosis } from './types';

function diagnosis(overrides: Partial<TraceDiagnosis>): TraceDiagnosis {
  return {
    id: 'diagnosis',
    ruleId: 'M1',
    category: 'main-thread',
    severity: 'warning',
    score: 50,
    title: '主线程阻塞',
    conclusion: '观察到长任务',
    confidence: 'medium',
    evidenceIds: ['trace:event:1'],
    counterEvidence: [],
    advice: ['缩小范围复核'],
    factIds: ['task:1'],
    limitations: [],
    ...overrides,
  };
}

describe('expert Trace diagnosis', () => {
  it('does not infer third party without a trusted page origin', () => {
    expect(classifyScriptActivity({
      scriptUrl: 'https://cdn.example.com/app.js?token=<REDACTED>',
    })).toEqual({ classification: 'unknown' });
    expect(classifyScriptActivity({
      pageOrigin: 'https://app.example.com',
      scriptUrl: 'https://cdn.example.com/app.js',
    })).toEqual({ classification: 'third-party' });
    expect(classifyScriptActivity({
      pageOrigin: 'https://app.example.com',
      scriptUrl: 'chrome-extension://secret-extension-id/content.js',
    })).toEqual({ classification: 'browser-extension' });
  });

  it('keeps extension presence as an observation without symptom contribution evidence', () => {
    const result = assessActivityContribution({
      classification: 'browser-extension',
      overlapsSymptom: false,
      cpuRatio: 0.4,
      hasStackEvidence: true,
    });

    expect(result.level).toBe('observation');
    expect(JSON.stringify(result)).not.toContain('secret-extension-id');
    expect(assessActivityContribution({
      classification: 'unknown',
      overlapsSymptom: true,
      cpuRatio: 0.9,
      hasStackEvidence: true,
    }).level).toBe('observation');
  });

  it('allows correlation only when overlap, CPU share and stack evidence agree', () => {
    expect(assessActivityContribution({
      classification: 'browser-extension',
      overlapsSymptom: true,
      cpuRatio: 0.55,
      hasStackEvidence: true,
    }).level).toBe('highly-correlated');
  });

  it('builds symptom findings with counter evidence and competing causes', () => {
    const findings = buildDiagnosisFindings([
      diagnosis({ id: 'main', score: 60 }),
      diagnosis({
        id: 'rendering',
        ruleId: 'R1',
        category: 'rendering',
        score: 90,
        evidenceIds: ['trace:event:2'],
        counterEvidence: ['当前范围脚本也持续繁忙'],
        limitations: ['缺少帧级直接因果链'],
      }),
    ]);

    expect(findings[0]).toMatchObject({
      phenomenon: expect.any(String),
      attributionLevel: expect.stringMatching(
        /highly-correlated|possible-contributor|observation|insufficient/,
      ),
      necessaryEvidenceIds: expect.any(Array),
      counterEvidenceIds: expect.any(Array),
      competingCauses: expect.arrayContaining([
        expect.objectContaining({ findingId: expect.any(String) }),
      ]),
      verificationSteps: expect.any(Array),
    });
    expect(findings.every(item => item.attributionLevel !== 'confirmed')).toBe(true);
    expect(findings.flatMap(item => item.counterEvidenceIds)).toEqual([]);
    expect(JSON.stringify(findings)).not.toContain('counter:');
  });
});
