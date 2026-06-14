/**
 * Go 服务日志解析引擎 - 配置化版本（方案 C）
 * 采用配置驱动的方式解析日志，新增格式只需添加配置，无需修改解析引擎代码
 */

import { getFriendlyName, getErrorDiagnosis, getUnknownErrorSuggestion, DURATION_RANGES } from './logConstants';

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
  suggestion: string;
  diagnosis?: string;
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
  parse(content: string): LogAnalysisResult;
}

// ============ 配置化解析器 ============

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
    const regex = new RegExp(`\\${actualPrefix}(\\d+)(ms|s)\\s*$`);
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
    return firstLine.startsWith('[') && /^\[\w+\]\s+(Info|Error|Warn|Debug)/.test(firstLine);
  }

  parse(content: string): LogAnalysisResult {
    this.entryIdCounter = 0;
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n').filter(line => line.trim());
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const entry = this.parseLine(line);
      if (entry) entries.push(entry);
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
    const methodUrlMatch = line.slice(currentPos).match(/^(GET|POST|PUT|DELETE|PATCH):([^\s|]+)/);
    if (!methodUrlMatch) return null;
    const method = methodUrlMatch[1];
    const url = methodUrlMatch[2];
    currentPos += methodUrlMatch[0].length;

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
    const scMatch = line.slice(currentPos).match(/^\s*statusCode:(\d+)\s*/);
    if (scMatch) {
      statusCode = parseInt(scMatch[1], 10);
      currentPos += scMatch[0].length;
    }

    // 读取 Method:URL
    const methodUrlMatch = line.slice(currentPos).match(/^(GET|POST|PUT|DELETE|PATCH):([^\s|]+)/);
    if (!methodUrlMatch) return null;
    const method = methodUrlMatch[1];
    const url = methodUrlMatch[2];
    currentPos += methodUrlMatch[0].length;

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
    const retryMatch = line.slice(pos).match(/^\s*\[(\d+)\]\s*(GET|POST|PUT|DELETE|PATCH):(.+?)\s*\+\s*(\d+)(ms|s)\s*$/);
    if (!retryMatch) return null;

    const [, retryCount, method, url, durNum, durUnit] = retryMatch;
    const duration = durUnit === 's' ? parseInt(durNum, 10) * 1000 : parseInt(durNum, 10);

    return this.buildEntry({
      worker, level, timestamp, status: 'Error',
      statusCode: undefined, statusText: `Retrying [${retryCount}]`,
      method, url: url.trim(), headers: {}, body: undefined, bodyRaw: undefined,
      duration, durationText: `+${durNum}${durUnit}`, rawLine: line,
    });
  }

  /** 解析 Network Error 行 */
  private parseNetworkErrorLine(ctx: ParseContext, worker: string, level: LogEntry['level'], timestamp: string): LogEntry | null {
    const { line, pos } = ctx;

    // 格式: Network Error METHOD:URL -> ErrorMsg +duration
    const netMatch = line.slice(pos).match(/^\s*Error\s+(GET|POST|PUT|DELETE|PATCH):(.+?)\s*->\s*(.+?)\s*\+\s*(\d+)(ms|s)\s*$/);
    if (!netMatch) return null;

    const [, method, url, errorMsg, durNum, durUnit] = netMatch;
    const duration = durUnit === 's' ? parseInt(durNum, 10) * 1000 : parseInt(durNum, 10);

    return this.buildEntry({
      worker, level, timestamp, status: 'Error',
      statusCode: undefined, statusText: `Network Error: ${errorMsg.trim()}`,
      method, url: url.trim(), headers: {}, body: undefined, bodyRaw: undefined,
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
        const durMatch = part.match(/^(\+\d+(ms|s))\s*$/);
        if (durMatch) {
          durationText = durMatch[1];
          const num = parseInt(durationMatch(durationText), 10);
          duration = durationText.endsWith('s') ? num * 1000 : num;
        }
      }
    }

    // 如果上面没匹配到 duration，再尝试从行尾提取
    if (duration === 0) {
      const endMatch = line.match(/\+(\d+)(ms|s)\s*$/);
      if (endMatch) {
        durationText = `+${endMatch[1]}${endMatch[2]}`;
        duration = endMatch[2] === 's' ? parseInt(endMatch[1], 10) * 1000 : parseInt(endMatch[1], 10);
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
    let timestampMs = 0;
    try {
      timestampMs = new Date(timestamp.replace(/\//g, '-')).getTime();
      if (isNaN(timestampMs)) {
        const p = timestamp.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/);
        if (p) {
          timestampMs = new Date(+p[1], +p[2] - 1, +p[3], +p[4], +p[5], +p[6]).getTime();
        }
      }
    } catch { timestampMs = 0; }

    // 确定状态文本
    let finalStatusText = statusText;
    if (!finalStatusText && statusCode) {
      const statusTexts: Record<number, string> = {
        400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
        404: 'Not Found', 429: 'Too Many Requests',
        500: 'Internal Server Error', 502: 'Bad Gateway',
        503: 'Service Unavailable', 504: 'Gateway Timeout',
      };
      finalStatusText = statusTexts[statusCode];
    }

    // 从 body 中提取错误信息
    if (body && typeof body === 'object') {
      if (body.msg && !finalStatusText) {
        finalStatusText = body.msg;
      } else if (body.message && !finalStatusText) {
        finalStatusText = body.message;
      }
      if (!statusCode && body.code !== undefined) {
        const code = typeof body.code === 'number' ? body.code : parseInt(body.code, 10);
        if (code >= 400) {
          // 不覆盖已有的 statusCode
        }
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
      statusCode,
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
      if (entry.level === 'Error') {
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
      id: `group-${Math.random().toString(36).substr(2, 9)}`,
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
    const success = entries.filter(e => e.status === 'Success').length;
    const error = entries.filter(e => e.status === 'Error').length;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;

    // 错误类型分布
    const errorMap = new Map<string, number>();
    for (const entry of entries) {
      if (entry.status === 'Error') {
        const code = entry.statusCode
          ? `${entry.statusCode}`
          : entry.statusText
            ? entry.statusText
            : 'Unknown';
        errorMap.set(code, (errorMap.get(code) || 0) + 1);
      }
    }
    const errorTypes = Array.from(errorMap.entries())
      .map(([code, count]) => ({ code, count, percentage: error > 0 ? Math.round((count / error) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    // 域名分布
    const domainMap = new Map<string, { count: number; success: number; error: number }>();
    for (const entry of entries) {
      const current = domainMap.get(entry.domain) || { count: 0, success: 0, error: 0 };
      current.count++;
      if (entry.status === 'Success') current.success++;
      else current.error++;
      domainMap.set(entry.domain, current);
    }
    const domainDistribution = Array.from(domainMap.entries())
      .map(([domain, data]) => ({ domain, ...data }))
      .sort((a, b) => b.count - a.count);

    // 耗时分布
    const durationDistribution = DURATION_RANGES.map(range => ({
      range: range.label,
      count: entries.filter(e => e.duration >= range.min && e.duration < range.max).length,
    }));

    // 日志级别分布（新增）
    const levelMap = new Map<string, number>();
    for (const entry of entries) {
      levelMap.set(entry.level, (levelMap.get(entry.level) || 0) + 1);
    }
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
      errorTypes, domainDistribution, durationDistribution, levelDistribution,
    };
  }

  private generateInsight(entries: LogEntry[], stats: LogStats): LogInsight {
    if (stats.error === 0) {
      return {
        summary: `所有请求均成功完成，共 ${stats.total} 个请求`,
        severity: 'success',
        suggestion: '迁移顺利完成，无需进一步操作',
      };
    }

    const errorEntries = entries.filter(e => e.status === 'Error');
    const firstError = errorEntries[0];
    const errorCodes = [...new Set(errorEntries.map(e => e.statusCode).filter(Boolean))];

    if (errorCodes.length === 1 && errorCodes[0]) {
      const code = errorCodes[0];
      const diagnosis = getErrorDiagnosis(code, firstError.domain);
      if (diagnosis) {
        return {
          summary: `${firstError.friendlyName}持续被拒 (${code}${firstError.statusText ? ` ${firstError.statusText}` : ''})，共 ${stats.error} 次失败`,
          severity: 'error',
          suggestion: diagnosis.suggestion,
          diagnosis: diagnosis.description,
        };
      }
    }

    const errorTexts = [...new Set(errorEntries.map(e => e.statusText).filter(Boolean))];
    if (errorTexts.length === 1 && errorTexts[0] && !errorCodes.length) {
      const text = errorTexts[0];
      const errorDomains = [...new Set(errorEntries.map(e => e.domain).filter(Boolean))];
      const domainStr = errorDomains.length === 1 ? ` (${errorDomains[0]})` : '';
      const diagnosis = this.getDiagnosisByText(text, firstError.domain);
      if (diagnosis) {
        return {
          summary: `${firstError.friendlyName}持续失败 (${text})${domainStr}，共 ${stats.error} 次失败`,
          severity: 'error',
          suggestion: diagnosis.suggestion,
          diagnosis: diagnosis.description,
        };
      }
      return {
        summary: `${firstError.friendlyName}持续失败 (${text})${domainStr}，共 ${stats.error} 次失败`,
        severity: 'error',
        suggestion: getUnknownErrorSuggestion(),
      };
    }

    const domainCounts = new Map<string, number>();
    for (const e of errorEntries) {
      if (e.domain) {
        domainCounts.set(e.domain, (domainCounts.get(e.domain) || 0) + 1);
      }
    }
    const topErrorDomain = Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1])[0];

    if (topErrorDomain && topErrorDomain[1] >= stats.error * 0.5) {
      const domainEntry = errorEntries.find(e => e.domain === topErrorDomain[0]);
      if (domainEntry?.statusCode) {
        const diagnosis = getErrorDiagnosis(domainEntry.statusCode, domainEntry.domain);
        if (diagnosis) {
          return {
            summary: `${domainEntry.domain} 请求频繁失败 (${domainEntry.statusCode})，共 ${topErrorDomain[1]} 次`,
            severity: 'error',
            suggestion: diagnosis.suggestion,
            diagnosis: diagnosis.description,
          };
        }
      }
    }

    if (errorCodes.length > 1) {
      return {
        summary: `共发现 ${errorCodes.length} 种不同类型的错误，建议逐一排查`,
        severity: 'warning',
        suggestion: getUnknownErrorSuggestion(),
      };
    }

    return {
      summary: `检测到 ${stats.error} 次请求失败，具体原因无法自动判断`,
      severity: 'error',
      suggestion: getUnknownErrorSuggestion(),
    };
  }

  private getDiagnosisByText(statusText: string, domain: string): { description: string; suggestion: string } | null {
    const text = statusText.toLowerCase();
    if (text.includes('forbidden')) {
      if (domain.includes('feishu') || domain.includes('lark')) {
        return {
          description: '飞书应用权限不足',
          suggestion: '建议检查飞书应用权限配置，确认已申请相关 API 权限，或联系飞书客服',
        };
      }
      if (domain.includes('weixin') || domain.includes('qq.com')) {
        return {
          description: '微盘风控限流',
          suggestion: '单个用户每天约 200 次导出/下载限制，建议拆分迁移任务或次日重试，或联系企业微信服务同学解除限流',
        };
      }
      return {
        description: '权限不足或访问被拒绝',
        suggestion: '建议检查相关权限配置，或联系客服或工作人员协助排查',
      };
    }
    if (text.includes('unauthorized') || text.includes('unauthenticated')) {
      return { description: '未授权访问', suggestion: '检查认证信息是否有效，或重新登录后重试' };
    }
    if (text.includes('not found')) {
      return { description: '请求的资源不存在', suggestion: '检查请求地址是否正确，或确认资源是否已被删除' };
    }
    if (text.includes('too many') || text.includes('rate limit')) {
      return { description: '请求频率过高', suggestion: '降低并发请求数，或联系服务提供方调整限流策略' };
    }
    if (text.includes('timeout') || text.includes('timed out')) {
      return { description: '请求超时', suggestion: '检查网络状况或稍后重试' };
    }
    return null;
  }
}

// ============ 解析器注册表 ============

const logParsers: LogParserStrategy[] = [
  new GoServiceLogParser(),
];

/**
 * 判断内容是否为可解析的日志格式
 */
export function isLogFile(content: string): boolean {
  return logParsers.some(p => p.canParse(content));
}

/**
 * 解析日志内容
 */
export function parseLogFile(content: string): LogAnalysisResult {
  const parser = logParsers.find(p => p.canParse(content));
  if (!parser) {
    throw new Error('无法识别的日志格式，请确保上传的是 Go 服务日志文件');
  }
  return parser.parse(content);
}

// GoServiceLogParser 导出，方便未来扩展
export { GoServiceLogParser };

// 辅助函数
function durationMatch(text: string): string {
  const m = text.match(/\d+/);
  return m ? m[0] : '0';
}
