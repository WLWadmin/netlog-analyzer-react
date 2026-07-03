import {
  getNetlogEndpointEvidenceInWorker,
  getNetlogDnsStateInWorker,
  getNetlogEventDetailInWorker,
  importNetlogDatasetInWorker,
  largeNetlogTimeout,
  queryNetlogEventsInWorker,
  releaseNetlogDatasetInWorker,
} from '../workers/workerClient';
import { parseUploadedInput } from '../upload/parseUploadedInput';
import { buildUploadPhase6DecisionReport, type UploadPhase6DecisionReport } from './netlogUploadPhase6Decision';

interface BrowserBenchmarkMetrics {
  benchmark: 'netlog-browser-worker';
  runtime: 'browser-worker';
  label: string;
  fileName: string;
  fileSize: number;
  datasetImportMs: number;
  datasetEventCount: number;
  queryP50: number;
  queryP95: number;
  detailP50: number;
  detailP95: number;
  mainThreadBlockedMs: number;
  rafMaxDelayMs: number;
  memoryPeakEstimateMb: number | null;
  endpointEvidenceCount: number;
  endpointRowCount: number;
  dnsAnswerCount: number;
  socketPeerCount: number;
  serverObservedClientIpCount: number;
  sourceGraphAssociatedCount: number;
  globalCandidateCount: number;
  socketPeerTotal?: number;
  socketPeerDirectUrlRequest?: number;
  socketPeerSourceGraphAssociated?: number;
  socketPeerGlobalCandidate?: number;
  socketPeerHostTimeCandidate?: number;
  socketPeerAssociationRate?: number;
  socketPeerUnresolvedRate?: number;
  sourceDependencyEdges?: number;
  sourceDependencyUnparsed?: number;
  globalCandidateByTypeName?: Record<string, number>;
  globalCandidateBySourceTypeName?: Record<string, number>;
  globalCandidateParamKeys?: Record<string, number>;
  sourceGraphDepthHit?: Record<string, number>;
  sourceGraphUnresolvedReasons?: Record<string, number>;
  topGlobalCandidateTypeNames?: Array<{ key: string; count: number }>;
  topGlobalCandidateSourceTypeNames?: Array<{ key: string; count: number }>;
  topGlobalCandidateParamKeys?: Array<{ key: string; count: number }>;
  topSourceGraphDepthHit?: Array<{ key: string; count: number }>;
  topSourceGraphUnresolvedReasons?: Array<{ key: string; count: number }>;
  dnsAnswerCandidateCount?: number;
  dnsAnswerUniqueHostIpPairs?: number;
  dnsAnswerMissingTraceCount?: number;
  dnsAnswerBySourceKind?: Record<string, number>;
  dnsAnswerByTypeName?: Record<string, number>;
  dnsAnswerEndpointCount?: number;
  dnsAnswerStateCount?: number;
  dnsAnswerBothCount?: number;
  dnsAnswerEndpointOnlyCount?: number;
  dnsAnswerStateOnlyCount?: number;
  dnsAnswerStateMissingTraceCount?: number;
  mode?: 'dataset-import' | 'upload-single-scan';
  evidencePackageVersion?: string;
  uploadToFirstDiagnosisMs?: number;
  summaryScanMs?: number;
  datasetAutoStartMs?: number;
  summaryReadyMs?: number;
  datasetReadyMs?: number;
  datasetTakesOverEventsMs?: number;
  datasetTakesOverStateViewsMs?: number;
  completeEventScanCount?: number;
  rawDetailReadbackOk?: boolean;
  rawDetailRowsHaveByteRange?: boolean;
  rawDetailCheckedEventIds?: number[];
  rawSearchWorstCaseMs?: number;
  rawSearchWorstCaseScanned?: number;
  rawSearchWorstCaseTotal?: number;
  rawSearchWorstCaseScanLimitHit?: boolean;
  rawSearchWorstCaseTimeLimitHit?: boolean;
  rawSearchWorstCaseHasMoreMatchesUnknown?: boolean;
  rawSearchFilteredMs?: number;
  rawSearchFilteredScanned?: number;
  rawSearchFilteredTotal?: number;
  rawSearchFilteredScanLimitHit?: boolean;
  rawSearchFilteredTimeLimitHit?: boolean;
  rawSearchFilteredHasMoreMatchesUnknown?: boolean;
  rawSearchFilteredSourceId?: number;
  eventsPreview?: number;
  singleScanDatasetReady?: boolean;
  backgroundDatasetImportExpected?: boolean;
  phase6Decision?: UploadPhase6DecisionReport;
  errors: string[];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function startMainThreadProbe() {
  let longTaskTotal = 0;
  let rafMaxDelayMs = 0;
  let stopped = false;
  let lastRaf = nowMs();
  let observer: PerformanceObserver | undefined;

  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskTotal += entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    observer = undefined;
  }

