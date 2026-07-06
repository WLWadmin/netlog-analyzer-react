export type SingleScanDefaultRecommendation = 'keep-disabled' | 'expand-gray' | 'enable-default';

export interface UploadEvidenceForDecision {
  mode?: 'dataset-import' | 'upload-single-scan';
  datasetEventCount?: number;
  expectedEventCount?: number;
  singleScanDatasetReady?: boolean;
  backgroundDatasetImportExpected?: boolean;
  completeEventScanCount?: number;
  rawDetailReadbackOk?: boolean;
  rawDetailRowsHaveByteRange?: boolean;
  rawSearchWorstCaseHasMoreMatchesUnknown?: boolean;
  rawSearchFilteredHasMoreMatchesUnknown?: boolean;
  dnsAnswerEndpointOnlyCount?: number;
  dnsAnswerStateOnlyCount?: number;
  socketPeerHostTimeCandidate?: number;
  forbiddenConfirmedMatchesCount?: number;
  memoryPeakEstimateMb?: number | null;
  baselineMemoryPeakEstimateMb?: number | null;
  lightweightParseSkippedEvents?: number;
  lightweightParseSkippedBytes?: number;
  lightweightParseSkipRate?: number;
  socketLazyProbeAttemptedEvents?: number;
  socketLazyProbeSatisfiedEvents?: number;
  socketLazyFallbackParamEvents?: number;
  socketEarlyReducerEvents?: number;
  socketLazyProbeSatisfiedRate?: number;
  sampleCount?: number;
}

