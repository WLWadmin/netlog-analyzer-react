export type NetlogDatasetStatus = 'unavailable' | 'importing' | 'ready' | 'fallback' | 'error';

export interface NetlogDatasetState {
  analysisId?: string;
  status: NetlogDatasetStatus;
  error?: string;
}

export const unavailableNetlogDatasetState: NetlogDatasetState = {
  status: 'unavailable',
};

export const fallbackNetlogDatasetState: NetlogDatasetState = {
  status: 'fallback',
  error: 'Dataset 模式尚未启用，当前使用大文件摘要 fallback。',
};
