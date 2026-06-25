/**
 * Analysis Web Worker
 * 在独立线程中执行 JSON.parse + 解析逻辑，避免阻塞主线程 UI
 *
 * CRA 5 + webpack 5 支持 new Worker(new URL(..., import.meta.url)) 语法
 */

import { parseLog, type AnalysisResult, type ParsedEvent } from '../parsers/netlog/parser';
import { parseHar, type HarAnalysisResult } from '../harParser';
import { parseLogFile } from '../logParser';
import { parseHarWithRepair } from '../utils/harRepair';
import { getStructureOverview, getValueByPath, searchJsonPaths } from '../parsers/shared/rawJsonPath';
import {
  RAW_EVIDENCE_SEARCH_MAX_DEPTH,
  RAW_EVIDENCE_SEARCH_MAX_RESULTS,
  RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH,
  RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
} from '../constants/analysisThresholds';
import { buildHarSummary, buildNetlogSummary } from './summaryBuilders';
import type { HarSummary, NetlogSummary } from './summaryTypes';
import type {
  EventRowPreview,
  GetEventDetailResponsePayload,
  GetRequestDetailResponsePayload,
  GetSourceChainDetailResponsePayload,
  QueryEventsResponsePayload,
  QueryRequestPageResponsePayload,
  QuerySourceChainsResponsePayload,
  QueryDiagnosisSummaryResponsePayload,
} from './queryTypes';
import { buildSourceGraph } from '../parsers/netlog/sourceGraph';
import { generateSuggestions } from '../parsers/netlog/diagnosis';
import { buildNetlogDiagnosisSummary } from '../diagnosis/shared/fromNetlog';
import { SLOW_REQUEST_MS } from '../constants/analysisThresholds';
import type { WorkerRequest, WorkerResponse } from './protocols';

/* eslint-disable no-restricted-globals */
const ctx: Worker = self as any;

type StoredNetlogAnalysis = {
  kind: 'netlog';
  rawDataId: string;
  rawData: unknown;
  events: ParsedEvent[];
  result: AnalysisResult;
  summary: NetlogSummary;
  // lazy caches will be added in Phase 2 (query handlers)
  cache?: Record<string, unknown>;
};

type StoredHarAnalysis = {
  kind: 'har';
  rawDataId: string;
  rawData: unknown;
  result: HarAnalysisResult;
  summary: HarSummary;
};

type StoredAnalysis = StoredNetlogAnalysis | StoredHarAnalysis;

const analysisStore = new Map<string, StoredAnalysis>();

function keepAnalysis(kind: 'netlog' | 'har', analysis: StoredAnalysis): string {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  analysisStore.set(id, analysis);
  return id;
}

function getStoredAnalysis(analysisId: string): StoredAnalysis {
  if (!analysisStore.has(analysisId)) {
    throw new Error('Analysis not found or released');
  }
  return analysisStore.get(analysisId)!;
}

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

