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
import { findForbiddenStage6Keys } from './stage6Privacy';
import { WorkbenchBenchmarkBridge } from './workbenchBrowserBenchmark';

export interface Stage2ProductBenchmarkState {
  ready: boolean;
  eventCount: number;
  corpus?: WorkbenchBenchmarkCorpusMetrics;
  codeRef: string;
  protocolSamples: Partial<Record<WorkbenchRequest['type'], number[]>>;
  workerSamples: Partial<Record<WorkbenchRequest['type'], number[]>>;
  transferBytes: number;
  sourceChanges: Array<{
    operation: 'added' | 'replaced' | 'removed';
    sourceRevision: number;
    revokedEdgeCount: number;
    revokedFindingCount: number;
  }>;
  truncation: {
    viewportObserved: number;
    viewportTruncated: number;
    viewportSampled: number;
    selectionObserved: number;
    selectionTruncated: number;
  };
  queue: {
    viewport: ReturnType<TraceWorkbenchClient['getQueueStats']>;
    selection: ReturnType<TraceWorkbenchClient['getSelectionQueueStats']>;
    analysis: ReturnType<TraceWorkbenchClient['getAnalysisQueueStats']>;
  };
  stage6: {
    requestTypes: Partial<Record<WorkbenchRequest['type'], number>>;
    customQueryResponseKeys: string[];
    customQueryEventKeys: string[];
    pluginManifestKeys: string[];
    pluginResponseKeys: string[];
    pluginEventKeys: string[];
    advancedStatuses: Partial<Record<string, string[]>>;
    forbiddenPayloadKeys: string[];
    activeRequestCount: number;
    maxActiveRequestCount: number;
    installedPluginCount: number;
    workerTerminated: boolean;
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

const STAGE6_REQUEST_TYPES = new Set<WorkbenchRequest['type']>([
  'query-advanced-analysis',
  'query-custom-events',
  'install-track-plugin',
  'query-track-plugin',
  'remove-track-plugin',
]);

function sortedKeys(value: unknown): string[] {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
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
    sourceChanges: [],
    truncation: {
      viewportObserved: 0,
      viewportTruncated: 0,
      viewportSampled: 0,
      selectionObserved: 0,
      selectionTruncated: 0,
    },
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
      analysis: {
        cpu: {
          maxQueueDepth: 0,
          cancelledRequestCount: 0,
          droppedPendingRequestCount: 0,
        },
        eventLog: {
          maxQueueDepth: 0,
          cancelledRequestCount: 0,
          droppedPendingRequestCount: 0,
        },
        search: {
          maxQueueDepth: 0,
          cancelledRequestCount: 0,
          droppedPendingRequestCount: 0,
        },
      },
    },
    stage6: {
      requestTypes: {},
      customQueryResponseKeys: [],
      customQueryEventKeys: [],
      pluginManifestKeys: [],
      pluginResponseKeys: [],
      pluginEventKeys: [],
      advancedStatuses: {},
      forbiddenPayloadKeys: [],
      activeRequestCount: 0,
      maxActiveRequestCount: 0,
      installedPluginCount: 0,
      workerTerminated: false,
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
        state.stage6.activeRequestCount += 1;
        state.stage6.maxActiveRequestCount = Math.max(
          state.stage6.maxActiveRequestCount,
          state.stage6.activeRequestCount,
        );
        try {
          const measurement = await bridge.dispatch(request);
          appendSample(state.protocolSamples, request.type, performance.now() - startedAt);
          appendSample(state.workerSamples, request.type, measurement.workerElapsedMs);
          state.transferBytes += measurement.requestBytes + measurement.responseBytes;
          if (STAGE6_REQUEST_TYPES.has(request.type)) {
            state.stage6.requestTypes[request.type] = (
              state.stage6.requestTypes[request.type] ?? 0
            ) + 1;
            state.stage6.forbiddenPayloadKeys = [...new Set([
              ...state.stage6.forbiddenPayloadKeys,
              ...findForbiddenStage6Keys(request),
              ...findForbiddenStage6Keys(measurement.value),
            ])].sort();
          }
          if (request.type === 'install-track-plugin') {
            state.stage6.pluginManifestKeys = sortedKeys(request.manifest);
          }
          if (measurement.value.type === 'custom-query-result') {
            state.stage6.customQueryResponseKeys = sortedKeys(measurement.value);
            state.stage6.customQueryEventKeys = sortedKeys(measurement.value.events[0]);
          } else if (measurement.value.type === 'track-plugin-result') {
            state.stage6.pluginResponseKeys = sortedKeys(measurement.value);
            if (measurement.value.operation === 'removed') {
              state.stage6.installedPluginCount = Math.max(
                0,
                state.stage6.installedPluginCount - 1,
              );
            } else {
              state.stage6.installedPluginCount += measurement.value.operation === 'installed'
                ? 1
                : 0;
              state.stage6.pluginEventKeys = sortedKeys(
                measurement.value.projectedEvents[0],
              );
            }
          } else if (measurement.value.type === 'advanced-analysis-result') {
            const statuses = state.stage6.advancedStatuses[
              measurement.value.capability
            ] ?? [];
            statuses.push(measurement.value.status);
            state.stage6.advancedStatuses[measurement.value.capability] = statuses;
          } else if (measurement.value.type === 'session-released') {
            state.stage6.installedPluginCount = 0;
          }
          if (measurement.value.type === 'source-change-result') {
            state.sourceChanges.push({
              operation: measurement.value.operation,
              sourceRevision: measurement.value.sourceRevision,
              revokedEdgeCount: measurement.value.revokedEdgeCount,
              revokedFindingCount: measurement.value.revokedFindingCount,
            });
          } else if (measurement.value.type === 'viewport-result') {
            state.truncation.viewportObserved += 1;
            if (measurement.value.truncation.truncated) {
              state.truncation.viewportTruncated += 1;
            }
            if (measurement.value.lod?.mode === 'sampled') {
              state.truncation.viewportSampled += 1;
            }
          } else if (measurement.value.type === 'selection-result') {
            state.truncation.selectionObserved += 1;
            if (measurement.value.truncation.truncated) {
              state.truncation.selectionTruncated += 1;
            }
          }
          return measurement.value;
        } finally {
          state.stage6.activeRequestCount -= 1;
        }
      },
      dispatchSourceFile: async (
        request: Extract<
          WorkbenchRequest,
          { type: 'add-source' | 'replace-source' | 'add-comparison-baseline' }
        >,
        file: File,
      ) => {
        const startedAt = performance.now();
        const measurement = await bridge.dispatchSourceFile(request, file);
        appendSample(state.protocolSamples, request.type, performance.now() - startedAt);
        appendSample(state.workerSamples, request.type, measurement.workerElapsedMs);
        state.transferBytes += measurement.requestBytes + measurement.responseBytes;
        if (measurement.value.type === 'source-change-result') {
          state.sourceChanges.push({
            operation: measurement.value.operation,
            sourceRevision: measurement.value.sourceRevision,
            revokedEdgeCount: measurement.value.revokedEdgeCount,
            revokedFindingCount: measurement.value.revokedFindingCount,
          });
        }
        return measurement.value;
      },
      close: () => {
        state.sessionClosed = true;
        bridge.close();
        state.stage6.workerTerminated = true;
      },
    };
    const client = new TraceWorkbenchClient(preparation.value.source, transport);
    const diagnoses = process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS === '1'
      ? [{
          id: 'benchmark-long-task',
          ruleId: 'M1' as const,
          category: 'main-thread' as const,
          severity: 'warning' as const,
          score: 60,
          title: '合成长任务症状',
          conclusion: '用于验证诊断导航的合成症状。',
          confidence: 'medium' as const,
          evidenceIds: ['trace:event:2'],
          counterEvidence: [],
          advice: ['检查合成调用栈。'],
          factIds: ['benchmark:task'],
          limitations: ['仅用于合成浏览器验证。'],
        }]
      : [];
    const queueTimer = window.setInterval(() => {
      state.queue.viewport = client.getQueueStats();
      state.queue.selection = client.getSelectionQueueStats();
      state.queue.analysis = client.getAnalysisQueueStats();
      if (state.sessionClosed) window.clearInterval(queueTimer);
    }, 50);
    const indexStartedAt = performance.now();
    await client.createSession();
    state.corpus.indexBuildMs = performance.now() - indexStartedAt;
    ReactDOM.createRoot(rootElement).render(
      <ThemeProvider>
        <TraceTimelineWorkbench client={client} diagnoses={diagnoses} />
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
