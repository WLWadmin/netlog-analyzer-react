import { buildUploadPhase6DecisionReport } from './netlogUploadPhase6Decision';

const passingSingleScanEvidence = {
  mode: 'upload-single-scan' as const,
  datasetEventCount: 100,
  expectedEventCount: 100,
  singleScanDatasetReady: true,
  backgroundDatasetImportExpected: false,
  completeEventScanCount: 1,
  rawDetailReadbackOk: true,
  rawDetailRowsHaveByteRange: true,
  rawSearchWorstCaseHasMoreMatchesUnknown: true,
  rawSearchFilteredHasMoreMatchesUnknown: false,
  dnsAnswerEndpointOnlyCount: 0,
  dnsAnswerStateOnlyCount: 0,
  socketPeerHostTimeCandidate: 0,
  forbiddenConfirmedMatchesCount: 0,
  memoryPeakEstimateMb: 100,
  baselineMemoryPeakEstimateMb: 100,
  lightweightParseSkippedEvents: 10,
  lightweightParseSkippedBytes: 1024,
  lightweightParseSkipRate: 0.1,
};

describe('buildUploadPhase6DecisionReport', () => {
  it('单样本 single scan 即使核心门禁通过也只能扩大灰度，不能默认开启', () => {
    const report = buildUploadPhase6DecisionReport({
      ...passingSingleScanEvidence,
      sampleCount: 1,
    });

    expect(report.recommendation).toBe('expand-gray');
    expect(report.blockers).toContain('multiSampleEvidenceMissing');
    expect(report.satisfiedGates).toEqual(expect.arrayContaining([
      'singleScanDatasetReady',
      'noBackgroundDatasetImportExpected',
      'singleCompleteEventScan',
      'rawSearchGuardVerified',
      'diagnosisGuardHasNoForbiddenConfirmedMatches',
      'lightweightParseSkipMeasured',
    ]));
  });

  it('多样本且核心门禁通过时才允许默认开启', () => {
    const report = buildUploadPhase6DecisionReport({
      ...passingSingleScanEvidence,
      sampleCount: 2,
    });

    expect(report.recommendation).toBe('enable-default');
    expect(report.blockers).toEqual([]);
    expect(report.deepOptimizationCandidates).toEqual(expect.arrayContaining([
      'source-chain-dataset-view',
      'raw-evidence-virtual-tree',
    ]));
  });

  it('关键证据缺失或诊断守门失败时保持默认关闭', () => {
    const report = buildUploadPhase6DecisionReport({
      ...passingSingleScanEvidence,
      datasetEventCount: 99,
      rawDetailReadbackOk: false,
      forbiddenConfirmedMatchesCount: 1,
      sampleCount: 2,
    });

    expect(report.recommendation).toBe('keep-disabled');
    expect(report.blockers).toEqual(expect.arrayContaining([
      'datasetEventCountMismatch',
      'rawDetailReadbackOrByteRangeMissing',
      'forbiddenConfirmedMatchesPresent',
    ]));
  });

  it('single scan 内存明显高于 baseline 时建议先优化 parse 成本', () => {
    const report = buildUploadPhase6DecisionReport({
      ...passingSingleScanEvidence,
      memoryPeakEstimateMb: 150,
      baselineMemoryPeakEstimateMb: 100,
      sampleCount: 2,
    });

    expect(report.recommendation).toBe('keep-disabled');
    expect(report.blockers).toContain('singleScanMemoryHigherThanBaseline');
    expect(report.deepOptimizationCandidates).toEqual(expect.arrayContaining([
      'single-scan-parse-cost',
      'lazy-params-parser',
    ]));
  });

  it('缺少 lightweight parse skip 指标时要求补充真实 benchmark 证据', () => {
    const report = buildUploadPhase6DecisionReport({
      ...passingSingleScanEvidence,
      lightweightParseSkippedEvents: undefined,
      lightweightParseSkippedBytes: undefined,
      sampleCount: 2,
    });

    expect(report.nextEvidenceNeeded).toContain('Record lightweightParseSkippedEvents and lightweightParseSkippedBytes in browser benchmark metrics.');
    expect(report.deepOptimizationCandidates).toContain('single-scan-parse-cost');
  });
});
