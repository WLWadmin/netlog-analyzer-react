import {
  readBoolean,
  readEventData,
  readFiniteNumber,
  readFrameId,
  readLocalId,
  readNavigationId,
  readParentFrameId,
  readProcessId,
  readRecord,
  readString,
  readThreadId,
} from './eventAccessors';
import { Batch3FactCollector } from './traceFactCollectors';
import type {
  TraceAggregationOptions,
  TraceAggregatorOutput,
  TraceAggregatorPort,
} from './traceAggregatorPort';
import type {
  ChromiumTraceEvent,
  ChromiumTraceFile,
  TraceContextFacts,
  TraceContextResult,
  TraceEncoding,
  TraceEventFamily,
  TraceEventRef,
  TraceFrameFacts,
  TraceFrameProcessSpan,
  TraceNavigationFacts,
  TraceParserWarning,
  TraceProcessFacts,
  TraceThreadFacts,
} from './types';

const DEFAULT_MAX_EVIDENCE = 5_000;
const DEFAULT_CANCELLATION_INTERVAL = 1_024;
const DEFAULT_MAX_FACTS_PER_KIND = 1_000;
const NAVIGATION_EVENT_NAMES = new Set(['navigationStart', 'NavigationStart']);
const FRAME_ASSIGNMENT_EVENT_NAMES = new Set([
  'FrameCommittedInBrowser',
]);
const METADATA_EVENT_NAMES = new Set([
  'process_name',
  'thread_name',
  'process_sort_index',
  'thread_sort_index',
  'process_labels',
]);

interface TraceIntakeSeed {
  encoding: TraceEncoding;
  jsonBytes: number;
  skippedEventCount: number;
  warnings: TraceParserWarning[];
}

interface MinimalTraceAggregatorOptions {
  maxEvidence?: number;
  maxFactsPerKind?: number;
  maxCandidatesPerKind?: number;
  cancellationInterval?: number;
}

interface MutableProcess {
  processId: number;
  name?: string;
  labels?: string[];
  sortIndex?: number;
  threadIds: Set<number>;
  evidenceIndexes: Set<number>;
}

interface MutableThread {
  processId: number;
  threadId: number;
  name?: string;
  sortIndex?: number;
  evidenceIndexes: Set<number>;
}

interface FrameSignal {
  frameId: string;
  parentFrameId?: string;
  processId?: number;
  timestampUs: number;
  isOutermost?: boolean;
  eventIndex: number;
}

interface NavigationSignal {
  frameId: string;
  navigationId?: string;
  timestampUs: number;
  eventIndex: number;
}

interface MutableFrame {
  frameId: string;
  parentFrameId?: string;
  explicitOutermost: boolean;
  evidenceIndexes: Set<number>;
  assignments: FrameSignal[];
}

interface MutableNavigation {
  key: string;
  navigationId?: string;
  frameId: string;
  startUs: number;
  eventIndex: number;
  evidenceIndexes: Set<number>;
}

interface ScanState {
  processes: Map<number, MutableProcess>;
  threads: Map<string, MutableThread>;
  frameSignals: FrameSignal[];
  navigationSignals: NavigationSignal[];
  evidence: Map<number, TraceEventRef>;
  warnings: Set<TraceParserWarning>;
  families: Set<TraceEventFamily>;
  captureStartUs?: number;
  captureEndUs?: number;
}

export class TraceAggregationCancelled extends Error {
  constructor() {
    super('Trace aggregation cancelled');
    this.name = 'TraceAggregationCancelled';
  }
}

function evidenceId(eventIndex: number): string {
  return `trace:event:${eventIndex}`;
}

function sortedEvidenceIds(indexes: Iterable<number>): string[] {
  return [...new Set(indexes)].sort((a, b) => a - b).slice(0, 32).map(evidenceId);
}

function threadKey(processId: number, threadId: number): string {
  return `${processId}:${threadId}`;
}

function getProcess(state: ScanState, processId: number): MutableProcess {
  let process = state.processes.get(processId);
  if (!process) {
    process = {
      processId,
      threadIds: new Set(),
      evidenceIndexes: new Set(),
    };
    state.processes.set(processId, process);
  }
  return process;
}

function getThread(
  state: ScanState,
  processId: number,
  threadId: number,
): MutableThread {
  const key = threadKey(processId, threadId);
  let thread = state.threads.get(key);
  if (!thread) {
    thread = {
      processId,
      threadId,
      evidenceIndexes: new Set(),
    };
    state.threads.set(key, thread);
  }
  getProcess(state, processId).threadIds.add(threadId);
  return thread;
}

