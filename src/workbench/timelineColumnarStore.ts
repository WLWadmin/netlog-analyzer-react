import type {
  WorkbenchTimelineEventDto,
  WorkbenchTruncation,
  WorkbenchViewportLod,
} from './protocol';

export interface TimelineStoreEventInput {
  sourceIndex: number;
  trackId: string;
  startUs: number;
  durationUs: number;
  depth: number;
  category: string;
  name: string;
  status?: WorkbenchTimelineEventDto['status'];
  processId?: number;
  threadId?: number;
  frameId?: string;
  navigationId?: string;
  parentSourceIndex?: number;
  initiatorSourceIndex?: number;
  evidenceIds: string[];
}

export interface TimelineQuery {
  startUs: number;
  endUs: number;
  limit: number;
  balanceByTrack?: boolean;
  continuation?: {
    afterStartUs: number;
    afterEventId: string;
  };
}

function selectBalancedPage(
  matches: number[],
  limit: number,
  trackIndexes: Uint32Array,
): number[] {
  if (matches.length <= limit) return matches;
  const positionsByTrack = new Map<number, number[]>();
  for (const position of matches) {
    const trackIndex = trackIndexes[position];
    const positions = positionsByTrack.get(trackIndex) ?? [];
    positions.push(position);
    positionsByTrack.set(trackIndex, positions);
  }
  const buckets = [...positionsByTrack.values()];
  const selected: number[] = [];
  for (let offset = 0; selected.length < limit; offset += 1) {
    let added = false;
    for (const bucket of buckets) {
      const position = bucket[offset];
      if (position === undefined) continue;
      selected.push(position);
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected.sort((left, right) => left - right);
}

export interface TimelineQueryResult {
  events: WorkbenchTimelineEventDto[];
  lod: WorkbenchViewportLod;
  truncation: WorkbenchTruncation;
}

export interface TimelineSelectionSummary {
  range: { startUs: number; endUs: number };
  matchedCount: number;
  trackCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  truncation: {
    truncated: false;
    countedCount: number;
    totalMatched: number;
  };
}

export interface TimelineEventFilters {
  names?: string[];
  categories?: string[];
  trackIds?: string[];
  statuses?: Array<NonNullable<WorkbenchTimelineEventDto['status']>>;
}

export interface TimelineEventLogQuery {
  range: { startUs: number; endUs: number };
  limit: number;
  continuation?: string;
  query?: string;
  filters?: TimelineEventFilters;
}

export interface TimelineEventLogResult {
  events: WorkbenchTimelineEventDto[];
  truncation: {
    truncated: boolean;
    returnedCount: number;
    totalMatched: number;
    continuation?: string;
  };
}

export interface TimelineEvidenceEntity {
  entityId: string;
  kind: 'symptom' | 'main-thread' | 'rendering' | 'frame' | 'interaction';
  label: string;
  trackId: string;
  startUs: number;
  durationUs: number;
  evidenceIds: string[];
  limitations: string[];
}

export class TimelineQueryCancelled extends Error {
  constructor() {
    super('Timeline query cancelled');
    this.name = 'TimelineQueryCancelled';
  }
}

export class TimelineQueryTimeout extends Error {
  constructor() {
    super('Timeline query timed out');
    this.name = 'TimelineQueryTimeout';
  }
}

interface StringTable {
  values: string[];
  indexes: Map<string, number>;
}

function intern(table: StringTable, value: string): number {
  const existing = table.indexes.get(value);
  if (existing !== undefined) return existing;
  const index = table.values.length;
  table.values.push(value);
  table.indexes.set(value, index);
  return index;
}

function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function eventId(sourceIndex: number): string {
  return `trace:timeline:${sourceIndex}`;
}

function sourceIndexFromEventId(value: string): number | undefined {
  const match = /^trace:timeline:(0|[1-9]\d*)$/.exec(value);
  if (!match) return undefined;
  const sourceIndex = Number(match[1]);
  return Number.isSafeInteger(sourceIndex) ? sourceIndex : undefined;
}

function viewportLod(
  query: TimelineQuery,
  totalMatched: number,
  renderedEventCount: number,
): WorkbenchViewportLod {
  const sampled = query.balanceByTrack === true && totalMatched > renderedEventCount;
  return {
    mode: sampled ? 'sampled' : 'raw',
    level: sampled ? Math.max(2, Math.ceil(totalMatched / query.limit)) : 1,
    sourceEventCount: totalMatched,
    renderedEventCount,
    bucketUs: sampled
      ? Math.max(1, (query.endUs - query.startUs) / Math.max(1, query.limit))
      : 0,
    explanation: sampled
      ? '当前密度超过绘制上限，按轨道确定性降采样；缩小范围可查看原始事件。'
      : '当前范围直接绘制原始事件。',
  };
}

export class TimelineColumnarStore {
  private released = false;

  private constructor(
    private startUs: Float64Array,
    private durationUs: Float64Array,
    private prefixMaxEndUs: Float64Array,
    private sourceIndexes: Uint32Array,
    private trackIndexes: Uint32Array,
    private nameIndexes: Uint32Array,
    private categoryIndexes: Uint32Array,
    private depths: Uint16Array,
    private strings: StringTable,
    private readonly inputsBySourceIndex: Map<number, TimelineStoreEventInput>,
    private readonly processIndex: Map<number, number[]>,
    private readonly threadIndex: Map<string, number[]>,
    private readonly frameIndex: Map<string, number[]>,
    private readonly navigationIndex: Map<string, number[]>,
    private readonly childSourceIndex: Map<number, number[]>,
  ) {}

  static build(inputs: TimelineStoreEventInput[]): TimelineColumnarStore {
    const sorted = [...inputs].sort((left, right) => (
      left.startUs - right.startUs || left.sourceIndex - right.sourceIndex
    ));
    const strings: StringTable = { values: [], indexes: new Map() };
    const startUs = new Float64Array(sorted.length);
    const durationUs = new Float64Array(sorted.length);
    const prefixMaxEndUs = new Float64Array(sorted.length);
    const sourceIndexes = new Uint32Array(sorted.length);
    const trackIndexes = new Uint32Array(sorted.length);
    const nameIndexes = new Uint32Array(sorted.length);
    const categoryIndexes = new Uint32Array(sorted.length);
    const depths = new Uint16Array(sorted.length);
    const inputsBySourceIndex = new Map<number, TimelineStoreEventInput>();
    const processIndex = new Map<number, number[]>();
    const threadIndex = new Map<string, number[]>();
    const frameIndex = new Map<string, number[]>();
    const navigationIndex = new Map<string, number[]>();
    const childSourceIndex = new Map<number, number[]>();
    let maxEndUs = Number.NEGATIVE_INFINITY;

    const addIndex = <T>(index: Map<T, number[]>, key: T, position: number) => {
      const positions = index.get(key) ?? [];
      positions.push(position);
      index.set(key, positions);
    };

    sorted.forEach((input, position) => {
      const normalizedDuration = Math.max(0, input.durationUs);
      startUs[position] = input.startUs;
      durationUs[position] = normalizedDuration;
      maxEndUs = Math.max(maxEndUs, input.startUs + normalizedDuration);
      prefixMaxEndUs[position] = maxEndUs;
      sourceIndexes[position] = input.sourceIndex;
      trackIndexes[position] = intern(strings, input.trackId);
      nameIndexes[position] = intern(strings, input.name);
      categoryIndexes[position] = intern(strings, input.category);
      depths[position] = Math.max(0, Math.min(65_535, input.depth));
      inputsBySourceIndex.set(input.sourceIndex, input);
      if (input.parentSourceIndex !== undefined) {
        const children = childSourceIndex.get(input.parentSourceIndex) ?? [];
        children.push(input.sourceIndex);
        childSourceIndex.set(input.parentSourceIndex, children);
      }
      if (input.processId !== undefined) addIndex(processIndex, input.processId, position);
      if (input.processId !== undefined && input.threadId !== undefined) {
        addIndex(threadIndex, `${input.processId}:${input.threadId}`, position);
      }
      if (input.frameId) addIndex(frameIndex, input.frameId, position);
      if (input.navigationId) addIndex(navigationIndex, input.navigationId, position);
    });

    return new TimelineColumnarStore(
      startUs,
      durationUs,
      prefixMaxEndUs,
      sourceIndexes,
      trackIndexes,
      nameIndexes,
      categoryIndexes,
      depths,
      strings,
      inputsBySourceIndex,
      processIndex,
      threadIndex,
      frameIndex,
      navigationIndex,
      childSourceIndex,
    );
  }

  query(query: TimelineQuery): TimelineQueryResult {
    if (
      this.released
      || !Number.isFinite(query.startUs)
      || !Number.isFinite(query.endUs)
      || query.startUs > query.endUs
      || !Number.isInteger(query.limit)
      || query.limit < 1
    ) {
      return {
        events: [],
        lod: viewportLod(query, 0, 0),
        truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
      };
    }
    const firstCandidate = lowerBound(this.prefixMaxEndUs, query.startUs);
    const lastCandidate = upperBound(this.startUs, query.endUs);
    const matches: number[] = [];
    for (let position = firstCandidate; position < lastCandidate; position += 1) {
      if (this.startUs[position] + this.durationUs[position] >= query.startUs) {
        matches.push(position);
      }
    }
    const continuationSourceIndex = query.continuation
      ? sourceIndexFromEventId(query.continuation.afterEventId)
      : undefined;
    const pageStart = query.continuation && continuationSourceIndex !== undefined
      ? matches.findIndex(position => (
          this.startUs[position] > query.continuation!.afterStartUs
          || (
            this.startUs[position] === query.continuation!.afterStartUs
            && this.sourceIndexes[position] > continuationSourceIndex
          )
        ))
      : query.continuation ? -1 : 0;
    const resolvedStart = pageStart < 0 ? matches.length : pageStart;
    const page = query.balanceByTrack && !query.continuation
      ? selectBalancedPage(matches, query.limit, this.trackIndexes)
      : matches.slice(resolvedStart, resolvedStart + query.limit);
    const events = page.map(position => this.dtoAt(position));
    const truncated = resolvedStart + page.length < matches.length;
    const last = events[events.length - 1];
    return {
      events,
      lod: viewportLod(query, matches.length, events.length),
      truncation: {
        truncated,
        returnedCount: events.length,
        totalMatched: matches.length,
        ...(truncated && last && (!query.balanceByTrack || query.continuation)
          ? {
              continuation: {
                afterStartUs: last.startUs,
                afterEventId: last.id,
              },
            }
          : {}),
      },
    };
  }

  async queryAsync(
    query: TimelineQuery,
    options: {
      isCancelled(): boolean;
      timeoutMs: number;
      now(): number;
      yieldControl(): Promise<void>;
      yieldInterval?: number;
      onProgress?(completed: number, total: number): void;
    },
  ): Promise<TimelineQueryResult> {
    if (
      this.released
      || !Number.isFinite(query.startUs)
      || !Number.isFinite(query.endUs)
      || query.startUs > query.endUs
      || !Number.isInteger(query.limit)
      || query.limit < 1
    ) {
      return {
        events: [],
        lod: viewportLod(query, 0, 0),
        truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
      };
    }
    const firstCandidate = lowerBound(this.prefixMaxEndUs, query.startUs);
    const lastCandidate = upperBound(this.startUs, query.endUs);
    const total = Math.max(0, lastCandidate - firstCandidate);
    const matches: number[] = [];
    const startedAt = options.now();
    const yieldInterval = options.yieldInterval ?? 2_048;
    for (let position = firstCandidate; position < lastCandidate; position += 1) {
      if (options.isCancelled()) throw new TimelineQueryCancelled();
      if (options.now() - startedAt > options.timeoutMs) throw new TimelineQueryTimeout();
      if (this.startUs[position] + this.durationUs[position] >= query.startUs) {
        matches.push(position);
      }
      const completed = position - firstCandidate + 1;
      if (completed % yieldInterval === 0) {
        options.onProgress?.(completed, total);
        await options.yieldControl();
      }
    }
    const continuationSourceIndex = query.continuation
      ? sourceIndexFromEventId(query.continuation.afterEventId)
      : undefined;
    const pageStart = query.continuation && continuationSourceIndex !== undefined
      ? matches.findIndex(position => (
          this.startUs[position] > query.continuation!.afterStartUs
          || (
            this.startUs[position] === query.continuation!.afterStartUs
            && this.sourceIndexes[position] > continuationSourceIndex
          )
        ))
      : query.continuation ? -1 : 0;
    const resolvedStart = pageStart < 0 ? matches.length : pageStart;
    const page = query.balanceByTrack && !query.continuation
      ? selectBalancedPage(matches, query.limit, this.trackIndexes)
      : matches.slice(resolvedStart, resolvedStart + query.limit);
    const events = page.map(position => this.dtoAt(position));
    const truncated = resolvedStart + page.length < matches.length;
    const last = events[events.length - 1];
    return {
      events,
      lod: viewportLod(query, matches.length, events.length),
      truncation: {
        truncated,
        returnedCount: events.length,
        totalMatched: matches.length,
        ...(truncated && last && (!query.balanceByTrack || query.continuation)
          ? {
              continuation: {
                afterStartUs: last.startUs,
                afterEventId: last.id,
              },
            }
          : {}),
      },
    };
  }

  async summarizeSelection(
    range: { startUs: number; endUs: number },
    options: {
      isCancelled(): boolean;
      timeoutMs: number;
      now(): number;
      yieldControl(): Promise<void>;
      yieldInterval?: number;
    },
  ): Promise<TimelineSelectionSummary> {
    const trackCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    if (
      this.released
      || !Number.isFinite(range.startUs)
      || !Number.isFinite(range.endUs)
      || range.startUs > range.endUs
    ) {
      return {
        range,
        matchedCount: 0,
        trackCounts,
        statusCounts,
        truncation: { truncated: false, countedCount: 0, totalMatched: 0 },
      };
    }
    const firstCandidate = lowerBound(this.prefixMaxEndUs, range.startUs);
    const lastCandidate = upperBound(this.startUs, range.endUs);
    const startedAt = options.now();
    const yieldInterval = options.yieldInterval ?? 2_048;
    let matchedCount = 0;
    for (let position = firstCandidate; position < lastCandidate; position += 1) {
      if (options.isCancelled()) throw new TimelineQueryCancelled();
      if (options.now() - startedAt > options.timeoutMs) throw new TimelineQueryTimeout();
      if (this.startUs[position] + this.durationUs[position] >= range.startUs) {
        matchedCount += 1;
        const sourceIndex = this.sourceIndexes[position];
        const trackId = this.strings.values[this.trackIndexes[position]];
        const status = this.inputsBySourceIndex.get(sourceIndex)?.status ?? 'unmarked';
        trackCounts[trackId] = (trackCounts[trackId] ?? 0) + 1;
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      }
      if ((position - firstCandidate + 1) % yieldInterval === 0) {
        await options.yieldControl();
      }
    }
    return {
      range,
      matchedCount,
      trackCounts,
      statusCounts,
      truncation: {
        truncated: false,
        countedCount: matchedCount,
        totalMatched: matchedCount,
      },
    };
  }

  async queryEventLog(
    query: TimelineEventLogQuery,
    options: {
      isCancelled(): boolean;
      timeoutMs: number;
      now(): number;
      yieldControl(): Promise<void>;
      yieldInterval?: number;
    },
  ): Promise<TimelineEventLogResult> {
    if (
      this.released
      || !Number.isFinite(query.range.startUs)
      || !Number.isFinite(query.range.endUs)
      || query.range.startUs > query.range.endUs
      || !Number.isInteger(query.limit)
      || query.limit < 1
    ) {
      return {
        events: [],
        truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
      };
    }
    const firstCandidate = lowerBound(this.prefixMaxEndUs, query.range.startUs);
    const lastCandidate = upperBound(this.startUs, query.range.endUs);
    const continuationSourceIndex = query.continuation
      ? sourceIndexFromEventId(query.continuation)
      : undefined;
    const normalizedQuery = query.query?.trim().toLowerCase();
    const names = query.filters?.names ? new Set(query.filters.names) : undefined;
    const categories = query.filters?.categories
      ? new Set(query.filters.categories)
      : undefined;
    const trackIds = query.filters?.trackIds
      ? new Set(query.filters.trackIds)
      : undefined;
    const statuses = query.filters?.statuses
      ? new Set(query.filters.statuses)
      : undefined;
    const startedAt = options.now();
    const yieldInterval = options.yieldInterval ?? 2_048;
    const events: WorkbenchTimelineEventDto[] = [];
    let totalMatched = 0;
    let eligibleMatched = 0;
    let pastContinuation = continuationSourceIndex === undefined;
    for (let position = firstCandidate; position < lastCandidate; position += 1) {
      if (options.isCancelled()) throw new TimelineQueryCancelled();
      if (options.now() - startedAt > options.timeoutMs) throw new TimelineQueryTimeout();
      const sourceIndex = this.sourceIndexes[position];
      const input = this.inputsBySourceIndex.get(sourceIndex);
      const trackId = this.strings.values[this.trackIndexes[position]];
      const name = this.strings.values[this.nameIndexes[position]];
      const category = this.strings.values[this.categoryIndexes[position]];
      const status = input?.status;
      const intersects = this.startUs[position] + this.durationUs[position]
        >= query.range.startUs;
      const matches = intersects
        && (!names || names.has(name))
        && (!categories || categories.has(category))
        && (!trackIds || trackIds.has(trackId))
        && (!statuses || (status !== undefined && statuses.has(status)))
        && (
          !normalizedQuery
          || name.toLowerCase().includes(normalizedQuery)
          || category.toLowerCase().includes(normalizedQuery)
          || trackId.toLowerCase().includes(normalizedQuery)
        );
      if (matches) {
        totalMatched += 1;
        if (!pastContinuation && sourceIndex === continuationSourceIndex) {
          pastContinuation = true;
        } else if (pastContinuation) {
          eligibleMatched += 1;
          if (events.length < query.limit) {
            events.push(this.dtoAt(position));
          }
        }
      }
      if ((position - firstCandidate + 1) % yieldInterval === 0) {
        await options.yieldControl();
      }
    }
    const truncated = events.length > 0 && events.length < eligibleMatched;
    return {
      events,
      truncation: {
        truncated,
        returnedCount: events.length,
        totalMatched,
        ...(truncated ? { continuation: events[events.length - 1].id } : {}),
      },
    };
  }

  getInput(eventIdValue: string): TimelineStoreEventInput | undefined {
    const sourceIndex = sourceIndexFromEventId(eventIdValue);
    return sourceIndex === undefined ? undefined : this.inputsBySourceIndex.get(sourceIndex);
  }

  getEvidenceEntities(): TimelineEvidenceEntity[] {
    const entities: TimelineEvidenceEntity[] = [];
    for (const [sourceIndex, input] of this.inputsBySourceIndex) {
      const kind = input.trackId === 'main'
        ? 'main-thread'
        : input.trackId === 'rendering'
          ? 'rendering'
          : input.trackId === 'frames'
            ? 'frame'
            : input.trackId === 'interactions'
              ? 'interaction'
              : undefined;
      if (!kind) continue;
      if (
        kind === 'main-thread'
        && input.status !== 'warning'
        && input.status !== 'error'
      ) continue;
      entities.push({
        entityId: eventId(sourceIndex),
        kind: input.status === 'warning' || input.status === 'error'
          ? 'symptom'
          : kind,
        label: input.name,
        trackId: input.trackId,
        startUs: input.startUs,
        durationUs: input.durationUs,
        evidenceIds: [...input.evidenceIds],
        limitations: ['时间重叠仅表示候选贡献，不能单独证明因果关系。'],
      });
    }
    return entities.sort((left, right) => (
      left.startUs - right.startUs || left.entityId.localeCompare(right.entityId)
    ));
  }

  childIds(eventIdValue: string): string[] {
    const sourceIndex = sourceIndexFromEventId(eventIdValue);
    if (sourceIndex === undefined) return [];
    return (this.childSourceIndex.get(sourceIndex) ?? [])
      .sort((left, right) => left - right)
      .map(eventId);
  }

  eventsByProcess(processId: number): WorkbenchTimelineEventDto[] {
    return this.positionsToDtos(this.processIndex.get(processId));
  }

  eventsByThread(processId: number, threadId: number): WorkbenchTimelineEventDto[] {
    return this.positionsToDtos(this.threadIndex.get(`${processId}:${threadId}`));
  }

  eventsByFrame(frameId: string): WorkbenchTimelineEventDto[] {
    return this.positionsToDtos(this.frameIndex.get(frameId));
  }

  eventsByNavigation(navigationId: string): WorkbenchTimelineEventDto[] {
    return this.positionsToDtos(this.navigationIndex.get(navigationId));
  }

  getRange(): { startUs: number; endUs: number } {
    if (this.startUs.length === 0) return { startUs: 0, endUs: 0 };
    return {
      startUs: this.startUs[0],
      endUs: this.prefixMaxEndUs[this.prefixMaxEndUs.length - 1],
    };
  }

  getStats(): {
    eventCount: number;
    stringCount: number;
    trackEventCounts: Record<string, number>;
    released: boolean;
  } {
    const trackEventCounts: Record<string, number> = {};
    for (const trackIndex of this.trackIndexes) {
      const trackId = this.strings.values[trackIndex];
      trackEventCounts[trackId] = (trackEventCounts[trackId] ?? 0) + 1;
    }
    return {
      eventCount: this.startUs.length,
      stringCount: this.strings.values.length,
      trackEventCounts,
      released: this.released,
    };
  }

  release(): void {
    this.startUs = new Float64Array(0);
    this.durationUs = new Float64Array(0);
    this.prefixMaxEndUs = new Float64Array(0);
    this.sourceIndexes = new Uint32Array(0);
    this.trackIndexes = new Uint32Array(0);
    this.nameIndexes = new Uint32Array(0);
    this.categoryIndexes = new Uint32Array(0);
    this.depths = new Uint16Array(0);
    this.strings.values.length = 0;
    this.strings.indexes.clear();
    this.inputsBySourceIndex.clear();
    this.processIndex.clear();
    this.threadIndex.clear();
    this.frameIndex.clear();
    this.navigationIndex.clear();
    this.childSourceIndex.clear();
    this.released = true;
  }

  private positionsToDtos(positions: number[] | undefined): WorkbenchTimelineEventDto[] {
    return (positions ?? []).map(position => this.dtoAt(position));
  }

  private dtoAt(position: number): WorkbenchTimelineEventDto {
    const sourceIndex = this.sourceIndexes[position];
    const status = this.inputsBySourceIndex.get(sourceIndex)?.status;
    return {
      id: eventId(sourceIndex),
      trackId: this.strings.values[this.trackIndexes[position]],
      startUs: this.startUs[position],
      durationUs: this.durationUs[position],
      depth: this.depths[position],
      category: this.strings.values[this.categoryIndexes[position]],
      name: this.strings.values[this.nameIndexes[position]],
      ...(status ? { status } : {}),
    };
  }
}
