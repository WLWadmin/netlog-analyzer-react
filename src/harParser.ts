// ============================================================
// HAR (HTTP Archive) Parser
// 独立于 NetLog 解析逻辑，将 DevTools 导出的 .har 文件解析为
// 可视化所需的结构化数据。
// ============================================================

import {
  assertNoCompetingRootFormat,
  isRecord,
} from './parsers/shared/rootFormatGuard';

export interface HarTiming {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

export interface HarChromeTimingEvidence {
  blockedQueueingMs?: number;
  blockedProxyMs?: number;
  workerStartMs?: number;
  workerReadyMs?: number;
  workerFetchStartMs?: number;
  workerRespondWithSettledMs?: number;
}

export type HarTimingPhaseKey =
  | 'blocked'
  | 'dns'
  | 'connect'
  | 'ssl'
  | 'send'
  | 'wait'
  | 'receive';

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarServerTiming {
  name: string;
  dur?: number;
  desc?: string;
}

export type HarCategory = 'xhr' | 'doc' | 'css' | 'js' | 'font' | 'img' | 'media' | 'other';

export interface HarQueryParam {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType: string;
  text: string;
  params?: { name: string; value: string }[];
}

export interface HarCookie {
  name: string;
  value?: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  comment?: string;
}

export interface HarInitiatorFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface HarInitiatorInfo {
  type?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  requestId?: string;
  stack?: HarInitiatorFrame[];
}

export interface HarRedirectInfo {
  redirectURL?: string;
  location?: string;
  status?: number;
}

export type HarCacheSource = 'disk' | 'memory' | 'service-worker' | 'prefetch';

export interface HarCacheInfo {
  cacheControl?: string;
  etag?: string;
  age?: string;
  expires?: string;
  lastModified?: string;
  fromDiskCache?: boolean;
  fromMemoryCache?: boolean;
  fromServiceWorker?: boolean;
  fromPrefetchCache?: boolean;
  fromCache?: boolean;
  status304?: boolean;
  source?: HarCacheSource;
  sourceRecorded?: boolean;
  rawSource?: string;
}

export interface HarConnectionInfo {
  connectionId?: string;
  harConnection?: string;
  remoteAddress?: string;
  protocol?: string;
}

export interface HarSizeInfo {
  transferSize: number;
  resourceSize: number;
  requestHeadersSize?: number;
  requestBodySize?: number;
  responseHeadersSize?: number;
  responseBodySize?: number;
}

export type HarResponseBodyState = 'inline' | 'deferred' | 'absent';

export interface HarResponseBodyDescriptor {
  state: HarResponseBodyState;
  originalLength: number;
  encoding?: string;
  mimeType?: string;
}

export interface HarPageMarker {
  pageId?: string;
  title?: string;
  startedDateTime?: string;
  startMs?: number;
  domContentLoadedMs?: number;
  loadMs?: number;
}

export interface HarRequestEntry {
  id: number;
  name: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  protocol: string;
  domain: string;
  remoteAddress: string;
  connectionId?: string;
  category: HarCategory;
  rawType: string;
  mimeType: string;
  size: number; // 传输大小（字节）
  contentSize: number; // 解压后内容大小
  time: number; // 总耗时 ms
  startedDateTime: string;
  startMs: number;
  pageRef?: string;
  timings: HarTiming;
  timingAvailability?: Partial<Record<HarTimingPhaseKey, boolean>>;
  chromeTiming?: HarChromeTimingEvidence;
  requestHeaders: HarHeader[];
  responseHeaders: HarHeader[];
  responseBody: string;
  responseBodyDescriptor?: HarResponseBodyDescriptor;
  responseBodyOmitted?: boolean;
  responseBodyOriginalLength?: number;
  responseBodyOmitReason?: string;
  responseEncoding: string;
  queryString: HarQueryParam[];
  postData?: HarPostData;
  initiator?: HarInitiatorInfo;
  redirect?: HarRedirectInfo;
  requestCookies?: HarCookie[];
  responseCookies?: HarCookie[];
  priority?: string;
  cacheInfo?: HarCacheInfo;
  connectionInfo?: HarConnectionInfo;
  sizeInfo?: HarSizeInfo;
  // 关键诊断字段
  serverTiming: HarServerTiming[];
  failureText?: string;
  netErrorText?: string;
  netErrorCode?: number;
  blockedReason?: string;
  issueSummary?: string;
  primaryTimingPhase?: HarTimingPhaseKey;
  primaryTimingMs?: number;
  xTtLogid: string;
  xTtCip: string;
  xLscSourceIp: string;
  isFailed: boolean;
  isSlow: boolean;
}

export interface HarAnalysisResult {
  entries: HarRequestEntry[];
  totalRequests: number;
  failedCount: number;
  slowCount: number;
  totalSize: number;
  totalTime: number;
  creator: string;
  typeCounts: Record<HarCategory, number>;
  pageMarkers?: HarPageMarker[];
  /** 响应体保留策略，用于解释大 HAR 的内存降峰行为 */
  bodyRetention: {
    mode: 'full' | 'optimized';
    omittedCount: number;
    omittedBytes: number;
    reason?: string;
  };
  /** HAR 修复信息（如果文件经过自动修复） */
  repairInfo?: {
    repaired: boolean;
    recoveredEntries: number;
    totalEntries: number;
    droppedEntries: number;
    recoveryRate: number;
    reason: string;
    warnings: string[];
  };
}

// 慢请求阈值（毫秒）
export const HAR_SLOW_THRESHOLD_MS = 1000;

const HAR_BODY_TOTAL_OPTIMIZE_THRESHOLD = 8 * 1024 * 1024;
const HAR_BODY_KEEP_SMALL_THRESHOLD = 100 * 1024;
const HAR_BODY_KEEP_JSON_THRESHOLD = 512 * 1024;

interface HarParseOptions {
  optimizeResponseBodies: boolean;
}

// 判断是否为 HAR 文件
export function isHarFile(data: any): boolean {
  return !!(data && data.log && Array.isArray(data.log.entries));
}

// 大小格式化
export function formatBytes(bytes: number): string {
  if (bytes === undefined || bytes === null || bytes < 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return (idx === 0 ? val.toFixed(0) : val.toFixed(1)) + ' ' + units[idx];
}

// 耗时格式化
export function formatHarTime(ms: number): string {
  if (ms === undefined || ms === null || ms < 0) return '-';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return Math.round(ms) + ' ms';
  return (ms / 1000).toFixed(2) + ' s';
}

// 大小写不敏感地读取 header
export function getHeader(headers: HarHeader[], name: string): string {
  const lower = name.toLowerCase();
  const hit = headers.find(h => (h.name || '').toLowerCase() === lower);
  return hit ? hit.value : '';
}

// 归一化资源类型
function normalizeCategory(resourceType: string, mimeType: string): HarCategory {
  const rt = (resourceType || '').toLowerCase();
  const mt = (mimeType || '').toLowerCase();
  if (rt === 'xhr' || rt === 'fetch') return 'xhr';
  if (rt === 'document' || rt === 'doc') return 'doc';
  if (rt === 'stylesheet' || rt === 'css') return 'css';
  if (rt === 'script' || rt === 'js') return 'js';
  if (rt === 'font') return 'font';
  if (rt === 'image' || rt === 'img') return 'img';
  if (rt === 'media') return 'media';
  // 根据 mimeType 兜底推断
  if (mt) {
    if (mt.includes('json') || mt.includes('xml')) return 'xhr';
    if (mt.includes('html')) return 'doc';
    if (mt.includes('css')) return 'css';
    if (mt.includes('javascript') || mt.includes('ecmascript')) return 'js';
    if (mt.includes('font')) return 'font';
    if (mt.startsWith('image/')) return 'img';
    if (mt.startsWith('video/') || mt.startsWith('audio/')) return 'media';
  }
  return 'other';
}

// 归一化协议
function normalizeProtocol(httpVersion: string): string {
  const v = (httpVersion || '').toLowerCase();
  if (!v || v === 'unknown') return '-';
  if (v.includes('h3') || v.includes('http/3') || v.includes('quic')) return 'h3';
  if (v.includes('h2') || v.includes('http/2')) return 'h2';
  if (v.includes('1.1')) return 'http/1.1';
  if (v.includes('1.0')) return 'http/1.0';
  return httpVersion;
}

// 从 URL 中提取域名与文件名
function parseUrlParts(url: string): { domain: string; name: string } {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const lastSegment = segs.length ? segs[segs.length - 1] : '';
    const pathName = lastSegment && u.pathname.endsWith('/') ? `${lastSegment}/` : lastSegment;
    const name = pathName
      ? `${pathName}${u.search}`
      : u.search || u.hostname || '/';
    return { domain: u.hostname, name };
  } catch {
    return { domain: '-', name: url.slice(0, 80) };
  }
}

// 解析 Server-Timing 头
function parseServerTiming(value: string): HarServerTiming[] {
  if (!value) return [];
  const result: HarServerTiming[] = [];
  for (const part of value.split(',')) {
    const segs = part.split(';').map(s => s.trim()).filter(Boolean);
    if (!segs.length) continue;
    const item: HarServerTiming = { name: segs[0] };
    for (let i = 1; i < segs.length; i++) {
      const eq = segs[i].indexOf('=');
      if (eq < 0) continue;
      const k = segs[i].slice(0, eq).trim().toLowerCase();
      let v = segs[i].slice(eq + 1).trim().replace(/^"|"$/g, '');
      if (k === 'dur') item.dur = parseFloat(v);
      else if (k === 'desc') item.desc = v;
    }
    result.push(item);
  }
  return result;
}

function num(v: any): number {
  const n = Number(v);
  return isNaN(n) || n < 0 ? 0 : n;
}

function isAvailableTiming(v: any): boolean {
  return typeof v === 'number' && v >= 0;
}

function firstNonEmptyString(values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstFiniteNumber(values: any[]): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n < 0) return n;
  }
  return undefined;
}

