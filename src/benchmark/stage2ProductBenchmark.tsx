import ReactDOM from 'react-dom/client';
import TraceTimelineWorkbench from '../components/trace/workbench/TraceTimelineWorkbench';
import '../components/trace/traceResultPage.css';
import { ThemeProvider } from '../theme';
import { TraceWorkbenchClient } from '../workbench/client';
import {
  WORKBENCH_BENCHMARK_EVENT_COUNTS,
  type WorkbenchBenchmarkEventCount,
  type WorkbenchBenchmarkCorpusMetrics,
} from '../workbench/spike/benchmarkProtocol';
import type { WorkbenchRequest } from '../workbench/protocol';
import { WorkbenchBenchmarkBridge } from './workbenchBrowserBenchmark';

export interface Stage2ProductBenchmarkState {
  ready: boolean;
  eventCount: number;
  corpus?: WorkbenchBenchmarkCorpusMetrics;
  codeRef: string;
  protocolSamples: Partial<Record<WorkbenchRequest['type'], number[]>>;
  workerSamples: Partial<Record<WorkbenchRequest['type'], number[]>>;
  transferBytes: number;
  queue: {
    viewport: ReturnType<TraceWorkbenchClient['getQueueStats']>;
    selection: ReturnType<TraceWorkbenchClient['getSelectionQueueStats']>;
  };
  sessionClosed: boolean;
  error?: string;
}

declare global {
  interface Window {
    __STAGE2_PRODUCT_BENCHMARK__?: Stage2ProductBenchmarkState;
  }
}

function eventCountFromLocation(): WorkbenchBenchmarkEventCount {
  const requested = Number(new URLSearchParams(window.location.search).get('event-count'));
  const match = WORKBENCH_BENCHMARK_EVENT_COUNTS.find(count => count === requested);
  return match ?? WORKBENCH_BENCHMARK_EVENT_COUNTS[0];
}

function appendSample(
  samples: Partial<Record<WorkbenchRequest['type'], number[]>>,
  type: WorkbenchRequest['type'],
  value: number,
): void {
  const values = samples[type] ?? [];
  values.push(Number(value.toFixed(3)));
  samples[type] = values;
}

export async function runStage2ProductBenchmark(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) return;
  const eventCount = eventCountFromLocation();
  const state: Stage2ProductBenchmarkState = {
    ready: false,
    eventCount,
    codeRef: process.env.REACT_APP_WORKBENCH_BENCHMARK_REF
      ?? 'uncommitted-working-tree',
    protocolSamples: {},
    workerSamples: {},
    transferBytes: 0,
    queue: {
      viewport: {
        maxQueueDepth: 0,
        cancelledRequestCount: 0,
        droppedPendingRequestCount: 0,
      },
      selection: {
        maxQueueDepth: 0,
        cancelledRequestCount: 0,
        droppedPendingRequestCount: 0,
      },
    },
    sessionClosed: false,
  };
  window.__STAGE2_PRODUCT_BENCHMARK__ = state;
  rootElement.textContent = '正在准备 Stage 2 产品组件 benchmark…';
  const worker = new Worker(new URL(
    '../workbench/spike/workbenchSpikeWorker.ts',
    import.meta.url,
  ));
  const bridge = new WorkbenchBenchmarkBridge(worker);
  try {
    const preparation = await bridge.prepareProduct(eventCount);
    state.corpus = preparation.value.metrics;
    state.transferBytes += preparation.requestBytes + preparation.responseBytes;
    const transport = {
      dispatch: async (request: WorkbenchRequest) => {
        const startedAt = performance.now();
        const measurement = await bridge.dispatch(request);
        appendSample(state.protocolSamples, request.type, performance.now() - startedAt);
        appendSample(state.workerSamples, request.type, measurement.workerElapsedMs);
        state.transferBytes += measurement.requestBytes + measurement.responseBytes;
        return measurement.value;
      },
      close: () => {
        state.sessionClosed = true;
        bridge.close();
      },
    };
    const client = new TraceWorkbenchClient(preparation.value.source, transport);
    const queueTimer = window.setInterval(() => {
      state.queue.viewport = client.getQueueStats();
      state.queue.selection = client.getSelectionQueueStats();
      if (state.sessionClosed) window.clearInterval(queueTimer);
    }, 50);
    const indexStartedAt = performance.now();
    await client.createSession();
    state.corpus.indexBuildMs = performance.now() - indexStartedAt;
    ReactDOM.createRoot(rootElement).render(
      <ThemeProvider>
        <TraceTimelineWorkbench client={client} diagnoses={[]} />
      </ThemeProvider>,
    );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        state.ready = true;
      });
    });
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Stage 2 benchmark failed';
    rootElement.textContent = state.error;
    bridge.close();
  }
}
