import type { CompactEventIndex } from './netlogDatasetIndexer';

export interface QueryNetlogEventsPayload {
  analysisId: string;
  page?: number;
  pageSize?: number;
  typeId?: number;
  sourceId?: number;
  sourceTypeId?: number;
  typeName?: string;
  sourceTypeName?: string;
  phase?: number;
  errorOnly?: boolean;
  startTime?: number;
  endTime?: number;
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
  page: number;
  pageSize: number;
  total: number;
  rows: NetlogEventRow[];
}

function matches(index: CompactEventIndex, eventId: number, query: QueryNetlogEventsPayload): boolean {
  if (query.typeId !== undefined && index.typeId[eventId] !== query.typeId) return false;
  if (query.sourceId !== undefined && index.sourceId[eventId] !== query.sourceId) return false;
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
