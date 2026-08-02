import type {
  SessionCreatedResponse,
  WorkbenchSourceRef,
  WorkbenchRequest,
  WorkbenchResponse,
} from './protocol';
import type { CrossSourceRequest } from '../crossSourceProtocol';

export const WORKBENCH_BENCHMARK_EVENT_COUNTS = [100_000, 500_000, 1_000_000] as const;
export type WorkbenchBenchmarkEventCount = typeof WORKBENCH_BENCHMARK_EVENT_COUNTS[number];

export interface PrepareWorkbenchBenchmarkRequest {
  type: 'prepare-workbench-benchmark';
  requestId: string;
  eventCount: WorkbenchBenchmarkEventCount;
}

export interface PrepareWorkbenchProductBenchmarkRequest {
  type: 'prepare-workbench-product-benchmark';
  requestId: string;
  eventCount: WorkbenchBenchmarkEventCount;
}

export type WorkbenchBenchmarkWorkerRequest =
  | PrepareWorkbenchBenchmarkRequest
  | PrepareWorkbenchProductBenchmarkRequest
  | {
      type: 'dispatch-workbench-request';
      request: WorkbenchRequest;
    }
  | {
      type: 'dispatch-workbench-source-file';
      request: Extract<
        CrossSourceRequest,
        { type: 'add-source' | 'replace-source' }
      >;
      file: File;
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
      type: 'workbench-product-benchmark-prepared';
      requestId: string;
      metrics: WorkbenchBenchmarkCorpusMetrics;
      source: WorkbenchSourceRef;
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
