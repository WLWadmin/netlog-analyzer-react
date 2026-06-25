import type { NetlogRequestPreview } from './summaryTypes';
import type { DiagnosisSummary } from '../diagnosis/shared/types';

export interface EventRowPreview {
  eventKey: string;
  time: string;
  type: number;
  typeName: string;
  phase: string;
  sourceId?: string | number;
  sourceType?: string;
  errorCode?: string | number;
  url?: string;
  method?: string;
  shortParams?: Record<string, unknown>;
}

export interface QueryEventsResponsePayload {
  total: number;
  page: number;
  pageSize: number;
  items: EventRowPreview[];
  facets?: {
    phases: string[];
    sourceTypes: string[];
    paramFields?: string[];
  };
}

export interface GetEventDetailResponsePayload {
  event: EventRowPreview;
  paramsPreview?: string;
  paramsTruncated: boolean;
}

export interface SourceChainPreview {
  rootId: number;
  url: string;
  duration: number;
  depth: number;
  hasError: boolean;
}

export interface QuerySourceChainsResponsePayload {
  total: number;
  page: number;
  pageSize: number;
  items: SourceChainPreview[];
}

export interface GetSourceChainDetailResponsePayload {
  rootId: number;
  url: string;
  duration: number;
  depth: number;
  hasError: boolean;
  nodes: Array<{ id: number; type: string; hasError: boolean }>;
  truncated: boolean;
}

export interface QueryRequestPageResponsePayload {
  total: number;
  page: number;
  pageSize: number;
  items: NetlogRequestPreview[];
  facets?: {
    hosts: string[];
    protocols: string[];
    errorCodes: string[];
  };
}

export interface GetRequestDetailResponsePayload {
  request: NetlogRequestPreview;
}

export interface QueryDiagnosisSummaryResponsePayload {
  summary: DiagnosisSummary;
}

