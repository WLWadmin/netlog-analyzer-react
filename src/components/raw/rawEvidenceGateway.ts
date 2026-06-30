import {
  getStructureOverview,
  getValueByPath,
  searchJsonPaths,
  JsonPathMatch,
  StructureNode,
} from '../../parsers/shared/rawJsonPath';
import {
  getRawStructureInWorker,
  getRawValueInWorker,
  isWorkerSupported,
  searchRawJsonInWorker,
} from '../../workers/workerClient';
import {
  RAW_EVIDENCE_SEARCH_MAX_DEPTH,
  RAW_EVIDENCE_SEARCH_MAX_RESULTS,
  RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH,
  RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
  RAW_EVIDENCE_WORKER_TIMEOUT_MS,
} from '../../constants/analysisThresholds';

interface RawEvidenceSource {
  rawData?: unknown;
  rawDataId?: string;
}

export interface RawEvidenceResult<T> {
  value: T;
  fallbackUsed: boolean;
}

export async function loadRawEvidenceStructure({
  rawData,
  rawDataId,
}: RawEvidenceSource): Promise<RawEvidenceResult<StructureNode[]>> {
  if (isWorkerSupported() && rawDataId) {
    try {
      const structure = await getRawStructureInWorker(rawDataId, {
        timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS,
        maxDepth: RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH,
      });
      return { value: structure, fallbackUsed: false };
    } catch {
      if (!rawData) {
        throw new Error('原始 JSON 结构读取失败，请重新上传文件');
      }
    }
  }

  if (!rawData) return { value: [], fallbackUsed: false };
  return {
    value: getStructureOverview(rawData, RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH),
    fallbackUsed: Boolean(rawDataId),
  };
}

export async function searchRawEvidence({
  rawData,
  rawDataId,
}: RawEvidenceSource, query: string): Promise<RawEvidenceResult<JsonPathMatch[]>> {
  if (isWorkerSupported() && rawDataId) {
    try {
      const results = await searchRawJsonInWorker(rawDataId, query, {
        timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS,
        maxResults: RAW_EVIDENCE_SEARCH_MAX_RESULTS,
        maxDepth: RAW_EVIDENCE_SEARCH_MAX_DEPTH,
      });
      return { value: results, fallbackUsed: false };
    } catch {
      if (!rawData) {
        throw new Error('Worker 搜索失败，请重新上传文件后重试');
      }
    }
  }

  if (!rawData) {
    throw new Error('原始 JSON 未在主线程保留，请重新上传文件后重试');
  }

  return {
    value: searchJsonPaths(rawData, query, RAW_EVIDENCE_SEARCH_MAX_RESULTS, RAW_EVIDENCE_SEARCH_MAX_DEPTH),
    fallbackUsed: Boolean(rawDataId),
  };
}

export async function readRawEvidenceValuePreview({
  rawData,
  rawDataId,
}: RawEvidenceSource, path: string): Promise<RawEvidenceResult<string>> {
  if (isWorkerSupported() && rawDataId) {
    try {
      const preview = await getRawValueInWorker(rawDataId, path, {
        timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS,
        maxChars: RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
      });
      return { value: preview.text, fallbackUsed: false };
    } catch {
      if (!rawData) {
        throw new Error('字段值读取失败');
      }
    }
  }

  const value = getValueByPath(rawData, path);
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return {
    value: text.length > RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS
      ? `${text.slice(0, RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS)}\n...(内容过长已截断)`
      : text,
    fallbackUsed: Boolean(rawDataId),
  };
}
