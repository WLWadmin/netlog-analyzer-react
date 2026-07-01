/**
 * Analysis Web Worker
 * 在独立线程中执行 JSON.parse + 解析逻辑，避免阻塞主线程 UI
 *
 * CRA 5 + webpack 5 支持 new Worker(new URL(..., import.meta.url)) 语法
 */

import { parseLog } from '../parsers/netlog/parser';
import { createNetlogStreamingAnalyzer } from '../parsers/netlog/streamingAnalyzer';
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
import { createNetlogDatasetStore } from './netlogDatasetStore';
import { buildNetlogCompactEventIndex, readNetlogEventDetail } from './netlogDatasetIndexer';
import { queryNetlogEvents } from './netlogDatasetQuery';
import { scanNetlogEventJson, type NetlogStreamScanMeta } from './netlogStreamScanner';
import { extractSourceTypeId, extractTopLevelNumericField } from './netlogEventJsonProbe';

/* eslint-disable no-restricted-globals */
const ctx: Worker = self as any;

// Worker 内缓存解析后的 rawData，避免 raw 搜索时反复 structured clone 大 JSON
const rawDataStore = createRawDataStore({ maxItems: WORKER_RAW_DATA_MAX_ITEMS });
const netlogDatasetStore = createNetlogDatasetStore();

function sendResponse(response: WorkerResponse) {
  ctx.postMessage(response);
}

function sendProgress(id: string, phase: string, percent?: number) {
  sendResponse({ type: 'progress', id, phase, percent });
}

function logLargeNetlogDebug(id: string, event: string, details?: Record<string, unknown>) {
  console.info('[netlog-large]', { taskId: id, event, ...(details || {}) });
}

function countObjectKeys(value: unknown): number {
  return value && typeof value === 'object' ? Object.keys(value as Record<string, unknown>).length : 0;
}

const LIGHTWEIGHT_COUNT_EVENT_NAMES = new Set([
  'HTTP2_SESSION_UPDATE_RECV_WINDOW',
  'HTTP2_STREAM_UPDATE_RECV_WINDOW',
  'SSL_SOCKET_BYTES_RECEIVED',
  'SOCKET_BYTES_RECEIVED',
  'HTTP2_SESSION_RECV_DATA',
  'HTTP_TRANSACTION_READ_BODY',
  'URL_REQUEST_JOB_FILTERED_BYTES_READ',
  'SIMPLE_CACHE_ENTRY_WRITE_CALL',
  'SIMPLE_CACHE_ENTRY_WRITE_BEGIN',
  'SIMPLE_CACHE_ENTRY_WRITE_END',
  'SIMPLE_CACHE_ENTRY_WRITE_OPTIMISTIC',
  'COOKIE_INCLUSION_STATUS',
]);

function extractEventTypeId(eventJson: string): number | undefined {
  return extractTopLevelNumericField(eventJson, 'type');
}

function hasErrorMarker(eventJson: string): boolean {
  if (!/"(?:net_error|error_code)"\s*:/.test(eventJson)) return false;
  return !/"(?:net_error|error_code)"\s*:\s*0(?:[,}])/.test(eventJson);
}

function buildLightweightTypeSet(constants: any): Set<number> {
  const ids = new Set<number>();
  const eventTypes = constants?.logEventTypes || constants?.eventTypes || {};
  if (!eventTypes || typeof eventTypes !== 'object') return ids;
  for (const [key, value] of Object.entries(eventTypes as Record<string, unknown>)) {
    if (LIGHTWEIGHT_COUNT_EVENT_NAMES.has(key) && typeof value === 'number') {
      ids.add(value);
    } else if (typeof value === 'string' && LIGHTWEIGHT_COUNT_EVENT_NAMES.has(value) && /^\d+$/.test(key)) {
      ids.add(Number(key));
    }
  }
  return ids;
}

function buildEventNameMap(constants: any): Record<number, string> {
  const eventTypes = constants?.logEventTypes || constants?.eventTypes || {};
  const result: Record<number, string> = {};
  if (!eventTypes || typeof eventTypes !== 'object') return result;
  for (const [key, value] of Object.entries(eventTypes as Record<string, unknown>)) {
    if (typeof value === 'number') result[value] = key;
    else if (typeof value === 'string' && /^\d+$/.test(key)) result[Number(key)] = value;
  }
  return result;
}

const SAMPLE_EVENT_NAMES = new Set([
  'HOST_RESOLVER_MANAGER_CACHE_HIT',
  'HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS',
  'SOCKET_CONNECT',
  'UDP_CONNECT',
  'HTTP_TRANSACTION_READ_RESPONSE_HEADERS',
]);

