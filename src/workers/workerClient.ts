/**
 * Worker Client - 主线程端封装
 * 提供 Promise-based API 调用 Worker，支持进度回调和超时
 */

import type {
  NetlogDatasetImportResult,
  NetlogDatasetReleaseResult,
  QueryNetlogEventsRequest,
  RawReleaseResult,
  WorkerRequest,
  WorkerResponse,
  WorkerSuccessResponse,
} from './protocols';
import type { QueryNetlogEventsResult } from './netlogDatasetQuery';
import type { AnalysisResult, ParsedEvent } from '../parsers/netlog/parser';
import type { HarAnalysisResult } from '../harParser';
import type { LogAnalysisResult } from '../logParser';
import type { DnsIpEvidenceSummary } from '../diagnosis/ipEvidence';
import type { JsonPathMatch, StructureNode } from '../parsers/shared/rawJsonPath';
import {
  RAW_EVIDENCE_SEARCH_MAX_DEPTH,
  RAW_EVIDENCE_SEARCH_MAX_RESULTS,
  RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH,
  RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
} from '../constants/analysisThresholds';

export interface WorkerClientOptions {
  onProgress?: (phase: string, percent?: number) => void;
  timeout?: number; // ms, default 60s
}

interface PendingTask {
  resolve: (value: WorkerSuccessResponse) => void;
  reject: (reason: Error) => void;
  onProgress?: (phase: string, percent?: number) => void;
  timer?: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let taskCounter = 0;
const pendingTasks = new Map<string, PendingTask>();

/**
 * 获取或创建共享 Worker 实例
 * CRA 5 webpack 5 支持 new Worker(new URL(..., import.meta.url))
 */
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./analysisWorker.ts', import.meta.url));
    worker.addEventListener('message', handleWorkerMessage);
    worker.addEventListener('error', handleWorkerError);
  }
  return worker;
}

function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
  const msg = event.data;
  const task = pendingTasks.get(msg.id);
  if (!task) return;

  switch (msg.type) {
    case 'progress':
      task.onProgress?.(msg.phase, msg.percent);
      break;
    case 'success':
      if (task.timer) clearTimeout(task.timer);
      pendingTasks.delete(msg.id);
      task.resolve(msg);
      break;
    case 'error':
      if (task.timer) clearTimeout(task.timer);
      pendingTasks.delete(msg.id);
      task.reject(new Error(msg.error));
      break;
  }
}

function handleWorkerError(event: ErrorEvent) {
  // Worker 级别的未捕获错误：拒绝所有待处理任务
  const error = new Error(`Worker error: ${event.message}`);
  for (const [id, task] of pendingTasks) {
    if (task.timer) clearTimeout(task.timer);
    task.reject(error);
    pendingTasks.delete(id);
  }
  // 重建 Worker
  terminateWorker();
}

function sendToWorker(request: WorkerRequest, options: WorkerClientOptions = {}): Promise<WorkerSuccessResponse> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const timeout = options.timeout ?? 60_000;

    const timer = setTimeout(() => {
      pendingTasks.delete(request.id);
      reject(new Error(`Worker timeout after ${timeout}ms`));
    }, timeout);

    pendingTasks.set(request.id, {
      resolve,
      reject,
      onProgress: options.onProgress,
      timer,
    });

    w.postMessage(request);
  });
}

function nextId(): string {
  return `task-${++taskCounter}-${Date.now()}`;
}

// ============ Public API ============

export interface NetlogParseResult {
  events: ParsedEvent[];
  result: AnalysisResult;
  rawData?: unknown;
  rawDataId?: string;
  duration: number;
}

function largeNetlogTimeout(fileSize: number): number {
  const mb = fileSize / (1024 * 1024);
  const minutes = Math.min(12, 2 + Math.ceil(mb / 100));
  return minutes * 60_000;
}

function isLargeNetlogDebugEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem('netlog_large_debug') === '1';
  } catch {
    return false;
  }
}

export interface HarParseResult {
  result: HarAnalysisResult;
  rawData?: unknown;
  rawDataId?: string;
  duration: number;
}

export interface LogParseResult {
  result: LogAnalysisResult;
  duration: number;
}

export interface RawValuePreview {
  text: string;
  truncated: boolean;
}

/**
 * 在 Worker 中搜索原始 JSON path（供 RawEvidenceExplorer 使用）
 */
export async function searchRawJsonInWorker(
  rawDataId: string,
  query: string,
  options?: WorkerClientOptions & { maxResults?: number; maxDepth?: number }
): Promise<JsonPathMatch[]> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'search-raw-json',
      id,
      payload: {
        rawDataId,
        query,
        maxResults: options?.maxResults ?? RAW_EVIDENCE_SEARCH_MAX_RESULTS,
        maxDepth: options?.maxDepth ?? RAW_EVIDENCE_SEARCH_MAX_DEPTH,
      },
    },
    options
  );

  return response.payload as JsonPathMatch[];
}

/**
 * 释放 Worker 内缓存的 rawData（避免长期占用内存）
 */
export async function releaseRawDataInWorker(
  payload: { rawDataId?: string; all?: boolean },
  options?: WorkerClientOptions
): Promise<boolean> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'release-raw-data',
      id,
      payload,
    },
    options
  );
  if (typeof response.payload === 'boolean') {
    return response.payload;
  }
  return Boolean((response.payload as RawReleaseResult).released);
}

