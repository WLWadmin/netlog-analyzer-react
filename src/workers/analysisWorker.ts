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
import { queryNetlogEvents, queryNetlogEventsWithRawSearch } from './netlogDatasetQuery';
import { buildNetlogSourceChainDetailView, buildNetlogSourceChainView } from './netlogSourceChainView';
import { buildNetlogRawEvidenceStructureView, getNetlogRawEvidenceMetadataValue, queryNetlogRawEvidenceEvents } from './netlogRawEvidenceView';
import { scanNetlogEventJson, type NetlogStreamScanMeta } from './netlogStreamScanner';
import { extractSourceTypeId, extractTopLevelNumericField } from './netlogEventJsonProbe';
import { LIGHTWEIGHT_COUNT_EVENT_NAMES } from './netlogLightweightEvents';
import {
  buildAnalysisProgress,
  type AnalysisProgress,
} from '../upload/analysisProgress';
import type { FileParserId } from '../upload/fileFormatTypes';

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

function sendStructuredProgress(
  id: string,
  startedAt: number,
  progress: Omit<AnalysisProgress, 'taskId' | 'startedAt' | 'updatedAt'>,
) {
  const structured = buildAnalysisProgress({
    ...progress,
    taskId: id,
    startedAt,
    updatedAt: performance.now(),
  });
  sendResponse({
    type: 'progress',
    id,
    phase: structured.label,
    progress: structured,
  });
}

function recordProgress(
  id: string,
  startedAt: number,
  parserId: FileParserId,
  label: string,
  completed: number,
  total: number,
  unit: 'events' | 'requests' | 'lines',
) {
  sendStructuredProgress(id, startedAt, {
    parserId,
    phase: 'scanning-records',
    label,
    mode: 'determinate',
    completed,
    total,
    unit,
    phaseIndex: 2,
    phaseCount: 5,
  });
}

function logLargeNetlogDebug(id: string, event: string, details?: Record<string, unknown>) {
  console.info('[netlog-large]', { taskId: id, event, ...(details || {}) });
}

function countObjectKeys(value: unknown): number {
  return value && typeof value === 'object' ? Object.keys(value as Record<string, unknown>).length : 0;
}

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

async function readWorkerFileText(payload: unknown): Promise<unknown> {
  return payload instanceof File ? payload.text() : payload;
}

function readHarResponseBody(rawData: unknown, entryId: number) {
  if (!Number.isInteger(entryId) || entryId < 0) {
    throw new Error('HAR response body entryId 无效');
  }
  const entries = (rawData as any)?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('HAR 原始数据已不可用或结构无效');
  }
  if (entryId >= entries.length) {
    throw new Error('HAR response body entryId 越界');
  }
  const content = entries[entryId]?.response?.content;
  const text = content?.text;
  if (text === undefined || text === null) {
    return {
      state: 'absent' as const,
      text: '',
      encoding: '',
      mimeType: content?.mimeType ? String(content.mimeType) : '',
      originalLength: 0,
    };
  }
  const bodyText = String(text);
  return {
    state: 'available' as const,
    text: bodyText,
    encoding: content?.encoding ? String(content.encoding) : '',
    mimeType: content?.mimeType ? String(content.mimeType) : '',
    originalLength: bodyText.length,
  };
}

