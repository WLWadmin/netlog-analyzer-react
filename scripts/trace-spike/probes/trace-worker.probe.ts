/// <reference lib="webworker" />

import { detectEventFamilies, parseTraceEvents } from './trace-engine-api.probe';

export interface TraceWorkerProbeRequest {
  type: 'run-trace-engine-probe';
  taskId: string;
  sampleUrl?: string;
}

export interface TraceWorkerProbeResponse {
  type: 'trace-engine-probe-result';
  taskId: string;
  result?: Awaited<ReturnType<typeof parseTraceEvents>>;
  jsonBytes?: number;
  detectedEventFamilies?: string[];
  errorCode?: string;
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

const MINIMAL_TRACE = [
  {
    name: 'process_name',
    cat: '__metadata',
    ph: 'M',
    pid: 1,
    tid: 1,
    ts: 0,
    args: { name: 'Renderer' },
  },
  {
    name: 'thread_name',
    cat: '__metadata',
    ph: 'M',
    pid: 1,
    tid: 1,
    ts: 0,
    args: { name: 'CrRendererMain' },
  },
  {
    name: 'navigationStart',
    cat: 'blink.user_timing',
    ph: 'R',
    pid: 1,
    tid: 1,
    ts: 1000,
    args: {
      frame: 'FRAME-A',
      data: {
        documentLoaderURL: 'https://trace-probe.invalid/',
        isOutermostMainFrame: true,
        navigationId: 'NAV-A',
      },
    },
  },
  {
    name: 'RunTask',
    cat: 'devtools.timeline',
    ph: 'X',
    pid: 1,
    tid: 1,
    ts: 2000,
    dur: 60000,
    args: {},
  },
] as const;

async function loadEvents(sampleUrl?: string): Promise<{
  events: ReadonlyArray<Record<string, unknown>>;
  jsonBytes: number;
}> {
  if (!sampleUrl) {
    return {
      events: MINIMAL_TRACE,
      jsonBytes: new TextEncoder().encode(JSON.stringify({ traceEvents: MINIMAL_TRACE })).byteLength,
    };
  }
  const response = await fetch(sampleUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('TRACE_SAMPLE_READ_FAILED');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (Array.isArray(parsed)) {
    return {
      events: parsed as Array<Record<string, unknown>>,
      jsonBytes: bytes.byteLength,
    };
  }
  if (
    parsed
    && typeof parsed === 'object'
    && Array.isArray((parsed as { traceEvents?: unknown }).traceEvents)
  ) {
    return {
      events: (parsed as { traceEvents: Array<Record<string, unknown>> }).traceEvents,
      jsonBytes: bytes.byteLength,
    };
  }
  throw new Error('TRACE_SAMPLE_SHAPE_UNSUPPORTED');
}

workerScope.addEventListener('message', async event => {
  const request = event.data as Partial<TraceWorkerProbeRequest>;
  if (request.type !== 'run-trace-engine-probe' || typeof request.taskId !== 'string') {
    return;
  }
  let response: TraceWorkerProbeResponse;
  try {
    const loaded = await loadEvents(request.sampleUrl);
    response = {
      type: 'trace-engine-probe-result',
      taskId: request.taskId,
      result: await parseTraceEvents(loaded.events),
      jsonBytes: loaded.jsonBytes,
      detectedEventFamilies: detectEventFamilies(loaded.events),
    };
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : '';
    const errorCode = /^TRACE_[A-Z0-9_]+$/.test(rawCode)
      ? rawCode
      : 'TRACE_ENGINE_PARSE_FAILED';
    response = {
      type: 'trace-engine-probe-result',
      taskId: request.taskId,
      errorCode,
    };
  }
  workerScope.postMessage(response);
});

export {};
