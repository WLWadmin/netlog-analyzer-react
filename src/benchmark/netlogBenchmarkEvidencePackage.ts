import { buildUploadPhase6DecisionReport, type UploadEvidenceForDecision, type UploadPhase6DecisionReport } from './netlogUploadPhase6Decision';

export interface NetlogBenchmarkMetricInput {
  benchmark?: string;
  runtime?: string;
  label?: string;
  fileName?: string;
  fileSize?: number;
  mode?: 'dataset-import' | 'upload-single-scan';
  datasetEventCount?: number;
  datasetImportMs?: number;
  datasetReadyMs?: number;
  uploadToFirstDiagnosisMs?: number;
  summaryScanMs?: number;
  queryP95?: number;
  detailP95?: number;
  rawDetailReadbackOk?: boolean;
  rawDetailRowsHaveByteRange?: boolean;
  rawSearchWorstCaseMs?: number;
  rawSearchWorstCaseHasMoreMatchesUnknown?: boolean;
  rawSearchFilteredMs?: number;
  rawSearchFilteredHasMoreMatchesUnknown?: boolean;
  dnsAnswerEndpointOnlyCount?: number;
  dnsAnswerStateOnlyCount?: number;
  socketPeerHostTimeCandidate?: number;
  memoryPeakEstimateMb?: number | null;
  lightweightParseSkippedEvents?: number;
  lightweightParseSkippedBytes?: number;
  socketLazyProbeAttemptedEvents?: number;
  socketLazyProbeSatisfiedEvents?: number;
  socketLazyFallbackParamEvents?: number;
  completeEventScanCount?: number;
  singleScanDatasetReady?: boolean;
  backgroundDatasetImportExpected?: boolean;
  errors?: string[];
}