function stringifyPreview(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n...(内容过长已截断)`, truncated: true };
}

function normalizeLargeNetlogPayload(payload: File | { file: File; debug?: boolean; singleScanDataset?: boolean }) {
  if (payload instanceof File) return { file: payload, debug: false };
  return {
    file: payload.file,
    debug: Boolean(payload.debug),
    singleScanDataset: Boolean((payload as { singleScanDataset?: boolean }).singleScanDataset),
  };
}

async function parseLargeNetlogFile(payload: File | { file: File; debug?: boolean; singleScanDataset?: boolean }, id: string, start: number) {
  const { file, debug, singleScanDataset } = normalizeLargeNetlogPayload(payload);
  if (!file.stream) {
    throw new Error('当前浏览器不支持大文件流式读取，请升级 Chrome/Edge 后重试');
  }

  logLargeNetlogDebug(id, 'worker:start', {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    hasStream: Boolean(file.stream),
    singleScanDataset,
  });
  if (singleScanDataset) {
    sendStructuredProgress(id, start, {
      parserId: 'chromium-netlog@1',
      phase: 'scanning-records',
      label: '正在单次扫描 NetLog',
      mode: 'determinate',
      completed: 0,
      total: file.size,
      unit: 'bytes',
      phaseIndex: 2,
      phaseCount: 5,
    });
    const analyzer = createNetlogStreamingAnalyzer();
    const { index: eventIndex, parseSkipStats, endpointEvidence, dataLoaded, dnsState, proxyState, quicState, http2State, socketsState, cacheState, altSvcState, streamPoolState, reportingState, timelineState, modulesState, prerenderState } = await buildNetlogCompactEventIndex(file, {
      onTopLevelField: (key, value) => analyzer.applyMetadata({ [key]: value }),
      onEvent: (event) => {
        try {
          analyzer.accept(event);
        } catch {
          // 单个事件 summary 解析失败不应中断 Dataset 构建
        }
      },
      onLightweightEvent: (typeId, sourceTypeId) => {
        analyzer.recordLightweightEvent(typeId, sourceTypeId);
      },
      onProgress: (bytesRead, eventCount) => {
        sendStructuredProgress(id, start, {
          parserId: 'chromium-netlog@1',
          phase: 'scanning-records',
          label: `正在扫描 NetLog，已识别 ${eventCount.toLocaleString()} 个事件`,
          mode: 'determinate',
          completed: bytesRead,
          total: file.size,
          unit: 'bytes',
          phaseIndex: 2,
          phaseCount: 5,
        });
      },
    });
    sendStructuredProgress(id, start, {
      parserId: 'chromium-netlog@1',
      phase: 'building-facts',
      label: '正在生成 NetLog 诊断事实',
      mode: 'indeterminate',
      phaseIndex: 3,
      phaseCount: 5,
    });
    const { result, eventsPreview, meta } = analyzer.finish();
    result.largeFileMode = {
      enabled: true,
      fileSize: file.size,
      bytesRead: file.size,
      parsedEvents: eventIndex.count,
      skippedEvents: meta.skippedEvents,
      truncatedEventsPreview: meta.truncatedEventsPreview,
      reachedEventsEnd: true,
    };
    const datasetMeta = {
      ...netlogDatasetStore.importFile(file, eventIndex, endpointEvidence, dataLoaded, dnsState, proxyState, quicState, http2State, socketsState, cacheState, altSvcState, streamPoolState, reportingState, timelineState, modulesState, prerenderState),
      parseSkipStats,
      socketLazyParamsStats: socketsState.lazyParamsStats,
    };
    const duration = performance.now() - start;
    logLargeNetlogDebug(id, 'worker:single-scan-success', {
      duration,
      analysisId: datasetMeta.analysisId,
      datasetEventCount: datasetMeta.eventCount,
      dnsAnswerCount: endpointEvidence.dnsAnswers.length,
      endpointEvidenceCount: endpointEvidence.failedOrSlowIps.length,
      ...parseSkipStats,
    });
    sendResponse({
      type: 'success',
      id,
      resultType: 'netlog',
      payload: result,
      events: eventsPreview,
      datasetMeta,
      duration,
    });
    return;
  }
  sendStructuredProgress(id, start, {
    parserId: 'chromium-netlog@1',
    phase: 'scanning-records',
    label: '正在启动 NetLog 流式扫描',
    mode: 'determinate',
    completed: 0,
    total: file.size,
    unit: 'bytes',
    phaseIndex: 2,
    phaseCount: 5,
  });
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
      sendStructuredProgress(id, start, {
        parserId: 'chromium-netlog@1',
        phase: 'scanning-records',
        label: `正在扫描 NetLog，已识别 ${scanMeta.parsedEvents.toLocaleString()} 个事件`,
        mode: 'determinate',
        completed: Math.min(bytesRead, file.size),
        total: file.size,
        unit: 'bytes',
        phaseIndex: 2,
        phaseCount: 5,
      });
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

  sendStructuredProgress(id, start, {
    parserId: 'chromium-netlog@1',
    phase: 'building-facts',
    label: '正在生成 NetLog 诊断事实',
    mode: 'indeterminate',
    phaseIndex: 3,
    phaseCount: 5,
  });
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
        sendStructuredProgress(msg.id, start, {
          parserId: 'chromium-netlog@1',
          phase: 'parsing-structure',
          label: '正在解析 NetLog JSON 结构',
          mode: 'indeterminate',
          phaseIndex: 1,
          phaseCount: 5,
        });
        const netlogPayload = await readWorkerFileText(msg.payload);
        const rawData = typeof netlogPayload === 'string'
          ? JSON.parse(netlogPayload)
          : netlogPayload;
        const { events, result } = parseLog(rawData, (completed, total) => {
          recordProgress(
            msg.id,
            start,
            'chromium-netlog@1',
            '正在扫描 NetLog 事件',
            completed,
            total,
            'events',
          );
        });
        sendStructuredProgress(msg.id, start, {
          parserId: 'chromium-netlog@1',
          phase: 'preparing-result',
          label: '正在准备 NetLog 结果',
          mode: 'indeterminate',
          phaseIndex: 4,
          phaseCount: 5,
        });
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
        sendStructuredProgress(msg.id, start, {
          parserId: 'har@1',
          phase: 'parsing-structure',
          label: '正在解析 HAR JSON 结构',
          mode: 'indeterminate',
          phaseIndex: 1,
          phaseCount: 5,
        });
        const harPayload = await readWorkerFileText(msg.payload);
        let rawData: unknown = harPayload;
        let repairInfo = msg.repairInfo;
        if (typeof harPayload === 'string') {
          const repaired = parseHarWithRepair(harPayload);
          rawData = repaired.data;
          repairInfo = repaired.repaired ? repaired : undefined;
        }
        const harResult = parseHar(rawData, (completed, total) => {
          recordProgress(
            msg.id,
            start,
            'har@1',
            '正在扫描 HAR 请求',
            completed,
            total,
            'requests',
          );
        });
        sendStructuredProgress(msg.id, start, {
          parserId: 'har@1',
          phase: 'preparing-result',
          label: '正在准备 HAR 结果',
          mode: 'indeterminate',
          phaseIndex: 4,
          phaseCount: 5,
        });
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
        sendStructuredProgress(msg.id, start, {
          parserId: 'go-service-log@1',
          phase: 'parsing-structure',
          label: '正在解析日志结构',
          mode: 'indeterminate',
          phaseIndex: 1,
          phaseCount: 5,
        });
        const logPayload = await readWorkerFileText(msg.payload);
        if (typeof logPayload !== 'string') {
          throw new Error('Log 文件内容必须是文本');
        }
        const logResult = parseLogFile(logPayload, (completed, total) => {
          recordProgress(
            msg.id,
            start,
            'go-service-log@1',
            '正在扫描日志行',
            completed,
            total,
            'lines',
          );
        });
        sendStructuredProgress(msg.id, start, {
          parserId: 'go-service-log@1',
          phase: 'preparing-result',
          label: '正在准备日志结果',
          mode: 'indeterminate',
          phaseIndex: 4,
          phaseCount: 5,
        });
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

      case 'get-netlog-source-chain': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.eventIndex) throw new Error(`NetLog Dataset Source Chain 不存在：${msg.payload.analysisId}`);
        const payload = buildNetlogSourceChainView(dataset.eventIndex);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-source-chain',
          payload,
          duration,
        });
        break;
      }

      case 'get-netlog-source-chain-detail': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.eventIndex) throw new Error(`NetLog Dataset Source Chain detail 不存在：${msg.payload.analysisId}`);
        const payload = buildNetlogSourceChainDetailView(
          msg.payload.analysisId,
          dataset.eventIndex,
          msg.payload.sourceId,
          msg.payload.page,
          msg.payload.pageSize
        );
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-source-chain-detail',
          payload,
          duration,
        });
        break;
      }

      case 'get-netlog-raw-evidence-structure': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.eventIndex || !dataset.dataLoaded) throw new Error(`NetLog Dataset Raw Evidence 不存在：${msg.payload.analysisId}`);
        const payload = buildNetlogRawEvidenceStructureView(dataset.dataLoaded, dataset.eventIndex);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-raw-evidence-structure',
          payload,
          duration,
        });
        break;
      }

      case 'query-netlog-raw-evidence-events': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.eventIndex) throw new Error(`NetLog Dataset Raw Evidence events 不存在：${msg.payload.analysisId}`);
        const payload = queryNetlogRawEvidenceEvents(msg.payload.analysisId, dataset.eventIndex, msg.payload.page, msg.payload.pageSize);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-raw-evidence-events',
          payload,
          duration,
        });
        break;
      }

      case 'get-netlog-raw-evidence-metadata': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.eventIndex) throw new Error(`NetLog Dataset Raw Evidence metadata 不存在：${msg.payload.analysisId}`);
        const payload = await getNetlogRawEvidenceMetadataValue(dataset.file, dataset.eventIndex, msg.payload.key);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-raw-evidence-metadata',
          payload,
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

      case 'get-har-response-body': {
        sendProgress(msg.id, '正在读取 HAR 响应体...', 10);
        const rawData = getStoredRawData(msg.payload.rawDataId);
        const payload = readHarResponseBody(rawData, msg.payload.entryId);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'har-response-body',
          payload,
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
        logLargeNetlogDebug(msg.id, 'dataset-index:start', {
          fileName: msg.payload.file?.name,
          fileSize: msg.payload.file?.size,
          fileType: msg.payload.file?.type || 'application/json',
        });
        try {
          const { index: eventIndex, parseSkipStats, endpointEvidence, dataLoaded, dnsState, proxyState, quicState, http2State, socketsState, cacheState, altSvcState, streamPoolState, reportingState, timelineState, modulesState, prerenderState } = await buildNetlogCompactEventIndex(msg.payload.file);
          const meta = {
            ...netlogDatasetStore.importFile(msg.payload.file, eventIndex, endpointEvidence, dataLoaded, dnsState, proxyState, quicState, http2State, socketsState, cacheState, altSvcState, streamPoolState, reportingState, timelineState, modulesState, prerenderState),
            parseSkipStats,
            socketLazyParamsStats: socketsState.lazyParamsStats,
          };
          const duration = performance.now() - start;
          const endpointEvidenceCount = endpointEvidence.failedOrSlowIps.length;
          const endpointRowCount = endpointEvidence.cipSipRows.length;
          logLargeNetlogDebug(msg.id, 'dataset-index:endpoint-evidence-summary', {
            endpointEvidenceCount,
            endpointRowCount,
            dnsAnswerCount: endpointEvidence.dnsAnswers.length,
            dnsServerCount: endpointEvidence.dnsServers.length,
            copyableIpCount: endpointEvidence.copyableIps.length,
          });
          logLargeNetlogDebug(msg.id, 'dataset-index:finish', {
            analysisId: meta.analysisId,
            indexBuildMs: duration,
            eventCount: meta.eventCount,
            endpointEvidenceCount,
            endpointRowCount,
            dnsStateCacheCount: dnsState.hostResolverCache.length,
            dnsStateTaskCount: dnsState.taskResults.length,
            ...parseSkipStats,
          });
          sendResponse({
            type: 'success',
            id: msg.id,
            resultType: 'netlog-dataset',
            payload: meta,
            duration,
          });
        } catch (err) {
          const duration = performance.now() - start;
          logLargeNetlogDebug(msg.id, 'dataset-index:error', {
            indexBuildMs: duration,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
        break;
      }

      case 'get-netlog-data-loaded': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.dataLoaded) throw new Error(`NetLog Dataset data loaded view 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-data-loaded',
          payload: dataset.dataLoaded,
          duration,
        });
        break;
      }

      case 'get-netlog-dns-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.dnsState) throw new Error(`NetLog Dataset DNS state 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-dns-state',
          payload: dataset.dnsState,
          duration,
        });
        break;
      }

      case 'get-netlog-proxy-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.proxyState) throw new Error(`NetLog Dataset Proxy state 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-proxy-state',
          payload: dataset.proxyState,
          duration,
        });
        break;
      }

      case 'get-netlog-quic-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.quicState) throw new Error(`NetLog Dataset QUIC state 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-quic-state',
          payload: dataset.quicState,
          duration,
        });
        break;
      }

      case 'get-netlog-http2-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.http2State) throw new Error(`NetLog Dataset HTTP/2 state 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-http2-state',
          payload: dataset.http2State,
          duration,
        });
        break;
      }

      case 'get-netlog-sockets-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.socketsState) throw new Error(`NetLog Dataset Sockets state 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-sockets-state',
          payload: dataset.socketsState,
          duration,
        });
        break;
      }

      case 'get-netlog-cache-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.cacheState) throw new Error(`NetLog Dataset Cache state 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-cache-state',
          payload: dataset.cacheState,
          duration,
        });
        break;
      }

      case 'get-netlog-alt-svc-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.altSvcState) throw new Error(`NetLog Dataset Alt-Svc state 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-alt-svc-state',
          payload: dataset.altSvcState,
          duration,
        });
        break;
      }

      case 'get-netlog-reporting-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset) throw new Error(`NetLog Dataset 不存在：${msg.payload.analysisId}`);
        if (!dataset.reportingState) throw new Error('当前 Dataset 未生成 Reporting State');
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-reporting-state',
          payload: dataset.reportingState,
          duration: performance.now() - start,
        });
        break;
      }
      case 'get-netlog-timeline-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.timelineState) throw new Error(`NetLog Dataset Timeline state 不存在：${msg.payload.analysisId}`);
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-timeline-state',
          payload: dataset.timelineState,
          duration: performance.now() - start,
        });
        break;
      }
      case 'get-netlog-modules-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.modulesState) throw new Error(`NetLog Dataset Modules state 不存在：${msg.payload.analysisId}`);
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-modules-state',
          payload: dataset.modulesState,
          duration: performance.now() - start,
        });
        break;
      }
      case 'get-netlog-prerender-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.prerenderState) throw new Error(`NetLog Dataset Prerender state 不存在：${msg.payload.analysisId}`);
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-prerender-state',
          payload: dataset.prerenderState,
          duration: performance.now() - start,
        });
        break;
      }
      case 'get-netlog-stream-pool-state': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.streamPoolState) throw new Error(`NetLog Dataset StreamPool state 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-stream-pool-state',
          payload: dataset.streamPoolState,
          duration,
        });
        break;
      }

      case 'query-netlog-events': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.eventIndex) throw new Error(`NetLog Dataset 不存在或未完成索引：${msg.payload.analysisId}`);
        const payload = msg.payload.searchText?.trim()
          ? await queryNetlogEventsWithRawSearch(dataset.file, dataset.eventIndex, msg.payload)
          : queryNetlogEvents(dataset.eventIndex, msg.payload);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-events-query',
          payload,
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

      case 'get-netlog-endpoint-evidence': {
        const dataset = netlogDatasetStore.get(msg.payload.analysisId);
        if (!dataset?.endpointEvidence) throw new Error(`NetLog Dataset endpoint evidence 不存在：${msg.payload.analysisId}`);
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog-endpoint-evidence',
          payload: dataset.endpointEvidence,
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
