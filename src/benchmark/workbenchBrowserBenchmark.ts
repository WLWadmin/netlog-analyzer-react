import { LatestViewportDispatcher, WorkbenchSpikeClientState } from '../workbench/spike/clientState';
import {
  WORKBENCH_BENCHMARK_EVENT_COUNTS,
  type WorkbenchBenchmarkEventCount,
  type WorkbenchBenchmarkWorkerRequest,
  type WorkbenchBenchmarkWorkerResponse,
} from '../workbench/spike/benchmarkProtocol';
import {
  WORKBENCH_SPIKE_SCHEMA_VERSION,
  type QueryViewportRequest,
  type SessionCreatedResponse,
  type ViewportResultResponse,
  type WorkbenchRequest,
  type WorkbenchResponse,
  type WorkbenchTimelineEventDto,
} from '../workbench/spike/protocol';
import { isWorkbenchBenchmarkWorkerResponse } from '../workbench/spike/protocolGuards';

const WARMUP_RUNS = 3;
const VALID_RUNS = 10;
const BENCHMARK_QUERY = 'workbench-benchmark';

interface WorkerMeasurement<T> {
  value: T;
  roundTripMs: number;
  workerElapsedMs: number;
  requestBytes: number;
  responseBytes: number;
}

interface LatencySummary {
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
}

declare global {
  interface Window {
    __WORKBENCH_BENCHMARK_RESULT__?: unknown;
  }
}

class WorkbenchBenchmarkBridge {
  private readonly pending = new Map<string, {
    startedAt: number;
    requestBytes: number;
    resolve: (measurement: WorkerMeasurement<WorkbenchBenchmarkWorkerResponse>) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
  }

  prepare(eventCount: WorkbenchBenchmarkEventCount): Promise<WorkerMeasurement<
    Extract<WorkbenchBenchmarkWorkerResponse, { type: 'workbench-benchmark-prepared' }>
  >> {
    const message: WorkbenchBenchmarkWorkerRequest = {
      type: 'prepare-workbench-benchmark',
      requestId: `prepare-${eventCount}`,
      eventCount,
    };
    return this.send(message, message.requestId).then(measurement => {
      if (measurement.value.type !== 'workbench-benchmark-prepared') {
        throw new Error('Unexpected benchmark preparation response');
      }
      return {
        ...measurement,
        value: measurement.value,
      };
    });
  }

  dispatch(request: WorkbenchRequest): Promise<WorkerMeasurement<WorkbenchResponse>> {
    const message: WorkbenchBenchmarkWorkerRequest = {
      type: 'dispatch-workbench-request',
      request,
    };
    return this.send(message, request.requestId).then(measurement => {
      if (measurement.value.type !== 'workbench-response') {
        throw new Error('Unexpected Workbench response');
      }
      return {
        value: measurement.value.response,
        roundTripMs: measurement.roundTripMs,
        workerElapsedMs: measurement.value.workerElapsedMs,
        requestBytes: measurement.requestBytes,
        responseBytes: measurement.value.uiTransferBytes,
      };
    });
  }

  close(): void {
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.terminate();
    for (const entry of this.pending.values()) {
      entry.reject(new Error('Workbench benchmark bridge closed'));
    }
    this.pending.clear();
  }

  private send(
    message: WorkbenchBenchmarkWorkerRequest,
    requestId: string,
  ): Promise<WorkerMeasurement<WorkbenchBenchmarkWorkerResponse>> {
    const requestBytes = encodedBytes(message);
    return new Promise((resolve, reject) => {
      if (this.pending.has(requestId)) {
        reject(new Error(`Duplicate Workbench benchmark requestId: ${requestId}`));
        return;
      }
      this.pending.set(requestId, {
        startedAt: performance.now(),
        requestBytes,
        resolve,
        reject,
      });
      this.worker.postMessage(message);
    });
  }