  const tick = () => {
    if (stopped) return;
    const current = nowMs();
    rafMaxDelayMs = Math.max(rafMaxDelayMs, Math.max(0, current - lastRaf - 16.7));
    lastRaf = current;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    stop: () => {
      stopped = true;
      observer?.disconnect();
      return {
        mainThreadBlockedMs: Math.round(longTaskTotal),
        rafMaxDelayMs: Math.round(rafMaxDelayMs),
      };
    },
  };
}

function memoryEstimateMb(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } }).memory;
  const bytes = memory?.usedJSHeapSize ?? memory?.totalJSHeapSize;
  return bytes ? Math.round(bytes / 1024 / 1024) : null;
}

function normalizeDnsKeyHost(host: string | undefined): string {
  return (host || '').trim().toLowerCase();
}

function dnsAnswerKeysFromEndpointEvidence(endpointEvidence: Awaited<ReturnType<typeof getNetlogEndpointEvidenceInWorker>>): Set<string> {
  const keys = new Set<string>();
  for (const answer of endpointEvidence.dnsAnswers) {
    const host = normalizeDnsKeyHost(answer.host);
    for (const ip of answer.ips || []) {
      const value = `${host}|${ip}`;
      if (host && ip) keys.add(value);
    }
  }
  return keys;
}

function dnsAnswerKeysFromDnsState(dnsState: Awaited<ReturnType<typeof getNetlogDnsStateInWorker>>): { keys: Set<string>; missingTraceCount: number } {
  const keys = new Set<string>();
  let missingTraceCount = 0;
  const add = (hostValue: string, ips: string[], eventId?: number, sourceId?: number, byteStart?: number, byteEnd?: number) => {
    const host = normalizeDnsKeyHost(hostValue);
    if (!host || ips.length === 0) return;
    if (eventId === undefined || sourceId === undefined || byteStart === undefined || byteEnd === undefined) {
      missingTraceCount += 1;
    }
    for (const ip of ips) {
      if (ip) keys.add(`${host}|${ip}`);
    }
  };
  for (const item of dnsState.hostResolverCache) {
    add(item.host, item.ips, item.eventId, item.sourceId, item.byteStart, item.byteEnd);
  }
  for (const item of dnsState.taskResults) {
    add(item.host, item.ips, item.eventId, item.sourceId, item.byteStart, item.byteEnd);
  }
  return { keys, missingTraceCount };
}

function compareSets(left: Set<string>, right: Set<string>) {
  let both = 0;
  let leftOnly = 0;
  let rightOnly = 0;
  for (const key of left) {
    if (right.has(key)) both += 1;
    else leftOnly += 1;
  }
  for (const key of right) {
    if (!left.has(key)) rightOnly += 1;
  }
  return { both, leftOnly, rightOnly };
}

function safeRate(part: number | undefined, total: number | undefined): number | undefined {
  if (!total || part === undefined) return undefined;
  return Math.round((part / total) * 10000) / 10000;
}

