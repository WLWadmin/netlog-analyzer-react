/**
 * Analysis Web Worker
 * 在独立线程中执行 JSON.parse + 解析逻辑，避免阻塞主线程 UI
 *
 * CRA 5 + webpack 5 支持 new Worker(new URL(..., import.meta.url)) 语法
 */

import { parseLog } from '../parsers/netlog/parser';
import { parseHar } from '../harParser';
import { parseLogFile } from '../logParser';
import { parseHarWithRepair } from '../utils/harRepair';
import { getStructureOverview, getValueByPath, searchJsonPaths } from '../parsers/shared/rawJsonPath';
import {
  RAW_EVIDENCE_SEARCH_MAX_DEPTH,
  RAW_EVIDENCE_SEARCH_MAX_RESULTS,
  RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH,
  RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
  WORKER_RAW_DATA_MAX_ITEMS,
} from '../constants/analysisThresholds';
import type { WorkerRequest, WorkerResponse } from './protocols';
import { createRawDataStore } from './rawDataStore';

/* eslint-disable no-restricted-globals */
const ctx: Worker = self as any;

// Worker 内缓存解析后的 rawData，避免 raw 搜索时反复 structured clone 大 JSON
const rawDataStore = createRawDataStore({ maxItems: WORKER_RAW_DATA_MAX_ITEMS });

function sendResponse(response: WorkerResponse) {
  ctx.postMessage(response);
}

function sendProgress(id: string, phase: string, percent?: number) {
  sendResponse({ type: 'progress', id, phase, percent });
}

function getStoredRawData(id: string): unknown {
  return rawDataStore.get(id);
}

function stringifyPreview(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n...(内容过长已截断)`, truncated: true };
}

function compactSearchMatchValue(value: unknown): unknown {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', ...' : ''}}`;
  }
  return value;
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  const start = performance.now();

  try {
    switch (msg.type) {
      case 'parse-netlog': {
        sendProgress(msg.id, '正在解析 NetLog JSON...', 10);
        const rawData = typeof msg.payload === 'string'
          ? JSON.parse(msg.payload)
          : msg.payload;
        sendProgress(msg.id, '正在分析 NetLog 事件...', 40);
        const { events, result } = parseLog(rawData);
        const rawDataId = rawDataStore.keep('netlog', rawData);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog',
          payload: result,
          events,
          rawDataId,
          duration,
        });
        break;
      }

      case 'parse-har': {
        sendProgress(msg.id, '正在解析 HAR JSON...', 10);
        let rawData: unknown = msg.payload;
        let repairInfo = msg.repairInfo;
        if (typeof msg.payload === 'string') {
          const repaired = parseHarWithRepair(msg.payload);
          rawData = repaired.data;
          repairInfo = repaired.repaired ? repaired : undefined;
        }
        sendProgress(msg.id, '正在分析 HAR 请求...', 40);
        const harResult = parseHar(rawData);
        if (repairInfo) {
          harResult.repairInfo = repairInfo as any;
        }
        const rawDataId = rawDataStore.keep('har', rawData);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'har',
          payload: harResult,
          rawDataId,
          duration,
        });
        break;
      }

      case 'parse-log': {
        sendProgress(msg.id, '正在解析日志文件...', 10);
        const logResult = parseLogFile(msg.payload);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'log',
          payload: logResult,
          duration,
        });
        break;
      }

      case 'search-raw-json': {
        const query = msg.payload?.query || '';
        sendProgress(msg.id, '正在搜索原始 JSON...', 10);
        const rawData = getStoredRawData(msg.payload.rawDataId);
        const matches = searchJsonPaths(
          rawData,
          query,
          msg.payload?.maxResults ?? RAW_EVIDENCE_SEARCH_MAX_RESULTS,
          msg.payload?.maxDepth ?? RAW_EVIDENCE_SEARCH_MAX_DEPTH
        ).map(match => ({
          ...match,
          value: compactSearchMatchValue(match.value),
        }));
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'raw-search',
          payload: matches,
          duration,
        });
        break;
      }

      case 'get-raw-structure': {
        sendProgress(msg.id, '正在读取原始 JSON 结构...', 10);
        const rawData = getStoredRawData(msg.payload.rawDataId);
        const structure = getStructureOverview(
          rawData,
          msg.payload.maxDepth ?? RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH
        );
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'raw-structure',
          payload: structure,
          duration,
        });
        break;
      }

      case 'get-raw-value': {
        sendProgress(msg.id, '正在读取原始 JSON 字段...', 10);
        const rawData = getStoredRawData(msg.payload.rawDataId);
        const value = getValueByPath(rawData, msg.payload.path);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'raw-value',
          payload: stringifyPreview(
            value,
            msg.payload.maxChars ?? RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS
          ),
          duration,
        });
        break;
      }

      case 'release-raw-data': {
        let released = false;
        if (msg.payload?.all) {
          released = rawDataStore.releaseAll();
        } else if (msg.payload?.rawDataId) {
          released = rawDataStore.release(msg.payload.rawDataId);
        }
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'raw-release',
          payload: {
            released,
            rawDataId: msg.payload?.rawDataId,
            all: Boolean(msg.payload?.all),
            remaining: rawDataStore.size(),
          },
          duration,
        });
        break;
      }

      default:
        sendResponse({
          type: 'error',
          id: (msg as any).id || 'unknown',
          error: `Unknown message type: ${(msg as any).type}`,
        });
    }
  } catch (err) {
    sendResponse({
      type: 'error',
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
