import type { DnsIpEvidenceSummary } from '../diagnosis/ipEvidence';
import { createNetlogEndpointEvidenceReducer } from './netlogEndpointEvidenceReducer';
import { createNetlogDnsStateReducer } from './netlogDnsStateReducer';
import { createNetlogProxyStateReducer } from './netlogProxyStateReducer';
import { createNetlogQuicStateReducer } from './netlogQuicStateReducer';
import { createNetlogHttp2StateReducer } from './netlogHttp2StateReducer';
import { canProbeSocketParamsFromEventJson, createNetlogSocketsStateReducer } from './netlogSocketsStateReducer';
import { createNetlogCacheStateReducer } from './netlogCacheStateReducer';
import { createNetlogAltSvcStateReducer } from './netlogAltSvcStateReducer';
import { createNetlogStreamPoolStateReducer } from './netlogStreamPoolStateReducer';
import { createNetlogReportingStateReducer } from './netlogReportingStateReducer';
import { buildNetlogTimelineView } from './netlogTimelineView';
import { createNetlogModulesStateReducer } from './netlogModulesStateReducer';
import { createNetlogPrerenderStateReducer } from './netlogPrerenderStateReducer';
import type { DataLoadedView, DnsStateView, ProxyStateView, QuicStateView, Http2StateView, SocketsStateView, CacheStateView, AltSvcStateView, StreamPoolStateView, ReportingStateView, TimelineStateView, ModulesStateView, PrerenderStateView } from './netlogDatasetViews';
import { isLightweightCountEventName } from './netlogLightweightEvents';
import type { NetlogDatasetParseSkipStats } from './netlogDatasetTypes';
import {
  extractSourceId,
  extractSourceTypeId,
  extractTopLevelNumberLikeField,
  extractTopLevelNumericField,
  hasNetlogErrorMarker,
  hasNetlogSourceDependencyMarker,
} from './netlogEventJsonProbe';

export interface CompactEventIndex {
  count: number;
  time: number[];
  typeId: number[];
  sourceTypeId: number[];
  sourceId: number[];
  phase: number[];
  flags: number[];
  byteStart: number[];
  byteEnd: number[];
  eventTypeNames?: Record<number, string>;
  sourceTypeNames?: Record<number, string>;
  sourceDependencyFrom?: number[];
  sourceDependencyTo?: number[];
  sourceDependencyEventId?: number[];
  sourceUrls?: Record<number, string>;
  sourceHosts?: Record<number, string>;
  sourceErrorCodes?: Record<number, number>;
  sourceFirstEventId?: Record<number, number>;
  sourceLastEventId?: Record<number, number>;
  timeTickOffset?: number;
  topLevelValueRanges?: Record<string, { byteStart: number; byteEnd: number }>;
}

export interface NetlogDatasetIndexResult {
  index: CompactEventIndex;
  parseSkipStats: NetlogDatasetParseSkipStats;
  endpointEvidence: DnsIpEvidenceSummary;
  dataLoaded: DataLoadedView;
  dnsState: DnsStateView;
  proxyState: ProxyStateView;
  quicState: QuicStateView;
  http2State: Http2StateView;
  socketsState: SocketsStateView;
  cacheState: CacheStateView;
  altSvcState: AltSvcStateView;
  streamPoolState: StreamPoolStateView;
  reportingState: ReportingStateView;
  timelineState: TimelineStateView;
  modulesState: ModulesStateView;
  prerenderState: PrerenderStateView;
}

export interface NetlogIndexableFile {
  name?: string;
  size: number;
  stream(): ReadableStream<Uint8Array>;
  slice(start?: number, end?: number): Blob;
}

export interface NetlogCompactEventIndexOptions {
  onTopLevelField?: (key: string, value: unknown) => void;
  onEvent?: (event: unknown, trace: { eventId: number; byteStart: number; byteEnd: number }) => void;
  onLightweightEvent?: (typeId: number, sourceTypeId: number | undefined, trace: { eventId: number; byteStart: number; byteEnd: number; typeName: string }) => void;
}

const QUOTE = 34;
const BACKSLASH = 92;
const LEFT_BRACE = 123;
const RIGHT_BRACE = 125;
const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const COLON = 58;
const COMMA = 44;

function isWhitespaceByte(byte: number): boolean {
  return byte === 32 || byte === 10 || byte === 13 || byte === 9;
}

