import type { CompactEventIndex } from './netlogDatasetIndexer';
import type { NetlogIndexableFile } from './netlogDatasetIndexer';
import { numericColumnAt } from './chunkedNumericColumn';

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
  if (index.sourceAdjacency) {
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      for (const next of postingItems(index.sourceAdjacency, current) || []) {
        if (!chain.has(next)) {
          chain.add(next);
          queue.push(next);
        }
      }
    }
    return chain;
  }
  const from = index.sourceDependencyFrom || [];
  const to = index.sourceDependencyTo || [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (let i = 0; i < from.length; i += 1) {
      const a = numericColumnAt(from, i);
      const b = numericColumnAt(to, i);
      const next = a === current ? b : b === current ? a : undefined;
      if (next && !chain.has(next)) {
        chain.add(next);
        queue.push(next);
      }
    }
  }
  return chain;
}

function postingEventIds(
  posting: CompactEventIndex['typePostings'],
  value: number,
): Uint32Array | undefined {
  return posting ? postingItems(posting, value) : undefined;
}

function postingItems(
  posting: NonNullable<CompactEventIndex['typePostings']>,
  key: number,
): Uint32Array {
  let low = 0;
  let high = posting.keys.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = posting.keys[middle];
    if (candidate === key) {
      return posting.items.subarray(posting.starts[middle], posting.starts[middle + 1]);
    }
    if (candidate < key) low = middle + 1;
    else high = middle - 1;
  }
  return new Uint32Array();
}

function findNamedIds(names: Record<number, string> | undefined, name: string): number[] {
  const expected = name.toLowerCase();
  const matches: number[] = [];
  for (const [id, candidate] of Object.entries(names || {})) {
    if (candidate.toLowerCase() === expected) matches.push(Number(id));
  }
  return matches;
}

function sourceChainEventIds(index: CompactEventIndex, sourceChain: Set<number>): Uint32Array | undefined {
  const ranges = Array.from(sourceChain, sourceId => {
    const start = index.sourceFirstEventId?.[sourceId];
    const end = index.sourceLastEventId?.[sourceId];
    return start === undefined || end === undefined ? undefined : { start, end };
  }).filter((range): range is { start: number; end: number } => Boolean(range))
    .sort((left, right) => left.start - right.start);
  if (ranges.length === 0) return undefined;
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  const count = merged.reduce((total, range) => total + range.end - range.start + 1, 0);
  if (count > index.count / 2) return undefined;
  const eventIds = new Uint32Array(count);
  let cursor = 0;
  for (const range of merged) {
    for (let eventId = range.start; eventId <= range.end; eventId += 1) {
      eventIds[cursor] = eventId;
      cursor += 1;
    }
  }
  return eventIds;
}

function sourceEventIds(index: CompactEventIndex, sourceId: number): Uint32Array | undefined {
  const start = index.sourceFirstEventId?.[sourceId];
  const end = index.sourceLastEventId?.[sourceId];
  if (start === undefined || end === undefined || end - start + 1 > index.count / 2) {
    return undefined;
  }
  const eventIds = new Uint32Array(end - start + 1);
  for (let offset = 0; offset < eventIds.length; offset += 1) {
    eventIds[offset] = start + offset;
  }
  return eventIds;
}

function selectCandidateEventIds(
  index: CompactEventIndex,
  query: QueryNetlogEventsPayload,
  sourceChain?: Set<number>,
): Uint32Array | undefined {
  const candidates: Uint32Array[] = [];
  if (query.typeId !== undefined) {
    const ids = postingEventIds(index.typePostings, query.typeId);
    if (ids) candidates.push(ids);
  } else if (query.typeName && index.typePostings) {
    const typeIds = findNamedIds(index.eventTypeNames, query.typeName);
    if (typeIds.length === 0) candidates.push(new Uint32Array());
    if (typeIds.length === 1) candidates.push(postingEventIds(index.typePostings, typeIds[0])!);
  }
  if (query.sourceId !== undefined) {
    const ids = sourceEventIds(index, query.sourceId);
    if (ids) candidates.push(ids);
  }
  if (query.errorOnly && index.errorEventIds) candidates.push(index.errorEventIds);
  if (sourceChain) {
    const ids = sourceChainEventIds(index, sourceChain);
    if (ids) candidates.push(ids);
  }
  return candidates.reduce<Uint32Array | undefined>(
    (smallest, ids) => !smallest || ids.length < smallest.length ? ids : smallest,
    undefined,
  );
}

