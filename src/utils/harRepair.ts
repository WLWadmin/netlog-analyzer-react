/**
 * HAR JSON 修复工具
 *
 * 核心策略：状态机扫描 entries 数组，保留完整闭合的 entry，丢弃损坏尾部
 */

export interface HarRepairResult {
  repaired: boolean;
  data: unknown;
  recoveredEntries: number;
  totalEntries: number;
  droppedEntries: number;
  recoveryRate: number;
  reason: string;
  warnings: string[];
}

/** 校验是否为 HAR 结构 */
function isHarLike(data: unknown): data is { log: { entries: unknown[] } } {
  return (
    !!data &&
    typeof data === 'object' &&
    !!(data as any).log &&
    typeof (data as any).log === 'object' &&
    Array.isArray((data as any).log.entries)
  );
}

export function parseHarWithRepair(raw: string): HarRepairResult {
  try {
    const data = JSON.parse(raw);

    if (!isHarLike(data)) {
      throw new Error('文件不是标准 HAR 结构，缺少 log.entries 数组');
    }

    const entries = data.log.entries.length;

    return {
      repaired: false,
      data,
      recoveredEntries: entries,
      totalEntries: entries,
      droppedEntries: 0,
      recoveryRate: 100,
      reason: 'HAR 文件完整，无需修复',
      warnings: [],
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('不是标准 HAR')) {
      throw err;
    }
    return repairHarJson(raw, err as SyntaxError);
  }
}

function repairHarJson(raw: string, parseError?: SyntaxError): HarRepairResult {
  // 策略1：完整 entry 恢复（主策略）
  const entryRepair = repairByCompleteEntries(raw, parseError);
  if (entryRepair) return entryRepair;

  // 策略2：末尾补全兜底
  const bracketRepair = repairByClosingJsonTail(raw, parseError);
  if (bracketRepair) return bracketRepair;

  // 所有策略失败
  throw new Error(
    [
      'HAR 文件损坏严重，无法自动修复。',
      parseError ? `原始错误：${parseError.message}` : '',
      '',
      '已尝试：',
      '1. 扫描 log.entries 并恢复完整请求',
      '2. 自动补全 JSON 尾部括号和字符串',
      '',
      '建议：',
      '1. 重新从 Chrome DevTools Network 面板导出 HAR',
      '2. 导出前停止录制，等待 Network 面板稳定',
      '3. 如果文件很大，建议关闭 Preserve log 后重新采集',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

// ========== 字符串工具 ==========

/** 找到字符串结束位置（处理转义） */
function findStringEnd(raw: string, quoteStart: number): number {
  let escaped = false;
  for (let i = quoteStart + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') return i;
  }
  return -1;
}

/** 在 JSON key 位置查找指定 key，跳过所有字符串值 */
function findJsonKey(raw: string, key: string, from = 0, to = raw.length): number {
  const needle = `"${key}"`;
  for (let i = from; i < to && i < raw.length; i++) {
    if (raw[i] !== '"') continue;
    if (raw.startsWith(needle, i)) {
      let j = i + needle.length;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      if (raw[j] === ':') return i;
    }
    const end = findStringEnd(raw, i);
    if (end === -1) return -1;
    i = end;
  }
  return -1;
}

/** 统计 JSON key 出现次数，跳过所有字符串值 */
function countJsonKey(raw: string, key: string): number {
  const needle = `"${key}"`;
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '"') continue;
    if (raw.startsWith(needle, i)) {
      let j = i + needle.length;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      if (raw[j] === ':') count++;
    }
    const end = findStringEnd(raw, i);
    if (end === -1) break;
    i = end;
  }
  return count;
}

// ========== 策略1：完整 entry 恢复 ==========

interface EntriesArrayLocation {
  keyStart: number;
  arrayStart: number;
}

function findEntriesArray(raw: string): EntriesArrayLocation | null {
  const logKeyStart = findJsonKey(raw, 'log');

  let searchStart = 0;
  let searchEnd = raw.length;

  if (logKeyStart !== -1) {
    const colon = raw.indexOf(':', logKeyStart);
    const logObjectStart = colon === -1 ? -1 : raw.indexOf('{', colon);
    if (logObjectStart !== -1) {
      searchStart = logObjectStart;
      const logObjectEnd = findMatchingToken(raw, logObjectStart, '{', '}');
      if (logObjectEnd !== -1) searchEnd = logObjectEnd;
    }
  }

  let keyStart = searchStart;
  while (
    keyStart < searchEnd &&
    (keyStart = findJsonKey(raw, 'entries', keyStart, searchEnd)) !== -1 &&
    keyStart < searchEnd
  ) {
    let i = keyStart + '"entries"'.length;
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (raw[i] !== ':') {
      keyStart++;
      continue;
    }
    i++;
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (raw[i] === '[') return { keyStart, arrayStart: i };
    keyStart++;
  }
  return null;
}

interface CompleteEntryScanResult {
  entriesJson: string;
  recoveredEntries: number;
  lastCompleteEntryEnd: number;
}

function scanCompleteEntries(raw: string, entriesArrayStart: number): CompleteEntryScanResult | null {
  let i = entriesArrayStart + 1;
  let inString = false;
  let escaped = false;
  let objectDepth = 0;
  let arrayDepth = 0;
  let entryStart = -1;
  let lastCompleteEntryEnd = -1;
  let recoveredEntries = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      i++;
      continue;
    }

    if (ch === '{') {
      if (objectDepth === 0 && arrayDepth === 0) entryStart = i;
      objectDepth++;
    } else if (ch === '}') {
      if (objectDepth === 0) {
        i++;
        continue;
      }
      objectDepth--;
      if (objectDepth === 0 && arrayDepth === 0 && entryStart !== -1) {
        lastCompleteEntryEnd = i;
        recoveredEntries++;
        entryStart = -1;
      }
    } else if (ch === '[') {
      arrayDepth++;
    } else if (ch === ']') {
      if (objectDepth === 0 && arrayDepth === 0) break;
      if (arrayDepth > 0) arrayDepth--;
    }
    i++;
  }

  if (recoveredEntries === 0 || lastCompleteEntryEnd === -1) return null;

  const entriesJson = raw.slice(entriesArrayStart + 1, lastCompleteEntryEnd + 1);
  return { entriesJson, recoveredEntries, lastCompleteEntryEnd };
}

