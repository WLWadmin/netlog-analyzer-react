/**
 * Go 服务日志解析引擎 - 配置化版本（方案 C）
 * 采用配置驱动的方式解析日志，新增格式只需添加配置，无需修改解析引擎代码
 */

import { getFriendlyName, DURATION_RANGES } from './logConstants';

// ============ 类型定义 ============

export interface LogEntry {
  id: string;
  worker: string;
  level: 'Info' | 'Error' | 'Warn' | 'Debug';
  timestamp: string;
  timestampMs: number;
  method: string;
  url: string;
  domain: string;
  path: string;
  status: 'Success' | 'Error';
  statusCode?: number;
  statusText?: string;
  headers: Record<string, string>;
  body?: any;
  bodyRaw?: string;
  duration: number;
  durationText: string;
  friendlyName: string;
  rawLine: string;
}

export interface LogFlowGroup {
  id: string;
  startTime: string;
  endTime: string;
  entries: LogEntry[];
  successCount: number;
  errorCount: number;
  hasError: boolean;
  summary: string;
}

export interface LogStats {
  total: number;
  success: number;
  error: number;
  successRate: number;
  errorTypes: { code: string; count: number; percentage: number }[];
  domainDistribution: { domain: string; count: number; success: number; error: number }[];
  durationDistribution: { range: string; count: number }[];
  levelDistribution: { level: string; count: number; percentage: number; color: string }[];
}

export interface LogInsight {
  summary: string;
  severity: 'success' | 'warning' | 'error';
  detail: string;
}

export interface LogAnalysisResult {
  entries: LogEntry[];
  groups: LogFlowGroup[];
  stats: LogStats;
  insight: LogInsight;
}

// 日志解析策略接口
export interface LogParserStrategy {
  canParse(content: string): boolean;
  parse(
    content: string,
    onLineProgress?: (completed: number, total: number) => void,
  ): LogAnalysisResult;
}

// ============ 配置化解析器 ============

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'];
const HTTP_METHOD_PATTERN = HTTP_METHODS.join('|');

// Module-level compiled regexes (avoid re-compilation in loops)
const METHOD_URL_REGEX = new RegExp(`^\\s*(${HTTP_METHOD_PATTERN}):([^\\s|]+)`, 'i');
const STATUS_CODE_REGEX = /^\s*statusCode:(\d+)\s*/;
const RETRYING_REGEX = new RegExp(`^\\s*\\[(\\d+)\\]\\s*(${HTTP_METHOD_PATTERN}):(.+?)\\s*\\+\\s*(\\d+)(ms|s)\\s*$`, 'i');
const NETWORK_ERROR_REGEX = new RegExp(`^\\s*(?:Error\\s+)?(${HTTP_METHOD_PATTERN}):(.+?)\\s*->\\s*(.+?)\\s*\\+\\s*(\\d+)(ms|s)\\s*$`, 'i');
const SUFFIX_DURATION_REGEX = (prefix: string) => new RegExp(`\\${prefix}(\\d+)(ms|s)\\s*$`);

function parseDuration(numText: string, unit: string): number {
  const num = parseInt(numText, 10);
  if (!Number.isFinite(num)) return 0;
  return unit === 's' ? num * 1000 : num;
}

function parseTimestampMs(timestamp: string): number {
  const trimmed = timestamp.trim();
  const native = new Date(trimmed).getTime();
  if (!Number.isNaN(native)) return native;

  const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/);
  if (slashMatch) {
    const [, y, m, d, hh, mm, ss, ms = '0'] = slashMatch;
    return new Date(+y, +m - 1, +d, +hh, +mm, +ss, +ms.padEnd(3, '0')).getTime();
  }

  const dashMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/);
  if (dashMatch) {
    const [, y, m, d, hh, mm, ss, ms = '0'] = dashMatch;
    return new Date(+y, +m - 1, +d, +hh, +mm, +ss, +ms.padEnd(3, '0')).getTime();
  }

  return 0;
}

