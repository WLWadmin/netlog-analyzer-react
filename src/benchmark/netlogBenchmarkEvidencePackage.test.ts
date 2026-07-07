import { buildNetlogBenchmarkEvidencePackage } from './netlogBenchmarkEvidencePackage';

describe('buildNetlogBenchmarkEvidencePackage', () => {
  it('聚合 baseline 与 upload-single-scan benchmark 指标并生成 Phase 6 evidence', () => {
    const evidence = buildNetlogBenchmarkEvidencePackage([
      {
        label: 'real-326mb-baseline',
        fileName: 'chrome-net-export-log.json',
        fileSize: 326,
        mode: 'dataset-import',
        datasetEventCount: 100,
        memoryPeakEstimateMb: 120,
      },
      {
        label: 'real-326mb-single-scan',
        fileName: 'chrome-net-export-log.json',
        fileSize: 326,
        mode: 'upload-single-scan',
        datasetEventCount: 100,
        datasetReadyMs: 4000,
        uploadToFirstDiagnosisMs: 4000,
        queryP95: 20,
        detailP95: 10,
        rawDetailReadbackOk: true,
        rawDetailRowsHaveByteRange: true,
        rawSearchWorstCaseMs: 10000,
        rawSearchWorstCaseHasMoreMatchesUnknown: true,
        rawSearchFilteredMs: 20,
        rawSearchFilteredHasMoreMatchesUnknown: false,
        dnsAnswerEndpointOnlyCount: 2,
        dnsAnswerStateOnlyCount: 3,
        socketPeerHostTimeCandidate: 0,
        memoryPeakEstimateMb: 130,
        lightweightParseSkippedEvents: 25,
        lightweightParseSkippedBytes: 2048,
        socketParseSkippedEvents: 8,
        socketParseSkippedBytes: 1024,
        socketLazyProbeAttemptedEvents: 10,
        socketLazyProbeSatisfiedEvents: 8,
        socketLazyFallbackParamEvents: 2,
        socketEarlyReducerEvents: 8,
        completeEventScanCount: 1,
        singleScanDatasetReady: true,
        backgroundDatasetImportExpected: false,
      },
    ], '2026-07-06T00:00:00.000Z');

    expect(evidence).toEqual(expect.objectContaining({
      packageVersion: 'netlog-benchmark-evidence-v1',
      generatedAt: '2026-07-06T00:00:00.000Z',
      metricCount: 2,
      sampleCount: 1,
    }));
    expect(evidence.files).toEqual([
      expect.objectContaining({
        fileName: 'chrome-net-export-log.json',
        modes: ['dataset-import', 'upload-single-scan'],
      }),
    ]);
    expect(evidence.aggregate).toEqual(expect.objectContaining({
      datasetEventCount: 100,
      baselineDatasetEventCount: 100,
      lightweightParseSkippedEvents: 25,
      lightweightParseSkippedBytes: 2048,
      lightweightParseSkipRate: 0.25,
      socketParseSkippedEvents: 8,
      socketParseSkippedBytes: 1024,
      socketParseSkipRate: 0.08,
      socketLazyProbeAttemptedEvents: 10,
      socketLazyProbeSatisfiedEvents: 8,
      socketLazyFallbackParamEvents: 2,
      socketEarlyReducerEvents: 8,
      socketLazyProbeSatisfiedRate: 0.8,
    }));
    expect(evidence.phase6Evidence).toEqual(expect.objectContaining({
      expectedEventCount: 100,
      sampleCount: 1,
      backgroundDatasetImportExpected: false,
      rawSearchFilteredHasMoreMatchesUnknown: false,
      lightweightParseSkipRate: 0.25,
      socketLazyProbeSatisfiedRate: 0.8,
    }));
    expect(evidence.phase6Decision.satisfiedGates).toEqual(expect.arrayContaining([
      'datasetEventCountMatchesExpected',
      'lightweightParseSkipMeasured',
      'socketLazyParamsStatsMeasured',
    ]));
  });

  it('缺少 upload-single-scan 时输出 gap 并保持默认关闭', () => {
    const evidence = buildNetlogBenchmarkEvidencePackage([
      {
        label: 'baseline-only',
        fileName: 'chrome-net-export-log.json',
        mode: 'dataset-import',
        datasetEventCount: 100,
      },
    ]);

    expect(evidence.gaps).toEqual(expect.arrayContaining([
      '缺少 upload-single-scan benchmark。',
    ]));
    expect(evidence.phase6Decision.recommendation).toBe('keep-disabled');
    expect(evidence.phase6Decision.blockers).toContain('singleScanRunMissing');
  });
});