interface HarMetadata {
  version: string;
  creator: unknown;
  browser?: unknown;
  pages: unknown[];
  comment?: string;
}

function extractHarMetadata(raw: string, entriesKeyStart: number): HarMetadata {
  const prefix = raw.slice(0, entriesKeyStart);
  return {
    version: extractStringField(prefix, 'version') || '1.2',
    creator: extractObjectField(prefix, 'creator') || { name: 'Recovered HAR', version: '1.0' },
    browser: extractObjectField(prefix, 'browser') || undefined,
    pages: extractArrayField(prefix, 'pages') || [],
    comment: extractStringField(prefix, 'comment') || undefined,
  };
}

function extractStringField(raw: string, field: string): string | null {
  const idx = findJsonKey(raw, field);
  if (idx === -1) return null;
  const colon = raw.indexOf(':', idx);
  if (colon === -1) return null;
  let quote = colon + 1;
  while (quote < raw.length && /\s/.test(raw[quote])) quote++;
  if (raw[quote] !== '"') return null;
  const endQuote = findStringEnd(raw, quote);
  if (endQuote === -1) return null;
  try {
    return JSON.parse(raw.slice(quote, endQuote + 1));
  } catch {
    return null;
  }
}

function extractObjectField(raw: string, field: string): unknown | null {
  const idx = findJsonKey(raw, field);
  if (idx === -1) return null;
  const colon = raw.indexOf(':', idx);
  if (colon === -1) return null;
  let scan = colon + 1;
  while (scan < raw.length && /\s/.test(raw[scan])) scan++;
  if (raw[scan] !== '{') return null;
  const objectStart = scan;
  const objectEnd = findMatchingToken(raw, objectStart, '{', '}');
  if (objectEnd === -1) return null;
  try {
    return JSON.parse(raw.slice(objectStart, objectEnd + 1));
  } catch {
    return null;
  }
}

