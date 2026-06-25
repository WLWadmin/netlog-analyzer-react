/**
 * Worker 通信协议类型定义
 * 主线程与 Web Worker 之间的消息传递规范
 */

import type { HarSummary, NetlogSummary } from './summaryTypes';

// ============ Request Messages (Main → Worker) ============

export type AnalysisKind = 'netlog' | 'har';

export interface ParseNetlogRequest {
  type: 'parse-netlog';
  id: string;
  payload: string | unknown; // raw file text or parsed JSON data
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

export interface ReleaseAnalysisRequest {
  type: 'release-analysis';
  id: string;
  payload: {
    analysisId?: string;
    all?: boolean;
  };
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

export interface QueryEventsRequest {
  type: 'query-events';
  id: string;
  payload: {
    analysisId: string;
    page: number;
    pageSize: number;
    filters?: {
      sourceId?: string;
      sourceType?: string;
      phase?: string;
      errorCode?: string;
      errorOnly?: boolean;
      keyword?: string;
      paramField?: string;
    };
  };
}

export interface GetEventDetailRequest {
  type: 'get-event-detail';
  id: string;
  payload: {
    analysisId: string;
    eventKey: string;
    maxParamChars?: number;
  };
}

export interface QuerySourceChainsRequest {
  type: 'query-source-chains';
  id: string;
  payload: {
    analysisId: string;
    page: number;
    pageSize: number;
    filters?: {
      keyword?: string;
      mode?: 'all' | 'error' | 'slow';
    };
  };
}

export interface GetSourceChainDetailRequest {
  type: 'get-source-chain-detail';
  id: string;
  payload: {
    analysisId: string;
    rootId: number;
  };
}

export interface QueryRequestPageRequest {
  type: 'query-request-page';
  id: string;
  payload: {
    analysisId: string;
    page: number;
    pageSize: number;
    filters?: {
      keyword?: string;
      host?: string;
      status?: 'all' | 'success' | 'error';
      errorCode?: string;
      protocol?: string;
      slowOnly?: boolean;
      errorOnly?: boolean;
    };
  };
}

export interface GetRequestDetailRequest {
  type: 'get-request-detail';
  id: string;
  payload: {
    analysisId: string;
    requestId: number;
    maxEvents?: number;
  };
}

export interface QueryDiagnosisSummaryRequest {
  type: 'query-diagnosis-summary';
  id: string;
  payload: {
    analysisId: string;
  };
}

export type WorkerRequest =
  | ParseNetlogRequest
  | ParseHarRequest
  | ParseLogRequest
  | ReleaseAnalysisRequest
  | SearchRawJsonRequest
  | ReleaseRawDataRequest
  | GetRawStructureRequest
  | GetRawValueRequest
  | QueryEventsRequest
  | GetEventDetailRequest
  | QuerySourceChainsRequest
  | GetSourceChainDetailRequest
  | QueryRequestPageRequest
  | GetRequestDetailRequest
  | QueryDiagnosisSummaryRequest;

// ============ Response Messages (Worker → Main) ============

export interface WorkerSuccessResponse {
  type: 'success';
  id: string;
  resultType:
    | 'netlog'
    | 'har'
    | 'log'
    | 'release-analysis'
    | 'raw-search'
    | 'raw-release'
    | 'raw-structure'
    | 'raw-value'
    | 'query-events'
    | 'get-event-detail'
    | 'query-source-chains'
    | 'get-source-chain-detail'
    | 'query-request-page'
    | 'get-request-detail'
    | 'query-diagnosis-summary';
  payload: unknown;
  events?: unknown; // Only for netlog: ParsedEvent[]
  rawPayload?: unknown; // Parsed original JSON for raw evidence explorer
  /** rawPayload 在 Worker 内部的缓存 ID，用于后续 raw 搜索避免 structured clone 大 JSON */
  rawDataId?: string;
  /** analysisStore 的缓存 ID（主线程只保存该 ID + summary/counters） */
  analysisId?: string;
  /** 主线程安全 summary（仅 parse 请求返回） */
  summary?: NetlogSummary | HarSummary;
  eventCount?: number;
  requestCount?: number;
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