function getStoredRawData(id: string): unknown {
  if (!rawDataStore.has(id)) {
    throw new Error('Raw data not found or released');
  }
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

function extractErrorCodeFromEvent(e: ParsedEvent): string | undefined {
  const p: any = e.params || {};
  const code = p.net_error ?? p.error;
  if (code === undefined || code === null) return undefined;
  if (typeof code === 'number' && code === 0) return undefined;
  const s = String(code);
  return s === '0' ? undefined : s;
}

function buildEventPreview(e: ParsedEvent, eventKey: string): EventRowPreview {
  const p: any = e.params || {};
  const errorCode = extractErrorCodeFromEvent(e);
  // 白名单 params：避免把大对象回传主线程
  const shortParams: Record<string, unknown> = {};
  const whitelist = [
    'net_error',
    'net_error_string',
    'error',
    'address',
    'ip_endpoint',
    'peer_address',
    'host',
    'scheme',
    'method',
    'url',
    'status_code',
    'http_response_code',
    'quic_error_code',
    'source_dependency',
  ];
  for (const k of whitelist) {
    const v = p[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object') {
      // object 类型仅保留 keys 概览
      shortParams[k] = compactSearchMatchValue(v);
    } else {
      const s = String(v);
      shortParams[k] = s.length > 200 ? `${s.slice(0, 200)}...(截断)` : v;
    }
  }
  return {
    eventKey,
    time: e.time.toFixed(0),
    type: e.type,
    typeName: e.typeName,
    phase: e.phaseName,
    sourceId: e.source?.id,
    sourceType: e.source?.typeName,
    errorCode,
    url: typeof p.url === 'string' ? p.url : undefined,
    method: typeof p.method === 'string' ? p.method : undefined,
    shortParams: Object.keys(shortParams).length > 0 ? shortParams : undefined,
  };
}

function capPageSize(input: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return Math.min(100, max);
  return Math.min(Math.max(1, Math.floor(n)), max);
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
        const summary = buildNetlogSummary(result);
        const analysisId = keepAnalysis('netlog', {
          kind: 'netlog',
          rawDataId,
          rawData,
          events,
          result,
          summary,
        });
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'netlog',
          payload: summary,
          analysisId,
          summary,
          eventCount: events.length,
          requestCount: result.urlRequests.length,
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
        const summary = buildHarSummary(harResult);
        const analysisId = keepAnalysis('har', {
          kind: 'har',
          rawDataId,
          rawData,
          result: harResult,
          summary,
        });
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'har',
          payload: summary,
          analysisId,
          summary,
          requestCount: harResult.totalRequests,
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

      case 'release-analysis': {
        if (msg.payload?.all) {
          analysisStore.forEach((a) => {
            rawDataStore.delete(a.rawDataId);
          });
          analysisStore.clear();
        } else if (msg.payload?.analysisId) {
          const a = analysisStore.get(msg.payload.analysisId);
          if (a) rawDataStore.delete(a.rawDataId);
          analysisStore.delete(msg.payload.analysisId);
        }
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'release-analysis',
          payload: true,
          duration,
        });
        break;
      }

      case 'query-events': {
        const a = getStoredAnalysis(msg.payload.analysisId);
        if (a.kind !== 'netlog') throw new Error('query-events only supports netlog analysis');
        const pageSize = capPageSize(msg.payload.pageSize, 200);
        const page = Math.max(1, Math.floor(Number(msg.payload.page) || 1));
        const filters = msg.payload.filters || {};
        const kw = (filters.keyword || '').trim().toLowerCase();

        const phasesSet = new Set<string>();
        const sourceTypesSet = new Set<string>();

        const matchedKeys: string[] = [];
        for (let i = 0; i < a.events.length; i++) {
          const e = a.events[i];
          phasesSet.add(e.phaseName);
          sourceTypesSet.add(e.source.typeName);

          if (filters.sourceId && String(e.source.id) !== String(filters.sourceId)) continue;
          if (filters.sourceType && e.source.typeName !== filters.sourceType) continue;
          if (filters.phase && e.phaseName !== filters.phase) continue;

          const errorCode = extractErrorCodeFromEvent(e);
          if (filters.errorOnly && !errorCode) continue;
          if (filters.errorCode && String(errorCode || '') !== String(filters.errorCode)) continue;
          if (filters.paramField && !(filters.paramField in (e.params || {}))) continue;

          if (kw) {
            const p: any = e.params || {};
            const hay = `${e.typeName} ${e.source.typeName} ${e.source.id} ${e.phaseName} ${errorCode || ''} ${p.net_error_string || ''}`.toLowerCase();
            if (!hay.includes(kw)) continue;
          }

          matchedKeys.push(String(i));
        }

        const total = matchedKeys.length;
        const startIndex = (page - 1) * pageSize;
        const sliceKeys = matchedKeys.slice(startIndex, startIndex + pageSize);
        const items = sliceKeys.map(k => buildEventPreview(a.events[Number(k)], k));

        const payload: QueryEventsResponsePayload = {
          total,
          page,
          pageSize,
          items,
          facets: {
            phases: Array.from(phasesSet).sort(),
            sourceTypes: Array.from(sourceTypesSet).sort(),
          },
        };

        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'query-events',
          payload,
          duration,
        });
        break;
      }

      case 'get-event-detail': {
        const a = getStoredAnalysis(msg.payload.analysisId);
        if (a.kind !== 'netlog') throw new Error('get-event-detail only supports netlog analysis');
        const idx = Number(msg.payload.eventKey);
        if (!Number.isFinite(idx) || idx < 0 || idx >= a.events.length) throw new Error('Invalid eventKey');
        const e = a.events[idx];
        const eventPreview = buildEventPreview(e, msg.payload.eventKey);

        const maxChars = capPageSize(msg.payload.maxParamChars ?? 2000, 20_000);
        const text = JSON.stringify(e.params || {}, null, 2);
        const truncated = text.length > maxChars;
        const payload: GetEventDetailResponsePayload = {
          event: eventPreview,
          paramsPreview: truncated ? `${text.slice(0, maxChars)}\n...(内容过长已截断)` : text,
          paramsTruncated: truncated,
        };
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'get-event-detail',
          payload,
          duration,
        });
        break;
      }

      case 'query-source-chains': {
        const a = getStoredAnalysis(msg.payload.analysisId);
        if (a.kind !== 'netlog') throw new Error('query-source-chains only supports netlog analysis');
        const pageSize = capPageSize(msg.payload.pageSize, 100);
        const page = Math.max(1, Math.floor(Number(msg.payload.page) || 1));
        const keyword = (msg.payload.filters?.keyword || '').trim().toLowerCase();
        const mode = msg.payload.filters?.mode || 'all';

        const cache = (a.cache ||= {});
        if (!cache.sourceGraph) {
          cache.sourceGraph = buildSourceGraph(a.events, a.result.urlRequests);
        }
        const graph: any = cache.sourceGraph;
        let chains = graph.chains as any[];
        if (mode === 'error') chains = chains.filter(c => c.hasError);
        if (mode === 'slow') chains = chains.filter(c => c.duration > 3_000);
        if (keyword) chains = chains.filter(c => (c.url || '').toLowerCase().includes(keyword));

        const total = chains.length;
        const startIndex = (page - 1) * pageSize;
        const slice = chains.slice(startIndex, startIndex + pageSize);
        const items = slice.map(c => ({
          rootId: c.rootId,
          url: c.url,
          duration: c.duration,
          depth: c.depth,
          hasError: c.hasError,
        }));

        const payload: QuerySourceChainsResponsePayload = { total, page, pageSize, items };
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'query-source-chains',
          payload,
          duration,
        });
        break;
      }

      case 'get-source-chain-detail': {
        const a = getStoredAnalysis(msg.payload.analysisId);
        if (a.kind !== 'netlog') throw new Error('get-source-chain-detail only supports netlog analysis');
        const cache = (a.cache ||= {});
        if (!cache.sourceGraph) {
          cache.sourceGraph = buildSourceGraph(a.events, a.result.urlRequests);
        }
        const graph: any = cache.sourceGraph;
        const chain = (graph.chains as any[]).find(c => c.rootId === msg.payload.rootId);
        if (!chain) throw new Error('Chain not found');
        const maxNodes = 200;
        const nodes = (chain.path as any[]).slice(0, maxNodes).map(n => ({
          id: n.id,
          type: n.type,
          hasError: Boolean(n.hasError),
        }));
        const payload: GetSourceChainDetailResponsePayload = {
          rootId: chain.rootId,
          url: chain.url,
          duration: chain.duration,
          depth: chain.depth,
          hasError: chain.hasError,
          nodes,
          truncated: chain.path.length > maxNodes,
        };
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'get-source-chain-detail',
          payload,
          duration,
        });
        break;
      }

      case 'query-request-page': {
        const a = getStoredAnalysis(msg.payload.analysisId);
        if (a.kind !== 'netlog') throw new Error('query-request-page only supports netlog analysis');
        const pageSize = capPageSize(msg.payload.pageSize, 200);
        const page = Math.max(1, Math.floor(Number(msg.payload.page) || 1));
        const f = msg.payload.filters || {};
        const kw = (f.keyword || '').trim().toLowerCase();

        // 预计算 host
        const list = a.result.urlRequests.map(r => {
          let host = '';
          try { host = new URL(r.url).host; } catch { /* ignore */ }
          return { r, host };
        });

        let filtered = list;
        if (kw) {
          filtered = filtered.filter(({ r, host }) => {
            const hay = `${r.url} ${r.method} ${r.statusCode ?? ''} ${r.error ?? ''} ${r.errorDesc ?? ''} ${r.protocol ?? ''} ${r.status ?? ''} ${host}`.toLowerCase();
            return hay.includes(kw);
          });
        }
        if (f.host) filtered = filtered.filter(x => x.host === f.host);
        if (f.status && f.status !== 'all') {
          filtered = filtered.filter(({ r }) => {
            if (f.status === 'success') return !r.error && r.status !== 'error';
            if (f.status === 'error') return Boolean(r.error) || r.status === 'error';
            return true;
          });
        }
        if (f.errorOnly) filtered = filtered.filter(({ r }) => Boolean(r.error) || r.status === 'error');
        if (f.errorCode && f.errorCode !== 'all') {
          filtered = filtered.filter(({ r }) => String(r.error ?? '') === String(f.errorCode) || r.errorDesc === f.errorCode);
        }
        if (f.protocol && f.protocol !== 'all') filtered = filtered.filter(({ r }) => r.protocol === f.protocol);
        if (f.slowOnly) filtered = filtered.filter(({ r }) => (r.duration || 0) > SLOW_REQUEST_MS);

        filtered.sort((a1, a2) => a1.r.startTime - a2.r.startTime);

        const hosts = Array.from(new Set(list.map(x => x.host).filter(Boolean))).sort();
        const protocols = Array.from(new Set(list.map(x => x.r.protocol).filter(Boolean))).sort() as string[];
        const errorCodes = Array.from(new Set(list.map(x => x.r.error).filter(v => v !== undefined).map(v => String(v)))).sort();

        const total = filtered.length;
        const startIndex = (page - 1) * pageSize;
        const slice = filtered.slice(startIndex, startIndex + pageSize);
        const items = slice.map(({ r }) => ({
          id: r.id,
          url: r.url,
          method: r.method,
          startTime: r.startTime,
          endTime: r.endTime,
          duration: r.duration,
          status: r.status,
          statusCode: r.statusCode,
          error: r.error,
          errorDesc: r.errorDesc,
          resolvedIp: r.resolvedIp,
          remoteIp: r.remoteIp,
          protocol: r.protocol,
          timeline: {
            dns: r.timeline?.dns?.duration,
            connect: r.timeline?.connect?.duration,
            ssl: r.timeline?.ssl?.duration,
            send: r.timeline?.send?.duration,
            wait: r.timeline?.wait?.duration,
            download: r.timeline?.download?.duration,
          },
        }));

        const payload: QueryRequestPageResponsePayload = {
          total,
          page,
          pageSize,
          items,
          facets: { hosts, protocols, errorCodes },
        };

        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'query-request-page',
          payload,
          duration,
        });
        break;
      }

      case 'get-request-detail': {
        const a = getStoredAnalysis(msg.payload.analysisId);
        if (a.kind !== 'netlog') throw new Error('get-request-detail only supports netlog analysis');
        const req = a.result.urlRequests.find(r => r.id === msg.payload.requestId);
        if (!req) throw new Error('Request not found');
        const payload: GetRequestDetailResponsePayload = {
          request: {
            id: req.id,
            url: req.url,
            method: req.method,
            startTime: req.startTime,
            endTime: req.endTime,
            duration: req.duration,
            status: req.status,
            statusCode: req.statusCode,
            error: req.error,
            errorDesc: req.errorDesc,
            resolvedIp: req.resolvedIp,
            remoteIp: req.remoteIp,
            protocol: req.protocol,
            timeline: {
              dns: req.timeline?.dns?.duration,
              connect: req.timeline?.connect?.duration,
              ssl: req.timeline?.ssl?.duration,
              send: req.timeline?.send?.duration,
              wait: req.timeline?.wait?.duration,
              download: req.timeline?.download?.duration,
            },
          },
        };
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'get-request-detail',
          payload,
          duration,
        });
        break;
      }

      case 'query-diagnosis-summary': {
        const a = getStoredAnalysis(msg.payload.analysisId);
        if (a.kind !== 'netlog') throw new Error('query-diagnosis-summary only supports netlog analysis');
        const suggestions = generateSuggestions(a.result);
        const summary = buildNetlogDiagnosisSummary(a.result, suggestions, a.events);
        const payload: QueryDiagnosisSummaryResponsePayload = { summary };
        const duration = performance.now() - start;
        sendResponse({
          type: 'success',
          id: msg.id,
          resultType: 'query-diagnosis-summary',
          payload,
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
