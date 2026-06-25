/**
 * Worker 通信协议类型定义
 * 主线程与 Web Worker 之间的消息传递规范
 */

// ============ Request Messages (Main → Worker) ============

export interface ParseNetlogRequest {
  type: 'parse-netlog';
  id: string;
  payload: unknown; // raw JSON data
}

export interface ParseHarRequest {
  type: 'parse-har';
  id: string;
  payload: unknown; // raw HAR JSON
  repairInfo?: unknown;
}

export interface ParseLogRequest {
  type: 'parse-log';
  id: string;
  payload: string; // raw text content
}

export type WorkerRequest = ParseNetlogRequest | ParseHarRequest | ParseLogRequest;

// ============ Response Messages (Worker → Main) ============

export interface WorkerSuccessResponse {
  type: 'success';
  id: string;
  resultType: 'netlog' | 'har' | 'log';
  payload: unknown; // Parsed result (AnalysisResult | HarAnalysisResult | LogAnalysisResult)
  events?: unknown; // Only for netlog: ParsedEvent[]
  duration: number; // parsing time in ms
}

export interface WorkerErrorResponse {
  type: 'error';
  id: string;
  error: string;
}

export interface WorkerProgressResponse {
  type: 'progress';
  id: string;
  phase: string;
  percent?: number;
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse | WorkerProgressResponse;