function decodeAscii(bytes: number[]): string {
  return String.fromCharCode(...bytes);
}

function emptyIndex(): CompactEventIndex {
  return {
    count: 0,
    time: [],
    typeId: [],
    sourceTypeId: [],
    sourceId: [],
    phase: [],
    flags: [],
    byteStart: [],
    byteEnd: [],
    eventTypeNames: {},
    sourceTypeNames: {},
    sourceDependencyFrom: [],
    sourceDependencyTo: [],
    sourceDependencyEventId: [],
    sourceUrls: {},
    sourceHosts: {},
    sourceErrorCodes: {},
    sourceFirstEventId: {},
    sourceLastEventId: {},
    topLevelValueRanges: {},
  };
}

function extractSourceIdFromObject(value: Record<string, unknown>): number | undefined {
  const id = Number(value.id ?? value.source_id ?? value.sourceId);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function extractDependencySourceIds(params: Record<string, unknown> | undefined): number[] {
  if (!params || typeof params !== 'object') return [];
  const roots = [
    params.source_dependency,
    params.sourceDependency,
    params.source_dependencies,
    params.sourceDependencies,
    params.dependencies,
  ].filter(value => value !== undefined);
  const ids = new Set<number>();
  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const value = node as Record<string, unknown>;
    const id = extractSourceIdFromObject(value);
    if (id) ids.add(id);
    [
      value.source_dependency,
      value.sourceDependency,
      value.source_dependencies,
      value.sourceDependencies,
      value.dependency,
      value.dependencies,
      value.source,
    ].filter(item => item !== undefined).forEach(item => visit(item, depth + 1));
  };
  roots.forEach(root => visit(root));
  return Array.from(ids);
}

function buildReverseNameMap(raw: unknown): Record<number, string> {
  const result: Record<number, string> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number') {
      result[value] = name;
    } else if (/^\d+$/.test(name) && typeof value === 'string') {
      result[Number(name)] = value;
    }
  }
  return result;
}