const MAX_INTERNAL_EVIDENCE = 10_000;

function createEvidenceRef(
  event: ChromiumTraceEvent,
  eventIndex: number,
): TraceEventRef {
  const name = readString(event.name);
  const processId = readFiniteNumber(event.pid);
  const threadId = readFiniteNumber(event.tid);
  const timestampUs = readFiniteNumber(event.ts);
  return {
    evidenceId: evidenceId(eventIndex),
    eventIndex,
    origin: 'raw',
    ...(name === undefined ? {} : { name }),
    ...(processId === undefined ? {} : { processId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(timestampUs === undefined ? {} : { timestampUs }),
  };
}

function addEvidence(
  state: ScanState,
  event: ChromiumTraceEvent,
  eventIndex: number,
): void {
  if (state.evidence.has(eventIndex)) return;
  if (state.evidence.size >= MAX_INTERNAL_EVIDENCE) {
    state.warnings.add('TRACE_FACT_CANDIDATES_TRUNCATED');
    return;
  }
  state.evidence.set(eventIndex, createEvidenceRef(event, eventIndex));
}

function readMetadataArgs(event: ChromiumTraceEvent): Record<string, unknown> | undefined {
  return readRecord(event.args);
}

function readLabels(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const labels = value.split(',').map(label => label.trim()).filter(Boolean);
    return labels.length > 0 ? labels : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const labels = value.map(readString);
  return labels.every((label): label is string => label !== undefined)
    ? labels
    : undefined;
}

function collectMetadata(
  state: ScanState,
  event: ChromiumTraceEvent,
  eventIndex: number,
): void {
  if (event.ph !== 'M') return;
  const name = readString(event.name);
  if (!name || !METADATA_EVENT_NAMES.has(name)) return;

  addEvidence(state, event, eventIndex);
  state.families.add('metadata');
  const processId = readFiniteNumber(event.pid);
  const threadId = readThreadId(event);
  const needsThread = name === 'thread_name' || name === 'thread_sort_index';
  if (processId === undefined || (needsThread && threadId === undefined)) {
    state.warnings.add('TRACE_METADATA_ID_MISSING');
    return;
  }

  const process = getProcess(state, processId);
  process.evidenceIndexes.add(eventIndex);
  const args = readMetadataArgs(event);
  if (!args) {
    state.warnings.add('TRACE_METADATA_VALUE_INVALID');
    return;
  }

  if (name === 'process_name') {
    const value = readString(args.name);
    if (value === undefined) state.warnings.add('TRACE_METADATA_VALUE_INVALID');
    else process.name = value;
    return;
  }
  if (name === 'process_sort_index') {
    const value = readFiniteNumber(args.sort_index);
    if (value === undefined) state.warnings.add('TRACE_METADATA_VALUE_INVALID');
    else process.sortIndex = value;
    return;
  }
  if (name === 'process_labels') {
    const value = readLabels(args.labels);
    if (value === undefined) state.warnings.add('TRACE_METADATA_VALUE_INVALID');
    else process.labels = value;
    return;
  }

  const thread = getThread(state, processId, threadId!);
  thread.evidenceIndexes.add(eventIndex);
  if (name === 'thread_name') {
    const value = readString(args.name);
    if (value === undefined) state.warnings.add('TRACE_METADATA_VALUE_INVALID');
    else thread.name = value;
  } else {
    const value = readFiniteNumber(args.sort_index);
    if (value === undefined) state.warnings.add('TRACE_METADATA_VALUE_INVALID');
    else thread.sortIndex = value;
  }
}

function addFrameSignal(
  state: ScanState,
  event: ChromiumTraceEvent,
  eventIndex: number,
  frame: Record<string, unknown>,
  defaultTimestampUs: number,
): void {
  const frameId = readLocalId(frame.frame) ?? readLocalId(frame.frameId);
  if (!frameId) return;
  const processId = readFiniteNumber(frame.processId);
  const signal: FrameSignal = {
    frameId,
    timestampUs: readFiniteNumber(frame.ts) ?? defaultTimestampUs,
    eventIndex,
    ...(readLocalId(frame.parent) === undefined
      && readLocalId(frame.parentFrameId) === undefined
      ? {}
      : { parentFrameId: readLocalId(frame.parent) ?? readLocalId(frame.parentFrameId) }),
    ...(processId === undefined ? {} : { processId }),
    ...(readBoolean(frame.isOutermostMainFrame) === undefined
      && readBoolean(frame.isOutermost) === undefined
      ? {}
      : {
          isOutermost: readBoolean(frame.isOutermostMainFrame)
            ?? readBoolean(frame.isOutermost),
        }),
  };
  state.frameSignals.push(signal);
  if (processId !== undefined) {
    getProcess(state, processId).evidenceIndexes.add(eventIndex);
  }
  addEvidence(state, event, eventIndex);
}

function collectFrameNavigationSignals(
  state: ScanState,
  event: ChromiumTraceEvent,
  eventIndex: number,
): void {
  const name = readString(event.name);
  const timestampUs = readFiniteNumber(event.ts);
  if (!name || timestampUs === undefined) return;

  if (name === 'TracingStartedInBrowser') {
    const frames = readEventData(event)?.frames;
    if (Array.isArray(frames)) {
      for (const value of frames) {
        const frame = readRecord(value);
        if (frame) addFrameSignal(state, event, eventIndex, frame, timestampUs);
      }
    }
    return;
  }

  if (FRAME_ASSIGNMENT_EVENT_NAMES.has(name)) {
    const frameId = readFrameId(event);
    if (!frameId) return;
    state.frameSignals.push({
      frameId,
      timestampUs,
      eventIndex,
      ...(readParentFrameId(event) === undefined
        ? {}
        : { parentFrameId: readParentFrameId(event) }),
      ...(readProcessId(event) === undefined
        ? {}
        : { processId: readProcessId(event) }),
      ...(readBoolean(readEventData(event)?.isOutermostMainFrame) === undefined
        && readBoolean(readEventData(event)?.isOutermost) === undefined
        ? {}
        : {
            isOutermost: readBoolean(readEventData(event)?.isOutermostMainFrame)
              ?? readBoolean(readEventData(event)?.isOutermost),
          }),
    });
    const processId = readProcessId(event);
    if (processId !== undefined) {
      getProcess(state, processId).evidenceIndexes.add(eventIndex);
    } else {
      state.warnings.add('TRACE_FRAME_PROCESS_MISSING');
    }
    addEvidence(state, event, eventIndex);
    return;
  }

  if (NAVIGATION_EVENT_NAMES.has(name)) {
    const frameId = readFrameId(event);
    if (!frameId) {
      state.warnings.add('TRACE_NAVIGATION_FRAME_MISSING');
      return;
    }
    state.navigationSignals.push({
      frameId,
      timestampUs,
      eventIndex,
      ...(readNavigationId(event) === undefined
        ? {}
        : { navigationId: readNavigationId(event) }),
    });
    state.families.add('navigation');
    addEvidence(state, event, eventIndex);
  }
}

function collectCaptureAndFamilies(state: ScanState, event: ChromiumTraceEvent): void {
  const name = readString(event.name)?.toLowerCase() ?? '';
  const category = readString(event.cat)?.toLowerCase() ?? '';
  if (category.includes('__metadata') || name === 'process_name' || name === 'thread_name') {
    state.families.add('metadata');
  }
  if (name.includes('navigation') || name.includes('commitload')) {
    state.families.add('navigation');
  }
  if (name.includes('resource') || name.includes('request') || name.includes('response')) {
    state.families.add('network');
  }
  if (name === 'runtask' || category.includes('devtools.timeline')) {
    state.families.add('main-thread');
  }
  if (/layout|paint|frame|raster/.test(name)) state.families.add('rendering');
  if (/eventtiming|interaction/.test(name)) state.families.add('interaction');
  if (/profile|profilechunk/.test(name)) state.families.add('cpu-profile');

  const timestampUs = readFiniteNumber(event.ts);
  if (timestampUs !== undefined) {
    state.captureStartUs = state.captureStartUs === undefined
      ? timestampUs
      : Math.min(state.captureStartUs, timestampUs);
    const durationUs = readFiniteNumber(event.dur);
    const endUs = durationUs === undefined || durationUs < 0
      ? timestampUs
      : timestampUs + durationUs;
    state.captureEndUs = state.captureEndUs === undefined
      ? endUs
      : Math.max(state.captureEndUs, endUs);
  }
}

function finalizeMetadata(state: ScanState): {
  processes: TraceProcessFacts[];
  threads: TraceThreadFacts[];
  rendererMainByProcess: Map<number, number[]>;
} {
  const rendererMainByProcess = new Map<number, number[]>();
  const threads = [...state.threads.values()]
    .sort((a, b) => a.processId - b.processId || a.threadId - b.threadId)
    .map<TraceThreadFacts>(thread => {
      const isRendererMain = thread.name?.trim() === 'CrRendererMain';
      if (isRendererMain) {
        const candidates = rendererMainByProcess.get(thread.processId) ?? [];
        candidates.push(thread.threadId);
        rendererMainByProcess.set(thread.processId, candidates);
      }
      return {
        processId: thread.processId,
        threadId: thread.threadId,
        ...(thread.name === undefined ? {} : { name: thread.name }),
        ...(thread.sortIndex === undefined ? {} : { sortIndex: thread.sortIndex }),
        isRendererMain,
        evidenceIds: sortedEvidenceIds(thread.evidenceIndexes),
      };
    });

  const processes = [...state.processes.values()]
    .sort((a, b) => a.processId - b.processId)
    .map<TraceProcessFacts>(process => ({
      processId: process.processId,
      ...(process.name === undefined ? {} : { name: process.name }),
      ...(process.labels === undefined ? {} : { labels: process.labels }),
      ...(process.sortIndex === undefined ? {} : { sortIndex: process.sortIndex }),
      threadIds: [...process.threadIds].sort((a, b) => a - b),
      evidenceIds: sortedEvidenceIds(process.evidenceIndexes),
    }));
  return { processes, threads, rendererMainByProcess };
}

function finalizeFrames(
  state: ScanState,
): { frames: Map<string, MutableFrame>; outermost: Map<string, string> } {
  const frames = new Map<string, MutableFrame>();
  const signals = [...state.frameSignals].sort((a, b) => (
    a.timestampUs - b.timestampUs || a.eventIndex - b.eventIndex
  ));
  for (const signal of signals) {
    let frame = frames.get(signal.frameId);
    if (!frame) {
      frame = {
        frameId: signal.frameId,
        explicitOutermost: false,
        evidenceIndexes: new Set(),
        assignments: [],
      };
      frames.set(signal.frameId, frame);
    }
    frame.evidenceIndexes.add(signal.eventIndex);
    if (signal.parentFrameId !== undefined) frame.parentFrameId = signal.parentFrameId;
    if (signal.isOutermost === true) frame.explicitOutermost = true;
    if (signal.processId !== undefined) frame.assignments.push(signal);
  }
  for (const navigation of state.navigationSignals) {
    if (!frames.has(navigation.frameId)) {
      frames.set(navigation.frameId, {
        frameId: navigation.frameId,
        explicitOutermost: false,
        evidenceIndexes: new Set([navigation.eventIndex]),
        assignments: [],
      });
    } else {
      frames.get(navigation.frameId)!.evidenceIndexes.add(navigation.eventIndex);
    }
  }

  const cycleFrames = new Set<string>();
  for (const frameId of frames.keys()) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = frameId;
    while (current !== undefined && frames.has(current)) {
      const position = positions.get(current);
      if (position !== undefined) {
        for (const cycleId of path.slice(position)) cycleFrames.add(cycleId);
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = frames.get(current)?.parentFrameId;
    }
  }
  if (cycleFrames.size > 0) state.warnings.add('TRACE_FRAME_PARENT_CYCLE');

  const outermost = new Map<string, string>();
  for (const frame of frames.values()) {
    if (cycleFrames.has(frame.frameId)) {
      frame.parentFrameId = undefined;
      outermost.set(frame.frameId, frame.frameId);
      continue;
    }
    if (frame.parentFrameId === undefined && !frame.explicitOutermost) {
      state.warnings.add('TRACE_FRAME_PARENT_MISSING');
    }
    let current = frame;
    const visited = new Set<string>();
    while (current.parentFrameId !== undefined && !visited.has(current.frameId)) {
      visited.add(current.frameId);
      const parent = frames.get(current.parentFrameId);
      if (!parent) {
        state.warnings.add('TRACE_FRAME_PARENT_MISSING');
        current = frame;
        break;
      }
      current = parent;
    }
    outermost.set(frame.frameId, current.frameId);
  }
  return { frames, outermost };
}

function mainThreadForProcess(
  processId: number,
  rendererMainByProcess: Map<number, number[]>,
  state: ScanState,
): { mainThreadId?: number; confidence: 'direct' | 'uncertain' } {
  const candidates = rendererMainByProcess.get(processId) ?? [];
  if (candidates.length === 1) {
    return { mainThreadId: candidates[0], confidence: 'direct' };
  }
  if (candidates.length > 1) {
    state.warnings.add('TRACE_RENDERER_MAIN_AMBIGUOUS');
    return { confidence: 'uncertain' };
  }
  state.warnings.add('TRACE_RENDERER_MAIN_MISSING');
  return { confidence: 'direct' };
}

function buildFrameSpans(
  frame: MutableFrame,
  captureEndUs: number | undefined,
  rendererMainByProcess: Map<number, number[]>,
  state: ScanState,
): TraceFrameProcessSpan[] {
  if (captureEndUs === undefined) return [];
  const sortedAssignments = [...frame.assignments].sort((a, b) => (
    a.timestampUs - b.timestampUs || a.eventIndex - b.eventIndex
  ));
  const assignments: FrameSignal[] = [];
  for (const assignment of sortedAssignments) {
    const previous = assignments[assignments.length - 1];
    if (previous?.timestampUs === assignment.timestampUs) {
      assignments[assignments.length - 1] = assignment;
    } else {
      assignments.push(assignment);
    }
  }
  const spans: TraceFrameProcessSpan[] = [];
  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index];
    if (assignment.processId === undefined) continue;
    const endUs = Math.max(
      assignment.timestampUs,
      Math.min(assignments[index + 1]?.timestampUs ?? captureEndUs, captureEndUs),
    );
    if (endUs <= assignment.timestampUs) continue;
    const mainThread = mainThreadForProcess(
      assignment.processId,
      rendererMainByProcess,
      state,
    );
    const span: TraceFrameProcessSpan = {
      processId: assignment.processId,
      startUs: assignment.timestampUs,
      endUs,
      ...(mainThread.mainThreadId === undefined
        ? {}
        : { mainThreadId: mainThread.mainThreadId }),
      confidence: mainThread.confidence,
      evidenceIds: [evidenceId(assignment.eventIndex)],
    };
    const previous = spans[spans.length - 1];
    if (
      previous
      && previous.processId === span.processId
      && previous.endUs === span.startUs
      && previous.mainThreadId === span.mainThreadId
      && previous.confidence === span.confidence
    ) {
      previous.endUs = span.endUs;
      previous.evidenceIds = [...new Set([...previous.evidenceIds, ...span.evidenceIds])].sort();
    } else {
      spans.push(span);
    }
  }
  return spans;
}

