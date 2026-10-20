import { assertNoCompetingRootFormat, isRecord } from '../parsers/shared/rootFormatGuard';
import { harEntryStructureIssue } from './harEntryStructure';

export interface HarSourcePosition {
  /** Zero-based UTF-16 character offsets, end exclusive; NOT file byte offsets. */
  charStart: number;
  charEnd: number;
  line: number;
  column: number;
  /** Zero-based original array index. Absent after an uncountable damaged range. */
  originalEntryIndex?: number;
}

export interface HarExcludedEntry extends HarSourcePosition {
  kind: 'structure' | 'syntax' | 'unrecovered';
  reason: string;
  safeUrl?: string;
  urlBasis?: 'parsed-request';
  /** Only punctuation/whitespace is exposed; keys and values are masked. */
  structuralPreview: string;
}

export interface HarRepairInfo {
  repaired: boolean;
  recoveredEntries: number;
  /** A lower bound when totalEntriesExact is false. */
  totalEntries: number;
  droppedEntries: number;
  recoveryRate: number;
  reason: string;
  warnings: string[];
  totalEntriesExact?: boolean;
  structureIncompleteEntries?: number;
  syntaxDamagedEntries?: number;
  unknownRanges?: number;
  heuristicResynchronization?: boolean;
  retainedSources?: HarSourcePosition[];
  excludedEntries?: HarExcludedEntry[];
}

export interface HarRepairResult extends HarRepairInfo {
  data: unknown;
}

export const HAR_RECOVERY_LIMITATION =
  '当前诊断仅覆盖保留下来的请求；缺失请求不能作为没有失败、问题已经恢复或两份采集完整可比的证据。';

type HarRoot = { log: Record<string, unknown> & { entries: unknown[] } };
function isHarLike(data: unknown): data is HarRoot {
  return isRecord(data) && isRecord(data.log) && Array.isArray(data.log.entries);
}

function space(raw: string, start: number): number {
  let i = start;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  return i;
}

interface Boundary { end: number; mismatched?: boolean }

/**
 * One forward lexical pass. Never synthesize quotes or delimiters. Balanced
 * containers may still have invalid JSON grammar; JSON.parse checks each one.
 * A literal control character in a string destroys trustworthy synchronization.
 */
function valueBoundary(raw: string, start: number): Boundary | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let mismatched = false;
  const container = raw[start] === '{' || raw[start] === '[';
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch.charCodeAt(0) < 32) return undefined;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        if (!container) return { end: i + 1 };
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (!stack.length) return { end: i };
      if (stack.pop() !== ch) mismatched = true;
      if (!stack.length) return { end: i + 1, mismatched };
    } else if (!container && (ch === ',' || /\s/.test(ch))) {
      return { end: i };
    }
  }
  return !container && !inString ? { end: raw.length } : undefined;
}

/** Read direct properties only, validating every preceding value. Linear scan. */
function directProperty(raw: string, objectStart: number, wanted: string): number | undefined {
  if (raw[objectStart] !== '{') return undefined;
  let i = space(raw, objectStart + 1);
  while (raw[i] === '"') {
    const keyEnd = valueBoundary(raw, i);
    if (!keyEnd) return undefined;
    let key: unknown;
    try { key = JSON.parse(raw.slice(i, keyEnd.end)); } catch { return undefined; }
    i = space(raw, keyEnd.end);
    if (raw[i] !== ':') return undefined;
    i = space(raw, i + 1);
    if (key === wanted) return i;
    const end = valueBoundary(raw, i);
    if (!end || end.mismatched) return undefined;
    try { JSON.parse(raw.slice(i, end.end)); } catch { return undefined; }
    i = space(raw, end.end);
    if (raw[i] !== ',') return undefined;
    i = space(raw, i + 1);
  }
  return undefined;
}