function optionalString(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function optionalRawString(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function optionalNumber(value: any): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalBoolean(value: any): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNonNegativeNumber(value: any): number | undefined {
  const n = optionalNumber(value);
  return n !== undefined && n >= 0 ? n : undefined;
}

function mergeOptionalBoolean(...values: any[]): boolean | undefined {
  const booleans = values.filter((value): value is boolean => typeof value === 'boolean');
  if (booleans.some(Boolean)) return true;
  if (booleans.length > 0) return false;
  return undefined;
}

function parseChromeTimingEvidence(timings: any): HarChromeTimingEvidence | undefined {
  const evidence: HarChromeTimingEvidence = {
    blockedQueueingMs: optionalNonNegativeNumber(timings?._blocked_queueing),
    blockedProxyMs: optionalNonNegativeNumber(timings?._blocked_proxy),
    workerStartMs: optionalNonNegativeNumber(timings?._workerStart),
    workerReadyMs: optionalNonNegativeNumber(timings?._workerReady),
    workerFetchStartMs: optionalNonNegativeNumber(timings?._workerFetchStart),
    workerRespondWithSettledMs: optionalNonNegativeNumber(timings?._workerRespondWithSettled),
  };
  return Object.values(evidence).some(v => v !== undefined) ? evidence : undefined;
}

function parseCacheSource(raw: any): { source?: HarCacheSource; rawSource?: string } {
  const rawSource = optionalString(raw);
  if (!rawSource) return {};
  const normalized = rawSource.toLowerCase().replace(/[\s_]+/g, '-');
  if (normalized === 'disk') return { source: 'disk', rawSource };
  if (normalized === 'memory') return { source: 'memory', rawSource };
  if (normalized === 'service-worker' || normalized === 'serviceworker') return { source: 'service-worker', rawSource };
  if (normalized === 'prefetch') return { source: 'prefetch', rawSource };
  return { rawSource };
}

function pickCacheSource(cacheInfo: Pick<HarCacheInfo, 'fromDiskCache' | 'fromMemoryCache' | 'fromServiceWorker' | 'fromPrefetchCache'>): HarCacheSource | undefined {
  if (cacheInfo.fromServiceWorker) return 'service-worker';
  if (cacheInfo.fromMemoryCache) return 'memory';
  if (cacheInfo.fromDiskCache) return 'disk';
  if (cacheInfo.fromPrefetchCache) return 'prefetch';
  return undefined;
}

function parseCookies(cookies: any): HarCookie[] {
  if (!Array.isArray(cookies)) return [];
  return cookies.reduce<HarCookie[]>((acc, cookie) => {
    const name = optionalString(cookie?.name);
    if (!name) return acc;

    acc.push({
      name,
      value: optionalRawString(cookie?.value),
      path: optionalString(cookie?.path),
      domain: optionalString(cookie?.domain),
      expires: optionalString(cookie?.expires),
      httpOnly: optionalBoolean(cookie?.httpOnly),
      secure: optionalBoolean(cookie?.secure),
      sameSite: optionalString(cookie?.sameSite),
      comment: optionalString(cookie?.comment),
    });
    return acc;
  }, []);
}

function parseInitiatorFrame(frame: any): HarInitiatorFrame | undefined {
  const parsed: HarInitiatorFrame = {
    functionName: optionalString(frame?.functionName),
    url: optionalString(frame?.url),
    lineNumber: optionalNumber(frame?.lineNumber),
    columnNumber: optionalNumber(frame?.columnNumber),
  };
  return Object.values(parsed).some(v => v !== undefined) ? parsed : undefined;
}

function parseInitiatorStack(stack: any): HarInitiatorFrame[] | undefined {
  const frames: HarInitiatorFrame[] = [];

  if (Array.isArray(stack)) {
    stack.forEach(frame => {
      const parsed = parseInitiatorFrame(frame);
      if (parsed) frames.push(parsed);
    });
  } else if (stack && typeof stack === 'object') {
    let node: any = stack;
    let depth = 0;
    while (node && typeof node === 'object' && depth < 50) {
      if (Array.isArray(node.callFrames)) {
        node.callFrames.forEach((frame: any) => {
          const parsed = parseInitiatorFrame(frame);
          if (parsed) frames.push(parsed);
        });
      }
      node = node.parent;
      depth++;
    }
  }

  return frames.length ? frames : undefined;
}

function parseInitiator(raw: any): HarInitiatorInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const initiator: HarInitiatorInfo = {
    type: optionalString(raw.type),
    url: optionalString(raw.url),
    lineNumber: optionalNumber(raw.lineNumber),
    columnNumber: optionalNumber(raw.columnNumber),
    requestId: optionalString(raw.requestId),
    stack: parseInitiatorStack(raw.stack),
  };
  return Object.values(initiator).some(v => v !== undefined) ? initiator : undefined;
}

function isRedirectStatus(status: number): boolean {
  return status === 300
    || status === 301
    || status === 302
    || status === 303
    || status === 305
    || status === 307
    || status === 308;
}

function parseRedirect(resp: any, responseHeaders: HarHeader[], status: number): HarRedirectInfo | undefined {
  const redirectURL = optionalString(resp.redirectURL);
  const location = optionalString(getHeader(responseHeaders, 'location'));
  if (!redirectURL && !location && !isRedirectStatus(status)) return undefined;
  return {
    redirectURL,
    location,
    status: isRedirectStatus(status) ? status : undefined,
  };
}

function parseCacheInfo(entry: any, resp: any, responseHeaders: HarHeader[], status: number): HarCacheInfo | undefined {
  const parsedSource = parseCacheSource(resp._fromCache ?? entry._fromCache);
  const fromDiskCache = mergeOptionalBoolean(resp._fromDiskCache, entry._fromDiskCache, parsedSource.source === 'disk' ? true : undefined);
  const fromMemoryCache = mergeOptionalBoolean(resp._fromMemoryCache, entry._fromMemoryCache, parsedSource.source === 'memory' ? true : undefined);
  const fromServiceWorker = mergeOptionalBoolean(resp._fromServiceWorker, entry._fromServiceWorker, parsedSource.source === 'service-worker' ? true : undefined);
  const fromPrefetchCache = mergeOptionalBoolean(resp._fromPrefetchCache, entry._fromPrefetchCache, parsedSource.source === 'prefetch' ? true : undefined);
  const hasCacheBoolean = fromDiskCache !== undefined
    || fromMemoryCache !== undefined
    || fromServiceWorker !== undefined
    || fromPrefetchCache !== undefined;
  const fromCache = [fromDiskCache, fromMemoryCache, fromServiceWorker, fromPrefetchCache].some(v => v === true)
    ? true
    : undefined;

  const cacheInfo: HarCacheInfo = {
    cacheControl: optionalString(getHeader(responseHeaders, 'cache-control')),
    etag: optionalString(getHeader(responseHeaders, 'etag')),
    age: optionalString(getHeader(responseHeaders, 'age')),
    expires: optionalString(getHeader(responseHeaders, 'expires')),
    lastModified: optionalString(getHeader(responseHeaders, 'last-modified')),
    fromDiskCache,
    fromMemoryCache,
    fromServiceWorker,
    fromPrefetchCache,
    fromCache,
    status304: status === 304 ? true : undefined,
    source: pickCacheSource({ fromDiskCache, fromMemoryCache, fromServiceWorker, fromPrefetchCache }),
    sourceRecorded: parsedSource.source !== undefined ? true : undefined,
    rawSource: parsedSource.rawSource,
  };

  const hasCacheInfo = Object.values(cacheInfo).some(v => v !== undefined) || hasCacheBoolean;
  return hasCacheInfo ? cacheInfo : undefined;
}

function parseConnectionInfo(connectionId: string | undefined, harConnection: string | undefined, remoteAddress: string | undefined, protocol: string): HarConnectionInfo | undefined {
  const info: HarConnectionInfo = {
    connectionId,
    harConnection,
    remoteAddress: optionalString(remoteAddress),
    protocol: protocol !== '-' ? protocol : undefined,
  };
  return Object.values(info).some(v => v !== undefined) ? info : undefined;
}

function optionalNonNegativeSize(value: any): number | undefined {
  const n = optionalNumber(value);
  return n !== undefined && n >= 0 ? n : undefined;
}

function buildSizeInfo(req: any, resp: any, content: any, transferSize: number): HarSizeInfo {
  return {
    transferSize,
    resourceSize: optionalNonNegativeSize(content.size) ?? -1,
    requestHeadersSize: optionalNonNegativeSize(req.headersSize),
    requestBodySize: optionalNonNegativeSize(req.bodySize),
    responseHeadersSize: optionalNonNegativeSize(resp.headersSize),
    responseBodySize: optionalNonNegativeSize(resp.bodySize),
  };
}

function extractNetErrorText(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\b(?:net::)?ERR_[A-Z0-9_]+\b/);
  return match ? match[0] : undefined;
}

