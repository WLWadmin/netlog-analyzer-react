import {
  getNetlogEndpointEvidenceInWorker,
  getNetlogEventDetailInWorker,
  importNetlogDatasetInWorker,
  largeNetlogTimeout,
  queryNetlogEventsInWorker,
  releaseNetlogDatasetInWorker,
} from '../workers/workerClient';

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
  socketPeerSourceGraphAssociated?: number;
  socketPeerGlobalCandidate?: number;
  sourceDependencyEdges?: number;
  sourceDependencyUnparsed?: number;
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
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = '<div style="font:14px system-ui;padding:24px">Running NetLog browser benchmark...</div>';
  }

  const probe = startMainThreadProbe();
  try {
    const response = await fetch('/__benchmark-file');
    if (!response.ok) throw new Error(`Benchmark file fetch failed: ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: 'application/json' });

    const importStartedAt = nowMs();
    const meta = await importNetlogDatasetInWorker(file, { timeout: Math.max(timeoutMs, largeNetlogTimeout(file.size)) });
    const datasetImportMs = Math.round(nowMs() - importStartedAt);
    const analysisId = meta.analysisId;
    const datasetEventCount = meta.eventCount ?? 0;

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

    const detailIds = [
      firstQuery.rows[0]?.eventId,
      firstQuery.rows[Math.floor(firstQuery.rows.length / 2)]?.eventId,
      datasetEventCount > 0 ? datasetEventCount - 1 : undefined,
    ].filter((id, index, ids): id is number => typeof id === 'number' && ids.indexOf(id) === index);
    for (const eventId of detailIds) {
      await timed(detailTimes, () => getNetlogEventDetailInWorker({ analysisId, eventId }));
    }

    const endpointEvidence = await getNetlogEndpointEvidenceInWorker({ analysisId });
    const mainThread = probe.stop();
    await releaseNetlogDatasetInWorker({ analysisId }).catch(() => undefined);

    await postResult({
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
      socketPeerCount: endpointEvidence.failedOrSlowIps.filter(item => item.role === 'socket-peer').length,
      serverObservedClientIpCount: endpointEvidence.failedOrSlowIps.filter(item => item.role === 'server-observed-client-ip').length,
      sourceGraphAssociatedCount: endpointEvidence.failedOrSlowIps.filter(item => item.association === 'source-graph').length,
      globalCandidateCount: endpointEvidence.failedOrSlowIps.filter(item => item.association === 'global-candidate').length,
      socketPeerTotal: endpointEvidence.sourceGraphStats?.socketPeerTotal,
      socketPeerSourceGraphAssociated: endpointEvidence.sourceGraphStats?.socketPeerSourceGraphAssociated,
      socketPeerGlobalCandidate: endpointEvidence.sourceGraphStats?.socketPeerGlobalCandidate,
      sourceDependencyEdges: endpointEvidence.sourceGraphStats?.sourceDependencyEdges,
      sourceDependencyUnparsed: endpointEvidence.sourceGraphStats?.sourceDependencyUnparsed,
      errors: [],
    });
  } catch (error) {
    probe.stop();
    await postResult({ errors: [(error as Error).message] });
  }
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
