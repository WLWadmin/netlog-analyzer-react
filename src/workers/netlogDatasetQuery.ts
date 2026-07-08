import type { CompactEventIndex } from './netlogDatasetIndexer';
import type { NetlogIndexableFile } from './netlogDatasetIndexer';

export interface QueryNetlogEventsPayload {
  analysisId: string;
  page?: number;
  pageSize?: number;
  typeId?: number;
  sourceId?: number;
  sourceChainId?: number;
  sourceTypeId?: number;
  typeName?: string;
  sourceTypeName?: string;
  phase?: number;
  errorOnly?: boolean;
  startTime?: number;
  endTime?: number;
  searchText?: string;
  rawSearchScanLimit?: number;
  rawSearchTimeLimitMs?: number;
}

export interface NetlogEventRow {
  eventId: number;
  time: number;
  typeId: number;
  typeName: string;
  sourceId: number;
  sourceTypeId: number;
  sourceTypeName: string;
  phase: number;
  phaseName: string;
  hasError: boolean;
  byteStart: number;
  byteEnd: number;
}

export interface QueryNetlogEventsResult {
  analysisId: string;
  timeTickOffset?: number;
  page: number;
  pageSize: number;
  total: number;
  rows: NetlogEventRow[];
  scanned?: number;
  scanLimitHit?: boolean;
  timeLimitHit?: boolean;
  hasMoreMatchesUnknown?: boolean;
}

const DEFAULT_RAW_SEARCH_SCAN_LIMIT = 10_000;
const FILTERED_RAW_SEARCH_SCAN_LIMIT = 50_000;
const DEFAULT_RAW_SEARCH_TIME_LIMIT_MS = 2_000;

function buildSourceChain(index: CompactEventIndex, sourceId: number): Set<number> {
  const chain = new Set<number>([sourceId]);
  const queue = [sourceId];
  const from = index.sourceDependencyFrom || [];
  const to = index.sourceDependencyTo || [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (let i = 0; i < from.length; i += 1) {
      const a = from[i];
      const b = to[i];
      const next = a === current ? b : b === current ? a : undefined;
      if (next && !chain.has(next)) {
        chain.add(next);
        queue.push(next);
      }
    }
  }
  return chain;
}

function matches(index: CompactEventIndex, eventId: number, query: QueryNetlogEventsPayload, sourceChain?: Set<number>): boolean {
  if (query.typeId !== undefined && index.typeId[eventId] !== query.typeId) return false;
  if (query.sourceId !== undefined && index.sourceId[eventId] !== query.sourceId) return false;
  if (sourceChain && !sourceChain.has(index.sourceId[eventId])) return false;
  if (query.sourceTypeId !== undefined && index.sourceTypeId[eventId] !== query.sourceTypeId) return false;
  if (query.typeName && (index.eventTypeNames?.[index.typeId[eventId]] || '').toLowerCase() !== query.typeName.toLowerCase()) return false;
  if (query.sourceTypeName && (index.sourceTypeNames?.[index.sourceTypeId[eventId]] || '').toLowerCase() !== query.sourceTypeName.toLowerCase()) return false;
  if (query.phase !== undefined && index.phase[eventId] !== query.phase) return false;
  if (query.errorOnly && index.flags[eventId] !== 1) return false;
  const time = index.time[eventId] || 0;
  if (query.startTime !== undefined && time < query.startTime) return false;
  if (query.endTime !== undefined && time > query.endTime) return false;
  return true;
}

function phaseName(phase: number): string {
  if (phase === 0) return 'PHASE_BEGIN';
  if (phase === 1) return 'PHASE_END';
  if (phase === 2) return 'PHASE_NONE';
  return `PHASE_${phase}`;
}

function toRow(index: CompactEventIndex, eventId: number): NetlogEventRow {
  const typeId = index.typeId[eventId] || 0;
  const sourceTypeId = index.sourceTypeId[eventId] || 0;
  const phase = index.phase[eventId] || 0;
  return {
    eventId,
    time: index.time[eventId] || 0,
    typeId,
    typeName: index.eventTypeNames?.[typeId] || `UNKNOWN_${typeId}`,
    sourceId: index.sourceId[eventId] || 0,
    sourceTypeId,
    sourceTypeName: index.sourceTypeNames?.[sourceTypeId] || (sourceTypeId ? `UNKNOWN_SRC_${sourceTypeId}` : 'UNKNOWN_SRC'),
    phase,
    phaseName: phaseName(phase),
    hasError: index.flags[eventId] === 1,
    byteStart: index.byteStart[eventId],
    byteEnd: index.byteEnd[eventId],
  };
}