function extractNetErrorCode(text?: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/\b(?:net_error|code)\s*[:=]\s*(-\d+)\b/i);
  return match ? Number(match[1]) : undefined;
}

function shouldKeepResponseBody(rawBody: string, mimeType: string, status: number, options: HarParseOptions): boolean {
  if (!rawBody) return true;
  if (!options.optimizeResponseBodies) return true;

  const length = rawBody.length;
  const lowerMime = (mimeType || '').toLowerCase();

  if (length <= HAR_BODY_KEEP_SMALL_THRESHOLD) return true;
  if (status >= 400 && length <= HAR_BODY_KEEP_JSON_THRESHOLD) return true;
  if ((lowerMime.includes('json') || lowerMime.includes('xml') || lowerMime.includes('text')) && length <= HAR_BODY_KEEP_JSON_THRESHOLD) return true;

  return false;
}

// 解析单条 entry
function parseEntry(entry: any, id: number, options: HarParseOptions): HarRequestEntry {
  const req = entry.request || {};
  const resp = entry.response || {};
  const content = resp.content || {};
  const t = entry.timings || {};

  const requestHeaders: HarHeader[] = Array.isArray(req.headers)
    ? req.headers.map((h: any) => ({ name: String(h?.name || ''), value: String(h?.value || '') }))
    : [];
  const responseHeaders: HarHeader[] = Array.isArray(resp.headers)
    ? resp.headers.map((h: any) => ({ name: String(h?.name || ''), value: String(h?.value || '') }))
    : [];

  const mimeType = content.mimeType || '';
  const rawType = entry._resourceType || (req.method === 'OPTIONS' ? 'preflight' : '');
  const category = normalizeCategory(entry._resourceType || '', mimeType);

  const { domain, name } = parseUrlParts(req.url || '');

  // 传输大小：优先 _transferSize，其次 bodySize，最后 content.size；-1 表示未记录。
  const size = optionalNonNegativeSize(resp._transferSize)
    ?? optionalNonNegativeSize(resp.bodySize)
    ?? optionalNonNegativeSize(content.size)
    ?? -1;

  const status = num(resp.status);
  const time = num(entry.time);
  const isSlow = time >= HAR_SLOW_THRESHOLD_MS;
  const rawResponseBody = content.text || '';
  const keepResponseBody = shouldKeepResponseBody(rawResponseBody, mimeType, status, options);

  const serverTiming = parseServerTiming(getHeader(responseHeaders, 'server-timing'));
  const failureText = firstNonEmptyString([
    entry._error,
    entry.error,
    entry.errorText,
    resp._error,
    resp.error,
    status === 0 || status >= 400 ? resp.statusText : '',
  ]);
  const explicitNetErrorText = firstNonEmptyString([
    entry._netError,
    entry.netError,
    resp._netError,
    resp.netError,
  ]);
  const netErrorText = extractNetErrorText(explicitNetErrorText) || extractNetErrorText(failureText);
  const netErrorCode = firstFiniteNumber([
    entry._netError,
    entry.netError,
    resp._netError,
    resp.netError,
    extractNetErrorCode(failureText),
  ]);
  const blockedReason = firstNonEmptyString([
    entry._blockedReason,
    entry.blockedReason,
    resp._blockedReason,
    resp.blockedReason,
  ]);
  const isFailed = status === 0
    || status >= 400
    || Boolean(netErrorText)
    || netErrorCode !== undefined
    || Boolean(blockedReason)
    || Boolean(failureText);
  const xTtLogid = getHeader(responseHeaders, 'x-tt-logid') || getHeader(requestHeaders, 'x-tt-logid');
  const xTtCip = getHeader(responseHeaders, 'x-tt-cip') || getHeader(requestHeaders, 'x-tt-cip');
  const xLscSourceIp = getHeader(responseHeaders, 'x-lsc-source-ip') || getHeader(requestHeaders, 'x-lsc-source-ip');
  const remoteAddress = optionalString(entry.serverIPAddress);
  const harConnection = optionalString(entry.connection);
  const connectionId = optionalString(entry._connectionId) || optionalString(resp._connectionId) || harConnection;
  const protocol = normalizeProtocol(resp.httpVersion || req.httpVersion || '');
  const initiator = parseInitiator(entry._initiator);
  const redirect = parseRedirect(resp, responseHeaders, status);
  const requestCookies = parseCookies(req.cookies);
  const responseCookies = parseCookies(resp.cookies);
  const priority = optionalString(entry._priority);
  const cacheInfo = parseCacheInfo(entry, resp, responseHeaders, status);
  const connectionInfo = parseConnectionInfo(connectionId, harConnection, remoteAddress, protocol);
  const chromeTiming = parseChromeTimingEvidence(t);
  const sizeInfo = buildSizeInfo(req, resp, content, size);
  const responseBodyDescriptor: HarResponseBodyDescriptor = {
    state: rawResponseBody ? (keepResponseBody ? 'inline' : 'deferred') : 'absent',
    originalLength: rawResponseBody ? rawResponseBody.length : 0,
    encoding: optionalString(content.encoding),
    mimeType: optionalString(mimeType),
  };
  // 提取 queryString 和 postData
  const queryString: HarQueryParam[] = Array.isArray(req.queryString)
    ? req.queryString.map((q: any) => ({
      name: String(q?.name || ''),
      value: String(q?.value || ''),
    }))
    : [];

  const postDataRaw = req.postData || {};
  const postData: HarPostData | undefined = postDataRaw.text || postDataRaw.params ? {
    mimeType: String(postDataRaw.mimeType || ''),
    text: String(postDataRaw.text || ''),
    params: Array.isArray(postDataRaw.params)
      ? postDataRaw.params.map((p: any) => ({ name: String(p?.name || ''), value: String(p?.value || '') }))
      : undefined,
  } : undefined;

  return {
    id,
    name,
    url: req.url || '',
    method: req.method || 'GET',
    status,
    statusText: resp.statusText || '',
    protocol,
    domain,
    remoteAddress: remoteAddress || '-',
    connectionId,
    category,
    rawType: rawType || category,
    mimeType,
    size,
    contentSize: optionalNonNegativeSize(content.size) ?? -1,
    time,
    startedDateTime: entry.startedDateTime || '',
    startMs: entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : Number.NaN,
    pageRef: optionalString(entry.pageref),
    timings: {
      blocked: num(t.blocked),
      dns: num(t.dns),
      connect: num(t.connect),
      ssl: num(t.ssl),
      send: num(t.send),
      wait: num(t.wait),
      receive: num(t.receive),
    },
    timingAvailability: {
      blocked: isAvailableTiming(t.blocked),
      dns: isAvailableTiming(t.dns),
      connect: isAvailableTiming(t.connect),
      ssl: isAvailableTiming(t.ssl),
      send: isAvailableTiming(t.send),
      wait: isAvailableTiming(t.wait),
      receive: isAvailableTiming(t.receive),
    },
    chromeTiming,
    requestHeaders,
    responseHeaders,
    responseBody: keepResponseBody ? rawResponseBody : '',
    responseBodyDescriptor,
    responseBodyOmitted: Boolean(rawResponseBody && !keepResponseBody),
    responseBodyOriginalLength: rawResponseBody ? rawResponseBody.length : 0,
    responseBodyOmitReason: rawResponseBody && !keepResponseBody
      ? '大 HAR 内存优化：已省略大型响应体，保留请求、响应头和 timing 诊断字段'
      : undefined,
    responseEncoding: content.encoding || '',
    queryString,
    postData,
    initiator,
    redirect,
    requestCookies,
    responseCookies,
    priority,
    cacheInfo,
    connectionInfo,
    sizeInfo,
    serverTiming,
    failureText,
    netErrorText,
    netErrorCode,
    blockedReason,
    xTtLogid,
    xTtCip,
    xLscSourceIp,
    isFailed,
    isSlow,
  };
}