  private readonly onMessage = (
    event: MessageEvent<unknown>,
  ): void => {
    const response = event.data;
    if (!isWorkbenchBenchmarkWorkerResponse(response)) {
      this.rejectAll(new Error('Workbench benchmark Worker returned an invalid message'));
      return;
    }
    const requestId = response.type === 'workbench-response'
      ? response.response.requestId
      : response.requestId;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if (response.type === 'workbench-benchmark-failed') {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve({
      value: response,
      roundTripMs: performance.now() - pending.startedAt,
      workerElapsedMs: response.workerElapsedMs,
      requestBytes: pending.requestBytes,
      responseBytes: response.uiTransferBytes,
    });
  };

  private readonly onError = (event: ErrorEvent): void => {
    const detail = event.message ? `: ${event.message}` : '';
    this.rejectAll(new Error(`Workbench benchmark Worker crashed${detail}`));
  };

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return Number(sorted[index].toFixed(3));
}

function summarize(values: number[]): LatencySummary {
  return {
    samplesMs: values.map(value => Number(value.toFixed(3))),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

function memoryUsedBytes(): number | null {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    }
  ).memory;
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
}

function drawViewport(
  context: CanvasRenderingContext2D,
  events: WorkbenchTimelineEventDto[],
  range: { startUs: number; endUs: number },
): void {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const span = Math.max(1, range.endUs - range.startUs);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#edf2f7';
  context.fillRect(0, 0, width, height);
  for (const event of events) {
    const x = ((event.startUs - range.startUs) / span) * width;
    const eventWidth = Math.max(1, (event.durationUs / span) * width);
    const y = (event.depth % 8) * 28 + 6;
    context.fillStyle = event.category === 'network' ? '#17724d' : '#1d5fc1';
    context.fillRect(x, y, eventWidth, 18);
  }
}

function hitTest(
  events: WorkbenchTimelineEventDto[],
  timestampUs: number,
): WorkbenchTimelineEventDto | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event.startUs <= timestampUs
      && event.startUs + event.durationUs >= timestampUs
    ) {
      return event;
    }
  }
  return undefined;
}

function viewportRequest(
  session: SessionCreatedResponse,
  requestId: string,
  startUs: number,
  endUs: number,
  limit = 2_000,
): QueryViewportRequest {
  return {
    type: 'query-viewport',
    schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
    requestId,
    sessionId: session.sessionId,
    sessionRevision: session.sessionRevision,
    range: { startUs, endUs },
    limit,
  };
}

async function measureQueries(
  bridge: WorkbenchBenchmarkBridge,
  buildRequest: (index: number) => QueryViewportRequest,
): Promise<{
  latency: LatencySummary;
  workerLatency: LatencySummary;
  transferBytes: number;
  lastResult: ViewportResultResponse;
}> {
  let transferBytes = 0;
  let lastResult: ViewportResultResponse | undefined;
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    await bridge.dispatch(buildRequest(-index - 1));
  }
  const roundTripSamples: number[] = [];
  const workerSamples: number[] = [];
  for (let index = 0; index < VALID_RUNS; index += 1) {
    const measurement = await bridge.dispatch(buildRequest(index));
    if (measurement.value.type !== 'viewport-result') {
      throw new Error('Viewport query did not return events');
    }
    lastResult = measurement.value;
    roundTripSamples.push(measurement.roundTripMs);
    workerSamples.push(measurement.workerElapsedMs);
    transferBytes += measurement.requestBytes + measurement.responseBytes;
  }
  if (!lastResult) throw new Error('Viewport benchmark produced no result');
  return {
    latency: summarize(roundTripSamples),
    workerLatency: summarize(workerSamples),
    transferBytes,
    lastResult,
  };
}