export async function importNetlogDatasetInWorker(
  file: File,
  options?: WorkerClientOptions
): Promise<NetlogDatasetImportResult> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'import-netlog-dataset',
      id,
      payload: { file },
    },
    options
  );
  return response.payload as NetlogDatasetImportResult;
}

export async function releaseNetlogDatasetInWorker(
  payload: { analysisId?: string; all?: boolean },
  options?: WorkerClientOptions
): Promise<NetlogDatasetReleaseResult> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'release-netlog-dataset',
      id,
      payload,
    },
    options
  );
  return response.payload as NetlogDatasetReleaseResult;
}

export async function queryNetlogEventsInWorker(
  payload: QueryNetlogEventsRequest['payload'],
  options?: WorkerClientOptions
): Promise<QueryNetlogEventsResult> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'query-netlog-events',
      id,
      payload,
    },
    options
  );
  return response.payload as QueryNetlogEventsResult;
}

export async function getNetlogEventDetailInWorker(
  payload: { analysisId: string; eventId: number },
  options?: WorkerClientOptions
): Promise<unknown> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'get-netlog-event-detail',
      id,
      payload,
    },
    options
  );
  return response.payload;
}

export async function getNetlogEndpointEvidenceInWorker(
  payload: { analysisId: string },
  options?: WorkerClientOptions
): Promise<DnsIpEvidenceSummary> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'get-netlog-endpoint-evidence',
      id,
      payload,
    },
    options
  );
  return response.payload as DnsIpEvidenceSummary;
}

/**
 * 从 Worker 内 rawData 缓存读取结构概览。
 */
export async function getRawStructureInWorker(
  rawDataId: string,
  options?: WorkerClientOptions & { maxDepth?: number }
): Promise<StructureNode[]> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'get-raw-structure',
      id,
      payload: {
        rawDataId,
        maxDepth: options?.maxDepth ?? RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH,
      },
    },
    options
  );
  return response.payload as StructureNode[];
}

/**
 * 从 Worker 内 rawData 缓存读取字段值预览，避免把大对象 clone 回主线程。
 */
export async function getRawValueInWorker(
  rawDataId: string,
  path: string,
  options?: WorkerClientOptions & { maxChars?: number }
): Promise<RawValuePreview> {
  const id = nextId();
  const response = await sendToWorker(
    {
      type: 'get-raw-value',
      id,
      payload: {
        rawDataId,
        path,
        maxChars: options?.maxChars ?? RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
      },
    },
    options
  );
  return response.payload as RawValuePreview;
}

/**
 * 在 Worker 中解析 NetLog JSON
 */
export async function parseNetlogInWorker(
  data: string | unknown,
  options?: WorkerClientOptions
): Promise<NetlogParseResult> {
  const id = nextId();
  const response = await sendToWorker(
    { type: 'parse-netlog', id, payload: data },
    options
  );
  return {
    events: response.events as ParsedEvent[],
    result: response.payload as AnalysisResult,
    rawData: response.rawPayload,
    rawDataId: response.rawDataId,
    duration: response.duration,
  };
}

export async function parseLargeNetlogFileInWorker(
  file: File,
  options?: WorkerClientOptions
): Promise<NetlogParseResult> {
  const id = nextId();
  const timeout = options?.timeout ?? largeNetlogTimeout(file.size);
  console.info('[netlog-large]', {
    taskId: id,
    event: 'client:dispatch',
    fileName: file.name,
    fileSize: file.size,
    timeout,
  });
  const response = await sendToWorker(
    { type: 'parse-large-netlog-file', id, payload: { file, debug: isLargeNetlogDebugEnabled() } },
    { ...options, timeout }
  );
  console.info('[netlog-large]', {
    taskId: id,
    event: 'client:success',
    duration: response.duration,
    previewEventCount: Array.isArray(response.events) ? response.events.length : undefined,
    parsedEvents: (response.payload as AnalysisResult | undefined)?.largeFileMode?.parsedEvents,
    totalEvents: (response.payload as AnalysisResult | undefined)?.totalEvents,
  });
  return {
    events: response.events as ParsedEvent[],
    result: response.payload as AnalysisResult,
    rawData: undefined,
    rawDataId: undefined,
    duration: response.duration,
  };
}

/**
 * 在 Worker 中解析 HAR JSON
 */
export async function parseHarInWorker(
  data: string | unknown,
  repairInfo?: unknown,
  options?: WorkerClientOptions
): Promise<HarParseResult> {
  const id = nextId();
  const response = await sendToWorker(
    { type: 'parse-har', id, payload: data, repairInfo },
    options
  );
  return {
    result: response.payload as HarAnalysisResult,
    rawData: response.rawPayload,
    rawDataId: response.rawDataId,
    duration: response.duration,
  };
}

/**
 * 在 Worker 中解析 Log 文本
 */
export async function parseLogInWorker(
  text: string,
  options?: WorkerClientOptions
): Promise<LogParseResult> {
  const id = nextId();
  const response = await sendToWorker(
    { type: 'parse-log', id, payload: text },
    options
  );
  return {
    result: response.payload as LogAnalysisResult,
    duration: response.duration,
  };
}

/**
 * 检测浏览器是否支持 Web Worker
 */
export function isWorkerSupported(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * 终止 Worker（用于清理或重置）
 */
export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  // 清除所有待处理任务
  for (const [, task] of pendingTasks) {
    if (task.timer) clearTimeout(task.timer);
    task.reject(new Error('Worker terminated'));
  }
  pendingTasks.clear();
}
