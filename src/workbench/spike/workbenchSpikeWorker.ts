/// <reference lib="webworker" />

import { TRACE_LIMITS } from '../../parsers/trace/traceLimits';
import type { ChromiumTraceFile } from '../../parsers/trace/types';
import { WORKBENCH_SCHEMA_VERSION } from '../protocol';
import { WorkbenchSessionKernel } from '../sessionKernel';
import { MinimalTraceEngineAdapter } from '../traceEngineAdapter';
import type {
  WorkbenchBenchmarkEventCount,
  WorkbenchBenchmarkWorkerResponse,
} from './benchmarkProtocol';
import { isWorkbenchBenchmarkWorkerRequest } from './protocolGuards';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
let adapter: MinimalTraceEngineAdapter | undefined;
let kernel: WorkbenchSessionKernel | undefined;

function post(response: WorkbenchBenchmarkWorkerResponse): void {
  workerScope.postMessage(response);
}

function transferBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function sampleHash(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest('SHA-256', bytes).then(digest => (
    [...new Uint8Array(digest)]
      .map(value => value.toString(16).padStart(2, '0'))
      .join('')
  ));
}

function buildSyntheticEvents(eventCount: WorkbenchBenchmarkEventCount): ChromiumTraceFile['traceEvents'] {
  const families = ['main-thread', 'network', 'rendering', 'interaction', 'frames'] as const;
  return Array.from({ length: eventCount }, (_, index) => {
    if (index === 0) {
      return {
        ts: 0,
        cat: 'cpu-profile',
        name: 'Profile',
        ph: 'P',
        pid: 1,
        tid: 10,
        id: 'benchmark-profile',
        args: { data: { startTime: 0 } },
      };
    }
    if (index === 1) {
      const sampleCount = Math.min(10_000, Math.max(1_000, eventCount / 100));
      return {
        ts: 1,
        cat: 'cpu-profile',
        name: 'ProfileChunk',
        ph: 'P',
        pid: 1,
        tid: 99,
        id: 'benchmark-profile',
        args: { data: {
          cpuProfile: {
            nodes: [
              { id: 1, callFrame: { functionName: '(root)' }, children: [2] },
              { id: 2, callFrame: { functionName: 'benchmarkWork' }, children: [3] },
              { id: 3, callFrame: { functionName: 'benchmarkLeaf' } },
            ],
            samples: Array.from({ length: sampleCount }, (_, sample) => (
              sample % 4 === 0 ? 2 : 3
            )),
          },
          timeDeltas: Array.from({ length: sampleCount }, () => 10),
        } },
      };
    }
    const family = families[index % families.length];
    const screenshot = index % 1_000 === 0;
    return {
      ts: index * 10,
      dur: index % 100 === 0 ? 500 : 5 + (index % 20),
      cat: screenshot
        ? 'screenshot'
        : family === 'main-thread'
          ? 'cpu-profile'
          : family,
      name: screenshot
        ? 'Screenshot'
        : family === 'network'
          ? 'ResourceEvent'
          : family === 'rendering'
            ? 'Layout'
            : family === 'interaction'
              ? 'EventTiming'
              : family === 'frames'
                ? 'DrawFrame'
                : 'RunTask',
      ph: 'X',
      pid: 1 + (index % 4),
      tid: 10 + (index % 8),
      ...(screenshot
        ? { args: { snapshot: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' } }
        : {}),
    };
  });
}

function corpusMetrics(events: ChromiumTraceFile['traceEvents']): {
  eventFamilyDistribution: Record<string, number>;
  screenshotEncodedBytes: number;
  screenshotDecodedBytes: number;
} {
  const eventFamilyDistribution: Record<string, number> = {};
  let screenshotEncodedBytes = 0;
  let screenshotDecodedBytes = 0;
  for (const event of events) {
    const category = typeof event.cat === 'string' ? event.cat : 'other';
    eventFamilyDistribution[category] = (eventFamilyDistribution[category] ?? 0) + 1;
    const args = event.args as { snapshot?: unknown } | undefined;
    if (typeof args?.snapshot === 'string') {
      screenshotEncodedBytes += args.snapshot.length;
      screenshotDecodedBytes += 64 * 64 * 4;
    }
  }
  return {
    eventFamilyDistribution,
    screenshotEncodedBytes,
    screenshotDecodedBytes,
  };
}

async function prepareBenchmark(
  requestId: string,
  eventCount: WorkbenchBenchmarkEventCount,
  createSession: boolean,
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
  const parsed = JSON.parse(fileText) as ChromiumTraceFile;
  const jsonParseMs = performance.now() - parseStartedAt;
  const metrics = corpusMetrics(rawEvents);

  kernel?.fail();
  adapter?.release();
  adapter = new MinimalTraceEngineAdapter(parsed, {
    encoding: 'plain-json',
    jsonBytes: sourceBuffer.byteLength,
    skippedEventCount: 0,
    warnings: [],
  });
  await adapter.analyze({
    isCancelled: () => false,
    onProgress: () => undefined,
    yieldControl: () => Promise.resolve(),
  });
  const source = {
    sourceId: `workbench-benchmark-${eventCount}`,
    parserId: 'trace' as const,
    fingerprint: `synthetic:${eventCount}`,
  };
  kernel = new WorkbenchSessionKernel(adapter, source);
  if (!createSession) {
    const response: WorkbenchBenchmarkWorkerResponse = {
      type: 'workbench-product-benchmark-prepared',
      requestId,
      metrics: {
        sourceBytes: sourceBuffer.byteLength,
        jsonBytes: sourceBuffer.byteLength,
        eventCount,
        eventFamilyDistribution: metrics.eventFamilyDistribution,
        screenshotEncodedBytes: metrics.screenshotEncodedBytes,
        screenshotDecodedBytes: metrics.screenshotDecodedBytes,
        fileReadMs,
        jsonParseMs,
        indexBuildMs: 0,
        sampleHash: await sampleHash(sourceBuffer),
      },
      source,
      workerElapsedMs: performance.now() - startedAt,
      uiTransferBytes: 0,
    };
    response.uiTransferBytes = transferBytes(response);
    post(response);
    return;
  }
  const indexStartedAt = performance.now();
  const session = await kernel.dispatch({
    type: 'create-session',
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    requestId: `${requestId}-create-session`,
    source,
    requestedCapabilities: [
      'timeline-events',
      'event-detail',
      'raw-evidence',
      'cpu-profile',
      'screenshots',
    ],
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
      eventFamilyDistribution: metrics.eventFamilyDistribution,
      screenshotEncodedBytes: metrics.screenshotEncodedBytes,
      screenshotDecodedBytes: metrics.screenshotDecodedBytes,
      fileReadMs,
      jsonParseMs,
      indexBuildMs,
      sampleHash: await sampleHash(sourceBuffer),
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
      await prepareBenchmark(message.requestId, message.eventCount, true);
      return;
    }
    if (message.type === 'prepare-workbench-product-benchmark') {
      await prepareBenchmark(message.requestId, message.eventCount, false);
      return;
    }
    if (!kernel) throw new Error('Workbench benchmark is not prepared');
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
        || message.type === 'prepare-workbench-product-benchmark'
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