async function runBenchmark(
  eventCount: WorkbenchBenchmarkEventCount,
  canvas: HTMLCanvasElement,
  setStatus: (status: string) => void,
): Promise<unknown> {
  const worker = new Worker(new URL('../workbench/spike/workbenchSpikeWorker.ts', import.meta.url));
  const bridge = new WorkbenchBenchmarkBridge(worker);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const benchmarkStartedAt = performance.now();
  const uiMemoryBefore = memoryUsedBytes();
  let transferBytes = 0;

  try {
    setStatus('正在 Worker 内生成并解析固定语料');
    const preparation = await bridge.prepare(eventCount);
    transferBytes += preparation.requestBytes + preparation.responseBytes;
    const session = preparation.value.session;
    const captureEndUs = session.session.range.endUs;
    const centerUs = captureEndUs / 2;

    setStatus('正在测量视口与选区查询');
    const viewport = await measureQueries(
      bridge,
      index => viewportRequest(
        session,
        `viewport-${index}`,
        centerUs - 50_000 + index * 100,
        centerUs + 50_000 + index * 100,
      ),
    );
    transferBytes += viewport.transferBytes;
    const selection = await measureQueries(
      bridge,
      index => viewportRequest(
        session,
        `selection-${index}`,
        centerUs - 250_000 + index * 100,
        centerUs + 250_000 + index * 100,
        5_000,
      ),
    );
    transferBytes += selection.transferBytes;

    setStatus('正在测量 Canvas、缩放、平移与悬浮');
    const drawSamples: number[] = [];
    const hoverSamples: number[] = [];
    for (let index = -WARMUP_RUNS; index < VALID_RUNS; index += 1) {
      const drawStartedAt = performance.now();
      drawViewport(context, viewport.lastResult.events, viewport.lastResult.range);
      const drawElapsed = performance.now() - drawStartedAt;
      const hoverStartedAt = performance.now();
      hitTest(viewport.lastResult.events, centerUs + index);
      const hoverElapsed = performance.now() - hoverStartedAt;
      if (index >= 0) {
        drawSamples.push(drawElapsed);
        hoverSamples.push(hoverElapsed);
      }
    }
    const zoom = await measureQueries(
      bridge,
      index => viewportRequest(
        session,
        `zoom-${index}`,
        centerUs - 25_000 - index * 50,
        centerUs + 25_000 + index * 50,
      ),
    );
    const pan = await measureQueries(
      bridge,
      index => viewportRequest(
        session,
        `pan-${index}`,
        centerUs - 50_000 + index * 1_000,
        centerUs + 50_000 + index * 1_000,
      ),
    );
    transferBytes += zoom.transferBytes + pan.transferBytes;

    setStatus('正在验证取消、背压与迟到响应丢弃');
    const cancellationRequest = viewportRequest(
      session,
      'cancellation-target',
      0,
      captureEndUs,
      eventCount,
    );
    const cancellationStartedAt = performance.now();
    const cancellationResult = bridge.dispatch(cancellationRequest);
    await new Promise(resolve => setTimeout(resolve, 0));
    const cancelControl = await bridge.dispatch({
      type: 'cancel-query',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'cancel-control',
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
      targetRequestId: cancellationRequest.requestId,
    });
    const cancelled = await cancellationResult;
    transferBytes += cancelControl.requestBytes
      + cancelControl.responseBytes
      + cancelled.requestBytes
      + cancelled.responseBytes;
    const cancellationResponseMs = performance.now() - cancellationStartedAt;
    if (
      cancelControl.value.type !== 'query-cancelled'
      || cancelled.value.type !== 'structured-error'
      || cancelled.value.error.code !== 'query-cancelled'
    ) {
      throw new Error('Workbench cancellation contract was not satisfied');
    }

    const clientState = new WorkbenchSpikeClientState();
    clientState.activateSession(session.session);
    let cancelSequence = 0;
    const cancelControls: Array<Promise<void>> = [];
    const dispatcher = new LatestViewportDispatcher(
      async request => {
        const measurement = await bridge.dispatch(request);
        transferBytes += measurement.requestBytes + measurement.responseBytes;
        clientState.accept(measurement.value);
        return measurement.value;
      },
      request => {
        const controlRequest: WorkbenchRequest = {
          type: 'cancel-query',
          schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
          requestId: `queue-cancel-${++cancelSequence}`,
          sessionId: request.sessionId,
          sessionRevision: request.sessionRevision,
          targetRequestId: request.requestId,
        };
        const control = bridge.dispatch(controlRequest).then(measurement => {
          if (measurement.value.type !== 'query-cancelled') {
            throw new Error('Latest viewport cancellation was not acknowledged');
          }
          transferBytes += measurement.requestBytes + measurement.responseBytes;
        });
        cancelControls.push(control);
      },
    );
    const queued = Array.from({ length: 20 }, (_, index) => {
      const request = viewportRequest(
        session,
        `queue-${index}`,
        centerUs - 20_000 + index * 500,
        centerUs + 20_000 + index * 500,
      );
      clientState.markLatest('viewport', request.requestId);
      return dispatcher.submit(request);
    });
    await Promise.all(queued);
    await Promise.all(cancelControls);

    const release = await bridge.dispatch({
      type: 'release-session',
      schemaVersion: WORKBENCH_SPIKE_SCHEMA_VERSION,
      requestId: 'release-session',
      sessionId: session.sessionId,
      sessionRevision: session.sessionRevision,
    });
    transferBytes += release.requestBytes + release.responseBytes;
    if (release.value.type !== 'session-released') {
      throw new Error('Workbench session was not released');
    }
    const firstInteractiveMs = preparation.roundTripMs
      + viewport.latency.samplesMs[0]
      + drawSamples[0];
    const uiMemoryAfter = memoryUsedBytes();
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };

    return {
      schemaVersion: 1,
      status: 'browser-benchmark-verified',
      codeRef: process.env.REACT_APP_WORKBENCH_BENCHMARK_REF ?? 'uncommitted-working-tree',
      environment: {
        browserUserAgent: navigator.userAgent,
        operatingSystem: navigator.platform,
        cpu: {
          model: null,
          logicalCores: navigator.hardwareConcurrency || null,
          limitation: 'Web platform does not expose CPU model',
        },
        memory: {
          deviceGiB: navigatorWithMemory.deviceMemory ?? null,
          limitation: 'deviceMemory is rounded and may be unavailable',
        },
        dpr: window.devicePixelRatio,
      },
      corpus: preparation.value.metrics,
      runs: {
        warmupCount: WARMUP_RUNS,
        validRunCount: VALID_RUNS,
      },
      timings: {
        firstInteractiveMs: Number(firstInteractiveMs.toFixed(3)),
        viewportQuery: viewport.latency,
        viewportWorker: viewport.workerLatency,
        selectionQuery: selection.latency,
        canvasDraw: summarize(drawSamples),
        zoom: zoom.latency,
        pan: pan.latency,
        hover: summarize(hoverSamples),
        cancellationResponseMs: Number(cancellationResponseMs.toFixed(3)),
        totalBenchmarkMs: Number((performance.now() - benchmarkStartedAt).toFixed(3)),
      },
      transfer: {
        workerUiBytes: transferBytes,
      },
      memory: {
        uiPeakBytes: uiMemoryAfter === null
          ? null
          : Math.max(uiMemoryBefore ?? 0, uiMemoryAfter),
        workerPeakBytes: null,
        limitation: 'The browser does not expose per-Worker peak memory to page JavaScript',
      },
      cancellation: {
        controlResponseType: cancelControl.value.type,
        queryResponseType: cancelled.value.type,
        queryErrorCode: cancelled.value.type === 'structured-error'
          ? cancelled.value.error.code
          : null,
      },
      queue: {
        ...dispatcher.getStats(),
        discardedLateResponseCount: clientState.getSnapshot().discardedResponseCount,
      },
      release: {
        responseType: release.value.type,
      },
      safety: {
        maxJsonBytes: 128 * 1024 * 1024,
        limitRaised: false,
        rawTraceEventsReturnedToUi: false,
      },
    };
  } finally {
    bridge.close();
  }
}

