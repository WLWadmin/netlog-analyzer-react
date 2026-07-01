import type { CompactEventIndex } from './netlogDatasetIndexer';

export interface QueryNetlogEventsPayload {
  analysisId: string;
  page?: number;
  pageSize?: number;
  typeId?: number;
  sourceId?: number;
  sourceTypeId?: number;
  phase?: number;
  errorOnly?: boolean;
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
  hasError: boolean;
  byteStart: number;
  byteEnd: number;
}

export interface QueryNetlogEventsResult {
  analysisId: string;
  page: number;
  pageSize: number;
  total: number;
  rows: NetlogEventRow[];
}

function matches(index: CompactEventIndex, eventId: number, query: QueryNetlogEventsPayload): boolean {
  if (query.typeId !== undefined && index.typeId[eventId] !== query.typeId) return false;
  if (query.sourceId !== undefined && index.sourceId[eventId] !== query.sourceId) return false;
  if (query.sourceTypeId !== undefined && index.sourceTypeId[eventId] !== query.sourceTypeId) return false;
  if (query.phase !== undefined && index.phase[eventId] !== query.phase) return false;
  if (query.errorOnly && index.flags[eventId] !== 1) return false;
  return true;
}

function toRow(index: CompactEventIndex, eventId: number): NetlogEventRow {
  const typeId = index.typeId[eventId] || 0;
  const sourceTypeId = index.sourceTypeId[eventId] || 0;
  return {
    eventId,
    time: index.time[eventId] || 0,
    typeId,
    typeName: `UNKNOWN_${typeId}`,
    sourceId: index.sourceId[eventId] || 0,
    sourceTypeId,
    sourceTypeName: sourceTypeId ? `UNKNOWN_SRC_${sourceTypeId}` : 'UNKNOWN_SRC',
    phase: index.phase[eventId] || 0,
    hasError: index.flags[eventId] === 1,
    byteStart: index.byteStart[eventId],
    byteEnd: index.byteEnd[eventId],
  };
}

export function queryNetlogEvents(index: CompactEventIndex, query: QueryNetlogEventsPayload): QueryNetlogEventsResult {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(500, Math.max(1, query.pageSize || 100));
  const start = (page - 1) * pageSize;
  const rows: NetlogEventRow[] = [];
  let total = 0;

  for (let eventId = 0; eventId < index.count; eventId++) {
    if (!matches(index, eventId, query)) continue;
    if (total >= start && rows.length < pageSize) {
      rows.push(toRow(index, eventId));
    }
    total += 1;
  }

  return {
    analysisId: query.analysisId,
    page,
    pageSize,
    total,
    rows,
  };
}