function lineIndent(raw: string, offset: number): string | undefined {
  const prefix = raw.slice(raw.lastIndexOf('\n', offset - 1) + 1, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : undefined;
}

/**
 * A damaged extension (e.g. initiator stack) can contain surplus brackets while
 * the terminal request/response members remain intact. Accept that record's
 * closing fence only when its entire terminal member sequence parses, contains
 * both required objects, and leads to an independently valid sibling or array
 * end. Indentation is a fence, never the sole evidence. Strings are tracked so
 * body text cannot supply member names/fences. Only one tail is tried per record.
 */
function recoverEntryTailBoundary(raw: string, start: number): Boundary | undefined {
  const indent = lineIndent(raw, start);
  const firstKey = space(raw, start + 1);
  const memberIndent = lineIndent(raw, firstKey);
  if (raw[start] !== '{' || indent === undefined || memberIndent === undefined
    || memberIndent.length <= indent.length || raw[firstKey] !== '"') return undefined;

  let requestKey: number | undefined;
  let responseKey: number | undefined;
  let inString = false;
  let escaped = false;
  let lineStart = start + 1;
  let onlyIndent = false;
  for (let cursor = start + 1; cursor < raw.length; cursor++) {
    const ch = raw[cursor];
    if (inString) {
      if (ch.charCodeAt(0) < 32) return undefined;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '\n') { lineStart = cursor + 1; onlyIndent = true; continue; }
    if (onlyIndent && (ch === ' ' || ch === '\t')) continue;
    const prefix = onlyIndent ? raw.slice(lineStart, cursor) : undefined;
    onlyIndent = false;
    // Never cross another record fence searching for a convenient tail. Only
    // the final pair is validated, avoiding repeated parsing of long suffixes.
    if (ch === '}' && prefix === indent) {
      if (requestKey === undefined || responseKey === undefined) return undefined;
      const tail = raw.slice(Math.min(requestKey, responseKey), cursor + 1);
      try {
        if (harEntryStructureIssue(JSON.parse(`{${tail}`))) return undefined;
      } catch { return undefined; }
      const after = space(raw, cursor + 1);
      if (raw[after] === ']') return { end: cursor + 1 };
      if (raw[after] !== ',') return undefined;
      const sibling = space(raw, after + 1);
      if (lineIndent(raw, sibling) !== indent || raw[sibling] !== '{') return undefined;
      const siblingEnd = valueBoundary(raw, sibling);
      if (!siblingEnd || siblingEnd.mismatched) return undefined;
      try {
        if (harEntryStructureIssue(JSON.parse(raw.slice(sibling, siblingEnd.end)))) return undefined;
      } catch { return undefined; }
      return { end: cursor + 1 };
    }
    if (ch === '"') {
      if (prefix === memberIndent) {
        const key = /^(?:"(request|response)")\s*:/.exec(raw.slice(cursor, cursor + 32))?.[1];
        if (key === 'request') requestKey = cursor;
        if (key === 'response') responseKey = cursor;
      }
      inString = true;
    }
  }
  return undefined;
}

function findEntriesArray(raw: string): { start: number; prefix: HarRoot } {
  const log = directProperty(raw, space(raw, 0), 'log');
  const start = log === undefined ? undefined : directProperty(raw, log, 'entries');
  if (start === undefined || raw[start] !== '[') {
    throw new Error('文件不是可确认的 HAR 根级 log.entries，无法安全恢复');
  }
  let prefix: unknown;
  try { prefix = JSON.parse(raw.slice(0, start + 1) + ']}}'); } catch {
    throw new Error('HAR 前置结构无法确认，无法安全恢复');
  }
  if (!isHarLike(prefix)) throw new Error('文件不是标准 HAR 结构');
  assertNoCompetingRootFormat(prefix, 'har');
  return { start, prefix };
}

function safeRequestUrl(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.request) || typeof value.request.url !== 'string') return undefined;
  try {
    const url = new URL(value.request.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.origin + url.pathname;
  } catch { return undefined; }
}

