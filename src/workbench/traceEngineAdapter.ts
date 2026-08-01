import {
  readFiniteNumber,
  readFrameId,
  readNavigationId,
  readString,
} from '../parsers/trace/eventAccessors';
import {
  MinimalTraceAggregator,
  TraceAggregationCancelled,
} from '../parsers/trace/minimalTraceAggregator';
import type {
  TraceAggregationProgress,
} from '../parsers/trace/traceAggregatorPort';
import type {
  ChromiumTraceEvent,
  ChromiumTraceFile,
  TraceContextResult,
  TraceEncoding,
  TraceParserWarning,
} from '../parsers/trace/types';
import type { WorkbenchCapability } from './protocol';
import { RawEvidenceStore } from './rawEvidenceStore';
import {
  TimelineColumnarStore,
  type TimelineStoreEventInput,
} from './timelineColumnarStore';
import { classifyTimelineTrack } from './timelineTracks';

export interface TraceEngineMetadata {
  engine: 'minimal-trace-aggregator';
  eventCount: number;
  jsonBytes: number;
}

export interface TraceEngineCapability {
  capability: WorkbenchCapability;
  status: 'available' | 'missing';
  reason?: string;
}

export interface TraceEngineBuildProgress {
  phase: TraceAggregationProgress['phase'] | 'indexing-events';
  completed?: number;
  total?: number;
  unit: 'events';
}

export interface TraceEngineOperationOptions {
  isCancelled(): boolean;
  onProgress(progress: TraceEngineBuildProgress): void;
  yieldControl?(): Promise<void>;
}

export interface TraceEngineSessionData {
  timeline: TimelineColumnarStore;
  evidence: RawEvidenceStore;
}

export interface TraceEngineAdapter {
  analyze(options: TraceEngineOperationOptions): Promise<TraceContextResult>;
  getMetadata(): TraceEngineMetadata;
  getCapabilities(): TraceEngineCapability[];
  buildSessionData(options: TraceEngineOperationOptions): Promise<TraceEngineSessionData>;
  release(): void;
}

interface TraceIntakeSeed {
  encoding: TraceEncoding;
  jsonBytes: number;
  skippedEventCount: number;
  warnings: TraceParserWarning[];
}

interface MinimalTraceEngineAdapterOptions {
  cancellationInterval?: number;
  indexYieldInterval?: number;
}

const ALL_CAPABILITIES: WorkbenchCapability[] = [
  'timeline-events',
  'event-detail',
  'cpu-profile',
  'network',
  'rendering',
  'interactions',
  'frames',
  'screenshots',
];

function hasScreenshot(event: ChromiumTraceEvent): boolean {
  if (event.name !== 'Screenshot') return false;
  const args = event.args;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return false;
  const argsRecord = args as Record<string, unknown>;
  if (typeof argsRecord.snapshot === 'string') return true;
  const data = argsRecord.data;
  return data !== null
    && typeof data === 'object'
    && !Array.isArray(data)
    && typeof (data as Record<string, unknown>).snapshot === 'string';
}

function eventCategory(event: ChromiumTraceEvent): string {
  const category = readString(event.cat);
  if (category) return category.split(',')[0] || 'other';
  const name = readString(event.name) ?? '';
  if (/Resource|Request|Response/.test(name)) return 'network';
  if (/Layout|Paint|Raster|Frame/.test(name)) return 'rendering';
  if (/EventTiming|Interaction/.test(name)) return 'interaction';
  if (/Profile/.test(name)) return 'cpu-profile';
  if (name === 'Screenshot') return 'screenshot';
  return 'other';
}