function extractArrayField(raw: string, field: string): unknown[] | null {
  const idx = findJsonKey(raw, field);
  if (idx === -1) return null;
  const colon = raw.indexOf(':', idx);
  if (colon === -1) return null;
  let scan = colon + 1;
  while (scan < raw.length && /\s/.test(raw[scan])) scan++;
  if (raw[scan] !== '[') return null;
  const arrayStart = scan;
  const arrayEnd = findMatchingToken(raw, arrayStart, '[', ']');
  if (arrayEnd === -1) return null;
  try {
    const value = JSON.parse(raw.slice(arrayStart, arrayEnd + 1));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function findMatchingToken(raw: string, start: number, openToken: '{' | '[', closeToken: '}' | ']'): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        continue;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === openToken) depth++;
    else if (ch === closeToken) {
      if (depth <= 0) return -1;
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function repairByCompleteEntries(raw: string, parseError?: SyntaxError): HarRepairResult | null {
  const entriesLocation = findEntriesArray(raw);
  if (!entriesLocation) return null;

  const scanResult = scanCompleteEntries(raw, entriesLocation.arrayStart);
  if (!scanResult) return null;

  let entries: unknown[];
  try {
    entries = JSON.parse(`[${scanResult.entriesJson}]`);
  } catch {
    return null;
  }

  const metadata = extractHarMetadata(raw, entriesLocation.keyStart);
  const estimatedTotal = estimateTotalEntries(raw);

  const log: Record<string, unknown> = {
    version: metadata.version,
    creator: metadata.creator,
    pages: metadata.pages,
    entries,
  };
  if (metadata.browser) log.browser = metadata.browser;
  if (metadata.comment) log.comment = metadata.comment;

  const data = { log };
  const recovered = entries.length;
  const total = Math.max(estimatedTotal, recovered);
  const dropped = Math.max(total - recovered, 0);
  const recoveryRate = Math.round((recovered / Math.max(total, 1)) * 100);

  return {
    repaired: true,
    data,
    recoveredEntries: recovered,
    totalEntries: total,
    droppedEntries: dropped,
    recoveryRate,
    reason: `HAR 文件可能在导出过程中被截断，已恢复 ${recovered}/${total} 条完整请求。`,
    warnings: [
      dropped > 0 ? `最后 ${dropped} 条疑似损坏请求已被丢弃。` : '未发现需要丢弃的请求。',
      parseError ? `原始解析错误：${parseError.message}` : '',
    ].filter(Boolean),
  };
}

// ========== 策略2：末尾补全兜底 ==========

function repairByClosingJsonTail(raw: string, parseError?: SyntaxError): HarRepairResult | null {
  const suffix = buildJsonClosingSuffix(raw);
  if (!suffix) return null;

  const candidate = raw + suffix;
  try {
    const data = JSON.parse(candidate);

    if (!isHarLike(data)) return null;

    const entries = data.log.entries.length;
    const estimatedTotal = estimateTotalEntries(raw);

    if (entries === 0 && estimatedTotal > 1) return null;

    const total = Math.max(estimatedTotal, entries);
    const dropped = Math.max(total - entries, 0);
    const recoveryRate = Math.round((entries / Math.max(total, 1)) * 100);

    return {
      repaired: true,
      data,
      recoveredEntries: entries,
      totalEntries: total,
      droppedEntries: dropped,
      recoveryRate,
      reason: 'HAR JSON 尾部结构缺失，已自动补全括号和字符串。',
      warnings: [
        '该修复方式会保留最后一个未完整闭合的对象，请检查最后几条请求的数据是否完整。',
        dropped > 0 ? `估算仍有 ${dropped} 条请求未恢复。` : '',
        parseError ? `原始解析错误：${parseError.message}` : '',
      ].filter(Boolean),
    };
  } catch {
    return null;
  }
}

function buildJsonClosingSuffix(raw: string): string | null {
  const stack: Array<'}' | ']'> = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        continue;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) stack.pop();
    }
  }

  let suffix = '';
  if (inString) suffix += '"';
  while (stack.length > 0) suffix += stack.pop();
  return suffix || null;
}

// ========== 工具函数 ==========

function estimateTotalEntries(raw: string): number {
  const startedDateTimeCount = countJsonKey(raw, 'startedDateTime');
  const requestCount = countJsonKey(raw, 'request');
  const responseCount = countJsonKey(raw, 'response');
  return Math.max(startedDateTimeCount, requestCount, responseCount, 1);
}