function extractUrlFromParams(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  for (const key of ['url', 'request_url', 'requestUrl', 'original_url', 'originalUrl']) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function extractErrorCode(params: Record<string, unknown> | undefined): number | undefined {
  const value = params?.net_error ?? params?.error_code;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function applyConstants(index: CompactEventIndex, constants: unknown) {
  if (!constants || typeof constants !== 'object') return;
  const value = constants as Record<string, unknown>;
  index.eventTypeNames = buildReverseNameMap(value.logEventTypes || value.eventTypes);
  index.sourceTypeNames = buildReverseNameMap(value.logSourceType || value.sourceTypes || value.logSourceTypes);
  const timeTickOffset = Number(value.timeTickOffset);
  if (Number.isFinite(timeTickOffset)) index.timeTickOffset = timeTickOffset;
}

function pushEvent(index: CompactEventIndex, event: any, byteStart: number, byteEnd: number) {
  const sourceId = Number(event?.source?.id ?? event?.source_id) || 0;
  const eventId = index.count;
  index.count += 1;
  index.time.push(Number(event?.time) || 0);
  index.typeId.push(Number(event?.type) || 0);
  index.sourceTypeId.push(Number(event?.source?.type ?? event?.source_type) || 0);
  index.sourceId.push(sourceId);
  index.phase.push(Number(event?.phase) || 0);
  index.flags.push(event?.params?.net_error || event?.params?.error_code ? 1 : 0);
  index.byteStart.push(byteStart);
  index.byteEnd.push(byteEnd);
  if (sourceId > 0) {
    if (index.sourceFirstEventId?.[sourceId] === undefined) index.sourceFirstEventId![sourceId] = eventId;
    index.sourceLastEventId![sourceId] = eventId;
    const url = extractUrlFromParams(event?.params);
    if (url && !index.sourceUrls?.[sourceId]) {
      index.sourceUrls![sourceId] = url;
      const host = hostFromUrl(url);
      if (host) index.sourceHosts![sourceId] = host;
    }
    const errorCode = extractErrorCode(event?.params);
    if (errorCode !== undefined) index.sourceErrorCodes![sourceId] = errorCode;
  }
  for (const dependencySourceId of extractDependencySourceIds(event?.params)) {
    if (sourceId > 0 && dependencySourceId > 0) {
      index.sourceDependencyFrom?.push(sourceId);
      index.sourceDependencyTo?.push(dependencySourceId);
      index.sourceDependencyEventId?.push(eventId);
    }
  }
}

function pushProbedEvent(
  index: CompactEventIndex,
  fields: { time?: number; typeId: number; sourceTypeId?: number; sourceId?: number; phase?: number; hasError?: boolean; errorCode?: number },
  byteStart: number,
  byteEnd: number
) {
  const eventId = index.count;
  index.count += 1;
  index.time.push(fields.time || 0);
  index.typeId.push(fields.typeId || 0);
  index.sourceTypeId.push(fields.sourceTypeId || 0);
  index.sourceId.push(fields.sourceId || 0);
  index.phase.push(fields.phase || 0);
  index.flags.push(fields.hasError ? 1 : 0);
  index.byteStart.push(byteStart);
  index.byteEnd.push(byteEnd);
  const sourceId = fields.sourceId || 0;
  if (sourceId > 0) {
    if (index.sourceFirstEventId?.[sourceId] === undefined) index.sourceFirstEventId![sourceId] = eventId;
    index.sourceLastEventId![sourceId] = eventId;
    if (fields.errorCode !== undefined) index.sourceErrorCodes![sourceId] = fields.errorCode;
  }
}

function hasErrorParams(event: any): boolean {
  const params = event?.params;
  return Boolean(params?.net_error || params?.error_code);
}

function eventName(index: CompactEventIndex, typeId: number): string {
  return index.eventTypeNames?.[typeId] || `UNKNOWN_${typeId}`;
}

function sourceTypeName(index: CompactEventIndex, sourceTypeId: number): string {
  return index.sourceTypeNames?.[sourceTypeId] || (sourceTypeId ? `UNKNOWN_SRC_${sourceTypeId}` : 'UNKNOWN_SRC');
}

function isSocketEarlyReducerCandidate(typeName: string, sourceType: string): boolean {
  const upperType = typeName.toUpperCase();
  const upperSource = sourceType.toUpperCase();
  if (
    upperType.includes('STREAM_POOL') ||
    upperSource.includes('STREAM_POOL') ||
    upperType.includes('SOCKET_POOL') ||
    upperSource.includes('SOCKET_POOL')
  ) return false;
  return upperType.includes('SOCKET') ||
    upperSource.includes('SOCKET') ||
    upperType.startsWith('TCP_') ||
    upperType.startsWith('UDP_') ||
    upperType.startsWith('SSL_') ||
    upperType.startsWith('TLS_');
}

function extractJsonObjectBlock(json: string, key: string): string | undefined {
  const keyIndex = json.indexOf(`"${key}"`);
  if (keyIndex < 0) return undefined;
  const colonIndex = json.indexOf(':', keyIndex);
  if (colonIndex < 0) return undefined;
  let start = colonIndex + 1;
  while (start < json.length && /\s/.test(json[start])) start += 1;
  if (json[start] !== '{') return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < json.length; i += 1) {
    const ch = json[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return json.slice(start, i + 1);
    }
  }
  return undefined;
}

function extractProbedDependencySourceIds(eventJson: string): number[] {
  const paramsBlock = extractJsonObjectBlock(eventJson, 'params');
  if (!paramsBlock) return [];
  const hasDependencyLikeShape = hasNetlogSourceDependencyMarker(eventJson) || /"source"\s*:/.test(paramsBlock);
  if (!hasDependencyLikeShape) return [];
  const ids = new Set<number>();
  const matches = paramsBlock.matchAll(/"(?:id|source_id|sourceId)"\s*:\s*(\d+)/g);
  for (const match of matches) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return Array.from(ids);
}

function extractProbedErrorCode(eventJson: string): number | undefined {
  const paramsBlock = extractJsonObjectBlock(eventJson, 'params');
  if (!paramsBlock) return undefined;
  const match = paramsBlock.match(/"(?:net_error|error_code)"\s*:\s*(-?\d+)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function hasSocketDependencyLikeShape(eventJson: string): boolean {
  const paramsBlock = extractJsonObjectBlock(eventJson, 'params');
  if (!paramsBlock) return false;
  return hasNetlogSourceDependencyMarker(eventJson) ||
    /"source"\s*:/.test(paramsBlock) ||
    /"(?:source_id|sourceId|parent_source_id|parentSourceId|url_request_source_id|urlRequestSourceId|request_source_id|requestSourceId|stream_source_id|streamSourceId|socket_source_id|socketSourceId|connect_job_source_id|connectJobSourceId|job_source_id|jobSourceId)"\s*:/.test(paramsBlock);
}

function topCounts(ids: number[], names: Record<number, string> | undefined): Array<{ name: string; count: number }> {
  const counts = new Map<number, number>();
  ids.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([id, count]) => ({ name: names?.[id] || String(id), count }));
}

function buildDataLoadedView(file: NetlogIndexableFile, index: CompactEventIndex, topLevelKeys: Set<string>): DataLoadedView {
  const hasConstants = topLevelKeys.has('constants');
  const view: DataLoadedView = {
    fileName: file.name || 'netlog.json',
    fileSize: file.size,
    eventCount: index.count,
    hasConstants,
    hasPolledData: topLevelKeys.has('polledData'),
    hasSystemInfo: topLevelKeys.has('systemInfo'),
    hasClientInfo: topLevelKeys.has('clientInfo'),
    hasNetLogInfo: topLevelKeys.has('netLogInfo'),
    eventTypeCount: Object.keys(index.eventTypeNames || {}).length,
    sourceTypeCount: Object.keys(index.sourceTypeNames || {}).length,
    topEventTypes: topCounts(index.typeId, index.eventTypeNames),
    topSourceTypes: topCounts(index.sourceTypeId, index.sourceTypeNames),
    evidenceGaps: [],
  };
  if (!view.hasPolledData) view.evidenceGaps.push('未发现 polledData，DNS server、代理配置和系统网络配置可能缺失。');
  if (!view.hasSystemInfo) view.evidenceGaps.push('未发现 systemInfo，操作系统和系统网络环境信息不可用。');
  if (!view.hasClientInfo) view.evidenceGaps.push('未发现 clientInfo，浏览器客户端版本和平台信息可能缺失。');
  if (!view.hasNetLogInfo) view.evidenceGaps.push('未发现 netLogInfo，NetLog 采集元信息可能缺失。');
  if (!hasConstants) view.evidenceGaps.push('未发现 constants，事件和 source 名称只能使用 fallback 映射。');
  return view;
}

export async function readNetlogEventDetail(file: NetlogIndexableFile, index: CompactEventIndex, eventId: number): Promise<unknown> {
  const start = index.byteStart[eventId];
  const end = index.byteEnd[eventId];
  if (start === undefined || end === undefined) {
    throw new Error(`NetLog eventId 不存在：${eventId}`);
  }
  const text = await file.slice(start, end).text();
  return JSON.parse(text);
}

export async function readNetlogTopLevelValue(file: NetlogIndexableFile, index: CompactEventIndex, key: string): Promise<unknown> {
  const range = index.topLevelValueRanges?.[key];
  if (!range) {
    throw new Error(`NetLog 顶层字段不存在或未建立 byte range：${key}`);
  }
  const text = await file.slice(range.byteStart, range.byteEnd).text();
  return JSON.parse(text);
}

export async function buildNetlogCompactEventIndex(
  file: NetlogIndexableFile,
  options: NetlogCompactEventIndexOptions = {}
): Promise<NetlogDatasetIndexResult> {
  const index = emptyIndex();
  const parseSkipStats: NetlogDatasetParseSkipStats = {
    lightweightParseSkippedEvents: 0,
    lightweightParseSkippedBytes: 0,
    socketParseSkippedEvents: 0,
    socketParseSkippedBytes: 0,
  };
  const endpointReducer = createNetlogEndpointEvidenceReducer();
  const dnsStateReducer = createNetlogDnsStateReducer();
  const proxyStateReducer = createNetlogProxyStateReducer();
  const quicStateReducer = createNetlogQuicStateReducer();
  const http2StateReducer = createNetlogHttp2StateReducer();
  const socketsStateReducer = createNetlogSocketsStateReducer();
  const cacheStateReducer = createNetlogCacheStateReducer();
  const altSvcStateReducer = createNetlogAltSvcStateReducer();
  const streamPoolStateReducer = createNetlogStreamPoolStateReducer();
  const reportingStateReducer = createNetlogReportingStateReducer();
  const modulesStateReducer = createNetlogModulesStateReducer();
  const prerenderStateReducer = createNetlogPrerenderStateReducer();
  const topLevelKeys = new Set<string>();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();

  let absoluteByteOffset = 0;
  let mode: 'before-root' | 'find-key' | 'after-key' | 'after-colon' | 'skip-value' | 'in-events-array' | 'done' = 'before-root';
  let readingKey = false;
  let keyEscape = false;
  let keyBytes: number[] = [];
  let pendingKey = '';
  let pendingTargetKey = false;
  let skipStarted = false;
  let skipValueStart = -1;
  let skipValueEnd = -1;
  let skipDepth = 0;
  let skipInString = false;
  let skipEscape = false;
  let skipValueBytes: number[] | null = null;
  let objectDepth = 0;
  let objectInString = false;
  let objectEscape = false;
  let objectStart = -1;
  let objectBytes: number[] = [];

  const resetSkip = () => {
    skipStarted = false;
    skipValueStart = -1;
    skipValueEnd = -1;
    skipDepth = 0;
    skipInString = false;
    skipEscape = false;
    skipValueBytes = ['constants', 'polledData', 'systemInfo'].includes(pendingKey) ? [] : null;
  };

  const finishSkippedValue = () => {
    if (skipValueStart >= 0 && skipValueEnd >= skipValueStart) {
      index.topLevelValueRanges![pendingKey] = {
        byteStart: skipValueStart,
        byteEnd: skipValueEnd,
      };
    }
    if (!skipValueBytes) return;
    try {
      const value = JSON.parse(decoder.decode(new Uint8Array(skipValueBytes)));
      if (pendingKey === 'constants') applyConstants(index, value);
      if (pendingKey === 'polledData' || pendingKey === 'systemInfo') {
        dnsStateReducer.acceptTopLevelConfig(pendingKey, value);
        proxyStateReducer.acceptTopLevelConfig(pendingKey, pendingKey, value);
      }
      options.onTopLevelField?.(pendingKey, value);
    } catch {
      // constants 解析失败不影响事件索引
    } finally {
      skipValueBytes = null;
    }
  };

  const appendSkipByte = (byte: number, byteOffset: number) => {
    if (skipValueStart < 0) skipValueStart = byteOffset;
    skipValueEnd = byteOffset + 1;
    if (skipValueBytes !== null) {
      skipValueBytes.push(byte);
    }
  };

  const removeLastSkipByte = (byteOffset: number) => {
    skipValueEnd = byteOffset;
    if (skipValueBytes !== null) {
      skipValueBytes.pop();
    }
  };

  const finishObject = async (byteEnd: number) => {
    const eventJson = decoder.decode(new Uint8Array(objectBytes));
    const probedTypeId = extractTopLevelNumericField(eventJson, 'type');
    if (probedTypeId !== undefined) {
      const probedTypeName = eventName(index, probedTypeId);
      const probedSourceTypeId = extractSourceTypeId(eventJson);
      const probedSourceTypeName = sourceTypeName(index, probedSourceTypeId || 0);
      const probedHasError = hasNetlogErrorMarker(eventJson);
      const probedHasDependency = hasNetlogSourceDependencyMarker(eventJson);
      if (isLightweightCountEventName(probedTypeName) && !probedHasError && !probedHasDependency) {
        const sourceId = extractSourceId(eventJson);
        const eventId = index.count;
        pushProbedEvent(index, {
          time: extractTopLevelNumberLikeField(eventJson, 'time'),
          typeId: probedTypeId,
          sourceTypeId: probedSourceTypeId,
          sourceId,
          phase: extractTopLevelNumericField(eventJson, 'phase'),
          hasError: false,
        }, objectStart, byteEnd);
        options.onLightweightEvent?.(probedTypeId, probedSourceTypeId, {
          eventId,
          byteStart: objectStart,
          byteEnd,
          typeName: probedTypeName,
        });
        parseSkipStats.lightweightParseSkippedEvents += 1;
        parseSkipStats.lightweightParseSkippedBytes += eventJson.length;
        objectBytes = [];
        objectStart = -1;
        return;
      }
      if (
        isSocketEarlyReducerCandidate(probedTypeName, probedSourceTypeName) &&
        canProbeSocketParamsFromEventJson(eventJson) &&
        !hasSocketDependencyLikeShape(eventJson)
      ) {
        const eventId = index.count;
        const sourceId = extractSourceId(eventJson) || 0;
        const byteStart = objectStart;
        const dependencySourceIds = extractProbedDependencySourceIds(eventJson);
        pushProbedEvent(index, {
          time: extractTopLevelNumberLikeField(eventJson, 'time'),
          typeId: probedTypeId,
          sourceTypeId: probedSourceTypeId,
          sourceId,
          phase: extractTopLevelNumericField(eventJson, 'phase'),
          hasError: probedHasError,
          errorCode: extractProbedErrorCode(eventJson),
        }, objectStart, byteEnd);
        for (const dependencySourceId of dependencySourceIds) {
          if (sourceId > 0 && dependencySourceId > 0 && sourceId !== dependencySourceId) {
            index.sourceDependencyFrom?.push(sourceId);
            index.sourceDependencyTo?.push(dependencySourceId);
            index.sourceDependencyEventId?.push(eventId);
          }
        }
        const socketSeed = {
          eventId,
          byteStart,
          byteEnd,
          time: extractTopLevelNumberLikeField(eventJson, 'time') || 0,
          typeName: probedTypeName,
          sourceId,
          sourceTypeName: probedSourceTypeName,
          phase: extractTopLevelNumericField(eventJson, 'phase') || 0,
          params: undefined,
          eventJson,
        };
        endpointReducer.accept(socketSeed);
        socketsStateReducer.accept({
          ...socketSeed,
          earlyPath: true,
        });
        parseSkipStats.socketParseSkippedEvents = (parseSkipStats.socketParseSkippedEvents || 0) + 1;
        parseSkipStats.socketParseSkippedBytes = (parseSkipStats.socketParseSkippedBytes || 0) + eventJson.length;
        objectBytes = [];
        objectStart = -1;
        return;
      }
    }
    const event = JSON.parse(eventJson);
    const eventId = index.count;
    pushEvent(index, event, objectStart, byteEnd);
    const typeId = Number(event?.type) || 0;
    const sourceTypeId = Number(event?.source?.type ?? event?.source_type) || 0;
    const typeName = eventName(index, typeId);
    const dependencySourceIds = extractDependencySourceIds(event?.params);
    const shouldUseLightweightGate = isLightweightCountEventName(typeName) &&
      !hasErrorParams(event) &&
      dependencySourceIds.length === 0;
    if (shouldUseLightweightGate) {
      options.onLightweightEvent?.(typeId, sourceTypeId || undefined, {
        eventId,
        byteStart: objectStart,
        byteEnd,
        typeName,
      });
      objectBytes = [];
      objectStart = -1;
      return;
    }
    options.onEvent?.(event, { eventId, byteStart: objectStart, byteEnd });
    const seed = {
      eventId,
      byteStart: objectStart,
      byteEnd,
      time: Number(event?.time) || 0,
      typeName,
      sourceId: Number(event?.source?.id ?? event?.source_id) || 0,
      sourceTypeName: sourceTypeName(index, sourceTypeId),
      phase: Number(event?.phase) || 0,
      params: event?.params,
      eventJson,
    };
    endpointReducer.accept(seed);
    dnsStateReducer.accept(seed);
    proxyStateReducer.accept(seed);
    quicStateReducer.accept(seed);
    http2StateReducer.accept(seed);
    socketsStateReducer.accept(seed);
    cacheStateReducer.accept(seed);
    altSvcStateReducer.accept(seed);
    streamPoolStateReducer.accept(seed);
    reportingStateReducer.accept(seed);
    modulesStateReducer.accept(seed);
    prerenderStateReducer.accept(seed);
    objectBytes = [];
    objectStart = -1;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = value || new Uint8Array();
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      const byteOffset = absoluteByteOffset + i;

      if (mode === 'done') continue;

      if (mode === 'before-root') {
        if (isWhitespaceByte(byte)) continue;
        if (byte === LEFT_BRACE) {
          mode = 'find-key';
          continue;
        }
        if (byte === LEFT_BRACKET) {
          mode = 'in-events-array';
          continue;
        }
        throw new Error('NetLog JSON 格式异常：根节点不是对象或数组');
      }

      if (mode === 'find-key') {
        if (readingKey) {
          if (keyEscape) {
            keyBytes.push(byte);
            keyEscape = false;
          } else if (byte === BACKSLASH) {
            keyEscape = true;
          } else if (byte === QUOTE) {
            readingKey = false;
            pendingKey = decodeAscii(keyBytes);
            topLevelKeys.add(pendingKey);
            pendingTargetKey = pendingKey === 'events' || pendingKey === 'logEvents';
            keyBytes = [];
            mode = 'after-key';
          } else {
            keyBytes.push(byte);
          }
          continue;
        }
        if (isWhitespaceByte(byte) || byte === COMMA) continue;
        if (byte === RIGHT_BRACE) {
          mode = 'done';
          continue;
        }
        if (byte === QUOTE) {
          readingKey = true;
          keyBytes = [];
        }
        continue;
      }

      if (mode === 'after-key') {
        if (isWhitespaceByte(byte)) continue;
        if (byte !== COLON) throw new Error(`NetLog 顶层字段 ${pendingKey} 缺少冒号`);
        if (pendingTargetKey) {
          mode = 'after-colon';
        } else {
          mode = 'skip-value';
          resetSkip();
        }
        continue;
      }

      if (mode === 'after-colon') {
        if (isWhitespaceByte(byte)) continue;
        if (byte !== LEFT_BRACKET) throw new Error('NetLog events/logEvents 字段格式异常：不是数组');
        mode = 'in-events-array';
        continue;
      }

      if (mode === 'skip-value') {
        if (!skipStarted) {
          if (isWhitespaceByte(byte)) continue;
          skipStarted = true;
          appendSkipByte(byte, byteOffset);
          if (byte === QUOTE) {
            skipInString = true;
            continue;
          }
          if (byte === LEFT_BRACE || byte === LEFT_BRACKET) {
            skipDepth = 1;
            continue;
          }
          if (byte === COMMA) {
            finishSkippedValue();
            mode = 'find-key';
            continue;
          }
          if (byte === RIGHT_BRACE) {
            finishSkippedValue();
            mode = 'done';
            continue;
          }
          continue;
        }
        appendSkipByte(byte, byteOffset);
        if (skipInString) {
          if (skipEscape) skipEscape = false;
          else if (byte === BACKSLASH) skipEscape = true;
          else if (byte === QUOTE) skipInString = false;
          continue;
        }
        if (byte === QUOTE) {
          skipInString = true;
          continue;
        }
        if (byte === LEFT_BRACE || byte === LEFT_BRACKET) {
          skipDepth++;
          continue;
        }
        if (byte === RIGHT_BRACE || byte === RIGHT_BRACKET) {
          if (skipDepth > 0) {
            skipDepth--;
            if (skipDepth === 0) finishSkippedValue();
            continue;
          }
          finishSkippedValue();
          mode = 'done';
          continue;
        }
        if (skipDepth === 0 && byte === COMMA) {
          removeLastSkipByte(byteOffset);
          finishSkippedValue();
          mode = 'find-key';
        }
        continue;
      }

      if (mode === 'in-events-array') {
        if (objectDepth === 0) {
          if (isWhitespaceByte(byte) || byte === COMMA) continue;
          if (byte === RIGHT_BRACKET) {
            mode = 'done';
            continue;
          }
          if (byte !== LEFT_BRACE) continue;
          objectStart = byteOffset;
          objectDepth = 1;
          objectInString = false;
          objectEscape = false;
          objectBytes = [byte];
          continue;
        }

        objectBytes.push(byte);
        if (objectInString) {
          if (objectEscape) objectEscape = false;
          else if (byte === BACKSLASH) objectEscape = true;
          else if (byte === QUOTE) objectInString = false;
          continue;
        }
        if (byte === QUOTE) {
          objectInString = true;
          continue;
        }
        if (byte === LEFT_BRACE) objectDepth++;
        else if (byte === RIGHT_BRACE) {
          objectDepth--;
          if (objectDepth === 0) {
            await finishObject(byteOffset + 1);
          }
        }
      }
    }
    absoluteByteOffset += chunk.length;
  }

  return {
    index,
    parseSkipStats,
    endpointEvidence: endpointReducer.finish(),
    dataLoaded: buildDataLoadedView(file, index, topLevelKeys),
    dnsState: dnsStateReducer.finish(),
    proxyState: proxyStateReducer.finish(),
    quicState: quicStateReducer.finish(),
    http2State: http2StateReducer.finish(),
    socketsState: socketsStateReducer.finish(),
    cacheState: cacheStateReducer.finish(),
    altSvcState: altSvcStateReducer.finish(),
    streamPoolState: streamPoolStateReducer.finish(),
    reportingState: reportingStateReducer.finish(),
    timelineState: buildNetlogTimelineView(index),
    modulesState: modulesStateReducer.finish(),
    prerenderState: prerenderStateReducer.finish(),
  };
}
