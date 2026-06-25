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
import type { WorkerRequest, WorkerResponse } from './protocols';

/* eslint-disable no-restricted-globals */
const ctx: Worker = self as any;

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
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog',
          payload: result,
          events,
          rawPayload: rawData,
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
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'har',
          payload: harResult,
          rawPayload: rawData,
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