function clipSpans(
  spans: TraceFrameProcessSpan[],
  startUs: number,
  endUs: number,
): TraceFrameProcessSpan[] {
  return spans.flatMap(span => {
    const clippedStart = Math.max(span.startUs, startUs);
    const clippedEnd = Math.min(span.endUs, endUs);
    return clippedEnd <= clippedStart
      ? []
      : [{ ...span, startUs: clippedStart, endUs: clippedEnd }];
  });
}

function finalizeNavigations(
  state: ScanState,
  outermost: Map<string, string>,
  frameSpans: Map<string, TraceFrameProcessSpan[]>,
): TraceNavigationFacts[] {
  const deduplicated = new Map<string, MutableNavigation>();
  const signals = [...state.navigationSignals].sort((a, b) => (
    a.timestampUs - b.timestampUs || a.eventIndex - b.eventIndex
  ));
  for (const signal of signals) {
    const deduplicationKey = signal.navigationId
      ? `id:${signal.navigationId}`
      : `frame:${signal.frameId}:${signal.timestampUs}`;
    const existing = deduplicated.get(deduplicationKey);
    if (existing) {
      existing.evidenceIndexes.add(signal.eventIndex);
      continue;
    }
    deduplicated.set(deduplicationKey, {
      key: `trace:navigation:event:${signal.eventIndex}`,
      ...(signal.navigationId === undefined ? {} : { navigationId: signal.navigationId }),
      frameId: signal.frameId,
      startUs: signal.timestampUs,
      eventIndex: signal.eventIndex,
      evidenceIndexes: new Set([signal.eventIndex]),
    });
  }

  const byFrame = new Map<string, MutableNavigation[]>();
  for (const navigation of deduplicated.values()) {
    const values = byFrame.get(navigation.frameId) ?? [];
    values.push(navigation);
    byFrame.set(navigation.frameId, values);
  }

  const navigations: TraceNavigationFacts[] = [];
  for (const [frameId, values] of byFrame) {
    values.sort((a, b) => a.startUs - b.startUs || a.eventIndex - b.eventIndex);
    for (let index = 0; index < values.length; index += 1) {
      const navigation = values[index];
      const limitations: string[] = [];
      let endUs = values[index + 1]?.startUs ?? state.captureEndUs;
      if (endUs === undefined || endUs < navigation.startUs) {
        endUs = navigation.startUs;
        limitations.push('capture-end-unavailable');
        state.warnings.add('TRACE_NAVIGATION_CAPTURE_END_FALLBACK');
      }
      const processSpans = clipSpans(frameSpans.get(frameId) ?? [], navigation.startUs, endUs);
      if (processSpans.length === 0) {
        limitations.push('frame-process-assignment-missing');
        state.warnings.add('TRACE_FRAME_PROCESS_MISSING');
      }
      navigations.push({
        key: navigation.key,
        ...(navigation.navigationId === undefined
          ? {}
          : { navigationId: navigation.navigationId }),
        frameId,
        outermostFrameId: outermost.get(frameId) ?? frameId,
        startUs: navigation.startUs,
        endUs: Math.max(navigation.startUs, endUs),
        processSpans,
        evidenceIds: sortedEvidenceIds(navigation.evidenceIndexes),
        limitations,
      });
    }
  }
  return navigations.sort((a, b) => (
    a.frameId.localeCompare(b.frameId)
    || a.startUs - b.startUs
    || a.key.localeCompare(b.key)
  ));
}

