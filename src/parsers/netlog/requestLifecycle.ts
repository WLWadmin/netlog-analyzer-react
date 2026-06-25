/**
 * NetLog 请求生命周期分析（基于 source_dependency graph）
 *
 * 目标：
 * - 从 URL_REQUEST 出发，沿 sourceGraph 收集依赖 source 的事件
 * - 将事件粗分为 dns/proxy/tcp/tls/http2/quic/request/response 等阶段
 *
 * 说明：
 * - 该模块是“证据收集/结构化”，不是最终诊断结论生成
 * - 分阶段规则是启发式，允许在后续迭代中补充更精确的 event.typeName 映射
 */

import type { ParsedEvent, URLRequest } from './parser';
import { buildSourceGraph, type SourceGraph } from './sourceGraph';

export type LifecycleStageName =
  | 'dns'
  | 'proxy'
  | 'socket'
  | 'tcp'
  | 'tls'
  | 'http2'
  | 'quic'
  | 'cache'
  | 'request'
  | 'response'
  | 'unknown';

export interface LifecycleStageSummary {
  name: LifecycleStageName;
  label: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  eventCount: number;
  sourceTypes: string[];
  sourceIds: number[];
}

export interface RequestLifecycle {
  requestId: number;
  url: string;
  method: string;
  requestStartTime: number;
  requestEndTime?: number;
  requestDuration?: number;
  relatedSourceIds: number[];
  relatedSourceTypes: string[];
  stages: Record<LifecycleStageName, LifecycleStageSummary>;
}

const STAGE_LABELS: Record<LifecycleStageName, string> = {
  dns: 'DNS',
  proxy: '代理',
  socket: 'Socket/连接池',
  tcp: 'TCP 建连',
  tls: 'TLS 握手',
  http2: 'HTTP/2',
  quic: 'QUIC',
  cache: '缓存',
  request: '请求发送',
  response: '响应接收',
  unknown: '其他',
};

function stageLabel(name: LifecycleStageName): string {
  return STAGE_LABELS[name] || name;
}

function classifyStage(evt: ParsedEvent): LifecycleStageName {
  const st = (evt.source?.typeName || '').toUpperCase();
  const et = (evt.typeName || '').toUpperCase();
  const hay = `${st} ${et}`;

  if (hay.includes('HOST_RESOLVER') || hay.includes('DNS')) return 'dns';
  if (hay.includes('PROXY')) return 'proxy';
  if (hay.includes('SOCKET_POOL')) return 'socket';
  if (hay.includes('SOCKET') || hay.includes('TCP_CONNECT')) return 'tcp';
  if (hay.includes('SSL') || hay.includes('CERT')) return 'tls';
  if (hay.includes('HTTP2') || hay.includes('SPDY')) return 'http2';
  if (hay.includes('QUIC')) return 'quic';
  if (hay.includes('CACHE')) return 'cache';

  // URL_REQUEST 自身事件较多，这里只做粗分类
  if (st === 'URL_REQUEST') {
    if (hay.includes('RESPONSE') || hay.includes('READ') || hay.includes('HEADERS_RECEIVED')) return 'response';
    return 'request';
  }

  return 'unknown';
}

function initStage(name: LifecycleStageName): LifecycleStageSummary {
  return {
    name,
    label: stageLabel(name),
    eventCount: 0,
    sourceTypes: [],
    sourceIds: [],
  };
}

function ensureUnique(arr: string[], v: string) {
  if (!v) return;
  if (!arr.includes(v)) arr.push(v);
}

function ensureUniqueNum(arr: number[], v: number) {
  if (!Number.isFinite(v)) return;
  if (!arr.includes(v)) arr.push(v);
}

/**
 * 计算某个 URL_REQUEST 的“相关 sourceId 集合”
 * 优先使用 sourceGraph.chains（rootId），否则 fallback 到 [requestId]
 */
export function collectRelatedSourceIds(
  events: ParsedEvent[],
  urlRequests: URLRequest[],
  requestId: number
): number[] {
  const graph = buildSourceGraph(events, urlRequests);
  return collectRelatedSourceIdsFromGraph(graph, requestId);
}

export function collectRelatedSourceIdsFromGraph(graph: SourceGraph, requestId: number): number[] {
  const chain = graph.chains.find(c => c.rootId === requestId);
  if (chain && chain.path.length > 0) return chain.path.map(n => n.id);
  return [requestId];
}

export function buildRequestLifecycle(
  events: ParsedEvent[],
  urlRequests: URLRequest[],
  request: URLRequest,
  opts?: {
    /** 由调用方传入，避免重复 buildSourceGraph */
    relatedSourceIds?: number[];
  }
): RequestLifecycle {
  const relatedSourceIds = opts?.relatedSourceIds || collectRelatedSourceIds(events, urlRequests, request.id);
  const relatedSourceIdSet = new Set<number>(relatedSourceIds);

  const stages: Record<LifecycleStageName, LifecycleStageSummary> = {
    dns: initStage('dns'),
    proxy: initStage('proxy'),
    socket: initStage('socket'),
    tcp: initStage('tcp'),
    tls: initStage('tls'),
    http2: initStage('http2'),
    quic: initStage('quic'),
    cache: initStage('cache'),
    request: initStage('request'),
    response: initStage('response'),
    unknown: initStage('unknown'),
  };

  const relatedSourceTypes: string[] = [];

  for (const evt of events) {
    if (!relatedSourceIdSet.has(evt.source.id)) continue;
    ensureUnique(relatedSourceTypes, evt.source.typeName);

    const name = classifyStage(evt);
    const stage = stages[name];
    stage.eventCount += 1;
    if (stage.startTime === undefined || evt.time < stage.startTime) stage.startTime = evt.time;
    if (stage.endTime === undefined || evt.time > stage.endTime) stage.endTime = evt.time;
    ensureUnique(stage.sourceTypes, evt.source.typeName);
    ensureUniqueNum(stage.sourceIds, evt.source.id);
  }

  // 计算各阶段 duration
  (Object.keys(stages) as LifecycleStageName[]).forEach((name) => {
    const s = stages[name];
    if (s.startTime !== undefined && s.endTime !== undefined) {
      s.duration = Math.max(0, s.endTime - s.startTime);
    }
  });

  return {
    requestId: request.id,
    url: request.url,
    method: request.method,
    requestStartTime: request.startTime,
    requestEndTime: request.endTime,
    requestDuration: request.duration,
    relatedSourceIds,
    relatedSourceTypes,
    stages,
  };
}

export function getDominantStage(lifecycle: RequestLifecycle): LifecycleStageSummary | null {
  const list = Object.values(lifecycle.stages)
    .filter(s => s.duration !== undefined && s.duration > 0);
  if (list.length === 0) return null;
  list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return list[0];
}
