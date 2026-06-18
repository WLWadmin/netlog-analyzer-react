// ============================================================
// HAR (HTTP Archive) Parser
// 独立于 NetLog 解析逻辑，将 DevTools 导出的 .har 文件解析为
// 可视化所需的结构化数据。
// ============================================================

export interface HarTiming {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

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
  category: HarCategory;
  rawType: string;
  mimeType: string;
  size: number; // 传输大小（字节）
  contentSize: number; // 解压后内容大小
  time: number; // 总耗时 ms
  startedDateTime: string;
  startMs: number;
  timings: HarTiming;
  requestHeaders: HarHeader[];
  responseHeaders: HarHeader[];
  responseBody: string;
  responseEncoding: string;
  queryString: HarQueryParam[];
  postData?: HarPostData;
  // 关键诊断字段
  serverTiming: HarServerTiming[];
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
    let name = segs.length ? segs[segs.length - 1] : u.hostname;
    if (u.search) name += u.search;
    if (!name) name = u.hostname + '/';
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

// 解析单条 entry
function parseEntry(entry: any, id: number): HarRequestEntry {
  const req = entry.request || {};
  const resp = entry.response || {};
  const content = resp.content || {};
  const t = entry.timings || {};

  const requestHeaders: HarHeader[] = (req.headers || []).map((h: any) => ({ name: h.name, value: h.value }));
  const responseHeaders: HarHeader[] = (resp.headers || []).map((h: any) => ({ name: h.name, value: h.value }));

  const mimeType = content.mimeType || '';
  const rawType = entry._resourceType || (req.method === 'OPTIONS' ? 'preflight' : '');
  const category = normalizeCategory(entry._resourceType || '', mimeType);

  const { domain, name } = parseUrlParts(req.url || '');

  // 传输大小：优先 _transferSize，其次 bodySize，最后 content.size
  let size = -1;
  if (typeof resp._transferSize === 'number' && resp._transferSize >= 0) size = resp._transferSize;
  else if (typeof resp.bodySize === 'number' && resp.bodySize > 0) size = resp.bodySize;
  else if (typeof content.size === 'number' && content.size > 0) size = content.size;
  if (size < 0) size = 0;

  const status = num(resp.status);
  const time = num(entry.time);
  const isFailed = status === 0 || status >= 400;
  const isSlow = time >= HAR_SLOW_THRESHOLD_MS;

  const serverTiming = parseServerTiming(getHeader(responseHeaders, 'server-timing'));
  const xTtLogid = getHeader(responseHeaders, 'x-tt-logid') || getHeader(requestHeaders, 'x-tt-logid');
  const xTtCip = getHeader(responseHeaders, 'x-tt-cip') || getHeader(requestHeaders, 'x-tt-cip');
  const xLscSourceIp = getHeader(responseHeaders, 'x-lsc-source-ip') || getHeader(requestHeaders, 'x-lsc-source-ip');

  let remoteAddress = entry.serverIPAddress || '';
  if (remoteAddress && entry.connection) remoteAddress += ':' + entry.connection;

  // 提取 queryString 和 postData
  const queryString: HarQueryParam[] = (req.queryString || []).map((q: any) => ({
    name: q.name || '',
    value: q.value || '',
  }));

  const postDataRaw = req.postData || {};
  const postData: HarPostData | undefined = postDataRaw.text || postDataRaw.params ? {
    mimeType: postDataRaw.mimeType || '',
    text: postDataRaw.text || '',
    params: (postDataRaw.params || []).map((p: any) => ({ name: p.name || '', value: p.value || '' })),
  } : undefined;

  return {
    id,
    name,
    url: req.url || '',
    method: req.method || 'GET',
    status,
    statusText: resp.statusText || '',
    protocol: normalizeProtocol(resp.httpVersion || req.httpVersion || ''),
    domain,
    remoteAddress: remoteAddress || '-',
    category,
    rawType: rawType || category,
    mimeType,
    size,
    contentSize: num(content.size),
    time,
    startedDateTime: entry.startedDateTime || '',
    startMs: entry.startedDateTime ? (new Date(entry.startedDateTime).getTime() || 0) : 0,
    timings: {
      blocked: num(t.blocked),
      dns: num(t.dns),
      connect: num(t.connect),
      ssl: num(t.ssl),
      send: num(t.send),
      wait: num(t.wait),
      receive: num(t.receive),
    },
    requestHeaders,
    responseHeaders,
    responseBody: content.text || '',
    responseEncoding: content.encoding || '',
    queryString,
    postData,
    serverTiming,
    xTtLogid,
    xTtCip,
    xLscSourceIp,
    isFailed,
    isSlow,
  };
}

export function parseHar(data: any): HarAnalysisResult {
  const log = data.log || {};
  const rawEntries: any[] = Array.isArray(log.entries) ? log.entries : [];

  const entries = rawEntries.map((e, i) => parseEntry(e, i));

  const typeCounts: Record<HarCategory, number> = {
    xhr: 0, doc: 0, css: 0, js: 0, font: 0, img: 0, media: 0, other: 0,
  };
  let totalSize = 0;
  let failedCount = 0;
  let slowCount = 0;
  let minStart = Infinity;
  let maxEnd = 0;

  for (const e of entries) {
    typeCounts[e.category]++;
    totalSize += e.size;
    if (e.isFailed) failedCount++;
    if (e.isSlow) slowCount++;
    if (e.startMs > 0) {
      minStart = Math.min(minStart, e.startMs);
      maxEnd = Math.max(maxEnd, e.startMs + e.time);
    }
  }

  const totalTime = minStart !== Infinity && maxEnd > minStart ? maxEnd - minStart : 0;
  const creator = log.creator ? `${log.creator.name || ''} ${log.creator.version || ''}`.trim() : '';

  return {
    entries,
    totalRequests: entries.length,
    failedCount,
    slowCount,
    totalSize,
    totalTime,
    creator,
    typeCounts,
  };
}

// 解码响应体（处理 base64）并尝试 JSON 格式化
export function decodeResponseBody(entry: HarRequestEntry): { text: string; isJson: boolean; parsed?: any; isImage: boolean; isMedia: boolean; imageSrc?: string } {
  let raw = entry.responseBody || '';
  const mimeType = (entry.mimeType || '').toLowerCase();
  const isImage = mimeType.startsWith('image/');
  const isMedia = mimeType.startsWith('video/') || mimeType.startsWith('audio/');

  // 图片和媒体：base64 编码时直接生成 data URL
  if (entry.responseEncoding === 'base64' && raw) {
    if (isImage) {
      return { text: '', isJson: false, isImage: true, isMedia: false, imageSrc: `data:${entry.mimeType};base64,${raw}` };
    }
    if (isMedia) {
      return { text: '', isJson: false, isImage: false, isMedia: true, imageSrc: `data:${entry.mimeType};base64,${raw}` };
    }
    try {
      raw = new TextDecoder().decode(Uint8Array.from(window.atob(raw), c => c.charCodeAt(0)));
    } catch {
      try { raw = window.atob(raw); } catch { /* keep raw */ }
    }
  }

  // 非 base64 的图片/媒体（如 data URL 或空）
  if (isImage && raw) {
    // 如果已经是 data URL 或可解码内容
    if (raw.startsWith('data:')) {
      return { text: '', isJson: false, isImage: true, isMedia: false, imageSrc: raw };
    }
    // 尝试作为 base64 解码
    try {
      window.atob(raw); // 验证是否为有效 base64
      const src = `data:${entry.mimeType};base64,${raw}`;
      return { text: '', isJson: false, isImage: true, isMedia: false, imageSrc: src };
    } catch { /* fall through */ }
  }

  if (!raw) return { text: '', isJson: false, isImage: false, isMedia: false };
  try {
    const obj = JSON.parse(raw);
    return { text: JSON.stringify(obj, null, 2), isJson: true, parsed: obj, isImage: false, isMedia: false };
  } catch {
    return { text: raw, isJson: false, isImage: false, isMedia: false };
  }
}

// 状态码颜色
export function statusColor(status: number): string {
  if (status === 0) return '#fb7185';
  if (status >= 500) return '#fb7185';
  if (status >= 400) return '#fb923c';
  if (status >= 300) return '#22d3ee';
  if (status >= 200) return '#4ade80';
  return '#8892a4';
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