export function parseHar(
  data: any,
  onRequestProgress?: (completed: number, total: number) => void,
): HarAnalysisResult {
  if (!isHarFile(data)) {
    throw new Error('未找到有效的 HAR 请求数据');
  }
  assertNoCompetingRootFormat(data, 'har');
  const log = data.log || {};
  const rawEntries: any[] = Array.isArray(log.entries) ? log.entries : [];
  const totalResponseBodyChars = rawEntries.reduce((sum, entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.request) || !isRecord(entry.response)) {
      throw new Error(`HAR log.entries[${index}] 缺少 request 或 response 对象`);
    }
    const content = isRecord(entry.response.content)
      ? entry.response.content
      : undefined;
    const text = content?.text;
    return sum + (typeof text === 'string' ? text.length : 0);
  }, 0);
  const optimizeResponseBodies = totalResponseBodyChars > HAR_BODY_TOTAL_OPTIMIZE_THRESHOLD;

  const entries: HarRequestEntry[] = [];
  let lastProgressAt = 0;
  rawEntries.forEach((entry, index) => {
    entries.push(parseEntry(entry, index, { optimizeResponseBodies }));
    const completed = index + 1;
    const now = Date.now();
    if (
      onRequestProgress
      && (
        completed === rawEntries.length
        || (completed % 100 === 0 && now - lastProgressAt >= 100)
      )
    ) {
      lastProgressAt = now;
      onRequestProgress(completed, rawEntries.length);
    }
  });

  const typeCounts: Record<HarCategory, number> = {
    xhr: 0, doc: 0, css: 0, js: 0, font: 0, img: 0, media: 0, other: 0,
  };
  let totalSize = 0;
  let failedCount = 0;
  let slowCount = 0;
  let minStart = Infinity;
  let maxEnd = 0;
  let omittedCount = 0;
  let omittedBytes = 0;

  for (const e of entries) {
    typeCounts[e.category]++;
    totalSize += Math.max(0, e.size);
    if (e.isFailed) failedCount++;
    if (e.isSlow) slowCount++;
    if (e.responseBodyOmitted) {
      omittedCount++;
      omittedBytes += e.responseBodyOriginalLength || 0;
    }
    if (e.startMs > 0) {
      minStart = Math.min(minStart, e.startMs);
      maxEnd = Math.max(maxEnd, e.startMs + e.time);
    }
  }

  const totalTime = minStart !== Infinity && maxEnd > minStart ? maxEnd - minStart : 0;
  const creator = log.creator ? `${log.creator.name || ''} ${log.creator.version || ''}`.trim() : '';
  const pageMarkers = Array.isArray(log.pages)
    ? log.pages.map((page: any): HarPageMarker => {
      const startedDateTime = optionalString(page.startedDateTime);
      return {
        pageId: optionalString(page.id),
        title: optionalString(page.title),
        startedDateTime,
        startMs: startedDateTime ? (new Date(startedDateTime).getTime() || undefined) : undefined,
        domContentLoadedMs: optionalNonNegativeNumber(page.pageTimings?.onContentLoad),
        loadMs: optionalNonNegativeNumber(page.pageTimings?.onLoad),
      };
    }).filter((page: HarPageMarker) => page.domContentLoadedMs !== undefined || page.loadMs !== undefined)
    : undefined;

  return {
    entries,
    totalRequests: entries.length,
    failedCount,
    slowCount,
    totalSize,
    totalTime,
    creator,
    typeCounts,
    pageMarkers,
    bodyRetention: {
      mode: optimizeResponseBodies ? 'optimized' : 'full',
      omittedCount,
      omittedBytes,
      reason: optimizeResponseBodies
        ? `响应体总量约 ${formatBytes(totalResponseBodyChars)}，已自动省略大型 body 以降低浏览器内存占用`
        : undefined,
    },
  };
}