export interface UploadPhase6DecisionReport {
  recommendation: SingleScanDefaultRecommendation;
  blockers: string[];
  satisfiedGates: string[];
  nextEvidenceNeeded: string[];
  deepOptimizationCandidates: Array<'single-scan-parse-cost' | 'lazy-params-parser' | 'source-chain-dataset-view' | 'raw-evidence-virtual-tree'>;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function buildUploadPhase6DecisionReport(evidence: UploadEvidenceForDecision): UploadPhase6DecisionReport {
  const blockers: string[] = [];
  const satisfiedGates: string[] = [];
  const nextEvidenceNeeded: string[] = [];
  const deepOptimizationCandidates: UploadPhase6DecisionReport['deepOptimizationCandidates'] = [];

  if (evidence.mode !== 'upload-single-scan') {
    blockers.push('singleScanRunMissing');
    nextEvidenceNeeded.push('Run upload-single-scan benchmark for the same real sample.');
  } else {
    satisfiedGates.push('singleScanRunPresent');
  }

  if (isNumber(evidence.expectedEventCount)) {
    if (evidence.datasetEventCount === evidence.expectedEventCount) {
      satisfiedGates.push('datasetEventCountMatchesExpected');
    } else {
      blockers.push('datasetEventCountMismatch');
    }
  } else if (isNumber(evidence.datasetEventCount) && evidence.datasetEventCount > 0) {
    satisfiedGates.push('datasetEventCountPresent');
    nextEvidenceNeeded.push('Record expectedEventCount for this sample to make event-count equality explicit.');
  } else {
    blockers.push('datasetEventCountMissing');
  }

  if (evidence.singleScanDatasetReady === true) {
    satisfiedGates.push('singleScanDatasetReady');
  } else if (evidence.mode === 'upload-single-scan') {
    blockers.push('singleScanDatasetNotReady');
  }

  if (evidence.backgroundDatasetImportExpected === false) {
    satisfiedGates.push('noBackgroundDatasetImportExpected');
  } else if (evidence.mode === 'upload-single-scan') {
    blockers.push('backgroundDatasetImportStillExpected');
  }

  if (evidence.completeEventScanCount === 1) {
    satisfiedGates.push('singleCompleteEventScan');
  } else {
    blockers.push('completeEventScanCountNotOne');
  }

  if (evidence.rawDetailReadbackOk === true && evidence.rawDetailRowsHaveByteRange === true) {
    satisfiedGates.push('rawDetailReadbackAndByteRangeOk');
  } else {
    blockers.push('rawDetailReadbackOrByteRangeMissing');
  }

  if (evidence.rawSearchWorstCaseHasMoreMatchesUnknown === true && evidence.rawSearchFilteredHasMoreMatchesUnknown === false) {
    satisfiedGates.push('rawSearchGuardVerified');
  } else {
    blockers.push('rawSearchGuardMissing');
  }

  if ((evidence.dnsAnswerEndpointOnlyCount ?? 0) >= 0 && (evidence.dnsAnswerStateOnlyCount ?? 0) >= 0) {
    satisfiedGates.push('dnsDiffReported');
  } else {
    blockers.push('dnsDiffMissing');
  }

  if ((evidence.socketPeerHostTimeCandidate ?? 0) === 0) {
    satisfiedGates.push('noHostTimeSocketPeerCandidate');
  } else {
    blockers.push('hostTimeSocketPeerCandidatePresent');
  }

  if ((evidence.forbiddenConfirmedMatchesCount ?? 0) === 0) {
    satisfiedGates.push('diagnosisGuardHasNoForbiddenConfirmedMatches');
  } else {
    blockers.push('forbiddenConfirmedMatchesPresent');
  }

  if ((evidence.sampleCount ?? 1) < 2) {
    blockers.push('multiSampleEvidenceMissing');
    nextEvidenceNeeded.push('Run the same evidence package on at least one more real NetLog sample.');
  } else {
    satisfiedGates.push('multiSampleEvidencePresent');
  }

  if (isNumber(evidence.memoryPeakEstimateMb) && isNumber(evidence.baselineMemoryPeakEstimateMb)) {
    if (evidence.memoryPeakEstimateMb <= evidence.baselineMemoryPeakEstimateMb * 1.2) {
      satisfiedGates.push('memoryWithinBaselineTolerance');
    } else {
      blockers.push('singleScanMemoryHigherThanBaseline');
      deepOptimizationCandidates.push('single-scan-parse-cost', 'lazy-params-parser');
    }
  } else {
    nextEvidenceNeeded.push('Collect baseline and single-scan memoryPeakEstimateMb in the same run environment.');
    deepOptimizationCandidates.push('single-scan-parse-cost');
  }

  if (isNumber(evidence.lightweightParseSkippedEvents) && isNumber(evidence.lightweightParseSkippedBytes)) {
    if (evidence.lightweightParseSkippedEvents > 0 && evidence.lightweightParseSkippedBytes > 0) {
      satisfiedGates.push('lightweightParseSkipMeasured');
    } else {
      nextEvidenceNeeded.push('Run a NetLog sample with high-frequency lightweight events and record lightweightParseSkippedEvents/Bytes.');
    }
  } else {
    nextEvidenceNeeded.push('Record lightweightParseSkippedEvents and lightweightParseSkippedBytes in browser benchmark metrics.');
    deepOptimizationCandidates.push('single-scan-parse-cost');
  }

  if (isNumber(evidence.socketLazyProbeAttemptedEvents) && isNumber(evidence.socketLazyProbeSatisfiedEvents) && isNumber(evidence.socketLazyFallbackParamEvents)) {
    satisfiedGates.push('socketLazyParamsStatsMeasured');
    if (evidence.socketLazyProbeAttemptedEvents > 0 && evidence.socketLazyProbeSatisfiedEvents === 0) {
      nextEvidenceNeeded.push('Socket lazy params probe measured zero satisfied events; inspect real NetLog socket param shapes before adding early reducer path.');
      deepOptimizationCandidates.push('lazy-params-parser');
    }
  } else {
    nextEvidenceNeeded.push('Record socketLazyProbeAttemptedEvents/SatisfiedEvents/FallbackParamEvents in browser benchmark metrics.');
    deepOptimizationCandidates.push('lazy-params-parser');
  }

  if (blockers.length === 0) {
    return {
      recommendation: 'enable-default',
      blockers,
      satisfiedGates,
      nextEvidenceNeeded,
      deepOptimizationCandidates: Array.from(new Set([
        ...deepOptimizationCandidates,
        'source-chain-dataset-view' as const,
        'raw-evidence-virtual-tree' as const,
      ])),
    };
  }

  const hardBlockers = blockers.filter(item => item !== 'multiSampleEvidenceMissing');
  return {
    recommendation: hardBlockers.length === 0 ? 'expand-gray' : 'keep-disabled',
    blockers,
    satisfiedGates,
    nextEvidenceNeeded,
    deepOptimizationCandidates: Array.from(new Set(deepOptimizationCandidates)),
  };
}