function buildQuality(
  context: Omit<TraceContextFacts, 'quality' | 'warnings'>,
  warnings: TraceParserWarning[],
  skippedEventCount: number,
  hasCaptureWindow: boolean,
): TraceContextFacts['quality'] {
  const captureWindow = hasCaptureWindow ? 'available' : 'missing';
  const processThreadMetadata = context.processes.length === 0 && context.threads.length === 0
    ? 'missing'
    : context.processes.length > 0 && context.threads.length > 0
      ? 'available'
      : 'partial';
  const frameHierarchy = context.frames.length === 0
    ? 'missing'
    : warnings.includes('TRACE_FRAME_PARENT_CYCLE')
      || warnings.includes('TRACE_FRAME_PARENT_MISSING')
      ? 'partial'
      : 'available';
  const navigationContext = context.navigations.length === 0
    ? 'missing'
    : context.navigations.every(navigation => navigation.processSpans.length > 0)
      ? 'available'
      : 'partial';
  const spans = context.navigations.flatMap(navigation => navigation.processSpans);
  const rendererMainThread = spans.length === 0
    || spans.every(span => span.mainThreadId === undefined)
    ? 'missing'
    : spans.every(span => span.mainThreadId !== undefined && span.confidence !== 'uncertain')
      ? 'available'
      : 'partial';
  const disabledCapabilities: string[] = [];
  if (navigationContext === 'missing') disabledCapabilities.push('navigation-context');
  if (rendererMainThread === 'missing') disabledCapabilities.push('renderer-main-thread-mapping');
  const allCriticalMissing = navigationContext === 'missing'
    && processThreadMetadata === 'missing'
    && frameHierarchy === 'missing';
  const allCoreAvailable = !warnings.includes('TRACE_FACT_CANDIDATES_TRUNCATED')
    && captureWindow === 'available'
    && navigationContext === 'available'
    && processThreadMetadata === 'available'
    && frameHierarchy === 'available'
    && rendererMainThread === 'available';
  return {
    level: allCriticalMissing ? 'insufficient' : allCoreAvailable ? 'good' : 'partial',
    captureWindow,
    navigationContext,
    processThreadMetadata,
    frameHierarchy,
    rendererMainThread,
    skippedEventCount,
    warnings: [...warnings],
    disabledCapabilities,
  };
}

