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
  return {
    sourceIndex,
    trackId: processId === undefined
      ? 'global'
      : `${processId}:${threadId ?? 0}`,
    startUs,
    durationUs: Math.max(0, readFiniteNumber(event.dur) ?? 0),
    depth: 0,
    category: eventCategory(event),
    name: readString(event.name) ?? 'Unnamed',
    ...(processId === undefined ? {} : { processId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(frameId === undefined ? {} : { frameId }),
    ...(navigationId === undefined ? {} : { navigationId }),
    evidenceIds: [`trace:event:${sourceIndex}`],
  };
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
    const timelineEvents: TimelineStoreEventInput[] = [];
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
      if (projected) timelineEvents.push(projected);
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
    if (options.isCancelled()) throw new TraceAggregationCancelled();
    this.sessionData = {
      timeline: TimelineColumnarStore.build(timelineEvents),
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