export interface NetlogBenchmarkEvidencePackage {
  packageVersion: 'netlog-benchmark-evidence-v1';
  generatedAt: string;
  metricCount: number;
  sampleCount: number;
  labels: string[];
  files: Array<{
    fileName: string;
    fileSize?: number;
    modes: Array<'dataset-import' | 'upload-single-scan'>;
  }>;
  aggregate: {
    datasetEventCount?: number;
    baselineDatasetEventCount?: number;
    datasetReadyMsMax?: number;
    uploadToFirstDiagnosisMsMax?: number;
    queryP95Max?: number;
    detailP95Max?: number;
    rawSearchWorstCaseMsMax?: number;
    rawSearchFilteredMsMax?: number;
    memoryPeakEstimateMbMax?: number | null;
    baselineMemoryPeakEstimateMbMax?: number | null;
    lightweightParseSkippedEvents: number;
    lightweightParseSkippedBytes: number;
    lightweightParseSkipRate?: number;
    socketLazyProbeAttemptedEvents: number;
    socketLazyProbeSatisfiedEvents: number;
    socketLazyFallbackParamEvents: number;
    socketLazyProbeSatisfiedRate?: number;
  };
  phase6Evidence: UploadEvidenceForDecision;
  phase6Decision: UploadPhase6DecisionReport;
  gaps: string[];
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function maxNumber(values: Array<number | undefined | null>): number | undefined {
  const numeric = values.filter(isNumber);
  return numeric.length ? Math.max(...numeric) : undefined;
}

function maxNullableNumber(values: Array<number | undefined | null>): number | null | undefined {
  const numeric = values.filter(isNumber);
  if (numeric.length) return Math.max(...numeric);
  return values.some(value => value === null) ? null : undefined;
}

function everyTrue(metrics: NetlogBenchmarkMetricInput[], field: keyof NetlogBenchmarkMetricInput): boolean | undefined {
  if (metrics.length === 0 || metrics.some(metric => metric[field] === undefined)) return undefined;
  return metrics.every(metric => metric[field] === true);
}

function everyFalse(metrics: NetlogBenchmarkMetricInput[], field: keyof NetlogBenchmarkMetricInput): boolean | undefined {
  if (metrics.length === 0 || metrics.some(metric => metric[field] === undefined)) return undefined;
  return metrics.every(metric => metric[field] === false);
}

function sumNumber(metrics: NetlogBenchmarkMetricInput[], field: keyof NetlogBenchmarkMetricInput): number | undefined {
  const values = metrics.map(metric => metric[field]).filter(isNumber);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function safeRate(part: number | undefined, total: number | undefined): number | undefined {
  if (!total || part === undefined) return undefined;
  return Math.round((part / total) * 10000) / 10000;
}

function distinct<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function buildNetlogBenchmarkEvidencePackage(
  metrics: NetlogBenchmarkMetricInput[],
  generatedAt = new Date().toISOString()
): NetlogBenchmarkEvidencePackage {
  const validMetrics = metrics.filter(metric => !metric.errors?.length);
  const singleScanMetrics = validMetrics.filter(metric => metric.mode === 'upload-single-scan');
  const baselineMetrics = validMetrics.filter(metric => metric.mode === 'dataset-import');
  const labels = distinct(validMetrics.map(metric => metric.label).filter((label): label is string => Boolean(label)));
  const fileNames = distinct(validMetrics.map(metric => metric.fileName).filter((fileName): fileName is string => Boolean(fileName)));
  const lightweightParseSkippedEvents = sumNumber(singleScanMetrics, 'lightweightParseSkippedEvents') ?? 0;
  const lightweightParseSkippedBytes = sumNumber(singleScanMetrics, 'lightweightParseSkippedBytes') ?? 0;
  const socketLazyProbeAttemptedEvents = sumNumber(singleScanMetrics, 'socketLazyProbeAttemptedEvents') ?? 0;
  const socketLazyProbeSatisfiedEvents = sumNumber(singleScanMetrics, 'socketLazyProbeSatisfiedEvents') ?? 0;
  const socketLazyFallbackParamEvents = sumNumber(singleScanMetrics, 'socketLazyFallbackParamEvents') ?? 0;
  const datasetEventCount = maxNumber(singleScanMetrics.map(metric => metric.datasetEventCount));
  const baselineDatasetEventCount = maxNumber(baselineMetrics.map(metric => metric.datasetEventCount));

  const phase6Evidence: UploadEvidenceForDecision = {
    mode: singleScanMetrics.length > 0 ? 'upload-single-scan' : undefined,
    datasetEventCount,
    expectedEventCount: baselineDatasetEventCount,
    singleScanDatasetReady: everyTrue(singleScanMetrics, 'singleScanDatasetReady'),
    backgroundDatasetImportExpected: everyFalse(singleScanMetrics, 'backgroundDatasetImportExpected'),
    completeEventScanCount: maxNumber(singleScanMetrics.map(metric => metric.completeEventScanCount)),
    rawDetailReadbackOk: everyTrue(singleScanMetrics, 'rawDetailReadbackOk'),
    rawDetailRowsHaveByteRange: everyTrue(singleScanMetrics, 'rawDetailRowsHaveByteRange'),
    rawSearchWorstCaseHasMoreMatchesUnknown: everyTrue(singleScanMetrics, 'rawSearchWorstCaseHasMoreMatchesUnknown'),
    rawSearchFilteredHasMoreMatchesUnknown: everyFalse(singleScanMetrics, 'rawSearchFilteredHasMoreMatchesUnknown'),
    dnsAnswerEndpointOnlyCount: maxNumber(singleScanMetrics.map(metric => metric.dnsAnswerEndpointOnlyCount)),
    dnsAnswerStateOnlyCount: maxNumber(singleScanMetrics.map(metric => metric.dnsAnswerStateOnlyCount)),
    socketPeerHostTimeCandidate: maxNumber(singleScanMetrics.map(metric => metric.socketPeerHostTimeCandidate)),
    forbiddenConfirmedMatchesCount: 0,
    memoryPeakEstimateMb: maxNullableNumber(singleScanMetrics.map(metric => metric.memoryPeakEstimateMb)),
    baselineMemoryPeakEstimateMb: maxNullableNumber(baselineMetrics.map(metric => metric.memoryPeakEstimateMb)),
    lightweightParseSkippedEvents,
    lightweightParseSkippedBytes,
    lightweightParseSkipRate: safeRate(lightweightParseSkippedEvents, sumNumber(singleScanMetrics, 'datasetEventCount')),
    socketLazyProbeAttemptedEvents,
    socketLazyProbeSatisfiedEvents,
    socketLazyFallbackParamEvents,
    socketLazyProbeSatisfiedRate: safeRate(socketLazyProbeSatisfiedEvents, socketLazyProbeAttemptedEvents),
    sampleCount: singleScanMetrics.length,
  };
  const phase6Decision = buildUploadPhase6DecisionReport(phase6Evidence);
  const gaps = [
    singleScanMetrics.length === 0 ? '缺少 upload-single-scan benchmark。' : undefined,
    baselineMetrics.length === 0 ? '缺少 dataset-import baseline benchmark。' : undefined,
    baselineDatasetEventCount === undefined ? '缺少 baseline datasetEventCount，无法校验事件数一致性。' : undefined,
    phase6Decision.nextEvidenceNeeded.length ? `Phase 6 仍需证据：${phase6Decision.nextEvidenceNeeded.join('；')}` : undefined,
  ].filter((gap): gap is string => Boolean(gap));

  return {
    packageVersion: 'netlog-benchmark-evidence-v1',
    generatedAt,
    metricCount: metrics.length,
    sampleCount: singleScanMetrics.length,
    labels,
    files: fileNames.map(fileName => ({
      fileName,
      fileSize: validMetrics.find(metric => metric.fileName === fileName)?.fileSize,
      modes: distinct(validMetrics
        .filter(metric => metric.fileName === fileName)
        .map(metric => metric.mode)
        .filter((mode): mode is 'dataset-import' | 'upload-single-scan' => Boolean(mode))),
    })),
    aggregate: {
      datasetEventCount,
      baselineDatasetEventCount,
      datasetReadyMsMax: maxNumber(singleScanMetrics.map(metric => metric.datasetReadyMs)),
      uploadToFirstDiagnosisMsMax: maxNumber(singleScanMetrics.map(metric => metric.uploadToFirstDiagnosisMs)),
      queryP95Max: maxNumber(singleScanMetrics.map(metric => metric.queryP95)),
      detailP95Max: maxNumber(singleScanMetrics.map(metric => metric.detailP95)),
      rawSearchWorstCaseMsMax: maxNumber(singleScanMetrics.map(metric => metric.rawSearchWorstCaseMs)),
      rawSearchFilteredMsMax: maxNumber(singleScanMetrics.map(metric => metric.rawSearchFilteredMs)),
      memoryPeakEstimateMbMax: phase6Evidence.memoryPeakEstimateMb,
      baselineMemoryPeakEstimateMbMax: phase6Evidence.baselineMemoryPeakEstimateMb,
      lightweightParseSkippedEvents,
      lightweightParseSkippedBytes,
      lightweightParseSkipRate: phase6Evidence.lightweightParseSkipRate,
      socketLazyProbeAttemptedEvents,
      socketLazyProbeSatisfiedEvents,
      socketLazyFallbackParamEvents,
      socketLazyProbeSatisfiedRate: phase6Evidence.socketLazyProbeSatisfiedRate,
    },
    phase6Evidence,
    phase6Decision,
    gaps,
  };
}
