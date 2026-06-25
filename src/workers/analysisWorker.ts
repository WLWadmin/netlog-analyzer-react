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
import { searchJsonPaths } from '../parsers/shared/rawJsonPath';
import { RAW_EVIDENCE_SEARCH_MAX_DEPTH, RAW_EVIDENCE_SEARCH_MAX_RESULTS } from '../constants/analysisThresholds';
import type { WorkerRequest, WorkerResponse } from './protocols';

/* eslint-disable no-restricted-globals */
const ctx: Worker = self as any;

// Worker 内缓存解析后的 rawData，避免 raw 搜索时反复 structured clone 大 JSON
const rawDataStore = new Map<string, unknown>();

function keepRawData(kind: 'har' | 'netlog', rawData: unknown): string {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  rawDataStore.set(id, rawData);
  return id;
}

function sendResponse(response: WorkerResponse) {
  ctx.postMessage(response);
}

function sendProgress(id: string, phase: string, percent?: number) {
  sendResponse({ type: 'progress', id, phase, percent });
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
        const rawDataId = keepRawData('netlog', rawData);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog',
          payload: result,
          events,
          rawPayload: rawData,
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
        const rawDataId = keepRawData('har', rawData);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'har',
          payload: harResult,
          rawPayload: rawData,
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
        const rawData = rawDataStore.get(msg.payload.rawDataId);
        if (!rawData) {
          sendResponse({
            type: 'error',
            id: msg.id,
            error: 'Raw data not found or released',
          });
          break;
        }
        const matches = searchJsonPaths(
          rawData,
          query,
          msg.payload?.maxResults ?? RAW_EVIDENCE_SEARCH_MAX_RESULTS,
          msg.payload?.maxDepth ?? RAW_EVIDENCE_SEARCH_MAX_DEPTH
        );
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

      case 'release-raw-data': {
        if (msg.payload?.all) {
          rawDataStore.clear();
        } else if (msg.payload?.rawDataId) {
          rawDataStore.delete(msg.payload.rawDataId);
        }
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'raw-release',
          payload: true,
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