function topEntries(map: Record<string, number> | undefined, limit = 10): Array<{ key: string; count: number }> | undefined {
  if (!map) return undefined;
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

async function postResult(result: BrowserBenchmarkMetrics | { errors: string[] }) {
  await fetch('/__benchmark-result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  });
}

async function runNetlogBrowserBenchmark() {
  const params = new URLSearchParams(window.location.search);
  const label = params.get('label') || 'manual';
  const fileName = params.get('fileName') || 'chrome-net-export-log.json';
  const timeoutMs = Number(params.get('timeoutMs') || 15 * 60_000);
  const mode = params.get('mode') === 'upload-single-scan' ? 'upload-single-scan' : 'dataset-import';
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="font:14px system-ui;padding:24px">Running NetLog browser benchmark (${mode})...</div>`;
  }

  const probe = startMainThreadProbe();
  try {
    const response = await fetch('/__benchmark-file');
    if (!response.ok) throw new Error(`Benchmark file fetch failed: ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: 'application/json' });

    if (mode === 'upload-single-scan') {
      window.localStorage.setItem('netlog_single_scan_dataset', '1');
      const uploadStartedAt = nowMs();
      const parsed = await parseUploadedInput({
        data: file,
        fileTypeHint: 'netlog',
        useWorker: true,
        onProgress: () => undefined,
      });
      const datasetReadyMs = Math.round(nowMs() - uploadStartedAt);
      if (parsed.kind !== 'netlog') throw new Error(`Unexpected parse kind: ${parsed.kind}`);
      if (parsed.dataset?.status !== 'ready' || !parsed.dataset.analysisId) {
        throw new Error(`single scan did not return ready Dataset: ${parsed.dataset?.status || 'missing'}`);
      }
      const metrics = await collectDatasetMetrics({
        analysisId: parsed.dataset.analysisId,
        datasetEventCount: parsed.dataset.eventCount ?? 0,
        datasetImportMs: 0,
        file,
        fileName,
        label,
        probe,
        mode,
        uploadToFirstDiagnosisMs: datasetReadyMs,
        summaryScanMs: datasetReadyMs,
        datasetAutoStartMs: 0,
        summaryReadyMs: datasetReadyMs,
        datasetReadyMs,
        datasetTakesOverEventsMs: 0,
        datasetTakesOverStateViewsMs: 0,
        completeEventScanCount: 1,
        eventsPreview: parsed.events.length,
        singleScanDatasetReady: true,
        backgroundDatasetImportExpected: false,
      });
      await postResult(metrics);
      return;
    }

    const importStartedAt = nowMs();
    const meta = await importNetlogDatasetInWorker(file, { timeout: Math.max(timeoutMs, largeNetlogTimeout(file.size)) });
    const datasetImportMs = Math.round(nowMs() - importStartedAt);
    const analysisId = meta.analysisId;
    const datasetEventCount = meta.eventCount ?? 0;
    const metrics = await collectDatasetMetrics({
      analysisId,
      datasetEventCount,
      datasetImportMs,
      file,
      fileName,
      label,
      probe,
      mode,
      completeEventScanCount: 1,
    });
    await postResult(metrics);
  } catch (error) {
    probe.stop();
    await postResult({ errors: [(error as Error).message] });
  }
}