function projectTimelineEvent(
  event: ChromiumTraceEvent,
  sourceIndex: number,
): TimelineStoreEventInput | undefined {
  const startUs = readFiniteNumber(event.ts);
  if (startUs === undefined) return undefined;
  const processId = readFiniteNumber(event.pid);
  const threadId = readFiniteNumber(event.tid);
  const frameId = readFrameId(event);
  const navigationId = readNavigationId(event);
  const name = readString(event.name) ?? 'Unnamed';
  const category = eventCategory(event);
  const semanticTrack = classifyTimelineTrack(name, category);
  if (!semanticTrack) return undefined;
  const durationUs = Math.max(0, readFiniteNumber(event.dur) ?? 0);
  return {
    sourceIndex,
    trackId: semanticTrack,
    startUs,
    durationUs,
    depth: 0,
    category,
    name,
    ...(semanticTrack === 'main' && durationUs >= 50_000
      ? { status: 'warning' as const }
      : {}),
    ...(processId === undefined ? {} : { processId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(frameId === undefined ? {} : { frameId }),
    ...(navigationId === undefined ? {} : { navigationId }),
    evidenceIds: [`trace:event:${sourceIndex}`],
  };
}

interface ProjectedAnalysisFacts {
  events: TimelineStoreEventInput[];
  coveredSourceIndexes: Set<number>;
}

function sourceIndexesFromEvidence(
  evidenceIds: string[],
  sourceLimit: number,
): number[] {
  const indexes: number[] = [];
  for (const evidenceId of evidenceIds) {
    const match = /^trace:event:(0|[1-9]\d*)$/.exec(evidenceId);
    const sourceIndex = match ? Number(match[1]) : Number.NaN;
    if (Number.isSafeInteger(sourceIndex) && sourceIndex < sourceLimit) {
      indexes.push(sourceIndex);
    }
  }
  return indexes;
}

function projectAnalysisFacts(
  analysis: TraceContextResult,
  firstSourceIndex: number,
): ProjectedAnalysisFacts {
  const events: TimelineStoreEventInput[] = [];
  const coveredSourceIndexes = new Set<number>();
  let sourceIndex = firstSourceIndex;
  const assignedSourceIndexes = new Set<number>();
  const allocateSourceIndex = (evidenceIds: string[]): number => {
    for (const evidenceId of evidenceIds) {
      const match = /^trace:event:(0|[1-9]\d*)$/.exec(evidenceId);
      const candidate = match ? Number(match[1]) : Number.NaN;
      if (
        Number.isSafeInteger(candidate)
        && candidate < firstSourceIndex
        && !assignedSourceIndexes.has(candidate)
      ) {
        assignedSourceIndexes.add(candidate);
        return candidate;
      }
    }
    const assigned = sourceIndex;
    sourceIndex += 1;
    assignedSourceIndexes.add(assigned);
    return assigned;
  };
  const append = (
    event: Omit<TimelineStoreEventInput, 'sourceIndex' | 'depth'>,
  ): number => {
    sourceIndexesFromEvidence(event.evidenceIds, firstSourceIndex)
      .forEach(index => coveredSourceIndexes.add(index));
    const assignedSourceIndex = allocateSourceIndex(event.evidenceIds);
    events.push({ ...event, sourceIndex: assignedSourceIndex, depth: 0 });
    return assignedSourceIndex;
  };
  const requestIndexes = new Map<string, number>();
  const requests = analysis.context.requests ?? [];
  for (const request of requests) {
    sourceIndexesFromEvidence(request.evidenceIds, firstSourceIndex)
      .forEach(index => coveredSourceIndexes.add(index));
    requestIndexes.set(request.requestId, allocateSourceIndex(request.evidenceIds));
  }
  for (const request of requests) {
    const assignedSourceIndex = requestIndexes.get(request.requestId)!;
    const endUs = request.timing.trace.endUs ?? request.timing.trace.startUs;
    const status = request.result === 'success'
      ? 'normal'
      : request.result === 'cancelled' || request.result === 'incomplete-at-trace-end'
        ? 'incomplete'
        : 'error';
    events.push({
      sourceIndex: assignedSourceIndex,
      trackId: 'network',
      startUs: request.timing.trace.startUs,
      durationUs: Math.max(0, endUs - request.timing.trace.startUs),
      depth: 0,
      category: 'network',
      name: request.statusCode
        ? `HTTP ${request.statusCode} request`
        : `Network request · ${request.result}`,
      status,
      ...(request.initiatorRequestId && requestIndexes.has(request.initiatorRequestId)
        ? { initiatorSourceIndex: requestIndexes.get(request.initiatorRequestId) }
        : {}),
      evidenceIds: request.evidenceIds,
    });
  }
  for (const milestone of analysis.context.milestones ?? []) {
    append({
      trackId: 'milestones',
      startUs: milestone.timestampUs,
      durationUs: 0,
      category: 'milestone',
      name: milestone.name,
      status: milestone.candidate ? 'candidate' : 'normal',
      navigationId: milestone.navigationKey,
      evidenceIds: milestone.evidenceIds,
    });
  }
  for (const task of analysis.context.tasks ?? []) {
    append({
      trackId: 'main',
      startUs: task.startUs,
      durationUs: task.durationMs * 1_000,
      category: 'main-thread',
      name: task.durationMs >= 50 ? 'Long task' : 'Main-thread task',
      status: task.durationMs >= 50 ? 'warning' : 'normal',
      processId: task.processId,
      threadId: task.threadId,
      navigationId: task.navigationKey,
      evidenceIds: task.evidenceIds,
    });
  }
  for (const rendering of analysis.context.rendering ?? []) {
    append({
      trackId: 'rendering',
      startUs: rendering.startUs,
      durationUs: rendering.durationMs * 1_000,
      category: 'rendering',
      name: rendering.name,
      status: rendering.durationMs >= 50 ? 'warning' : 'normal',
      processId: rendering.processId,
      threadId: rendering.threadId,
      navigationId: rendering.navigationKey,
      evidenceIds: rendering.evidenceIds,
    });
  }
  for (const clue of analysis.context.forcedReflowClues ?? []) {
    append({
      trackId: 'rendering',
      startUs: clue.startUs,
      durationUs: 0,
      category: 'rendering',
      name: 'Forced Reflow evidence',
      status: 'warning',
      navigationId: clue.navigationKey,
      evidenceIds: clue.evidenceIds,
    });
  }
  for (const interaction of analysis.context.interactions ?? []) {
    append({
      trackId: 'interactions',
      startUs: interaction.startUs,
      durationUs: interaction.totalLatencyMs * 1_000,
      category: 'interaction',
      name: 'Interaction',
      status: interaction.totalLatencyMs >= 200 ? 'warning' : 'normal',
      navigationId: interaction.navigationKey,
      evidenceIds: interaction.evidenceIds,
    });
  }
  for (const frame of analysis.context.animationFrames ?? []) {
    append({
      trackId: 'frames',
      startUs: frame.startUs,
      durationUs: frame.durationMs * 1_000,
      category: 'frame',
      name: frame.dropped
        ? 'Dropped frame'
        : frame.overBudget
          ? 'Over-budget frame'
          : 'Frame',
      status: frame.dropped ? 'error' : frame.overBudget ? 'warning' : 'normal',
      processId: frame.processId,
      threadId: frame.threadId,
      navigationId: frame.navigationKey,
      evidenceIds: frame.evidenceIds,
    });
  }
  return { events, coveredSourceIndexes };
}

export class MinimalTraceEngineAdapter implements TraceEngineAdapter {
  private analysis?: TraceContextResult;
  private sessionData?: TraceEngineSessionData;
  private released = false;

  constructor(
    private readonly trace: ChromiumTraceFile,
    private readonly intakeSeed: TraceIntakeSeed,
    private readonly adapterOptions: MinimalTraceEngineAdapterOptions = {},
  ) {}

  async analyze(options: TraceEngineOperationOptions): Promise<TraceContextResult> {
    if (this.released) throw new Error('Trace engine adapter has been released');
    if (this.analysis) return this.analysis;
    const aggregator = new MinimalTraceAggregator(this.intakeSeed, {
      cancellationInterval: this.adapterOptions.cancellationInterval,
    });
    const aggregated = await aggregator.aggregate(this.trace, {
      isCancelled: options.isCancelled,
      onProgress: progress => options.onProgress({
        phase: progress.phase,
        ...(progress.processed === undefined ? {} : { completed: progress.processed }),
        ...(progress.total === undefined ? {} : { total: progress.total }),
        unit: 'events',
      }),
      yieldControl: options.yieldControl,
    });
    this.analysis = aggregated.facts;
    return this.analysis;
  }

  getMetadata(): TraceEngineMetadata {
    return {
      engine: 'minimal-trace-aggregator',
      eventCount: this.trace.traceEvents.length,
      jsonBytes: this.intakeSeed.jsonBytes,
    };
  }

  getCapabilities(): TraceEngineCapability[] {
    const families = new Set(this.analysis?.intake.availableFamilies ?? []);
    const screenshots = this.trace.traceEvents.some(hasScreenshot);
    return ALL_CAPABILITIES.map(capability => {
      const available = capability === 'timeline-events'
        || capability === 'event-detail'
        || (capability === 'cpu-profile' && families.has('cpu-profile'))
        || (capability === 'network' && families.has('network'))
        || (capability === 'rendering' && families.has('rendering'))
        || (capability === 'interactions' && families.has('interaction'))
        || (capability === 'frames' && families.has('rendering'))
        || (capability === 'screenshots' && screenshots);
      return available
        ? { capability, status: 'available' }
        : {
            capability,
            status: 'missing',
            reason: `Trace does not provide ${capability}`,
          };
    });
  }

  async buildSessionData(
    options: TraceEngineOperationOptions,
  ): Promise<TraceEngineSessionData> {
    if (this.released) throw new Error('Trace engine adapter has been released');
    if (!this.analysis) throw new Error('Trace analysis must complete before indexing');
    if (this.sessionData) return this.sessionData;
    const timelineEvents = new Map<number, TimelineStoreEventInput>();
    const total = this.trace.traceEvents.length;
    const yieldInterval = this.adapterOptions.indexYieldInterval ?? 2_048;
    options.onProgress({
      phase: 'indexing-events',
      completed: 0,
      total,
      unit: 'events',
    });
    for (let sourceIndex = 0; sourceIndex < total; sourceIndex += 1) {
      if (options.isCancelled()) throw new TraceAggregationCancelled();
      const projected = projectTimelineEvent(this.trace.traceEvents[sourceIndex], sourceIndex);
      if (projected) timelineEvents.set(sourceIndex, projected);
      if ((sourceIndex + 1) % yieldInterval === 0) {
        options.onProgress({
          phase: 'indexing-events',
          completed: sourceIndex + 1,
          total,
          unit: 'events',
        });
        await (options.yieldControl?.() ?? Promise.resolve());
      }
    }
    const projectedFacts = projectAnalysisFacts(this.analysis, total);
    for (const sourceIndex of projectedFacts.coveredSourceIndexes) {
      timelineEvents.delete(sourceIndex);
    }
    for (const semanticEvent of projectedFacts.events) {
      timelineEvents.set(semanticEvent.sourceIndex, semanticEvent);
    }
    if (options.isCancelled()) throw new TraceAggregationCancelled();
    this.sessionData = {
      timeline: TimelineColumnarStore.build([...timelineEvents.values()]),
      evidence: new RawEvidenceStore(this.trace.traceEvents),
    };
    options.onProgress({
      phase: 'indexing-events',
      completed: total,
      total,
      unit: 'events',
    });
    return this.sessionData;
  }

  release(): void {
    this.sessionData?.timeline.release();
    this.sessionData?.evidence.release();
    this.sessionData = undefined;
    this.analysis = undefined;
    this.trace.traceEvents.length = 0;
    this.released = true;
  }
}