function matches(index: CompactEventIndex, eventId: number, query: QueryNetlogEventsPayload, sourceChain?: Set<number>): boolean {
  const typeId = numericColumnAt(index.typeId, eventId) || 0;
  const sourceId = numericColumnAt(index.sourceId, eventId) || 0;
  const sourceTypeId = numericColumnAt(index.sourceTypeId, eventId) || 0;
  if (query.typeId !== undefined && typeId !== query.typeId) return false;
  if (query.sourceId !== undefined && sourceId !== query.sourceId) return false;
  if (sourceChain && !sourceChain.has(sourceId)) return false;
  if (query.sourceTypeId !== undefined && sourceTypeId !== query.sourceTypeId) return false;
  if (query.typeName && (index.eventTypeNames?.[typeId] || '').toLowerCase() !== query.typeName.toLowerCase()) return false;
  if (query.sourceTypeName && (index.sourceTypeNames?.[sourceTypeId] || '').toLowerCase() !== query.sourceTypeName.toLowerCase()) return false;
  if (query.phase !== undefined && numericColumnAt(index.phase, eventId) !== query.phase) return false;
  if (query.errorOnly && numericColumnAt(index.flags, eventId) !== 1) return false;
  const time = numericColumnAt(index.time, eventId) || 0;
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
  const typeId = numericColumnAt(index.typeId, eventId) || 0;
  const sourceTypeId = numericColumnAt(index.sourceTypeId, eventId) || 0;
  const phase = numericColumnAt(index.phase, eventId) || 0;
  return {
    eventId,
    time: numericColumnAt(index.time, eventId) || 0,
    typeId,
    typeName: index.eventTypeNames?.[typeId] || `UNKNOWN_${typeId}`,
    sourceId: numericColumnAt(index.sourceId, eventId) || 0,
    sourceTypeId,
    sourceTypeName: index.sourceTypeNames?.[sourceTypeId] || (sourceTypeId ? `UNKNOWN_SRC_${sourceTypeId}` : 'UNKNOWN_SRC'),
    phase,
    phaseName: phaseName(phase),
    hasError: numericColumnAt(index.flags, eventId) === 1,
    byteStart: numericColumnAt(index.byteStart, eventId) || 0,
    byteEnd: numericColumnAt(index.byteEnd, eventId) || 0,
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
  if (!hasStructuredRawSearchFilter(query)) {
    const end = Math.min(index.count, start + pageSize);
    for (let eventId = start; eventId < end; eventId += 1) {
      rows.push(toRow(index, eventId));
    }
    return {
      analysisId: query.analysisId,
      timeTickOffset: index.timeTickOffset,
      page,
      pageSize,
      total: index.count,
      rows,
    };
  }
  let total = 0;
  const sourceChain = query.sourceChainId !== undefined ? buildSourceChain(index, query.sourceChainId) : undefined;
  const candidates = selectCandidateEventIds(index, query, sourceChain);
  const candidateCount = candidates?.length ?? index.count;

  for (let candidateId = 0; candidateId < candidateCount; candidateId += 1) {
    const eventId = candidates?.[candidateId] ?? candidateId;
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
  const start = numericColumnAt(index.byteStart, eventId);
  const end = numericColumnAt(index.byteEnd, eventId);
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
  const candidates = selectCandidateEventIds(index, query, sourceChain);
  const candidateCount = candidates?.length ?? index.count;

  for (let candidateId = 0; candidateId < candidateCount; candidateId += 1) {
    const eventId = candidates?.[candidateId] ?? candidateId;
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