async function collectDatasetMetrics(options: {
  analysisId: string;
  datasetEventCount: number;
  datasetImportMs: number;
  file: File;
  fileName: string;
  label: string;
  probe: ReturnType<typeof startMainThreadProbe>;
  mode: 'dataset-import' | 'upload-single-scan';
  summaryReadyMs?: number;
  datasetReadyMs?: number;
  uploadToFirstDiagnosisMs?: number;
  summaryScanMs?: number;
  datasetAutoStartMs?: number;
  datasetTakesOverEventsMs?: number;
  datasetTakesOverStateViewsMs?: number;
  completeEventScanCount?: number;
  eventsPreview?: number;
  singleScanDatasetReady?: boolean;
  backgroundDatasetImportExpected?: boolean;
}): Promise<BrowserBenchmarkMetrics> {
  const {
    analysisId,
    datasetEventCount,
    datasetImportMs,
    file,
    fileName,
    label,
    probe,
    mode,
  } = options;
  const queryTimes: number[] = [];
  const detailTimes: number[] = [];
  const firstQuery = await timed(queryTimes, () => queryNetlogEventsInWorker({ analysisId, page: 1, pageSize: 100 }));
  await timed(queryTimes, () => queryNetlogEventsInWorker({ analysisId, page: 10, pageSize: 100 }));
  await timed(queryTimes, () => queryNetlogEventsInWorker({ analysisId, page: 1, pageSize: 100, errorOnly: true }));
  const firstRow = firstQuery.rows[0];
  if (firstRow?.sourceId !== undefined) {
    await timed(queryTimes, () => queryNetlogEventsInWorker({ analysisId, page: 1, pageSize: 100, sourceId: firstRow.sourceId }));
    await timed(queryTimes, () => queryNetlogEventsInWorker({ analysisId, page: 1, pageSize: 100, sourceChainId: firstRow.sourceId }));
  }
  if (firstRow?.typeId !== undefined) {
    await timed(queryTimes, () => queryNetlogEventsInWorker({ analysisId, page: 1, pageSize: 100, typeId: firstRow.typeId }));
  }

  const detailRows = [
    firstQuery.rows[0],
    firstQuery.rows[Math.floor(firstQuery.rows.length / 2)],
  ].filter((row, index, rows): row is NonNullable<typeof row> => Boolean(row) && rows.findIndex(item => item?.eventId === row.eventId) === index);
  const detailIds = [
    firstQuery.rows[0]?.eventId,
    firstQuery.rows[Math.floor(firstQuery.rows.length / 2)]?.eventId,
    datasetEventCount > 0 ? datasetEventCount - 1 : undefined,
  ].filter((id, index, ids): id is number => typeof id === 'number' && ids.indexOf(id) === index);
  let rawDetailReadbackOk = true;
  for (const eventId of detailIds) {
    const detail = await timed(detailTimes, () => getNetlogEventDetailInWorker({ analysisId, eventId }));
    if (!detail || typeof detail !== 'object') {
      rawDetailReadbackOk = false;
    }
  }
  const rawDetailRowsHaveByteRange = detailRows.length > 0 && detailRows.every(row =>
    Number.isFinite(row.byteStart) &&
    Number.isFinite(row.byteEnd) &&
    row.byteEnd > row.byteStart
  );
  const rawSearchWorstCaseStartedAt = nowMs();
  const rawSearchWorstCase = await queryNetlogEventsInWorker({
    analysisId,
    page: 1,
    pageSize: 10,
    searchText: '__netlog_benchmark_no_match__',
    rawSearchScanLimit: 2_000,
    rawSearchTimeLimitMs: 10_000,
  });
  const rawSearchWorstCaseMs = Math.round(nowMs() - rawSearchWorstCaseStartedAt);

  const rawSearchFilteredSourceId = firstRow?.sourceId;
  const rawSearchFilteredStartedAt = nowMs();
  const rawSearchFiltered = rawSearchFilteredSourceId === undefined
    ? undefined
    : await queryNetlogEventsInWorker({
      analysisId,
      page: 1,
      pageSize: 10,
      sourceId: rawSearchFilteredSourceId,
      searchText: '__netlog_benchmark_no_match__',
      rawSearchScanLimit: 2_000,
      rawSearchTimeLimitMs: 10_000,
    });
  const rawSearchFilteredMs = rawSearchFiltered ? Math.round(nowMs() - rawSearchFilteredStartedAt) : undefined;

  const endpointEvidence = await getNetlogEndpointEvidenceInWorker({ analysisId });
  const dnsState = await getNetlogDnsStateInWorker({ analysisId });
  const endpointDnsKeys = dnsAnswerKeysFromEndpointEvidence(endpointEvidence);
  const stateDns = dnsAnswerKeysFromDnsState(dnsState);
  const dnsDiff = compareSets(endpointDnsKeys, stateDns.keys);
  const socketPeers = endpointEvidence.failedOrSlowIps.filter(item => item.role === 'socket-peer');
  const socketPeerTotal = endpointEvidence.sourceGraphStats?.socketPeerTotal ?? socketPeers.length;
  const socketPeerDirectUrlRequest = socketPeers.filter(item => item.association === 'direct-url-request').length;
  const socketPeerSourceGraphAssociated = endpointEvidence.sourceGraphStats?.socketPeerSourceGraphAssociated ??
    socketPeers.filter(item => item.association === 'source-graph').length;
  const socketPeerGlobalCandidate = endpointEvidence.sourceGraphStats?.socketPeerGlobalCandidate ??
    socketPeers.filter(item => item.association === 'global-candidate').length;
  const socketPeerHostTimeCandidate = socketPeers.filter(item => item.association === 'host-time-candidate').length;
  const mainThread = probe.stop();
  await releaseNetlogDatasetInWorker({ analysisId }).catch(() => undefined);

  const metrics: BrowserBenchmarkMetrics = {
    benchmark: 'netlog-browser-worker',
    runtime: 'browser-worker',
    label,
    fileName,
    fileSize: file.size,
    datasetImportMs,
    datasetEventCount,
    queryP50: percentile(queryTimes, 50),
    queryP95: percentile(queryTimes, 95),
    detailP50: percentile(detailTimes, 50),
    detailP95: percentile(detailTimes, 95),
    mainThreadBlockedMs: mainThread.mainThreadBlockedMs,
    rafMaxDelayMs: mainThread.rafMaxDelayMs,
    memoryPeakEstimateMb: memoryEstimateMb(),
    endpointEvidenceCount: endpointEvidence.failedOrSlowIps.length,
    endpointRowCount: endpointEvidence.cipSipRows.length,
    dnsAnswerCount: endpointEvidence.dnsAnswers.length,
    socketPeerCount: socketPeers.length,
    serverObservedClientIpCount: endpointEvidence.failedOrSlowIps.filter(item => item.role === 'server-observed-client-ip').length,
    sourceGraphAssociatedCount: endpointEvidence.failedOrSlowIps.filter(item => item.association === 'source-graph').length,
    globalCandidateCount: endpointEvidence.failedOrSlowIps.filter(item => item.association === 'global-candidate').length,
    socketPeerTotal,
    socketPeerDirectUrlRequest,
    socketPeerSourceGraphAssociated,
    socketPeerGlobalCandidate,
    socketPeerHostTimeCandidate,
    socketPeerAssociationRate: safeRate(socketPeerDirectUrlRequest + socketPeerSourceGraphAssociated, socketPeerTotal),
    socketPeerUnresolvedRate: safeRate(socketPeerGlobalCandidate, socketPeerTotal),
    sourceDependencyEdges: endpointEvidence.sourceGraphStats?.sourceDependencyEdges,
    sourceDependencyUnparsed: endpointEvidence.sourceGraphStats?.sourceDependencyUnparsed,
    globalCandidateByTypeName: endpointEvidence.sourceGraphStats?.globalCandidateByTypeName,
    globalCandidateBySourceTypeName: endpointEvidence.sourceGraphStats?.globalCandidateBySourceTypeName,
    globalCandidateParamKeys: endpointEvidence.sourceGraphStats?.globalCandidateParamKeys,
    sourceGraphDepthHit: endpointEvidence.sourceGraphStats?.sourceGraphDepthHit,
    sourceGraphUnresolvedReasons: endpointEvidence.sourceGraphStats?.sourceGraphUnresolvedReasons,
    topGlobalCandidateTypeNames: topEntries(endpointEvidence.sourceGraphStats?.globalCandidateByTypeName),
    topGlobalCandidateSourceTypeNames: topEntries(endpointEvidence.sourceGraphStats?.globalCandidateBySourceTypeName),
    topGlobalCandidateParamKeys: topEntries(endpointEvidence.sourceGraphStats?.globalCandidateParamKeys),
    topSourceGraphDepthHit: topEntries(endpointEvidence.sourceGraphStats?.sourceGraphDepthHit),
    topSourceGraphUnresolvedReasons: topEntries(endpointEvidence.sourceGraphStats?.sourceGraphUnresolvedReasons),
    dnsAnswerCandidateCount: endpointEvidence.dnsAnswerSourceStats?.candidateCount,
    dnsAnswerUniqueHostIpPairs: endpointEvidence.dnsAnswerSourceStats?.uniqueHostIpPairs,
    dnsAnswerMissingTraceCount: endpointEvidence.dnsAnswerSourceStats?.missingTraceCount,
    dnsAnswerBySourceKind: endpointEvidence.dnsAnswerSourceStats?.bySourceKind,
    dnsAnswerByTypeName: endpointEvidence.dnsAnswerSourceStats?.byTypeName,
    dnsAnswerEndpointCount: endpointDnsKeys.size,
    dnsAnswerStateCount: stateDns.keys.size,
    dnsAnswerBothCount: dnsDiff.both,
    dnsAnswerEndpointOnlyCount: dnsDiff.leftOnly,
    dnsAnswerStateOnlyCount: dnsDiff.rightOnly,
    dnsAnswerStateMissingTraceCount: stateDns.missingTraceCount,
    mode,
    evidencePackageVersion: '2026-07-03-upload-observability-v1',
    uploadToFirstDiagnosisMs: options.uploadToFirstDiagnosisMs,
    summaryScanMs: options.summaryScanMs,
    datasetAutoStartMs: options.datasetAutoStartMs,
    summaryReadyMs: options.summaryReadyMs,
    datasetReadyMs: options.datasetReadyMs,
    datasetTakesOverEventsMs: options.datasetTakesOverEventsMs,
    datasetTakesOverStateViewsMs: options.datasetTakesOverStateViewsMs,
    completeEventScanCount: options.completeEventScanCount,
    rawDetailReadbackOk,
    rawDetailRowsHaveByteRange,
    rawDetailCheckedEventIds: detailIds,
    rawSearchWorstCaseMs,
    rawSearchWorstCaseScanned: rawSearchWorstCase.scanned,
    rawSearchWorstCaseTotal: rawSearchWorstCase.total,
    rawSearchWorstCaseScanLimitHit: rawSearchWorstCase.scanLimitHit,
    rawSearchWorstCaseTimeLimitHit: rawSearchWorstCase.timeLimitHit,
    rawSearchWorstCaseHasMoreMatchesUnknown: rawSearchWorstCase.hasMoreMatchesUnknown,
    rawSearchFilteredMs,
    rawSearchFilteredScanned: rawSearchFiltered?.scanned,
    rawSearchFilteredTotal: rawSearchFiltered?.total,
    rawSearchFilteredScanLimitHit: rawSearchFiltered?.scanLimitHit,
    rawSearchFilteredTimeLimitHit: rawSearchFiltered?.timeLimitHit,
    rawSearchFilteredHasMoreMatchesUnknown: rawSearchFiltered?.hasMoreMatchesUnknown,
    rawSearchFilteredSourceId,
    eventsPreview: options.eventsPreview,
    singleScanDatasetReady: options.singleScanDatasetReady,
    backgroundDatasetImportExpected: options.backgroundDatasetImportExpected,
    errors: [],
  };
  metrics.phase6Decision = buildUploadPhase6DecisionReport({
    mode,
    datasetEventCount,
    singleScanDatasetReady: metrics.singleScanDatasetReady,
    backgroundDatasetImportExpected: metrics.backgroundDatasetImportExpected,
    completeEventScanCount: metrics.completeEventScanCount,
    rawDetailReadbackOk,
    rawDetailRowsHaveByteRange,
    rawSearchWorstCaseHasMoreMatchesUnknown: rawSearchWorstCase.hasMoreMatchesUnknown,
    rawSearchFilteredHasMoreMatchesUnknown: rawSearchFiltered?.hasMoreMatchesUnknown,
    dnsAnswerEndpointOnlyCount: metrics.dnsAnswerEndpointOnlyCount,
    dnsAnswerStateOnlyCount: metrics.dnsAnswerStateOnlyCount,
    socketPeerHostTimeCandidate,
    forbiddenConfirmedMatchesCount: 0,
    memoryPeakEstimateMb: metrics.memoryPeakEstimateMb,
    sampleCount: 1,
  });
  return metrics;
}

async function timed<T>(bucket: number[], fn: () => Promise<T>): Promise<T> {
  const startedAt = nowMs();
  try {
    return await fn();
  } finally {
    bucket.push(Math.round(nowMs() - startedAt));
  }
}

export function maybeRunNetlogBrowserBenchmark(): boolean {
  if (typeof window === 'undefined') return false;
  const enabled = new URLSearchParams(window.location.search).get('netlogBrowserBenchmark') === '1';
  if (!enabled) return false;
  void runNetlogBrowserBenchmark();
  return true;
}
