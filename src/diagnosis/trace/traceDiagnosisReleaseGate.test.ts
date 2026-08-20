import { buildTraceGoldenCorpus } from './traceGoldenCorpus';
import { buildTraceDiagnosisReleaseGateReport } from './traceDiagnosisReleaseGate';
import { buildRealSampleValidationGateReport } from '../shared/realSampleValidationGate';

const traceRealSampleValidation = buildRealSampleValidationGateReport({
  TRACE_SAMPLE_MANIFEST_PATH: 'configured',
  TRACE_PLAIN_SAMPLE_PATH: 'configured',
  TRACE_GZIP_SAMPLE_PATH: 'configured',
}, {
  trace: { executed: true, passed: true },
});

describe('traceDiagnosisReleaseGate', () => {
  it('reports exactly the user-specified seven metrics', () => {
    const report = buildTraceDiagnosisReleaseGateReport(buildTraceGoldenCorpus(), {
      realSampleValidation: traceRealSampleValidation,
    });
    expect(report.passed).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.metrics).toEqual({
      corpusPassed: true,
      forbiddenConclusionCount: 0,
      missingEvidenceReferenceCount: 0,
      unstableDiagnosisCount: 0,
      sensitiveLeakCount: 0,
      disabledRuleCoverage: 1,
      deterministicOrderPassed: true,
    });
    expect(Object.keys(report.metrics)).toHaveLength(7);
  });

  it('blocks release when real-sample validation artifacts are absent', () => {
    const report = buildTraceDiagnosisReleaseGateReport(buildTraceGoldenCorpus());

    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('尚未提供已执行且通过的 Trace 真实样本验证记录');
  });

  it('folds all structured expectation failures into corpusPassed', () => {
    const mutations = [
      (corpus: ReturnType<typeof buildTraceGoldenCorpus>) => { corpus[1].expectation.requiredRules[0].category = 'security'; },
      (corpus: ReturnType<typeof buildTraceGoldenCorpus>) => { corpus[2].expectation.requiredRules[0].confidence.min = 'confirmed'; },
      (corpus: ReturnType<typeof buildTraceGoldenCorpus>) => { corpus[8].expectation.requiredRules[0].limitations = ['不存在的限制']; },
      (corpus: ReturnType<typeof buildTraceGoldenCorpus>) => { corpus[9].expectation.requiredRules[0].disabledReason = 'EVIDENCE_MISSING'; },
      (corpus: ReturnType<typeof buildTraceGoldenCorpus>) => { corpus[0].expectation.factAssertions[0].expected = 'wrong'; },
    ];
    for (const mutate of mutations) {
      const corpus = buildTraceGoldenCorpus();
      mutate(corpus);
      expect(buildTraceDiagnosisReleaseGateReport(corpus).metrics.corpusPassed).toBe(false);
    }
  });

  it('counts forbidden rules and missing evidence references generically', () => {
    const corpus = buildTraceGoldenCorpus();
    corpus[1].expectation.forbiddenRules.push('N1');
    corpus[8].runs[0].diagnoses[0].evidenceIds.push('trace:event:missing');
    const metrics = buildTraceDiagnosisReleaseGateReport(corpus).metrics;
    expect(metrics.forbiddenConclusionCount).toBeGreaterThan(0);
    expect(metrics.missingEvidenceReferenceCount).toBeGreaterThan(0);
  });


  it('counts an empty diagnosis evidence array as a missing evidence reference', () => {
    const corpus = buildTraceGoldenCorpus();
    corpus[8].runs[0].diagnoses[0].evidenceIds = [];
    const report = buildTraceDiagnosisReleaseGateReport(corpus);
    expect(report.metrics.missingEvidenceReferenceCount).toBe(1);
    expect(report.passed).toBe(false);
  });

  it('runs three times and detects full-output instability and order changes', () => {
    const corpus = buildTraceGoldenCorpus();
    corpus[1].runs[1].diagnoses[0].advice.push('unstable');
    corpus[1].runs[2].diagnoses.reverse();
    const metrics = buildTraceDiagnosisReleaseGateReport(corpus).metrics;
    expect(metrics.unstableDiagnosisCount).toBeGreaterThan(0);
    expect(metrics.deterministicOrderPassed).toBe(false);
  });

  it('scans the complete diagnosis text instead of only sensitive samples', () => {
    const corpus = buildTraceGoldenCorpus();
    corpus[8].runs[0].diagnoses[0].advice.push('Authorization: Bearer FAKE_TOKEN_VALUE');
    const report = buildTraceDiagnosisReleaseGateReport(corpus);
    expect(report.metrics.sensitiveLeakCount).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
  });


  it('fails corpusPassed for missing required rules, confidence upper bounds and evidence policy', () => {
    const missingRule = buildTraceGoldenCorpus();
    missingRule[2].runs[0].evaluations = missingRule[2].runs[0].evaluations
      .filter(item => item.ruleId !== 'N2');
    expect(buildTraceDiagnosisReleaseGateReport(missingRule).metrics.corpusPassed).toBe(false);

    const confidence = buildTraceGoldenCorpus();
    confidence[14].runs[0].diagnoses.find(item => item.ruleId === 'S1')!.confidence = 'high';
    expect(buildTraceDiagnosisReleaseGateReport(confidence).metrics.corpusPassed).toBe(false);

    const evidence = buildTraceGoldenCorpus();
    evidence[8].expectation.requiredRules[0].evidence = 'forbidden';
    expect(buildTraceDiagnosisReleaseGateReport(evidence).metrics.corpusPassed).toBe(false);
  });

  it('scans forbidden conclusions across the complete diagnosis text', () => {
    const corpus = buildTraceGoldenCorpus();
    corpus[1].runs[0].diagnoses[0].advice.push('HTTP 错误等同网络传输失败');
    const report = buildTraceDiagnosisReleaseGateReport(corpus);
    expect(report.metrics.forbiddenConclusionCount).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
  });

  it('calculates disabled rule coverage from explicit disabled expectations', () => {
    const corpus = buildTraceGoldenCorpus();
    const missingTiming = corpus.find(item => item.id === '缺timing')!;
    missingTiming.runs[0].evaluations = missingTiming.runs[0].evaluations.filter(item => item.ruleId !== 'N3');
    const report = buildTraceDiagnosisReleaseGateReport(corpus);
    expect(report.metrics.disabledRuleCoverage).toBeLessThan(1);
    expect(report.passed).toBe(false);
  });
});