function extractStatusCodeFromBody(body: any): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const candidates = [body.statusCode, body.status_code, body.code, body.err_code, body.error_code];
  for (const candidate of candidates) {
    const code = typeof candidate === 'number' ? candidate : parseInt(String(candidate), 10);
    if (Number.isFinite(code) && code >= 100 && code < 600) return code;
  }
  return undefined;
}

interface MethodUrlResult {
  method: string;
  url: string;
  nextPos: number;
}

function parseMethodUrl(line: string, pos: number): MethodUrlResult | null {
  const match = line.slice(pos).match(METHOD_URL_REGEX);
  if (!match) return null;
  return {
    method: match[1].toUpperCase(),
    url: match[2],
    nextPos: pos + match[0].length,
  };
}

/**
 * 解析上下文 - 维护当前解析位置和原始行
 */
interface ParseContext {
  line: string;
  pos: number;
}

/**
 * 提取器函数类型
 */
type Extractor = (ctx: ParseContext, marker?: string) => { value: any; consumed: number } | null;

/**
 * 提取器注册表
 */
const extractors: Record<string, Extractor> = {
  /** 读取 [...] 括号内的内容 */
  bracket: (ctx) => {
    if (ctx.line[ctx.pos] !== '[') return null;
    const end = ctx.line.indexOf(']', ctx.pos);
    if (end === -1) return null;
    return { value: ctx.line.slice(ctx.pos + 1, end), consumed: end - ctx.pos + 1 };
  },

  /** 读取下一个空白分隔的单词 */
  word: (ctx) => {
    // 跳过前导空白
    let start = ctx.pos;
    while (start < ctx.line.length && /\s/.test(ctx.line[start])) start++;
    if (start >= ctx.line.length) return null;
    let end = start;
    while (end < ctx.line.length && !/\s/.test(ctx.line[end])) end++;
    return { value: ctx.line.slice(start, end), consumed: end - ctx.pos };
  },

  /** 读取下一个数字 */
  number: (ctx) => {
    let start = ctx.pos;
    while (start < ctx.line.length && /\s/.test(ctx.line[start])) start++;
    if (start >= ctx.line.length || !/\d/.test(ctx.line[start])) return null;
    let end = start;
    while (end < ctx.line.length && /\d/.test(ctx.line[end])) end++;
    return { value: parseInt(ctx.line.slice(start, end), 10), consumed: end - ctx.pos };
  },

  /** 读取直到遇到指定标记 */
  until: (ctx, marker?: string) => {
    if (!marker) return null;
    const idx = ctx.line.indexOf(marker, ctx.pos);
    if (idx === -1) return null;
    // 跳过前导空白
    let start = ctx.pos;
    while (start < idx && /\s/.test(ctx.line[start])) start++;
    return { value: ctx.line.slice(start, idx).trim(), consumed: idx - ctx.pos };
  },

  /** 读取 key=value&key=value 格式 */
  keyValue: (ctx, prefix?: string) => {
    let start = ctx.pos;
    if (prefix) {
      const idx = ctx.line.indexOf(prefix, start);
      if (idx === -1) return null;
      start = idx + prefix.length;
    }
    while (start < ctx.line.length && /\s/.test(ctx.line[start])) start++;
    // 找到这个字段的结束位置（下一个 | 或行尾）
    let end = ctx.line.indexOf('|', start);
    if (end === -1) {
      // 如果没有 |，找 +duration 之前的部分
      const durMatch = ctx.line.slice(start).match(/\s+\+\d+(ms|s)\s*$/);
      end = durMatch ? start + durMatch.index! : ctx.line.length;
    }
    const raw = ctx.line.slice(start, end).trim();
    const result: Record<string, string> = {};
    const pairs = raw.split('&');
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
    }
    return { value: result, consumed: end - ctx.pos };
  },

  /** 读取 JSON 对象 */
  json: (ctx, prefix?: string) => {
    let start = ctx.pos;
    if (prefix) {
      const idx = ctx.line.indexOf(prefix, start);
      if (idx === -1) return null;
      start = idx + prefix.length;
    }
    while (start < ctx.line.length && /\s/.test(ctx.line[start])) start++;
    // 找到 JSON 结束位置（下一个 | 或行尾）
    let end = ctx.line.indexOf('|', start);
    if (end === -1) {
      const durMatch = ctx.line.slice(start).match(/\s+\+\d+(ms|s)\s*$/);
      end = durMatch ? start + durMatch.index! : ctx.line.length;
    }
    const raw = ctx.line.slice(start, end).trim();
    try {
      return { value: JSON.parse(raw), consumed: end - ctx.pos };
    } catch {
      return { value: raw, consumed: end - ctx.pos };
    }
  },

  /** 读取行尾 +duration */
  suffix: (ctx, prefix?: string) => {
    const actualPrefix = prefix || '+';
    const regex = SUFFIX_DURATION_REGEX(actualPrefix);
    const match = ctx.line.slice(ctx.pos).match(regex);
    if (!match) return null;
    const duration = match[2] === 's' ? parseInt(match[1], 10) * 1000 : parseInt(match[1], 10);
    return {
      value: { duration, durationText: `+${match[1]}${match[2]}` },
      consumed: ctx.line.length - ctx.pos,
    };
  },

  /** 读取 URL（从当前位置到下一个空白或分隔符） */
  url: (ctx) => {
    let start = ctx.pos;
    while (start < ctx.line.length && /\s/.test(ctx.line[start])) start++;
    let end = start;
    while (end < ctx.line.length && !/[\s|]/.test(ctx.line[end])) end++;
    return { value: ctx.line.slice(start, end), consumed: end - ctx.pos };
  },
};

