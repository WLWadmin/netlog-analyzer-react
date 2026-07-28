import type {
  TraceWorkerProbeRequest,
  TraceWorkerProbeResponse,
} from './trace-worker.probe';

export function runTraceWorkerProbe(timeoutMs = 30_000): Promise<TraceWorkerProbeResponse> {
  return new Promise((resolve, reject) => {
    const taskId = 'trace-engine-runtime-probe';
    const worker = new Worker(
      new URL('./trace-worker.probe.ts', import.meta.url),
      { type: 'module' },
    );
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('TRACE_WORKER_TIMEOUT'));
    }, timeoutMs);

    worker.addEventListener('message', event => {
      const response = event.data as Partial<TraceWorkerProbeResponse>;
      if (response.type !== 'trace-engine-probe-result' || response.taskId !== taskId) {
        return;
      }
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(response as TraceWorkerProbeResponse);
    });
    worker.addEventListener('error', () => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error('TRACE_WORKER_RUNTIME_FAILED'));
    });

    const request: TraceWorkerProbeRequest = {
      type: 'run-trace-engine-probe',
      taskId,
      sampleUrl: new URLSearchParams(window.location.search).get('sampleUrl') || undefined,
    };
    worker.postMessage(request);
  });
}

export async function runTraceSpikeBrowserHarness(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('traceSpikeProbe') !== '1') return;
  const startedAt = performance.now();
  const heartbeatStartedAt = performance.now();
  let heartbeatMaxDelayMs = 0;
  let previousHeartbeat = heartbeatStartedAt;
  const heartbeat = window.setInterval(() => {
    const now = performance.now();
    heartbeatMaxDelayMs = Math.max(heartbeatMaxDelayMs, now - previousHeartbeat - 20);
    previousHeartbeat = now;
  }, 20);
  let payload: Record<string, unknown>;
  try {
    const response = await runTraceWorkerProbe(Number(params.get('timeoutMs') || 300_000));
    payload = {
      sampleId: params.get('sampleId') || 'TRACE-SYNTHETIC',
      runIndex: Number(params.get('runIndex') || 0),
      parseDurationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      heartbeatMaxDelayMs: Math.max(0, Math.round(heartbeatMaxDelayMs * 1000) / 1000),
      result: response.result,
      jsonBytes: response.jsonBytes,
      detectedEventFamilies: response.detectedEventFamilies,
      errorCode: response.errorCode,
    };
  } catch (error) {
    payload = {
      sampleId: params.get('sampleId') || 'TRACE-SYNTHETIC',
      runIndex: Number(params.get('runIndex') || 0),
      errorCode: error instanceof Error ? error.message : 'TRACE_BROWSER_PROBE_FAILED',
    };
  } finally {
    window.clearInterval(heartbeat);
  }
  await fetch('/__trace-spike-result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