export class MinimalTraceAggregator implements TraceAggregatorPort<TraceContextResult> {
  private readonly maxEvidence: number;
  private readonly maxFactsPerKind: number;
  private readonly cancellationInterval: number;
  private readonly maxCandidatesPerKind: number;

  constructor(
    private readonly intakeSeed: TraceIntakeSeed,
    options: MinimalTraceAggregatorOptions = {},
  ) {
    this.maxEvidence = options.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
    this.maxFactsPerKind = options.maxFactsPerKind ?? DEFAULT_MAX_FACTS_PER_KIND;
    this.maxCandidatesPerKind = options.maxCandidatesPerKind ?? 10_000;
    this.cancellationInterval = options.cancellationInterval
      ?? DEFAULT_CANCELLATION_INTERVAL;
  }

  async aggregate(
    trace: ChromiumTraceFile,
    options: TraceAggregationOptions,
  ): Promise<TraceAggregatorOutput<TraceContextResult>> {
    const state: ScanState = {
      processes: new Map(),
      threads: new Map(),
      frameSignals: [],
      navigationSignals: [],
      evidence: new Map(),
      warnings: new Set(this.intakeSeed.warnings),
      families: new Set(),
    };
    const batch3Collector = new Batch3FactCollector({
      maxCandidatesPerKind: this.maxCandidatesPerKind,
      checkCancelled: () => {
        if (options.isCancelled()) throw new TraceAggregationCancelled();
      },
    });
    const total = trace.traceEvents.length;
    options.onProgress({ phase: 'scan-events', processed: 0, total });

    for (let eventIndex = 0; eventIndex < total; eventIndex += 1) {
      if (eventIndex % this.cancellationInterval === 0 && options.isCancelled()) {
        throw new TraceAggregationCancelled();
      }
      const event = trace.traceEvents[eventIndex];
      collectCaptureAndFamilies(state, event);
      collectMetadata(state, event, eventIndex);
      collectFrameNavigationSignals(state, event, eventIndex);
      if (batch3Collector.collect(event, eventIndex)) addEvidence(state, event, eventIndex);
      if (
        (eventIndex + 1) % this.cancellationInterval === 0
        || eventIndex + 1 === total
      ) {
        options.onProgress({ phase: 'scan-events', processed: eventIndex + 1, total });
        await options.yieldControl?.();
        if (options.isCancelled()) throw new TraceAggregationCancelled();
      }
    }

    options.onProgress({ phase: 'finalize-contexts' });
    if (options.isCancelled()) throw new TraceAggregationCancelled();
    const metadata = finalizeMetadata(state);
    const hierarchy = finalizeFrames(state);
    const frameSpans = new Map<string, TraceFrameProcessSpan[]>();
    for (const frame of hierarchy.frames.values()) {
      frameSpans.set(frame.frameId, buildFrameSpans(
        frame,
        state.captureEndUs,
        metadata.rendererMainByProcess,
        state,
      ));
    }
    const navigations = finalizeNavigations(
      state,
      hierarchy.outermost,
      frameSpans,
    );
    const buildFactTotal = batch3Collector.getFinalizeWorkTotal();
    options.onProgress({ phase: 'build-facts', processed: 0, total: buildFactTotal });
    const batch3Facts = batch3Collector.finalize(
      navigations,
      state.captureEndUs,
      this.maxFactsPerKind,
      (processed, totalWork) => {
        if (options.isCancelled()) throw new TraceAggregationCancelled();
        options.onProgress({
          phase: 'build-facts',
          processed,
          total: totalWork,
        });
      },
    );
    for (const warning of batch3Facts.warnings) state.warnings.add(warning);

    if (options.isCancelled()) throw new TraceAggregationCancelled();
    const referencedEvidenceIndexes = new Set<number>();
    for (const process of metadata.processes) {
      for (const id of process.evidenceIds) referencedEvidenceIndexes.add(Number(id.slice(12)));
    }
    for (const thread of metadata.threads) {
      for (const id of thread.evidenceIds) referencedEvidenceIndexes.add(Number(id.slice(12)));
    }
    for (const frame of hierarchy.frames.values()) {
      for (const index of frame.evidenceIndexes) referencedEvidenceIndexes.add(index);
    }
    for (const navigation of navigations) {
      for (const id of navigation.evidenceIds) referencedEvidenceIndexes.add(Number(id.slice(12)));
      for (const span of navigation.processSpans) {
        for (const id of span.evidenceIds) referencedEvidenceIndexes.add(Number(id.slice(12)));
      }
    }
    for (const index of batch3Facts.evidenceIndexes) referencedEvidenceIndexes.add(index);
    const evidenceIndexes = [...referencedEvidenceIndexes].sort((a, b) => a - b);
    const evidenceTotalCount = evidenceIndexes.length;
    if (evidenceTotalCount > this.maxEvidence) {
      state.warnings.add('TRACE_EVIDENCE_TRUNCATED');
    }
    const evidence = evidenceIndexes
      .slice(0, this.maxEvidence)
      .flatMap(index => {
        const cached = state.evidence.get(index);
        if (cached) return [cached];
        const event = trace.traceEvents[index];
        return event ? [createEvidenceRef(event, index)] : [];
      });
    const returnedEvidenceIds = new Set(evidence.map(item => item.evidenceId));
    const filterEvidenceIds = (ids: readonly string[]): string[] => (
      [...new Set(ids)].filter(id => returnedEvidenceIds.has(id)).slice(0, 32)
    );
    const warnings = [...state.warnings].sort();
    const frameIdentityInputs = [...hierarchy.frames.values()].map(frame => ({
      frame,
      primaryEventIndex: Math.min(...frame.evidenceIndexes),
    })).sort((left, right) => (
      left.primaryEventIndex - right.primaryEventIndex
      || left.frame.frameId.localeCompare(right.frame.frameId)
    ));
    const ordinalByEvent = new Map<number, number>();
    const frameRefs = new Map<string, string>();
    for (const { frame, primaryEventIndex } of frameIdentityInputs) {
      const ordinal = ordinalByEvent.get(primaryEventIndex) ?? 0;
      ordinalByEvent.set(primaryEventIndex, ordinal + 1);
      frameRefs.set(frame.frameId, `trace:frame:event:${primaryEventIndex}:${ordinal}`);
    }
    const frames = [...hierarchy.frames.values()]
      .sort((a, b) => a.frameId.localeCompare(b.frameId))
      .map<TraceFrameFacts>(frame => {
        const outermostFrameId = hierarchy.outermost.get(frame.frameId) ?? frame.frameId;
        return {
          frameId: frameRefs.get(frame.frameId)!,
          ...(frame.parentFrameId === undefined || !frameRefs.has(frame.parentFrameId)
            ? {}
            : { parentFrameId: frameRefs.get(frame.parentFrameId)! }),
          outermostFrameId: frameRefs.get(outermostFrameId)!,
          isOutermost: outermostFrameId === frame.frameId,
          processSpans: (frameSpans.get(frame.frameId) ?? []).map(span => ({
            ...span,
            evidenceIds: filterEvidenceIds(span.evidenceIds),
          })),
          evidenceIds: filterEvidenceIds(sortedEvidenceIds(frame.evidenceIndexes)),
        };
      });
    const processes = metadata.processes.map(process => ({
      ...process,
      evidenceIds: filterEvidenceIds(process.evidenceIds),
    }));
    const threads = metadata.threads.map(thread => ({
      ...thread,
      evidenceIds: filterEvidenceIds(thread.evidenceIds),
    }));
    const filteredNavigations = navigations.map(navigation => ({
      ...navigation,
      navigationId: navigation.key,
      frameId: frameRefs.get(navigation.frameId)!,
      outermostFrameId: frameRefs.get(navigation.outermostFrameId)!,
      evidenceIds: filterEvidenceIds(navigation.evidenceIds),
      processSpans: navigation.processSpans.map(span => ({
        ...span,
        evidenceIds: filterEvidenceIds(span.evidenceIds),
      })),
    }));
    const requests = batch3Facts.requests.map(request => ({
      ...request,
      evidenceIds: filterEvidenceIds(request.evidenceIds),
      initiatorEvidenceIds: filterEvidenceIds(request.initiatorEvidenceIds),
    }));
    const filterFactEvidence = <T extends { evidenceIds: string[] }>(facts: T[]): T[] => (
      facts.map(fact => ({ ...fact, evidenceIds: filterEvidenceIds(fact.evidenceIds) }))
    );
    const contextWithoutQuality = {
      processes,
      threads,
      frames,
      navigations: filteredNavigations,
      requests,
      tasks: filterFactEvidence(batch3Facts.tasks),
      profiles: filterFactEvidence(batch3Facts.profiles),
      milestones: filterFactEvidence(batch3Facts.milestones),
      animationFrames: filterFactEvidence(batch3Facts.animationFrames),
      animationFrameSummary: batch3Facts.animationFrameSummary,
      rendering: filterFactEvidence(batch3Facts.rendering),
      interactions: filterFactEvidence(batch3Facts.interactions),
      interactionSummary: batch3Facts.interactionSummary,
      cpuHotspots: filterFactEvidence(batch3Facts.cpuHotspots),
      forcedReflowClues: filterFactEvidence(batch3Facts.forcedReflowClues),
      factCounts: batch3Facts.factCounts,
      evidence,
      evidenceTotalCount,
      evidenceReturnedCount: evidence.length,
    };
    const quality = buildQuality(
      contextWithoutQuality,
      warnings,
      this.intakeSeed.skippedEventCount,
      state.captureStartUs !== undefined
        && state.captureEndUs !== undefined
        && state.captureEndUs > state.captureStartUs,
    );
    const context: TraceContextFacts = {
      ...contextWithoutQuality,
      quality,
      warnings,
    };
    const intake = {
      format: 'chromium-trace-object' as const,
      encoding: this.intakeSeed.encoding,
      jsonBytes: this.intakeSeed.jsonBytes,
      eventCount: total,
      ...(state.captureStartUs === undefined ? {} : { captureStartUs: state.captureStartUs }),
      ...(state.captureEndUs === undefined ? {} : { captureEndUs: state.captureEndUs }),
      availableFamilies: [...state.families].sort(),
      warnings: [...this.intakeSeed.warnings].sort(),
    };
    return {
      facts: { intake, context },
      warnings,
    };
  }
}