function renderHarness(root: HTMLElement): {
  canvas: HTMLCanvasElement;
  setStatus(status: string): void;
} {
  root.innerHTML = `
    <main style="max-width:1100px;margin:24px auto;padding:20px;font:14px/1.5 system-ui;color:#152033">
      <h1 style="font-size:22px">Performance Workbench Browser Benchmark</h1>
      <p>仅验证 Worker 查询、背压与 Canvas 绘制，不是产品 Timeline。</p>
      <label>事件级别
        <select id="workbench-event-count">
          ${WORKBENCH_BENCHMARK_EVENT_COUNTS.map(count => (
            `<option value="${count}">${count.toLocaleString('en-US')}</option>`
          )).join('')}
        </select>
      </label>
      <button id="workbench-run" style="margin-left:12px">运行 benchmark</button>
      <button id="workbench-download" style="margin-left:8px" disabled>下载脱敏 JSON</button>
      <p id="workbench-status" role="status">等待运行</p>
      <canvas id="workbench-canvas" width="1000" height="240"
        style="display:block;width:100%;border:1px solid #cbd5e1;background:#edf2f7"></canvas>
      <pre id="workbench-result" style="overflow:auto;padding:12px;background:#f5f8fc"></pre>
    </main>
  `;
  const canvas = root.querySelector<HTMLCanvasElement>('#workbench-canvas');
  const status = root.querySelector<HTMLElement>('#workbench-status');
  if (!canvas || !status) throw new Error('Workbench benchmark harness failed to render');
  return {
    canvas,
    setStatus(value) {
      status.textContent = value;
    },
  };
}

export function maybeRunWorkbenchBrowserBenchmark(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get(BENCHMARK_QUERY) !== '1') return false;
  const root = document.getElementById('root');
  if (!root) return true;
  const harness = renderHarness(root);
  const select = root.querySelector<HTMLSelectElement>('#workbench-event-count');
  const run = root.querySelector<HTMLButtonElement>('#workbench-run');
  const download = root.querySelector<HTMLButtonElement>('#workbench-download');
  const output = root.querySelector<HTMLElement>('#workbench-result');
  if (!select || !run || !download || !output) return true;

  const requestedEventCount = Number(params.get('event-count'));
  if (WORKBENCH_BENCHMARK_EVENT_COUNTS.some(count => count === requestedEventCount)) {
    select.value = String(requestedEventCount);
  }

  let result: unknown;
  run.addEventListener('click', async () => {
    run.disabled = true;
    download.disabled = true;
    output.textContent = '';
    try {
      const eventCount = Number(select.value) as WorkbenchBenchmarkEventCount;
      result = await runBenchmark(eventCount, harness.canvas, harness.setStatus);
      window.__WORKBENCH_BENCHMARK_RESULT__ = result;
      output.textContent = JSON.stringify(result, null, 2);
      harness.setStatus('完成');
      download.disabled = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown benchmark error';
      output.textContent = message;
      harness.setStatus(`失败：${message}`);
    } finally {
      run.disabled = false;
    }
  });
  download.addEventListener('click', () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob(
      [JSON.stringify(result, null, 2)],
      { type: 'application/json' },
    ));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'workbench-browser-benchmark.json';
    anchor.click();
    URL.revokeObjectURL(url);
  });
  if (params.get('autorun') === '1') run.click();
  return true;
}
