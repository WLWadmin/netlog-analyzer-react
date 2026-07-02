/**
 * Worker 通信协议类型定义
 * 主线程与 Web Worker 之间的消息传递规范
 */

// ============ Request Messages (Main → Worker) ============

export interface ParseNetlogRequest {
  type: 'parse-netlog';
  id: string;
  payload: string | unknown; // raw file text or parsed JSON data
}

export interface ParseLargeNetlogFileRequest {
  type: 'parse-large-netlog-file';
  id: string;
  payload: File | {
    file: File;
    debug?: boolean;
  };
}

export interface ParseHarRequest {
  type: 'parse-har';
  id: string;
  payload: string | unknown; // raw HAR text or parsed HAR JSON
  repairInfo?: unknown;
}

export interface ParseLogRequest {
  type: 'parse-log';
  id: string;
  payload: string; // raw text content
}

export interface SearchRawJsonRequest {
  type: 'search-raw-json';
  id: string;
  payload: {
    rawDataId: string;
    query: string;
    maxResults?: number;
    maxDepth?: number;
  };
}

export interface ReleaseRawDataRequest {
  type: 'release-raw-data';
  id: string;
  payload: {
    rawDataId?: string;
    all?: boolean;
  };
}

export interface ImportNetlogDatasetRequest {
  type: 'import-netlog-dataset';
  id: string;
  payload: {
    file: File;
  };
}

export interface ReleaseNetlogDatasetRequest {
  type: 'release-netlog-dataset';
  id: string;
  payload: {
    analysisId?: string;
    all?: boolean;
  };
}

export interface QueryNetlogEventsRequest {
  type: 'query-netlog-events';
  id: string;
  payload: {
    analysisId: string;
    page?: number;
    pageSize?: number;
    typeId?: number;
    typeName?: string;
    sourceId?: number;
    sourceChainId?: number;
    sourceTypeId?: number;
    sourceTypeName?: string;
    phase?: number;
    errorOnly?: boolean;
    startTime?: number;
    endTime?: number;
    searchText?: string;
  };
}

export interface GetNetlogEventDetailRequest {
  type: 'get-netlog-event-detail';
  id: string;
  payload: {
    analysisId: string;
    eventId: number;
  };
}

export interface GetNetlogEndpointEvidenceRequest {
  type: 'get-netlog-endpoint-evidence';
  id: string;
  payload: {
    analysisId: string;
  };
}

export interface GetNetlogDataLoadedRequest {
  type: 'get-netlog-data-loaded';
  id: string;
  payload: {
    analysisId: string;
  };
}

export interface GetNetlogDnsStateRequest {
  type: 'get-netlog-dns-state';
  id: string;
  payload: {
    analysisId: string;
  };
}

export interface GetNetlogProxyStateRequest {
  type: 'get-netlog-proxy-state';
  id: string;
  payload: {
    analysisId: string;
  };
}

export interface GetNetlogQuicStateRequest {
  type: 'get-netlog-quic-state';
  id: string;
  payload: {
    analysisId: string;
  };
}

export interface GetNetlogHttp2StateRequest {
  type: 'get-netlog-http2-state';
  id: string;
  payload: {
    analysisId: string;
  };
}

export interface GetRawStructureRequest {
  type: 'get-raw-structure';
  id: string;
  payload: {
    rawDataId: string;
    maxDepth?: number;
  };
}

export interface GetRawValueRequest {
  type: 'get-raw-value';
  id: string;
  payload: {
    rawDataId: string;
    path: string;
    maxChars?: number;
  };
}

export type WorkerRequest =
  | ParseNetlogRequest
  | ParseLargeNetlogFileRequest
  | ParseHarRequest
  | ParseLogRequest
  | SearchRawJsonRequest
  | ReleaseRawDataRequest
  | ImportNetlogDatasetRequest
  | ReleaseNetlogDatasetRequest
  | QueryNetlogEventsRequest
  | GetNetlogEventDetailRequest
  | GetNetlogEndpointEvidenceRequest
  | GetNetlogDataLoadedRequest
  | GetNetlogDnsStateRequest
  | GetNetlogProxyStateRequest
  | GetNetlogQuicStateRequest
  | GetNetlogHttp2StateRequest
  | GetRawStructureRequest
  | GetRawValueRequest;

// ============ Response Messages (Worker → Main) ============

export interface WorkerSuccessResponse {
  type: 'success';
  id: string;
  resultType: 'netlog' | 'har' | 'log' | 'raw-search' | 'raw-release' | 'raw-structure' | 'raw-value' | 'netlog-dataset' | 'netlog-dataset-release' | 'netlog-events-query' | 'netlog-event-detail' | 'netlog-endpoint-evidence' | 'netlog-data-loaded' | 'netlog-dns-state' | 'netlog-proxy-state' | 'netlog-quic-state' | 'netlog-http2-state';
  payload: unknown; // Parsed result (AnalysisResult | HarAnalysisResult | LogAnalysisResult)
  events?: unknown; // Only for netlog: ParsedEvent[]
  rawPayload?: unknown; // Parsed original JSON for raw evidence explorer
  /** rawPayload 在 Worker 内部的缓存 ID，用于后续 raw 搜索避免 structured clone 大 JSON */
  rawDataId?: string;
  duration: number; // parsing time in ms
}

export interface RawReleaseResult {
  released: boolean;
  rawDataId?: string;
  all: boolean;
  remaining: number;
}

export interface NetlogDatasetImportResult {
  analysisId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  importedAt: number;
  status: 'ready';
  eventCount?: number;
}

export interface NetlogDatasetReleaseResult {
  released: boolean;
  analysisId?: string;
  all: boolean;
  remaining: number;
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
