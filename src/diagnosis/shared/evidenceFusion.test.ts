import type { DiagnosticCard } from './types';
import type { DiagnosisObservation } from './diagnosisObservation';
import type { RequestCorrelation } from './requestCorrelation';
import { applyEvidenceFusion, fuseDiagnosisEvidence } from './evidenceFusion';

function observation(overrides: Partial<DiagnosisObservation>): DiagnosisObservation {
  return {
    id: 'obs',
    source: 'har',
    category: 'server',
    subject: { requestId: 1, domain: 'api.example.test', safePath: '/v1/resource', method: 'GET' },
    severity: 'warning',
    evidenceLevel: 'supporting',
    fact: 'TTFB 慢',
    evidence: [{ label: '请求', value: 'GET api.example.test/v1/resource', source: 'har', requestIds: [1] }],
    requiresMoreEvidence: true,
    primary: true,
    explanationState: 'partial',
    ...overrides,
  };
}

function correlation(overrides: Partial<RequestCorrelation>): RequestCorrelation {
  return {
    harRequestId: 1,
    netlogSourceIds: [10],
    primaryNetlogSourceId: 10,
    candidateCount: 1,
    level: 'same-origin-path-method',
    score: 0.9,
    reasons: ['origin + pathname + method 一致'],
    conflicts: [],
    safeKey: 'GET https://api.example.test/v1/resource',
    ...overrides,
  };
}

function card(): DiagnosticCard {
  return {
    id: 'combined-card',
    source: 'combined',
    category: 'server',
    severity: 'warning',
    confidence: 'medium',
    title: '服务端响应慢',
    conclusion: 'HAR 显示 TTFB 慢',
    scope: { type: 'single-request', summary: '1 个请求', affectedRequestCount: 1, affectedDomainCount: 1 },
    evidence: [{ label: 'HAR', value: 'TTFB 1800ms', source: 'har', originalSource: 'har', requestIds: [1] }],
    actions: [],
  };
}

describe('evidenceFusion', () => {
  it('raises confidence when HAR and NetLog support the same correlated request', () => {
    const fusion = fuseDiagnosisEvidence({
      harObservations: [observation({})],
      netlogObservations: [observation({
        id: 'netlog-slow',
        source: 'netlog',
        category: 'performance',
        subject: { sourceId: 10, domain: 'api.example.test', safePath: '/v1/resource', method: 'GET' },
        evidence: [{ label: '耗时', value: '1800ms', source: 'netlog', sourceIds: [10] }],
      })],
      correlations: [correlation({})],
      baseConfidence: 'medium',
    });

    expect(fusion.confidence).toBe('high');
    expect(fusion.mergedSources).toEqual(['har', 'netlog']);
    expect(fusion.confidenceFactors).toContainEqual(expect.objectContaining({ label: '双源证据', impact: 'positive' }));
    expect(fusion.confidenceFactors).toContainEqual(expect.objectContaining({ label: '强请求关联', impact: 'positive' }));
  });

  it('adds counter evidence and lowers confidence when HAR TTFB lacks NetLog network failures', () => {
    const fusion = fuseDiagnosisEvidence({
      harObservations: [observation({ category: 'server', fact: 'TTFB 慢' })],
      netlogObservations: [],
      correlations: [correlation({})],
      baseConfidence: 'high',
    });

    expect(fusion.confidence).toBe('medium');
    expect(fusion.counterEvidence[0]).toMatchObject({
      label: '反证',
      originalSource: 'netlog',
    });
    expect(fusion.limitations.join('\n')).toContain('反证只能降低某类根因置信度');
  });

  it('does not raise confidence from a weak correlation with a different category', () => {
    const fusion = fuseDiagnosisEvidence({
      harObservations: [observation({ category: 'server' })],
      netlogObservations: [observation({
        id: 'unrelated-dns',
        source: 'netlog',
        category: 'dns',
        subject: { domain: 'api.example.test' },
        evidence: [{ label: '错误码', value: '-105', source: 'netlog' }],
      })],
      correlations: [correlation({ level: 'same-host-only', score: 0.45 })],
      baseConfidence: 'medium',
    });

    expect(fusion.confidence).toBe('low');
    expect(fusion.supportingEvidence.some(item => item.originalSource === 'netlog')).toBe(false);
  });

  it('does not raise confidence from a same-domain observation bound to another NetLog source', () => {
    const fusion = fuseDiagnosisEvidence({
      harObservations: [observation({})],
      netlogObservations: [observation({
        id: 'other-source',
        source: 'netlog',
        category: 'performance',
        subject: { sourceId: 99, domain: 'api.example.test', safePath: '/v1/resource', method: 'GET' },
        evidence: [{ label: '耗时', value: '1800ms', source: 'netlog', sourceIds: [99] }],
      })],
      correlations: [correlation({ netlogSourceIds: [10], primaryNetlogSourceId: 10 })],
      baseConfidence: 'medium',
    });

    expect(fusion.confidence).toBe('medium');
    expect(fusion.supportingEvidence.some(item => item.originalSource === 'netlog')).toBe(false);
  });

  it('records conflicts for weak or conflicting correlations', () => {
    const fusion = fuseDiagnosisEvidence({
      harObservations: [observation({})],
      netlogObservations: [observation({
        id: 'dns',
        source: 'netlog',
        category: 'dns',
        subject: { domain: 'api.example.test' },
        evidence: [{ label: '错误码', value: '-105', source: 'netlog' }],
      })],
      correlations: [correlation({ level: 'same-host-path', score: 0.75, conflicts: ['method 不一致：HAR=POST, NetLog=GET'] })],
      baseConfidence: 'medium',
    });

    expect(fusion.conflictNotes).toContain('请求关联冲突：method 不一致：HAR=POST, NetLog=GET');
    expect(fusion.confidenceFactors).toContainEqual(expect.objectContaining({ label: '证据冲突', impact: 'negative' }));
  });

  it('applies fusion fields to diagnostic card without replacing root-cause boundary text', () => {
    const fusion = fuseDiagnosisEvidence({
      harObservations: [observation({})],
      netlogObservations: [],
      correlations: [],
      baseConfidence: 'high',
    });
    const fused = applyEvidenceFusion(card(), fusion);

    expect(fused.confidence).toBe('high');
    expect(fused.evidence.some(item => item.label === '反证')).toBe(false);
    expect(JSON.stringify(fused)).not.toContain('已确认');
    expect(JSON.stringify(fused)).not.toContain('确定根因');
  });
});