function hasStructuredRawSearchFilter(query: QueryNetlogEventsPayload): boolean {
  return query.typeId !== undefined ||
    query.sourceId !== undefined ||
    query.sourceChainId !== undefined ||
    query.sourceTypeId !== undefined ||
    Boolean(query.typeName) ||
    Boolean(query.sourceTypeName) ||
    query.phase !== undefined ||
    Boolean(query.errorOnly) ||
    query.startTime !== undefined ||
    query.endTime !== undefined;
}

export function queryNetlogEvents(index: CompactEventIndex, query: QueryNetlogEventsPayload): QueryNetlogEventsResult {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(500, Math.max(1, query.pageSize || 100));
  const start = (page - 1) * pageSize;
  const rows: NetlogEventRow[] = [];
  let total = 0;
  const sourceChain = query.sourceChainId !== undefined ? buildSourceChain(index, query.sourceChainId) : undefined;

  for (let eventId = 0; eventId < index.count; eventId++) {
    if (!matches(index, eventId, query, sourceChain)) continue;
    if (total >= start && rows.length < pageSize) {
      rows.push(toRow(index, eventId));
    }
    total += 1;
  }

  return {
    analysisId: query.analysisId,
    timeTickOffset: index.timeTickOffset,
    page,
    pageSize,
    total,
    rows,
  };
}

async function rawEventMatches(file: NetlogIndexableFile, index: CompactEventIndex, eventId: number, needle: string): Promise<boolean> {
  const start = index.byteStart[eventId];
  const end = index.byteEnd[eventId];
  if (start === undefined || end === undefined) return false;
  const text = await file.slice(start, end).text();
  return text.toLowerCase().includes(needle);
}

export async function queryNetlogEventsWithRawSearch(
  file: NetlogIndexableFile,
  index: CompactEventIndex,
  query: QueryNetlogEventsPayload
): Promise<QueryNetlogEventsResult> {
  const searchText = query.searchText?.trim().toLowerCase();
  if (!searchText) return queryNetlogEvents(index, query);

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(500, Math.max(1, query.pageSize || 100));
  const start = (page - 1) * pageSize;
  const rows: NetlogEventRow[] = [];
  let total = 0;
  let scanned = 0;
  let scanLimitHit = false;
  let timeLimitHit = false;
  const scanLimit = Math.max(1, query.rawSearchScanLimit ?? (hasStructuredRawSearchFilter(query) ? FILTERED_RAW_SEARCH_SCAN_LIMIT : DEFAULT_RAW_SEARCH_SCAN_LIMIT));
  const timeLimitMs = Math.max(0, query.rawSearchTimeLimitMs ?? DEFAULT_RAW_SEARCH_TIME_LIMIT_MS);
  const startedAt = Date.now();
  const sourceChain = query.sourceChainId !== undefined ? buildSourceChain(index, query.sourceChainId) : undefined;

  for (let eventId = 0; eventId < index.count; eventId++) {
    if (!matches(index, eventId, query, sourceChain)) continue;
    if (scanned >= scanLimit) {
      scanLimitHit = true;
      break;
    }
    if (Date.now() - startedAt >= timeLimitMs) {
      timeLimitHit = true;
      break;
    }
    scanned += 1;
    if (!(await rawEventMatches(file, index, eventId, searchText))) continue;
    if (total >= start && rows.length < pageSize) {
      rows.push(toRow(index, eventId));
    }
    total += 1;
  }

  return {
    analysisId: query.analysisId,
    timeTickOffset: index.timeTickOffset,
    page,
    pageSize,
    total,
    rows,
    scanned,
    scanLimitHit,
    timeLimitHit,
    hasMoreMatchesUnknown: scanLimitHit || timeLimitHit,
  };
}