// 类型标签颜色
export function categoryColor(cat: HarCategory): string {
  const map: Record<HarCategory, string> = {
    xhr: '#5ba3f5',
    doc: '#c084fc',
    css: '#22d3ee',
    js: '#fbbf24',
    font: '#fb923c',
    img: '#4ade80',
    media: '#f472b6',
    other: '#8892a4',
  };
  return map[cat] || '#8892a4';
}

// 浅色背景 + 深色字体的标签样式（兼顾深浅主题，背景始终为浅色）
export interface TagStyle {
  bg: string;
  color: string;
}

// 分类标签配色：淡色背景 + 同色系深色字体
export function categoryStyle(cat: HarCategory): TagStyle {
  const map: Record<HarCategory, TagStyle> = {
    doc: { bg: '#dbeafe', color: '#1e40af' },    // 淡蓝
    css: { bg: '#ede9fe', color: '#6d28d9' },    // 淡紫
    js: { bg: '#fef08a', color: '#854d0e' },     // 淡明黄
    font: { bg: '#ffedd5', color: '#c2410c' },   // 淡橙
    img: { bg: '#dcfce7', color: '#15803d' },    // 淡绿
    media: { bg: '#fce7f3', color: '#be185d' },  // 淡粉
    xhr: { bg: '#cffafe', color: '#0e7490' },    // 淡青
    other: { bg: '#e5e7eb', color: '#374151' },  // 淡灰
  };
  return map[cat] || { bg: '#e5e7eb', color: '#374151' };
}

