import type {
  SessionCreatedResponse,
  WorkbenchRequest,
  WorkbenchResponse,
} from './protocol';

export const WORKBENCH_BENCHMARK_EVENT_COUNTS = [100_000, 500_000, 1_000_000] as const;
export type WorkbenchBenchmarkEventCount = typeof WORKBENCH_BENCHMARK_EVENT_COUNTS[number];

export interface PrepareWorkbenchBenchmarkRequest {
  type: 'prepare-workbench-benchmark';
  requestId: string;
  eventCount: WorkbenchBenchmarkEventCount;
}

export type WorkbenchBenchmarkWorkerRequest =
  | PrepareWorkbenchBenchmarkRequest
  | {
      type: 'dispatch-workbench-request';
      request: WorkbenchRequest;
    };

export interface WorkbenchBenchmarkCorpusMetrics {
  sourceBytes: number;
  jsonBytes: number;
  eventCount: number;
  eventFamilyDistribution: Record<string, number>;
  screenshotEncodedBytes: number;
  screenshotDecodedBytes: number;
  fileReadMs: number;
  jsonParseMs: number;
  indexBuildMs: number;
  sampleHash: string;
}

export type WorkbenchBenchmarkWorkerResponse =
  | {
      type: 'workbench-benchmark-prepared';
      requestId: string;
      metrics: WorkbenchBenchmarkCorpusMetrics;
      session: SessionCreatedResponse;
      workerElapsedMs: number;
      uiTransferBytes: number;
    }
  | {
      type: 'workbench-response';
      response: WorkbenchResponse;
      workerElapsedMs: number;
      uiTransferBytes: number;
    }
  | {
      type: 'workbench-benchmark-failed';
      requestId: string;
      error: {
        code: 'worker-failed';
        message: string;
      };
    };