/**
 * Go 服务日志解析器 - 配置化实现
 */
class GoServiceLogParser implements LogParserStrategy {
  private entryIdCounter = 0;

  canParse(content: string): boolean {
    const firstLine = content.split(/\r?\n/).find(l => l.trim());
    if (!firstLine) return false;
    return firstLine.startsWith("[") && /^\[[^\]]+\]\s+(Info|Error|Warn|Debug)\b/.test(firstLine);
  }

  parse(
    content: string,
    onLineProgress?: (completed: number, total: number) => void,
  ): LogAnalysisResult {
    this.entryIdCounter = 0;
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n').filter(line => line.trim());
    const entries: LogEntry[] = [];

    let processedLines = 0;
    let lastProgressAt = 0;
    for (const line of lines) {
      const entry = this.parseLine(line);
      if (entry) entries.push(entry);
      processedLines += 1;
      const now = Date.now();
      if (
        onLineProgress
        && (
          processedLines === lines.length
          || (processedLines % 250 === 0 && now - lastProgressAt >= 100)
        )
      ) {
        lastProgressAt = now;
        onLineProgress(processedLines, lines.length);
      }
    }

    entries.sort((a, b) => a.timestampMs - b.timestampMs);

    const groups = this.groupEntries(entries);
    const stats = this.calculateStats(entries);
    const insight = this.generateInsight(entries, stats);

    return { entries, groups, stats, insight };
  }

  private parseLine(line: string): LogEntry | null {
    const ctx: ParseContext = { line, pos: 0 };

    // 1. 读取 worker: [workerName]
    const workerResult = extractors.bracket(ctx);
    if (!workerResult) return null;
    const worker = workerResult.value;
    ctx.pos += workerResult.consumed;

    // 2. 读取 level: Info/Error/Warn/Debug
    const levelResult = extractors.word(ctx);
    if (!levelResult) return null;
    const level = levelResult.value as LogEntry['level'];
    if (!['Info', 'Error', 'Warn', 'Debug'].includes(level)) return null;
    ctx.pos += levelResult.consumed;

    // 3. 读取 timestamp: 直到 "Got"
    const tsResult = extractors.until(ctx, 'Got');
    if (!tsResult) return null;
    const timestamp = tsResult.value;
    ctx.pos += tsResult.consumed;

    // 4. 跳过 "Got"
    ctx.pos += 3;
    while (ctx.pos < line.length && /\s/.test(line[ctx.pos])) ctx.pos++;

    // 5. 读取 result 类型
    const resultResult = extractors.word(ctx);
    if (!resultResult) return null;
    const resultType = resultResult.value;
    ctx.pos += resultResult.consumed;

    // 根据 result 类型选择解析路径
    switch (resultType) {
      case 'Success':
        return this.parseSuccessLine(ctx, worker, level, timestamp);
      case 'Error':
        return this.parseErrorLine(ctx, worker, level, timestamp);
      case 'Retrying':
        return this.parseRetryingLine(ctx, worker, level, timestamp);
      case 'Network':
        return this.parseNetworkErrorLine(ctx, worker, level, timestamp);
      default:
        return null;
    }
  }

  /** 解析 Success 行 */
  private parseSuccessLine(ctx: ParseContext, worker: string, level: LogEntry['level'], timestamp: string): LogEntry | null {
    const { line, pos } = ctx;

    // 可选：读取状态码数字
    let statusCode: number | undefined;
    let currentPos = pos;
    while (currentPos < line.length && /\s/.test(line[currentPos])) currentPos++;
    const numMatch = line.slice(currentPos).match(/^(\d+)\s+/);
    if (numMatch) {
      statusCode = parseInt(numMatch[1], 10);
      currentPos += numMatch[0].length;
    }

    // 读取 Method:URL
    const methodUrl = parseMethodUrl(line, currentPos);
    if (!methodUrl) return null;
    const { method, url, nextPos } = methodUrl;
    currentPos = nextPos;

    // 解析 header、body、duration
    const { headers, body, bodyRaw, duration, durationText } = this.parseTail(line, currentPos);

    return this.buildEntry({
      worker, level, timestamp, status: 'Success', statusCode,
      method, url, headers, body, bodyRaw, duration, durationText, rawLine: line,
    });
  }

  /** 解析 Error 行 */
  private parseErrorLine(ctx: ParseContext, worker: string, level: LogEntry['level'], timestamp: string): LogEntry | null {
    const { line, pos } = ctx;
    let currentPos = pos;

    // 可选：statusCode:XXX
    let statusCode: number | undefined;
    const scMatch = line.slice(currentPos).match(STATUS_CODE_REGEX);
    if (scMatch) {
      statusCode = parseInt(scMatch[1], 10);
      currentPos += scMatch[0].length;
    }

    // 读取 Method:URL
    const methodUrl = parseMethodUrl(line, currentPos);
    if (!methodUrl) return null;
    const { method, url, nextPos } = methodUrl;
    currentPos = nextPos;

    // 解析 header、body、duration
    const { headers, body, bodyRaw, duration, durationText } = this.parseTail(line, currentPos);

    return this.buildEntry({
      worker, level, timestamp, status: 'Error', statusCode,
      method, url, headers, body, bodyRaw, duration, durationText, rawLine: line,
    });
  }

  /** 解析 Retrying 行 */
  private parseRetryingLine(ctx: ParseContext, worker: string, level: LogEntry['level'], timestamp: string): LogEntry | null {
    const { line, pos } = ctx;

    // 格式: Retrying [N] METHOD:URL +duration
    const retryMatch = line.slice(pos).match(RETRYING_REGEX);
    if (!retryMatch) return null;

    const [, retryCount, method, url, durNum, durUnit] = retryMatch;
    const duration = parseDuration(durNum, durUnit);

    return this.buildEntry({
      worker, level, timestamp, status: 'Error',
      statusCode: undefined, statusText: `Retrying [${retryCount}]`,
      method: method.toUpperCase(), url: url.trim(), headers: {}, body: undefined, bodyRaw: undefined,
      duration, durationText: `+${durNum}${durUnit}`, rawLine: line,
    });
  }

  /** 解析 Network Error 行 */
  private parseNetworkErrorLine(ctx: ParseContext, worker: string, level: LogEntry['level'], timestamp: string): LogEntry | null {
    const { line, pos } = ctx;

    // 格式: Network Error METHOD:URL -> ErrorMsg +duration
    const netMatch = line.slice(pos).match(NETWORK_ERROR_REGEX);
    if (!netMatch) return null;

    const [, method, url, errorMsg, durNum, durUnit] = netMatch;
    const duration = parseDuration(durNum, durUnit);

    return this.buildEntry({
      worker, level, timestamp, status: 'Error',
      statusCode: undefined, statusText: `Network Error: ${errorMsg.trim()}`,
      method: method.toUpperCase(), url: url.trim(), headers: {}, body: undefined, bodyRaw: undefined,
      duration, durationText: `+${durNum}${durUnit}`, rawLine: line,
    });
  }

  /** 解析尾部：header、body、duration */
  private parseTail(line: string, startPos: number): {
    headers: Record<string, string>;
    body?: any;
    bodyRaw?: string;
    duration: number;
    durationText: string;
  } {
    let pos = startPos;
    const headers: Record<string, string> = {};
    let body: any = undefined;
    let bodyRaw: string | undefined;
    let duration = 0;
    let durationText = '+0ms';

    // 按 | 分段处理
    const remaining = line.slice(pos);
    const parts = remaining.split('|').map(p => p.trim());

    for (const part of parts) {
      if (part.startsWith('header ->')) {
        const raw = part.replace('header ->', '').trim();
        const pairs = raw.split('&');
        for (const pair of pairs) {
          const eq = pair.indexOf('=');
          if (eq > 0) {
            headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
          }
        }
      } else if (part.startsWith('body ->')) {
        bodyRaw = part.replace('body ->', '').trim();
        try {
          body = JSON.parse(bodyRaw);
        } catch {
          // 保留原始字符串
        }
      } else {
        // 检查是否是 duration
        const durMatch = part.match(/^\+(\d+)(ms|s)\s*$/);
        if (durMatch) {
          durationText = `+${durMatch[1]}${durMatch[2]}`;
          duration = parseDuration(durMatch[1], durMatch[2]);
        }
      }
    }

    // 如果上面没匹配到 duration，再尝试从行尾提取
    if (duration === 0) {
      const endMatch = line.match(/\+(\d+)(ms|s)\s*$/);
      if (endMatch) {
        durationText = `+${endMatch[1]}${endMatch[2]}`;
        duration = parseDuration(endMatch[1], endMatch[2]);
      }
    }

    return { headers, body, bodyRaw, duration, durationText };
  }

  /** 构建 LogEntry */
  private buildEntry(params: {
    worker: string;
    level: LogEntry['level'];
    timestamp: string;
    status: 'Success' | 'Error';
    statusCode?: number;
    statusText?: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
    bodyRaw?: string;
    duration: number;
    durationText: string;
    rawLine: string;
  }): LogEntry {
    const { worker, level, timestamp, status, statusCode, statusText, method, url, headers, body, bodyRaw, duration, durationText, rawLine } = params;
    let finalStatusCode = statusCode;

    // 解析 URL
    let domain = '';
    let path = '';
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname;
      path = urlObj.pathname;
    } catch {
      const m = url.match(/https?:\/\/([^/]+)(.*)/);
      if (m) { domain = m[1]; path = m[2] || ''; }
    }

    // 解析时间戳
    let timestampMs = parseTimestampMs(timestamp);

    // 确定状态文本
    let finalStatusText = statusText;
    if (!finalStatusText && finalStatusCode !== undefined) {
      const statusTexts: Record<number, string> = {
        400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
        404: 'Not Found', 429: 'Too Many Requests',
        500: 'Internal Server Error', 502: 'Bad Gateway',
        503: 'Service Unavailable', 504: 'Gateway Timeout',
      };
      finalStatusText = statusTexts[finalStatusCode];
    }

    // 从 body 中提取错误信息
    if (body && typeof body === 'object') {
      if (body.msg && !finalStatusText) {
        finalStatusText = body.msg;
      } else if (body.message && !finalStatusText) {
        finalStatusText = body.message;
      }
      if (finalStatusCode === undefined) {
        const code = extractStatusCodeFromBody(body);
        if (code !== undefined) finalStatusCode = code;
      }
    }

    return {
      id: `entry-${++this.entryIdCounter}`,
      worker,
      level,
      timestamp,
      timestampMs,
      method,
      url,
      domain,
      path,
      status,
      statusCode: finalStatusCode,
      statusText: finalStatusText,
      headers,
      body,
      bodyRaw,
      duration,
      durationText,
      friendlyName: getFriendlyName(url),
      rawLine,
    };
  }

  // ============ 分组、统计、洞察（保持不变） ============

  private groupEntries(entries: LogEntry[]): LogFlowGroup[] {
    const groups: LogFlowGroup[] = [];
    let currentGroup: LogEntry[] = [];

    for (const entry of entries) {
      currentGroup.push(entry);
      if (entry.status === "Error") {
        groups.push(this.createGroup(currentGroup));
        currentGroup = [];
      }
    }

    if (currentGroup.length > 0) {
      groups.push(this.createGroup(currentGroup));
    }

    return groups;
  }

  private createGroup(entries: LogEntry[]): LogFlowGroup {
    const successCount = entries.filter(e => e.status === 'Success').length;
    const errorCount = entries.filter(e => e.status === 'Error').length;
    const hasError = errorCount > 0;
    const names = entries.map(e => e.friendlyName);
    const uniqueNames = [...new Set(names)];

    return {
      id: `group-${entries[0]?.id || 'empty'}-${entries.length}`,
      startTime: entries[0]?.timestamp || '',
      endTime: entries[entries.length - 1]?.timestamp || '',
      entries,
      successCount,
      errorCount,
      hasError,
      summary: uniqueNames.join(' → '),
    };
  }

  private calculateStats(entries: LogEntry[]): LogStats {
    const total = entries.length;
    let success = 0;
    let error = 0;
    const errorMap = new Map<string, number>();
    const domainMap = new Map<string, { count: number; success: number; error: number }>();
    const levelMap = new Map<string, number>();
    const durationBuckets = DURATION_RANGES.map(range => ({ range: range.label, count: 0 }));

    for (const entry of entries) {
      if (entry.status === 'Success') success++;
      else error++;

      if (entry.status === 'Error') {
        const code = entry.statusCode !== undefined
          ? `${entry.statusCode}`
          : entry.statusText
            ? entry.statusText
            : 'Unknown';
        errorMap.set(code, (errorMap.get(code) || 0) + 1);
      }

      const current = domainMap.get(entry.domain) || { count: 0, success: 0, error: 0 };
      current.count++;
      if (entry.status === 'Success') current.success++;
      else current.error++;
      domainMap.set(entry.domain, current);

      levelMap.set(entry.level, (levelMap.get(entry.level) || 0) + 1);

      const bucket = DURATION_RANGES.findIndex(range => entry.duration >= range.min && entry.duration < range.max);
      if (bucket >= 0) durationBuckets[bucket].count++;
    }

    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;

    const errorTypes = Array.from(errorMap.entries())
      .map(([code, count]) => ({ code, count, percentage: error > 0 ? Math.round((count / error) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    const domainDistribution = Array.from(domainMap.entries())
      .map(([domain, data]) => ({ domain, ...data }))
      .sort((a, b) => b.count - a.count);

    const levelColors: Record<string, string> = {
      Info: '#1890ff',
      Warn: '#fa8c16',
      Error: '#ff4d4f',
      Debug: '#52c41a',
    };
    const levelDistribution = Array.from(levelMap.entries())
      .map(([level, count]) => ({
        level,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
        color: levelColors[level] || '#999',
      }))
      .sort((a, b) => b.count - a.count);

    return {
      total, success, error, successRate,
      errorTypes, domainDistribution, durationDistribution: durationBuckets, levelDistribution,
    };
  }

  private generateInsight(entries: LogEntry[], stats: LogStats): LogInsight {
    if (stats.error === 0) {
      return {
        summary: `所有请求均成功完成，共 ${stats.total} 个请求`,
        severity: 'success',
        detail: '当前视图仅基于日志文本统计成功、失败、耗时和分布情况。',
      };
    }

    const errorEntries = entries.filter(e => e.status === "Error");
    const errorCodes = [...new Set(errorEntries.map(e => e.statusCode).filter(code => code !== undefined))];
    const errorDomains = [...new Set(errorEntries.map(e => e.domain).filter(Boolean))];

    const domainCounts = new Map<string, number>();
    for (const e of errorEntries) {
      if (e.domain) {
        domainCounts.set(e.domain, (domainCounts.get(e.domain) || 0) + 1);
      }
    }
    const topErrorDomain = Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1])[0];

    if (errorCodes.length > 1) {
      return {
        summary: `共发现 ${errorCodes.length} 种不同状态码，失败 ${stats.error} 次`,
        severity: 'warning',
        detail: `涉及 ${errorDomains.length || 0} 个域名${topErrorDomain ? `，失败最多的是 ${topErrorDomain[0]}（${topErrorDomain[1]} 次）` : ''}。`,
      };
    }

    if (errorCodes.length === 1 && errorCodes[0]) {
      const code = errorCodes[0];
      return {
        summary: `状态码 ${code} 出现 ${stats.error} 次失败`,
        severity: stats.successRate < 80 ? 'error' : 'warning',
        detail: `涉及 ${errorDomains.length || 0} 个域名${topErrorDomain ? `，失败最多的是 ${topErrorDomain[0]}（${topErrorDomain[1]} 次）` : ''}。`,
      };
    }

    const errorTexts = [...new Set(errorEntries.map(e => e.statusText).filter((text): text is string => Boolean(text)))];
    if (errorTexts.length === 1 && errorTexts[0]) {
      return {
        summary: `错误文本 “${errorTexts[0]}” 出现 ${stats.error} 次`,
        severity: stats.successRate < 80 ? 'error' : 'warning',
        detail: `涉及 ${errorDomains.length || 0} 个域名${topErrorDomain ? `，失败最多的是 ${topErrorDomain[0]}（${topErrorDomain[1]} 次）` : ''}。`,
      };
    }

    return {
      summary: `检测到 ${stats.error} 次失败记录`,
      severity: stats.successRate < 80 ? 'error' : 'warning',
      detail: `当前仅展示日志中的状态、域名、耗时和原始内容，不基于 log 文件单独判断网络根因。`,
    };
  }
}

// ============ 解析器注册表 ============

const logParsers: LogParserStrategy[] = [
  new GoServiceLogParser(),
];

/**
 * 解析日志内容
 */
export function parseLogFile(
  content: string,
  onLineProgress?: (completed: number, total: number) => void,
): LogAnalysisResult {
  const parser = logParsers.find(p => p.canParse(content));
  if (!parser) {
    throw new Error('无法识别的日志格式，请确保上传的是 Go 服务日志文件');
  }
  return parser.parse(content, onLineProgress);
}

// GoServiceLogParser 导出，方便未来扩展
export { GoServiceLogParser };
