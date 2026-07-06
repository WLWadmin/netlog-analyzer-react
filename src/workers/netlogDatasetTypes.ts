export type NetlogDatasetStatus = 'unavailable' | 'importing' | 'ready' | 'fallback' | 'error';

export interface NetlogDatasetParseSkipStats {
  lightweightParseSkippedEvents: number;
  lightweightParseSkippedBytes: number;
}

export interface NetlogDatasetSocketLazyParamsStats {
  probeAttemptedEvents: number;
  probeSatisfiedEvents: number;
  fallbackParamEvents: number;
  earlyReducerEvents?: number;
}

export interface NetlogDatasetState {
  analysisId?: string;
  status: NetlogDatasetStatus;
  error?: string;
  phase?: string;
  eventCount?: number;
  parseSkipStats?: NetlogDatasetParseSkipStats;
  socketLazyParamsStats?: NetlogDatasetSocketLazyParamsStats;
  startedAt?: number;
  updatedAt?: number;
}

export const unavailableNetlogDatasetState: NetlogDatasetState = {
  status: 'unavailable',
};

export const fallbackNetlogDatasetState: NetlogDatasetState = {
  status: 'fallback',
  error: 'Dataset 模式尚未启用，当前使用大文件摘要 fallback。',
};