// 「All」筛选项样式：黑色字体 + 淡黄背景
export const ALL_TAG_STYLE: TagStyle = { bg: '#fef9c3', color: '#713f12' };

// 根据筛选项 key 取样式（含 all）
export function filterTagStyle(key: string): TagStyle {
  return key === 'all' ? ALL_TAG_STYLE : categoryStyle(key as HarCategory);
}

// 状态码标签配色：淡色背景 + 高对比深色字体
export function statusStyle(status: number): TagStyle {
  if (status === 0 || status >= 500) return { bg: '#fee2e2', color: '#b91c1c' };  // 淡红
  if (status >= 400) return { bg: '#ffedd5', color: '#c2410c' };                  // 淡橙
  if (status >= 300) return { bg: '#cffafe', color: '#0e7490' };                  // 淡青
  if (status >= 200) return { bg: '#dcfce7', color: '#15803d' };                  // 淡绿
  return { bg: '#e5e7eb', color: '#374151' };
}

export const CATEGORY_LABELS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'xhr', label: 'Fetch/XHR' },
  { key: 'doc', label: 'Doc' },
  { key: 'css', label: 'CSS' },
  { key: 'js', label: 'JS' },
  { key: 'font', label: 'Font' },
  { key: 'img', label: 'Img' },
  { key: 'media', label: 'Media' },
  { key: 'other', label: 'Other' },
];