function createSampleCollector() {
  const samples: Record<string, string[]> = {};
  return {
    maybeCollect(eventName: string | undefined, eventJson: string) {
      if (!eventName || !SAMPLE_EVENT_NAMES.has(eventName)) return;
      const list = samples[eventName] || [];
      if (list.length >= 2) return;
      list.push(eventJson.length > 3000 ? `${eventJson.slice(0, 3000)}...(truncated)` : eventJson);
      samples[eventName] = list;
    },
    getSamples() {
      return samples;
    },
  };
}

function getStoredRawData(id: string): unknown {
  return rawDataStore.get(id);
}

function stringifyPreview(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n...(内容过长已截断)`, truncated: true };
}

function normalizeLargeNetlogPayload(payload: File | { file: File; debug?: boolean }) {
  if (payload instanceof File) return { file: payload, debug: false };
  return { file: payload.file, debug: Boolean(payload.debug) };
}

async function parseLargeNetlogFile(payload: File | { file: File; debug?: boolean }, id: string, start: number) {
  const { file, debug } = normalizeLargeNetlogPayload(payload);
  if (!file.stream) {
    throw new Error('当前浏览器不支持大文件流式读取，请升级 Chrome/Edge 后重试');
  }

  logLargeNetlogDebug(id, 'worker:start', {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    hasStream: Boolean(file.stream),
  });
  sendProgress(id, '正在启动大文件流式解析...', 1);
  const analyzer = createNetlogStreamingAnalyzer();
  const topLevelMetaStats = {
    constantsEventTypes: 0,
    constantsSourceTypes: 0,
    hasPolledData: false,
    hasSystemInfo: false,
  };
  let lightweightTypeIds = new Set<number>();
  let eventNameById: Record<number, string> = {};
  const sampleCollector = debug ? createSampleCollector() : null;
  const scanMeta: NetlogStreamScanMeta = {
    bytesRead: 0,
    parsedEvents: 0,
    skippedEvents: 0,
    reachedEventsEnd: false,
  };
  let lastProgressAt = 0;

  for await (const eventJson of scanNetlogEventJson(file.stream(), scanMeta, {
    fileSize: file.size,
    onDebug: (event, details) => logLargeNetlogDebug(id, event, details),
    onTopLevelField: (key, valueJson) => {
      try {
        const value = JSON.parse(valueJson);
        analyzer.applyMetadata({ [key]: value });
        if (key === 'constants') {
          topLevelMetaStats.constantsEventTypes = countObjectKeys(value?.logEventTypes || value?.eventTypes);
          topLevelMetaStats.constantsSourceTypes = countObjectKeys(value?.logSourceType || value?.sourceTypes);
          lightweightTypeIds = buildLightweightTypeSet(value);
          eventNameById = buildEventNameMap(value);
        } else if (key === 'polledData') {
          topLevelMetaStats.hasPolledData = true;
        } else if (key === 'systemInfo') {
          topLevelMetaStats.hasSystemInfo = true;
        }
        logLargeNetlogDebug(id, 'worker:top-level-field-applied', {
          key,
          valueLength: valueJson.length,
          ...topLevelMetaStats,
          lightweightTypeIds: lightweightTypeIds.size,
        });
      } catch (err) {
        logLargeNetlogDebug(id, 'worker:top-level-field-parse-error', {
          key,
          valueLength: valueJson.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    onProgress: (bytesRead) => {
      const now = performance.now();
      if (now - lastProgressAt < 250) return;
      lastProgressAt = now;
      const percent = Math.max(1, Math.min(92, Math.round((bytesRead / file.size) * 92)));
      sendProgress(id, `正在扫描 NetLog events：${scanMeta.parsedEvents.toLocaleString()} 条`, percent);
    },
  })) {
    try {
      const eventTypeId = extractEventTypeId(eventJson);
      sampleCollector?.maybeCollect(eventTypeId !== undefined ? eventNameById[eventTypeId] : undefined, eventJson);
      if (eventTypeId !== undefined && lightweightTypeIds.has(eventTypeId) && !hasErrorMarker(eventJson)) {
        analyzer.recordLightweightEvent(eventTypeId, extractSourceTypeId(eventJson));
        continue;
      }
      analyzer.accept(JSON.parse(eventJson));
    } catch {
      scanMeta.skippedEvents++;
    }
  }

  sendProgress(id, '正在生成大文件诊断结果...', 96);
  const { result, eventsPreview, meta } = analyzer.finish();
  logLargeNetlogDebug(id, 'worker:finish-scan', {
    bytesRead: scanMeta.bytesRead,
    fileSize: file.size,
    parsedEvents: meta.parsedEvents,
    skippedEvents: scanMeta.skippedEvents + meta.skippedEvents,
    reachedEventsEnd: scanMeta.reachedEventsEnd,
    eventsPreview: eventsPreview.length,
    dnsRecords: result.dnsRecords.length,
    dnsServers: result.dnsServers.length,
    urlRequests: result.urlRequests.length,
    failedDomains: result.failedDomains.length,
    unknownEventTypes: meta.unknownEventTypes.length,
    unknownSourceTypes: meta.unknownSourceTypes.length,
    fullyParsedEvents: meta.fullyParsedEvents,
    lightweightCountedEvents: meta.lightweightCountedEvents,
    lightweightEventTypes: meta.lightweightEventTypes.slice(0, 10),
    ...topLevelMetaStats,
    lightweightTypeIds: lightweightTypeIds.size,
  });
  console.info('[netlog-large-summary]', JSON.stringify({
    taskId: id,
    fileName: file.name,
    fileSize: file.size,
    bytesRead: scanMeta.bytesRead,
    parsedEvents: meta.parsedEvents,
    skippedEvents: scanMeta.skippedEvents + meta.skippedEvents,
    reachedEventsEnd: scanMeta.reachedEventsEnd,
    durationMs: performance.now() - start,
    eventsPreview: eventsPreview.length,
    dnsRecords: result.dnsRecords.length,
    dnsServers: result.dnsServers.length,
    urlRequests: result.urlRequests.length,
    failedDomains: result.failedDomains.length,
    unknownEventTypes: meta.unknownEventTypes.slice(0, 50),
    unknownEventTypeCount: meta.unknownEventTypes.length,
    unknownSourceTypes: meta.unknownSourceTypes.slice(0, 50),
    unknownSourceTypeCount: meta.unknownSourceTypes.length,
    fullyParsedEvents: meta.fullyParsedEvents,
    lightweightCountedEvents: meta.lightweightCountedEvents,
    lightweightEventTypes: meta.lightweightEventTypes,
    ...topLevelMetaStats,
    lightweightTypeIds: lightweightTypeIds.size,
    diagnostics: meta.diagnostics,
  }));
  const samples = sampleCollector?.getSamples() || {};
  if (Object.keys(samples).length > 0) {
    console.info('[netlog-large-samples]', JSON.stringify({
      taskId: id,
      samples,
    }));
  }
  result.largeFileMode = {
    enabled: true,
    fileSize: file.size,
    bytesRead: scanMeta.bytesRead,
    parsedEvents: meta.parsedEvents,
    skippedEvents: scanMeta.skippedEvents + meta.skippedEvents,
    truncatedEventsPreview: meta.truncatedEventsPreview,
    reachedEventsEnd: scanMeta.reachedEventsEnd,
  };
  const duration = performance.now() - start;
  logLargeNetlogDebug(id, 'worker:success', { duration });
  sendResponse({
    type: 'success',
    id,
    resultType: 'netlog',
    payload: result,
    events: eventsPreview,
    duration,
  });
}

function compactSearchMatchValue(value: unknown): unknown {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', ...' : ''}}`;
  }
  return value;
}