function structuralPreview(raw: string, start: number, end: number): string {
  // Do not echo JSON.parse errors, keys, literals, or partially decoded secrets.
  return raw.slice(start, Math.min(end, start + 600)).replace(/[^\s{}[\],:"]/g, '•');
}

/** Explicit projection: parsed HAR data must never travel inside repairInfo. */
export function harRepairInfo(result: HarRepairResult): HarRepairInfo {
  const { data, ...info } = result;
  return info;
}

export function parseHarWithRepair(raw: string): HarRepairResult {
  let parsed: unknown;
  let validJson = true;
  try { parsed = JSON.parse(raw); } catch { validJson = false; }
  if (validJson) {
    if (!isHarLike(parsed)) throw new Error('文件不是标准 HAR 结构，缺少 log.entries 数组');
    assertNoCompetingRootFormat(parsed, 'har');
    if (parsed.log.entries.every(entry => !harEntryStructureIssue(entry))) {
      return {
        repaired: false, data: parsed, recoveredEntries: parsed.log.entries.length,
        totalEntries: parsed.log.entries.length, droppedEntries: 0, recoveryRate: 100,
        totalEntriesExact: true, reason: 'HAR 文件完整，无需修复', warnings: [],
      };
    }
  }

  const location = findEntriesArray(raw);
  const entries: unknown[] = [];
  const retainedSources: HarSourcePosition[] = [];
  const excludedEntries: HarExcludedEntry[] = [];
  let i = space(raw, location.start + 1);
  let ordinal: number | undefined = 0;
  let blocks = 0;
  let exact = true;
  let heuristic = false;
  let arrayEnd: number | undefined;
  let line = 1;
  let column = 1;
  let positionCursor = 0;
  // Position bookkeeping advances monotonically, including multibyte text/CRLF.
  const position = (start: number, end: number): HarSourcePosition => {
    while (positionCursor < start) {
      if (raw[positionCursor++] === '\n') { line++; column = 1; } else column++;
    }
    return { charStart: start, charEnd: end, line, column, originalEntryIndex: ordinal };
  };
  const unknown = (start: number, end: number, reason: string) => {
    excludedEntries.push({
      ...position(start, end), originalEntryIndex: undefined,
      kind: 'unrecovered', reason, structuralPreview: structuralPreview(raw, start, end),
    });
    exact = false;
    ordinal = undefined;
  };

  while (i < raw.length && raw[i] !== ']') {
    const start = i;
    let boundary = valueBoundary(raw, start);
    if (boundary?.mismatched) {
      const recoveredBoundary = recoverEntryTailBoundary(raw, start);
      if (recoveredBoundary) {
        boundary = recoveredBoundary;
        heuristic = true;
      }
    }
    if (!boundary || boundary.end <= start) {
      unknown(start, raw.length, '字符串或容器边界无法确认，已停止恢复此片段');
      i = raw.length;
      break;
    }
    const next = space(raw, boundary.end);
    // Mismatched delimiters are never counted as a known entry. Resynchronize
    // only at a lexical sibling separator; the next candidate is independently
    // scanned and parsed. No regex/indentation or suffix-search guessing.
    if (boundary.mismatched) {
      unknown(start, boundary.end, '容器闭合符不匹配，片段内请求数量未知');
      heuristic = true;
    } else {
      let candidate: unknown;
      let syntax = false;
      try { candidate = JSON.parse(raw.slice(start, boundary.end)); } catch { syntax = true; }
      const issue = syntax ? 'JSON 语法损坏' : harEntryStructureIssue(candidate);
      const source = position(start, boundary.end);
      blocks++;
      if (issue) {
        const safeUrl = syntax ? undefined : safeRequestUrl(candidate);
        excludedEntries.push({
          ...source, kind: syntax ? 'syntax' : 'structure', reason: issue,
          ...(safeUrl ? { safeUrl, urlBasis: 'parsed-request' as const } : {}),
          structuralPreview: structuralPreview(raw, start, boundary.end),
        });
      } else {
        entries.push(candidate);
        retainedSources.push(source);
      }
      if (ordinal !== undefined) ordinal++;
    }
    i = next;
    if (raw[i] === ',') {
      i = space(raw, i + 1);
      continue;
    }
    if (raw[i] === ']' || i === raw.length) break;
    unknown(i, raw.length, '请求之间的分隔结构无法确认，已停止恢复此片段');
    i = raw.length;
    break;
  }
  if (raw[i] === ']') arrayEnd = i;
  else exact = false;

  let data: HarRoot = location.prefix;
  if (arrayEnd !== undefined) {
    // Preserve metadata on either side, and run the original competing-format
    // guard on the full root even if an entry in the middle was invalid.
    const skeleton = raw.slice(0, location.start + 1) + raw.slice(arrayEnd);
    let envelope: unknown;
    try { envelope = JSON.parse(skeleton); } catch {
      // Only missing outer closing braces are accepted; never fill entry data.
      const tail = raw.slice(arrayEnd + 1).trim();
      if (tail !== '' && tail !== '}') {
        throw new Error('HAR 外层结构损坏或格式不明确，无法可靠恢复');
      }
      envelope = location.prefix;
    }
    if (!isHarLike(envelope)) throw new Error('HAR 外层结构不明确');
    assertNoCompetingRootFormat(envelope, 'har');
    data = envelope;
  }
  if (!entries.length) {
    const structural = excludedEntries.some(item => item.kind === 'structure');
    throw new Error(structural
      ? 'HAR entry 结构不完整，无可用请求'
      : 'HAR JSON 语法损坏，无可用请求或无法可靠恢复');
  }
  const structure = excludedEntries.filter(item => item.kind === 'structure').length;
  const syntax = excludedEntries.filter(item => item.kind === 'syntax').length;
  const ranges = excludedEntries.filter(item => item.kind === 'unrecovered').length;
  const reason = exact
    ? `已保留 ${entries.length} 条完整请求；另有 ${syntax} 条 JSON 损坏记录、${structure} 条结构不完整记录未参与分析。`
    : `至少恢复 ${entries.length} 条完整请求；存在无法确认总数的未恢复部分。`;
  return {
    repaired: true, data: { ...data, log: { ...data.log, entries } },
    recoveredEntries: entries.length, totalEntries: blocks,
    droppedEntries: syntax + structure,
    // Compatibility field only; unknown totals must never render a percentage.
    recoveryRate: exact ? Math.floor(entries.length / blocks * 1000) / 10 : 0,
    totalEntriesExact: exact, structureIncompleteEntries: structure,
    syntaxDamagedEntries: syntax, unknownRanges: ranges,
    heuristicResynchronization: heuristic, retainedSources, excludedEntries,
    reason, warnings: [HAR_RECOVERY_LIMITATION],
  };
}
