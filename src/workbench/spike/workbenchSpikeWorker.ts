/// <reference lib="webworker" />

import { TRACE_LIMITS } from '../../parsers/trace/traceLimits';
import type {
  WorkbenchBenchmarkEventCount,
  WorkbenchBenchmarkWorkerResponse,
} from './benchmarkProtocol';
import {
  WorkbenchSpikeKernel,
  type WorkbenchSpikeSource,
  type WorkbenchSpikeSourceEvent,
} from './kernel';
import { WORKBENCH_SPIKE_SCHEMA_VERSION } from './protocol';
import { isWorkbenchBenchmarkWorkerRequest } from './protocolGuards';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const sourceStore = new Map<string, WorkbenchSpikeSource>();
let kernel = createKernel();

interface SyntheticTraceEvent {
  ts: number;
  dur: number;
  cat: string;
  name: string;
  track: string;
  depth: number;
  screenshot?: {
    encoded: string;
    width: number;
    height: number;
  };
}

function createKernel(): WorkbenchSpikeKernel {
  return new WorkbenchSpikeKernel({
    resolveSource: sourceId => sourceStore.get(sourceId),
  });
}

function post(response: WorkbenchBenchmarkWorkerResponse): void {
  workerScope.postMessage(response);
}

function transferBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function percentileHash(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest('SHA-256', bytes).then(digest => (
    [...new Uint8Array(digest)]
      .map(value => value.toString(16).padStart(2, '0'))
      .join('')
  ));
}

function buildSyntheticEvents(eventCount: WorkbenchBenchmarkEventCount): SyntheticTraceEvent[] {
  const families = ['main-thread', 'network', 'rendering', 'interaction', 'frames'] as const;
  return Array.from({ length: eventCount }, (_, index) => {
    const family = families[index % families.length];
    const screenshot = index % 1_000 === 0;
    return {
      ts: index * 10,
      dur: index % 100 === 0 ? 500 : 5 + (index % 20),
      cat: screenshot ? 'screenshot' : family,
      name: screenshot ? 'Screenshot' : `${family}-event`,
      track: family,
      depth: index % 8,
      ...(screenshot
        ? {
            screenshot: {
              encoded: 'A'.repeat(1_024),
              width: 64,
              height: 64,
            },
          }
        : {}),
    };
  });
}

function projectSource(events: SyntheticTraceEvent[]): {
  source: WorkbenchSpikeSource;
  eventFamilyDistribution: Record<string, number>;
  screenshotEncodedBytes: number;
  screenshotDecodedBytes: number;
} {
  const eventFamilyDistribution: Record<string, number> = {};
  let screenshotEncodedBytes = 0;
  let screenshotDecodedBytes = 0;
  const projected: WorkbenchSpikeSourceEvent[] = events.map(event => {
    eventFamilyDistribution[event.cat] = (eventFamilyDistribution[event.cat] ?? 0) + 1;
    if (event.screenshot) {
      screenshotEncodedBytes += event.screenshot.encoded.length;
      screenshotDecodedBytes += event.screenshot.width * event.screenshot.height * 4;
    }
    return {
      trackId: event.track,
      startUs: event.ts,
      durationUs: event.dur,
      depth: event.depth,
      category: event.cat,
      name: event.name,
      evidenceIds: [],
      privateDetail: event.screenshot,
    };
  });
  return {
    source: {
      events: projected,
      capabilities: ['timeline-events', 'event-detail'],
      missingCapabilities: [
        { capability: 'cpu-profile', reason: 'Synthetic benchmark omits CPU samples' },
        { capability: 'screenshots', reason: 'Synthetic screenshot bytes are never exposed to UI' },
      ],
    },
    eventFamilyDistribution,
    screenshotEncodedBytes,
    screenshotDecodedBytes,
  };
}

async function prepareBenchmark(
  requestId: string,
  eventCount: WorkbenchBenchmarkEventCount,
): Promise<void> {
  const startedAt = performance.now();
  const rawEvents = buildSyntheticEvents(eventCount);
  const json = JSON.stringify({ traceEvents: rawEvents });
  const sourceBuffer = new TextEncoder().encode(json);
  if (sourceBuffer.byteLength > TRACE_LIMITS.maxJsonBytes) {
    throw new Error('Synthetic benchmark exceeds the existing 128 MiB Trace JSON limit');
  }

  const fileReadStartedAt = performance.now();
  const fileText = new TextDecoder().decode(sourceBuffer);
  const fileReadMs = performance.now() - fileReadStartedAt;
  const parseStartedAt = performance.now();
  const parsed = JSON.parse(fileText) as { traceEvents: SyntheticTraceEvent[] };
  const jsonParseMs = performance.now() - parseStartedAt;
  const projected = projectSource(parsed.traceEvents);
  const sourceId = `workbench-benchmark-${eventCount}`;
  sourceStore.clear();
  kernel.failWorker();
  kernel = createKernel();
  sourceStore.set(sourceId, projected.source);

  const indexStartedAt = performance.now();
  const session = await kernel.dispatch({
    type: 'create-session',
    schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
    requestId: `${requestId}-create-session`,
    source: {
      sourceId,
      parserId: 'trace',
      fingerprint: `synthetic:${eventCount}`,
    },
    requestedCapabilities: ['timeline-events', 'event-detail', 'cpu-profile', 'screenshots'],
  });
  const indexBuildMs = performance.now() - indexStartedAt;
  if (session.type !== 'session-created') {
    throw new Error('Synthetic Workbench session could not be created');
  }

  const response: WorkbenchBenchmarkWorkerResponse = {
    type: 'workbench-benchmark-prepared',
    requestId,
    metrics: {
      sourceBytes: sourceBuffer.byteLength,
      jsonBytes: sourceBuffer.byteLength,
      eventCount,
      eventFamilyDistribution: projected.eventFamilyDistribution,
      screenshotEncodedBytes: projected.screenshotEncodedBytes,
      screenshotDecodedBytes: projected.screenshotDecodedBytes,
      fileReadMs,
      jsonParseMs,
      indexBuildMs,
      sampleHash: await percentileHash(sourceBuffer),
    },
    session,
    workerElapsedMs: performance.now() - startedAt,
    uiTransferBytes: 0,
  };
  response.uiTransferBytes = transferBytes(response);
  post(response);
}

workerScope.addEventListener('message', async (
  event: MessageEvent<unknown>,
) => {
  const message = event.data;
  if (!isWorkbenchBenchmarkWorkerRequest(message)) {
    post({
      type: 'workbench-benchmark-failed',
      requestId: 'invalid-benchmark-request',
      error: {
        code: 'worker-failed',
        message: 'Workbench benchmark request is invalid',
      },
    });
    return;
  }
  try {
    if (message.type === 'prepare-workbench-benchmark') {
      await prepareBenchmark(message.requestId, message.eventCount);
      return;
    }
    const startedAt = performance.now();
    const response = await kernel.dispatch(message.request);
    const outbound: WorkbenchBenchmarkWorkerResponse = {
      type: 'workbench-response',
      response,
      workerElapsedMs: performance.now() - startedAt,
      uiTransferBytes: 0,
    };
    outbound.uiTransferBytes = transferBytes(outbound);
    post(outbound);
  } catch {
    post({
      type: 'workbench-benchmark-failed',
      requestId: message.type === 'prepare-workbench-benchmark'
        ? message.requestId
        : message.request.requestId,
      error: {
        code: 'worker-failed',
        message: 'Workbench benchmark Worker failed',
      },
    });
  }
});

export {};