ctx.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
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

      case 'parse-large-netlog-file': {
        void parseLargeNetlogFile(msg.payload, msg.id, start).catch(err => {
          logLargeNetlogDebug(msg.id, 'worker:error', {
            error: err instanceof Error ? err.message : String(err),
          });
          sendResponse({
            type: 'error',
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          });
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

      case 'import-netlog-dataset': {
        const eventIndex = await buildNetlogCompactEventIndex(msg.payload.file);
        const meta = netlogDatasetStore.importFile(msg.payload.file, eventIndex);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-dataset',
          payload: meta,
          duration,
        });
        break;
      }

      case 'query-netlog-events': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.eventIndex) throw new Error(`NetLog Dataset 不存在或未完成索引：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-events-query',
          payload: queryNetlogEvents(dataset.eventIndex, msg.payload),
          duration,
        });
        break;
      }

      case 'get-netlog-event-detail': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.eventIndex) throw new Error(`NetLog Dataset 不存在或未完成索引：${msg.payload.analysisId}`);
        const detail = await readNetlogEventDetail(dataset.file, dataset.eventIndex, msg.payload.eventId);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-event-detail',
          payload: detail,
          duration,
        });
        break;
      }

      case 'release-netlog-dataset': {
        let releasedCount = 0;
        let released = false;
        if (msg.payload?.all) {
          releasedCount = netlogDatasetStore.releaseAll();
          released = releasedCount > 0;
        } else if (msg.payload?.analysisId) {
          released = netlogDatasetStore.release(msg.payload.analysisId);
        }
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-dataset-release',
          payload: {
            released,
            analysisId: msg.payload?.analysisId,
            all: Boolean(msg.payload?.all),
            remaining: netlogDatasetStore.size(),
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
