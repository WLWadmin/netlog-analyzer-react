import {
  readBoolean,
  readEventData,
  readFiniteNumber,
  readLocalId,
  readRecord,
  readString,
} from './eventAccessors';
import { appendProfileChunkSamples } from './cpuProfileFacts';
import { calculateEventTiming } from './interactionFacts';
import { buildDispatchWaitFact, classifyRequest } from './requestFacts';
import { calculateSelfTime } from './taskFacts';
import type {
  ChromiumTraceEvent,
  TraceAnimationFrameFacts,
  TraceAnimationFrameSummary,
  TraceCpuHotspot,
  TraceCpuProfileFacts,
  TraceFactCounts,
  TraceForcedReflowClue,
  TraceInteractionFacts,
  TraceInteractionSummary,
  TraceMilestoneFacts,
  TraceNavigationFacts,
  TraceParserWarning,
  TraceRenderingEventFacts,
  TraceRequestFacts,
  TraceSanitizedUrl,
  TraceTaskFacts,
  TraceWorkCategory,
} from './types';

const REQUEST_NAMES = new Set([
  'ResourceSendRequest',
  'ResourceReceiveResponse',
  'ResourceReceivedData',
  'ResourceFinish',
  'ResourceFail',
]);
const MAX_ENTITY_EVIDENCE = 32;

const MILESTONE_NAMES: Record<string, TraceMilestoneFacts['name']> = {
  MarkDOMContent: 'DCL',
  MarkLoad: 'Load',
  firstContentfulPaint: 'FCP',
  'largestContentfulPaint::Candidate': 'LCP',
};
const FRAME_NAMES = new Set(['DrawFrame', 'DroppedFrame']);
const RENDERING_NAMES = new Set([
  'Layout',
  'UpdateLayoutTree',
  'Paint',
  'RasterTask',
  'CompositeLayers',
  'ForcedReflow',
]);
const SHAPE_WARNING: TraceParserWarning = 'TRACE_BATCH3_EVENT_SHAPE_UNSUPPORTED';

interface IndexedEvent {
  event: ChromiumTraceEvent;
  eventIndex: number;
}

interface CompleteEvent extends IndexedEvent {
  name: string;
  processId: number;
  threadId: number;
  startUs: number;
  endUs: number;
}

interface FrameCandidate extends IndexedEvent {
  name: 'DrawFrame' | 'DroppedFrame';
  processId: number;
  threadId: number;
  startUs: number;
  durationUs?: number;
}

interface TaskTreeNode {
  key: string;
  name: string;
  startUs: number;
  endUs: number;
  evidenceIndexes: number[];
}

interface MutableRequest {
  requestId: string;
  redirectIndex: number;
  send: IndexedEvent;
  startUs: number;
  processId?: number;
  frameId?: string;
  navigationId?: string;
  url?: TraceSanitizedUrl;
  method?: string;
  resourceType?: string;
  statusCode?: number;
  protocol?: string;
  fromCache?: boolean;
  failed?: boolean;
  explicitCancelled: boolean;
  endUs?: number;
  evidenceIndexes: number[];
  initiatorRequestId?: string;
  dataEventCount: number;
  encodedDataLength?: number;
  calibratedNetworkSendMs?: number;
  calibratedNetworkResponseMs?: number;
  rendererResponseEventMs?: number;
  mainThreadProcessingStartMs?: number;
  networkTimeDomain?: string;
  rendererTimeDomain?: string;
  traceTimeDomain?: string;
  resourceTimingDurationMs?: number;
}

interface MutableProfileNode {
  nodeId: number;
  functionName: string;
  script?: TraceSanitizedUrl;
  lineNumber?: number;
  columnNumber?: number;
}

interface MutableProfile {
  profileId: string;
  processId: number;
  threadId: number;
  startUs: number;
  endUs: number;
  nodes: Map<number, MutableProfileNode>;
  samples: Array<{ nodeId: number; timestampUs: number; deltaUs: number }>;
  sampleCount: number;
  evidenceIndexes: number[];
  limitations: Set<string>;
}

export interface Batch3CollectorOutput {
  requests: TraceRequestFacts[];
  tasks: TraceTaskFacts[];
  profiles: TraceCpuProfileFacts[];
  milestones: TraceMilestoneFacts[];
  animationFrames: TraceAnimationFrameFacts[];
  animationFrameSummary: TraceAnimationFrameSummary;
  rendering: TraceRenderingEventFacts[];
  interactions: TraceInteractionFacts[];
  interactionSummary: TraceInteractionSummary;
  cpuHotspots: TraceCpuHotspot[];
  forcedReflowClues: TraceForcedReflowClue[];
  factCounts: TraceFactCounts;
  evidenceIndexes: number[];
  warnings: TraceParserWarning[];
}

function evidenceId(index: number): string {
  return `trace:event:${index}`;
}

function eventId(value: unknown): string | undefined {
  return readLocalId(value)
    ?? readLocalId(readRecord(value)?.local)
    ?? readLocalId(readRecord(value)?.global);
}

function sanitizeUrl(value: unknown): TraceSanitizedUrl | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return { origin: parsed.origin, pathname: parsed.pathname };
  } catch {
    return undefined;
  }
}

function navigationFor(
  navigations: readonly TraceNavigationFacts[],
  timestampUs: number,
  processId?: number,
  navigationId?: string,
  frameId?: string,
): TraceNavigationFacts | undefined {
  if (navigationId) {
    const exact = navigations.find(item => item.navigationId === navigationId);
    if (exact) return exact;
  }
  if (frameId) {
    const exactFrame = navigations.find(item => item.frameId === frameId
      && timestampUs >= item.startUs
      && timestampUs <= item.endUs);
    if (exactFrame) return exactFrame;
  }
  return navigations.find(item => timestampUs >= item.startUs
    && timestampUs <= item.endUs
    && (processId === undefined || item.processSpans.some(span => (
      span.processId === processId
      && timestampUs >= span.startUs
      && timestampUs <= span.endUs
    ))));
}

function profileKey(
  processId: number,
  profileId: string,
): string {
  return `${processId}:profile:${profileId}`;
}


function boundedEvidenceIds(indexes: Iterable<number>): string[] {
  return [...new Set(indexes)].sort((left, right) => left - right)
    .slice(0, MAX_ENTITY_EVIDENCE).map(evidenceId);
}

function categoryFor(name: string): TraceWorkCategory {
  if (/script|function|microtask|callback/i.test(name)) return 'script';
  if (/layout|paint|raster|composite/i.test(name)) return 'rendering';
  if (/gc|garbage/i.test(name)) return 'gc';
  return 'other';
}

const MAX_FUNCTION_NAME_LENGTH = 120;

function sanitizeFunctionName(value: unknown): string {
  const cleaned = Array.from(readString(value) ?? '(anonymous)', character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  }).join('').trim();
  const normalized = cleaned || '(anonymous)';
  const codePoints = Array.from(normalized);
  return codePoints.length <= MAX_FUNCTION_NAME_LENGTH
    ? normalized
    : `${codePoints.slice(0, MAX_FUNCTION_NAME_LENGTH - 3).join('')}...`;
}

type CandidateKind = keyof TraceFactCounts;

interface Batch3FactCollectorOptions {
  maxCandidatesPerKind?: number;
  checkCancelled?: () => void;
}


export class Batch3FactCollector {
  private readonly warnings = new Set<TraceParserWarning>();
  private readonly maxCandidatesPerKind: number;
  private readonly checkCancelled: () => void;
  private readonly candidateTotals: Record<CandidateKind, number> = {
    requests: 0,
    tasks: 0,
    profiles: 0,
    milestones: 0,
    animationFrames: 0,
    rendering: 0,
    interactions: 0,
    cpuHotspots: 0,
    forcedReflowClues: 0,
  };
  private readonly candidateDroppedKinds = new Set<CandidateKind>();
  private cancellationCounter = 0;
  private retainedProfileSamples = 0;
  private readonly requests: MutableRequest[] = [];
  private readonly requestsById = new Map<string, MutableRequest>();
  private readonly completeEvents: CompleteEvent[] = [];
  private completeEventsDropped = false;
  private readonly longTasks: CompleteEvent[] = [];
  private readonly profiles = new Map<string, MutableProfile>();
  private readonly profileEntries: MutableProfile[] = [];
  private readonly milestones: IndexedEvent[] = [];
  private readonly frames: FrameCandidate[] = [];
  private readonly renderingEvents: CompleteEvent[] = [];
  private readonly forcedReflowEvents: CompleteEvent[] = [];
  private readonly interactions: IndexedEvent[] = [];
  private readonly phaseEvents: IndexedEvent[] = [];

  constructor(options: Batch3FactCollectorOptions = {}) {
    this.maxCandidatesPerKind = Math.min(options.maxCandidatesPerKind ?? 10_000, 10_000);
    this.checkCancelled = options.checkCancelled ?? (() => undefined);
  }

  private checkpoint(): void {
    this.cancellationCounter += 1;
    if (this.cancellationCounter % 256 === 0) this.checkCancelled();
  }


  private retain(kind: CandidateKind): boolean {
    this.candidateTotals[kind] += 1;
    if (this.candidateTotals[kind] <= this.maxCandidatesPerKind) return true;
    this.warnings.add('TRACE_FACT_CANDIDATES_TRUNCATED');
    this.candidateDroppedKinds.add(kind);
    return false;
  }

  getFinalizeWorkTotal(): number {
    return this.requests.length
      + this.longTasks.length
      + this.profileEntries.length
      + this.milestones.length
      + this.frames.length
      + this.renderingEvents.length
      + this.forcedReflowEvents.length
      + this.retainedProfileSamples
      + this.interactions.length;
  }

  collect(event: ChromiumTraceEvent, eventIndex: number): boolean {
    this.checkpoint();
    const name = readString(event.name);
    if (!name) return false;
    let recognized = false;

    if (REQUEST_NAMES.has(name)) {
      recognized = true;
      this.collectRequest(name, event, eventIndex);
    }
    if (name === 'Profile' || name === 'ProfileChunk') {
      recognized = true;
      this.collectProfile(name, event, eventIndex);
    }
    if (MILESTONE_NAMES[name]) {
      recognized = true;
      if (readFiniteNumber(event.ts) === undefined) this.warnings.add(SHAPE_WARNING);
      else if (this.retain('milestones')) this.milestones.push({ event, eventIndex });
    }
    if (name === 'EventTiming') {
      recognized = true;
      const data = readEventData(event);
      const completeTiming = data
        && readFiniteNumber(data.eventStart) !== undefined
        && readFiniteNumber(data.processingStart) !== undefined
        && readFiniteNumber(data.processingEnd) !== undefined
        && readFiniteNumber(data.interactionEnd) !== undefined;
      const pairBegin = event.ph === 'b'
        && data !== undefined
        && readFiniteNumber(data.interactionId) !== undefined
        && readFiniteNumber(data.processingStart) !== undefined
        && (eventId(event.id) !== undefined
          ? readFiniteNumber(data.timeStamp) !== undefined
            && readFiniteNumber(data.processingEnd) !== undefined
          : readFiniteNumber(data.eventStart) !== undefined);
      const pairEnd = event.ph === 'e'
        && (eventId(event.id) !== undefined
          || (data !== undefined
            && readFiniteNumber(data.interactionId) !== undefined
            && readFiniteNumber(data.processingEnd) !== undefined
            && readFiniteNumber(data.interactionEnd) !== undefined));
      if (!completeTiming && !pairBegin && !pairEnd) {
        this.warnings.add(SHAPE_WARNING);
      } else {
        const startsFact = Boolean(completeTiming || pairBegin);
        if ((!startsFact || this.retain('interactions'))
          && this.interactions.length < this.maxCandidatesPerKind * 2) {
          this.interactions.push({ event, eventIndex });
        } else if (!startsFact) {
          this.warnings.add('TRACE_FACT_CANDIDATES_TRUNCATED');
          this.candidateDroppedKinds.add('interactions');
        }
      }
    }
    if (FRAME_NAMES.has(name)) {
      recognized = true;
      const processId = readFiniteNumber(event.pid);
      const threadId = readFiniteNumber(event.tid);
      const startUs = readFiniteNumber(event.ts);
      const durationUs = event.ph === 'X' ? readFiniteNumber(event.dur) : undefined;
      if (processId === undefined || threadId === undefined || startUs === undefined
        || (event.ph === 'X' && (durationUs === undefined || durationUs < 0))) {
        this.warnings.add(SHAPE_WARNING);
      } else if (this.retain('animationFrames')) {
        this.frames.push({
          event,
          eventIndex,
          name: name as FrameCandidate['name'],
          processId,
          threadId,
          startUs,
          ...(durationUs === undefined ? {} : { durationUs }),
        });
      }
    }
    if ((event.ph === 'B' || event.ph === 'E')
      && readFiniteNumber(event.pid) !== undefined
      && readFiniteNumber(event.tid) !== undefined
      && readFiniteNumber(event.ts) !== undefined) {
      if (this.phaseEvents.length < this.maxCandidatesPerKind) {
        this.phaseEvents.push({ event, eventIndex });
      } else {
        this.warnings.add('TRACE_FACT_CANDIDATES_TRUNCATED');
      }
      recognized = true;
    }

    const complete = this.readCompleteEvent(event, eventIndex);
    if (complete) {
      recognized = true;
      if (this.completeEvents.length < this.maxCandidatesPerKind) {
        this.completeEvents.push(complete);
      } else {
        this.warnings.add('TRACE_FACT_CANDIDATES_TRUNCATED');
        this.completeEventsDropped = true;
      }
      if (RENDERING_NAMES.has(name)) {
        recognized = true;
        if (this.retain('rendering')) this.renderingEvents.push(complete);
        if (name === 'ForcedReflow' || (name === 'Layout' && this.hasStrongLayoutEvidence(event))) {
          if (this.retain('forcedReflowClues')) this.forcedReflowEvents.push(complete);
        }
      }
      if (name === 'RunTask') {
        recognized = true;
        if (complete.endUs - complete.startUs >= 50_000 && this.retain('tasks')) {
          this.longTasks.push(complete);
        }
      }
    } else if (name === 'RunTask' || RENDERING_NAMES.has(name)) {
      recognized = true;
      this.warnings.add(SHAPE_WARNING);
    }
    return recognized;
  }

  finalize(
    navigations: readonly TraceNavigationFacts[],
    captureEndUs: number | undefined,
    maxFactsPerKind: number,
    onProgress: (processed: number, total: number) => void = () => undefined,
  ): Batch3CollectorOutput {
    const totalWork = this.getFinalizeWorkTotal();
    let processedWork = 0;
    const reportCompleted = (work: number): void => {
      if (work <= 0) return;
      processedWork += work;
      onProgress(processedWork, totalWork);
    };
    const requests = this.finalizeRequests(navigations, captureEndUs);
    reportCompleted(this.requests.length);
    const tasks = this.finalizeTasks(navigations);
    reportCompleted(this.longTasks.length);
    const profiles = this.finalizeProfiles();
    reportCompleted(this.profileEntries.length);
    const milestones = this.finalizeMilestones(navigations);
    reportCompleted(this.milestones.length);
    const animationFrames = this.finalizeFrames(navigations);
    reportCompleted(this.frames.length);
    const rendering = this.finalizeRendering(navigations);
    reportCompleted(this.renderingEvents.length);
    const forcedReflowClues = this.finalizeForcedReflowClues(navigations, tasks);
    reportCompleted(this.forcedReflowEvents.length);
    const cpuHotspots = this.finalizeCpuHotspots(navigations, tasks);
    reportCompleted(this.retainedProfileSamples);
    const interactions = this.finalizeInteractions(
      navigations, tasks, rendering, animationFrames,
    );
    reportCompleted(this.interactions.length);
    const frameSummaryLimitations = [
      ...(this.candidateDroppedKinds.has('animationFrames')
        ? ['internal-candidate-limit']
        : []),
      ...(this.frames.some(frame => frame.durationUs === undefined && frame.name === 'DrawFrame')
        ? ['frame-duration-derived-from-draw-interval']
        : []),
      ...(this.frames.some(frame => frame.durationUs === undefined && frame.name === 'DroppedFrame')
        ? ['dropped-frame-duration-unavailable']
        : []),
    ];
    const animationFrameSummary: TraceAnimationFrameSummary = {
      completeness: frameSummaryLimitations.length > 0 ? 'partial' : 'complete',
      limitations: frameSummaryLimitations,
      totalCount: animationFrames.length,
      droppedCount: animationFrames.filter(frame => frame.dropped).length,
      overBudgetCount: animationFrames.filter(frame => frame.overBudget).length,
      maxDurationMs: animationFrames.reduce((maximum, frame) => Math.max(maximum, frame.durationMs), 0),
      budgetMs: 16.7,
      budgetBasis: '60hz-reference',
      refreshRate: 'unknown',
    };
    const slowestInteraction = interactions.reduce<TraceInteractionFacts | undefined>(
      (slowest, interaction) => !slowest || interaction.totalLatencyMs > slowest.totalLatencyMs
        ? interaction
        : slowest,
      undefined,
    );
    const interactionSummary: TraceInteractionSummary = {
      completeness: this.candidateDroppedKinds.has('interactions') ? 'partial' : 'complete',
      limitations: this.candidateDroppedKinds.has('interactions')
        ? ['internal-candidate-limit']
        : [],
      totalCount: interactions.length,
      ...(slowestInteraction ? {
        slowestInteractionId: slowestInteraction.id,
        maxTotalLatencyMs: slowestInteraction.totalLatencyMs,
      } : {}),
    };
    const all = {
      requests, tasks, profiles, milestones, animationFrames, rendering,
      interactions, cpuHotspots, forcedReflowClues,
    };
    const boundedRequests = requests.slice(0, maxFactsPerKind);
    const boundedTasks = tasks.slice(0, maxFactsPerKind);
    const boundedProfiles = profiles.slice(0, maxFactsPerKind);
    const boundedMilestones = milestones.slice(0, maxFactsPerKind);
    const boundedFrames = animationFrames.slice(0, maxFactsPerKind);
    const boundedRendering = rendering.slice(0, maxFactsPerKind);
    const boundedInteractions = interactions.slice(0, maxFactsPerKind);
    const boundedHotspots = cpuHotspots.slice(0, maxFactsPerKind);
    const boundedClues = forcedReflowClues.slice(0, maxFactsPerKind);

    const requestIds = new Set(boundedRequests.map(item => item.id));
    const taskIds = new Set(boundedTasks.map(item => item.id));
    const renderingIds = new Set(boundedRendering.map(item => item.id));
    const frameIds = new Set(boundedFrames.map(item => item.id));
    const interactionIds = new Set(boundedInteractions.map(item => item.id));
    const bounded = {
      requests: boundedRequests.map(request => ({
        ...request,
        ...(request.redirectPreviousRequestId
          && requestIds.has(request.redirectPreviousRequestId)
          ? { redirectPreviousRequestId: request.redirectPreviousRequestId }
          : { redirectPreviousRequestId: undefined }),
        ...(request.redirectNextRequestId && requestIds.has(request.redirectNextRequestId)
          ? { redirectNextRequestId: request.redirectNextRequestId }
          : { redirectNextRequestId: undefined }),
        ...(request.initiatorRequestId && requestIds.has(request.initiatorRequestId)
          ? { initiatorRequestId: request.initiatorRequestId }
          : { initiatorRequestId: undefined }),
        initiatorEvidenceIds: request.initiatorRequestId
          && requestIds.has(request.initiatorRequestId)
          ? request.initiatorEvidenceIds
          : [],
      })),
      tasks: boundedTasks,
      profiles: boundedProfiles,
      milestones: boundedMilestones,
      animationFrames: boundedFrames,
      rendering: boundedRendering,
      interactions: boundedInteractions.map(interaction => ({
        ...interaction,
        taskIds: interaction.taskIds.filter(id => taskIds.has(id)),
        renderingEventIds: interaction.renderingEventIds.filter(id => renderingIds.has(id)),
        frameIds: interaction.frameIds.filter(id => frameIds.has(id)),
      })),
      cpuHotspots: boundedHotspots.map(hotspot => ({
        ...hotspot,
        taskIds: hotspot.taskIds.filter(id => taskIds.has(id)),
      })),
      forcedReflowClues: boundedClues.map(clue => clue.taskId && !taskIds.has(clue.taskId)
        ? { ...clue, taskId: undefined }
        : clue),
    };
    const factCounts: TraceFactCounts = {
      requests: { total: all.requests.length, returned: bounded.requests.length, truncated: all.requests.length > bounded.requests.length },
      tasks: { total: all.tasks.length, returned: bounded.tasks.length, truncated: all.tasks.length > bounded.tasks.length },
      profiles: { total: all.profiles.length, returned: bounded.profiles.length, truncated: all.profiles.length > bounded.profiles.length },
      milestones: { total: all.milestones.length, returned: bounded.milestones.length, truncated: all.milestones.length > bounded.milestones.length },
      animationFrames: { total: all.animationFrames.length, returned: bounded.animationFrames.length, truncated: all.animationFrames.length > bounded.animationFrames.length },
      rendering: { total: all.rendering.length, returned: bounded.rendering.length, truncated: all.rendering.length > bounded.rendering.length },
      interactions: { total: all.interactions.length, returned: bounded.interactions.length, truncated: all.interactions.length > bounded.interactions.length },
      cpuHotspots: { total: all.cpuHotspots.length, returned: bounded.cpuHotspots.length, truncated: all.cpuHotspots.length > bounded.cpuHotspots.length },
      forcedReflowClues: { total: all.forcedReflowClues.length, returned: bounded.forcedReflowClues.length, truncated: all.forcedReflowClues.length > bounded.forcedReflowClues.length },
    };
    if (Object.values(factCounts).some(value => value.truncated)) {
      this.warnings.add('TRACE_FACTS_TRUNCATED');
    }
    const boundedInteractionSummary: TraceInteractionSummary = {
      ...interactionSummary,
      ...(interactionSummary.slowestInteractionId
        && interactionIds.has(interactionSummary.slowestInteractionId)
        ? { slowestInteractionId: interactionSummary.slowestInteractionId }
        : { slowestInteractionId: undefined }),
    };
    const evidenceIndexes = [...new Set(Object.values(bounded).flatMap(values => (
      values.flatMap(value => value.evidenceIds.map(id => Number(id.slice(12))))
    )))].sort((left, right) => left - right);
    return {
      ...bounded,
      animationFrameSummary,
      interactionSummary: boundedInteractionSummary,
      factCounts,
      evidenceIndexes,
      warnings: [...this.warnings].sort(),
    };
  }

  private hasStrongLayoutEvidence(event: ChromiumTraceEvent): boolean {
    const data = readEventData(event);
    const beginData = readRecord(readRecord(event.args)?.beginData);
    return Array.isArray(data?.stack)
      || Array.isArray(data?.invalidationTracking)
      || Array.isArray(beginData?.stackTrace)
      || readRecord(data?.stack) !== undefined
      || readRecord(data?.invalidationTracking) !== undefined
      || readRecord(beginData?.stackTrace) !== undefined;
  }

  private readCompleteEvent(event: ChromiumTraceEvent, eventIndex: number): CompleteEvent | undefined {
    if (event.ph !== 'X') return undefined;
    const name = readString(event.name);
    const processId = readFiniteNumber(event.pid);
    const threadId = readFiniteNumber(event.tid);
    const startUs = readFiniteNumber(event.ts);
    const durationUs = readFiniteNumber(event.dur);
    if (!name || processId === undefined || threadId === undefined
      || startUs === undefined || durationUs === undefined || durationUs < 0) return undefined;
    return { event, eventIndex, name, processId, threadId, startUs, endUs: startUs + durationUs };
  }

  private collectRequest(name: string, event: ChromiumTraceEvent, eventIndex: number): void {
    const data = readEventData(event);
    const requestId = readLocalId(data?.requestId);
    const timestampUs = readFiniteNumber(event.ts);
    if (!data || !requestId || timestampUs === undefined) {
      this.warnings.add(SHAPE_WARNING);
      return;
    }
    if (name === 'ResourceSendRequest') {
      if (!this.retain('requests')) {
        this.requestsById.delete(requestId);
        return;
      }
      const previous = this.requestsById.get(requestId);
      const request: MutableRequest = {
        requestId,
        redirectIndex: previous ? previous.redirectIndex + 1 : 0,
        send: { event, eventIndex },
        startUs: timestampUs,
        processId: readFiniteNumber(event.pid),
        frameId: readLocalId(data.frame),
        navigationId: readLocalId(data.navigationId),
        url: sanitizeUrl(data.url),
        method: readString(data.requestMethod),
        resourceType: readString(data.resourceType),
        explicitCancelled: false,
        evidenceIndexes: [eventIndex],
        initiatorRequestId: readLocalId(data.initiatorRequestId),
        dataEventCount: 0,
        encodedDataLength: undefined,
        calibratedNetworkSendMs: readFiniteNumber(data.calibratedNetworkSendMs),
        calibratedNetworkResponseMs: readFiniteNumber(data.calibratedNetworkResponseMs),
        rendererResponseEventMs: readFiniteNumber(data.rendererResponseEventMs),
        mainThreadProcessingStartMs: readFiniteNumber(data.mainThreadProcessingStartMs),
        networkTimeDomain: readString(data.networkTimeDomain),
        rendererTimeDomain: readString(data.rendererTimeDomain),
        traceTimeDomain: readString(data.traceTimeDomain),
      };
      this.requests.push(request);
      this.requestsById.set(requestId, request);
      return;
    }
    const request = this.requestsById.get(requestId);
    if (!request) {
      this.warnings.add(SHAPE_WARNING);
      return;
    }
    if (request.evidenceIndexes.length < MAX_ENTITY_EVIDENCE) {
      request.evidenceIndexes.push(eventIndex);
    }
    if (name === 'ResourceReceivedData') {
      request.dataEventCount += 1;
      const length = readFiniteNumber(data.encodedDataLength);
      if (length !== undefined) request.encodedDataLength = (request.encodedDataLength ?? 0) + length;
    } else if (name === 'ResourceReceiveResponse') {
      request.statusCode = readFiniteNumber(data.statusCode);
      request.protocol = readString(data.protocol);
      request.fromCache = readBoolean(data.fromCache);
      const timing = readRecord(data.timing);
      const sendStart = readFiniteNumber(timing?.sendStart);
      const receiveHeadersEnd = readFiniteNumber(timing?.receiveHeadersEnd);
      if (sendStart !== undefined && receiveHeadersEnd !== undefined
        && receiveHeadersEnd >= sendStart) {
        request.resourceTimingDurationMs = receiveHeadersEnd - sendStart;
      }
    } else if (name === 'ResourceFinish' || name === 'ResourceFail') {
      request.endUs = timestampUs;
      request.failed = name === 'ResourceFail' ? true : readBoolean(data.didFail);
      request.explicitCancelled = readBoolean(data.cancelled) === true
        || readBoolean(data.canceled) === true;
    }
  }

  private collectProfile(name: string, event: ChromiumTraceEvent, eventIndex: number): void {
    const processId = readFiniteNumber(event.pid);
    const threadId = readFiniteNumber(event.tid);
    const data = readEventData(event);
    const profileId = eventId(event.id) ?? eventId(data?.id);
    const timestampUs = readFiniteNumber(event.ts);
    if (processId === undefined || threadId === undefined || !data || !profileId
      || timestampUs === undefined) {
      this.warnings.add(SHAPE_WARNING);
      return;
    }
    // Chromium emits Profile on the sampled thread but most ProfileChunk
    // events on a profiler transport thread. The profile id is process-local;
    // the original Profile event still supplies the sampled thread identity.
    const key = profileKey(processId, profileId);
    if (name === 'Profile') {
      if (!this.retain('profiles')) {
        this.profiles.delete(key);
        return;
      }
      const startUs = readFiniteNumber(data.startTime) ?? timestampUs;
      const profile: MutableProfile = {
        profileId, processId, threadId, startUs, endUs: startUs,
        nodes: new Map(), samples: [], sampleCount: 0, evidenceIndexes: [eventIndex], limitations: new Set(),
      };
      this.profiles.set(key, profile);
      this.profileEntries.push(profile);
      return;
    }
    const profile = this.profiles.get(key);
    const cpuProfile = readRecord(data.cpuProfile);
    const nodes = cpuProfile?.nodes;
    const samples = cpuProfile?.samples;
    const timeDeltas = data.timeDeltas;
    if (!profile || (nodes !== undefined && !Array.isArray(nodes))) {
      this.warnings.add(SHAPE_WARNING);
      return;
    }
    for (const value of nodes ?? []) {
      const node = readRecord(value);
      const nodeId = readFiniteNumber(node?.id);
      const callFrame = readRecord(node?.callFrame);
      const script = sanitizeUrl(callFrame?.url);
      if (nodeId !== undefined && (profile.nodes.has(nodeId) || this.retain('cpuHotspots'))) {
        profile.nodes.set(nodeId, {
          nodeId,
          functionName: sanitizeFunctionName(callFrame?.functionName),
          ...(script ? { script } : {}),
          ...(readFiniteNumber(callFrame?.lineNumber) === undefined ? {} : { lineNumber: readFiniteNumber(callFrame?.lineNumber) }),
          ...(readFiniteNumber(callFrame?.columnNumber) === undefined ? {} : { columnNumber: readFiniteNumber(callFrame?.columnNumber) }),
        });
      }
    }
    if (samples === undefined && timeDeltas === undefined) {
      if (profile.evidenceIndexes.length < MAX_ENTITY_EVIDENCE) {
        profile.evidenceIndexes.push(eventIndex);
      }
      return;
    }
    if (!Array.isArray(samples) || !Array.isArray(timeDeltas)) {
      this.warnings.add(SHAPE_WARNING);
      return;
    }
    const sampleIds = samples.map(readFiniteNumber).filter((value): value is number => value !== undefined);
    const deltas = timeDeltas.map(readFiniteNumber).filter((value): value is number => value !== undefined);
    if (sampleIds.length !== samples.length || deltas.length !== timeDeltas.length) {
      this.warnings.add(SHAPE_WARNING);
      return;
    }
    const appended = appendProfileChunkSamples(profile.endUs, sampleIds, deltas);
    const remainingSamples = Math.max(
      this.maxCandidatesPerKind - this.retainedProfileSamples,
      0,
    );
    const retainedSamples = appended.samples.slice(0, remainingSamples);
    profile.samples.push(...retainedSamples);
    this.retainedProfileSamples += retainedSamples.length;
    if (appended.samples.length > retainedSamples.length) {
      this.warnings.add('TRACE_FACT_CANDIDATES_TRUNCATED');
      profile.limitations.add('profile-samples-candidate-limit');
    }
    profile.sampleCount += appended.samples.length;
    profile.endUs = appended.endTimeUs;
    if (profile.evidenceIndexes.length < MAX_ENTITY_EVIDENCE) {
      profile.evidenceIndexes.push(eventIndex);
    }
    for (const warning of appended.warnings) this.warnings.add(warning);
    if (appended.warnings.includes('TRACE_PROFILE_CHUNK_TAIL_INCOMPLETE')) {
      profile.limitations.add('incomplete-profile-chunk-tail');
    }
    if (appended.warnings.includes('TRACE_PROFILE_NEGATIVE_TIME_DELTA')) {
      profile.limitations.add('negative-profile-time-delta');
    }
  }

  private finalizeRequests(
    navigations: readonly TraceNavigationFacts[],
    captureEndUs: number | undefined,
  ): TraceRequestFacts[] {
    const resolved = this.requests.map(request => {
      const navigation = navigationFor(
        navigations,
        request.startUs,
        request.processId,
        request.navigationId,
        request.frameId,
      );
      const publicRequestId = `request:${request.send.eventIndex}`;
      return {
        request,
        navigation,
        publicRequestId,
        id: `trace:request:${navigation?.key ?? 'unassigned'}:${publicRequestId}:${request.redirectIndex}:${request.startUs}:event:${request.send.eventIndex}`,
      };
    });
    return resolved.map(({ request, navigation, publicRequestId, id }, index) => {
      const overlapsNavigation = request.failed === true && navigation !== undefined
        && navigations.some(item => item.key !== navigation.key
          && item.frameId === navigation.frameId
          && item.startUs > request.startUs
          && item.startUs < (request.endUs ?? captureEndUs ?? request.startUs));
      const classification = classifyRequest({
        statusCode: request.statusCode,
        failed: request.failed,
        cancelledSignal: request.explicitCancelled
          ? 'explicit'
          : overlapsNavigation ? 'navigation-overlap' : 'none',
        hasFinish: request.endUs !== undefined,
        traceEnded: captureEndUs !== undefined,
      });
      const previous = [...resolved].slice(0, index).reverse().find(item => (
        item.request.requestId === request.requestId
      ));
      const next = resolved.slice(index + 1).find(item => (
        item.request.requestId === request.requestId
      ));
      const initiator = request.initiatorRequestId
        ? [...resolved].reverse().find(item => item.request.requestId === request.initiatorRequestId
          && item.request.startUs <= request.startUs)
        : undefined;
      const limitations = request.url ? [] : ['request-url-unavailable'];
      const hasTimingInput = request.calibratedNetworkSendMs !== undefined
        || request.calibratedNetworkResponseMs !== undefined
        || request.rendererResponseEventMs !== undefined
        || request.mainThreadProcessingStartMs !== undefined;
      const hasNetworkTiming = hasTimingInput || request.resourceTimingDurationMs !== undefined;
      this.checkpoint();
      if (hasTimingInput && !request.traceTimeDomain) {
        limitations.push('request-trace-time-domain-unavailable');
      }
      if (hasTimingInput && request.calibratedNetworkSendMs === undefined) {
        limitations.push('request-network-send-timing-unavailable');
      }
      if ((request.calibratedNetworkSendMs !== undefined
        || request.calibratedNetworkResponseMs !== undefined) && !request.networkTimeDomain) {
        limitations.push('request-network-time-domain-unavailable');
      }
      if (hasTimingInput && request.calibratedNetworkResponseMs === undefined) {
        limitations.push('request-network-response-timing-unavailable');
      }
      if (hasTimingInput && request.mainThreadProcessingStartMs === undefined) {
        limitations.push('request-main-thread-processing-start-unavailable');
      }
      if ((request.rendererResponseEventMs !== undefined
        || request.mainThreadProcessingStartMs !== undefined) && !request.rendererTimeDomain) {
        limitations.push('request-renderer-time-domain-unavailable');
      }
      if (hasTimingInput && request.rendererResponseEventMs === undefined) {
        limitations.push('request-renderer-response-timing-unavailable');
      }
      if (request.networkTimeDomain && request.rendererTimeDomain
        && (request.networkTimeDomain !== request.rendererTimeDomain
          || (request.traceTimeDomain !== undefined
            && request.rendererTimeDomain !== request.traceTimeDomain))) {
        limitations.push('request-time-domains-differ');
      }
      const mainThreadBusyIntervals = navigation?.processSpans.flatMap(span => {
        if (span.mainThreadId === undefined) return [];
        return this.completeEvents.filter(item => item.name === 'RunTask'
          && item.processId === span.processId
          && item.threadId === span.mainThreadId
          && item.endUs > span.startUs
          && item.startUs < span.endUs).map(item => ({
            start: Math.max(item.startUs, span.startUs) / 1000,
            end: Math.min(item.endUs, span.endUs) / 1000,
          }));
      }) ?? [];
      const dispatch = request.calibratedNetworkResponseMs === undefined
        || request.rendererResponseEventMs === undefined
        ? undefined
        : buildDispatchWaitFact({
            calibratedNetworkResponseMs: request.calibratedNetworkResponseMs,
            rendererResponseEventMs: request.rendererResponseEventMs,
            networkTimeDomain: request.networkTimeDomain,
            rendererTimeDomain: request.rendererTimeDomain,
            traceTimeDomain: request.traceTimeDomain,
            mainThreadBusyIntervals,
          });
      if (hasTimingInput && !dispatch) limitations.push('dispatch-time-domain-unavailable');
      return {
        id,
        requestId: publicRequestId,
        ...(navigation ? { navigationKey: navigation.key } : {}),
        redirectIndex: request.redirectIndex,
        ...(previous ? { redirectPreviousRequestId: previous.id } : {}),
        ...(next ? { redirectNextRequestId: next.id } : {}),
        ...(initiator ? { initiatorRequestId: initiator.id } : {}),
        ...(request.url ? { url: request.url } : {}),
        ...(request.method ? { method: request.method } : {}),
        ...(request.resourceType ? { resourceType: request.resourceType } : {}),
        ...(request.statusCode === undefined ? {} : { statusCode: request.statusCode }),
        ...(request.protocol ? { protocol: request.protocol } : {}),
        ...(request.fromCache === undefined ? {} : { fromCache: request.fromCache }),
        ...(request.failed === undefined ? {} : { failed: request.failed }),
        result: classification.result,
        resultConfidence: classification.confidence,
        timing: {
          trace: {
            startUs: request.startUs,
            ...(request.endUs === undefined ? {} : {
              endUs: request.endUs,
              durationMs: (request.endUs - request.startUs) / 1000,
            }),
          },
          ...(!hasNetworkTiming ? {} : {
            ...(request.resourceTimingDurationMs !== undefined ? {
              network: {
                durationMs: request.resourceTimingDurationMs,
                domain: 'resource-timing-relative-ms',
              },
            } : request.calibratedNetworkSendMs === undefined
              && request.calibratedNetworkResponseMs === undefined ? {} : {
              network: {
                ...(request.calibratedNetworkSendMs === undefined ? {} : {
                  sendMs: request.calibratedNetworkSendMs,
                }),
                ...(request.calibratedNetworkResponseMs === undefined ? {} : {
                  responseMs: request.calibratedNetworkResponseMs,
                }),
                ...(request.calibratedNetworkSendMs === undefined
                  || request.calibratedNetworkResponseMs === undefined
                  || !request.networkTimeDomain ? {} : {
                  durationMs: Math.max(
                    request.calibratedNetworkResponseMs - request.calibratedNetworkSendMs,
                    0,
                  ),
                }),
                ...(request.networkTimeDomain ? { domain: request.networkTimeDomain } : {}),
              },
            }),
            ...(request.rendererResponseEventMs === undefined
              && request.mainThreadProcessingStartMs === undefined ? {} : {
              renderer: {
                ...(request.rendererResponseEventMs === undefined ? {} : {
                  responseEventMs: request.rendererResponseEventMs,
                }),
                ...(request.mainThreadProcessingStartMs === undefined ? {} : {
                  mainThreadProcessingStartMs: request.mainThreadProcessingStartMs,
                }),
                ...(request.rendererTimeDomain ? { domain: request.rendererTimeDomain } : {}),
              },
            }),
            ...(request.calibratedNetworkResponseMs === undefined
              || request.rendererResponseEventMs === undefined
              || !request.networkTimeDomain
              || request.networkTimeDomain !== request.rendererTimeDomain ? {} : {
              networkToRendererMs: Math.max(
                request.rendererResponseEventMs - request.calibratedNetworkResponseMs,
                0,
              ),
            }),
            ...(request.rendererResponseEventMs === undefined
              || request.mainThreadProcessingStartMs === undefined
              || !request.rendererTimeDomain ? {} : {
              rendererQueueMs: Math.max(
                request.mainThreadProcessingStartMs - request.rendererResponseEventMs,
                0,
              ),
            }),
          }),
        },
        dataEventCount: request.dataEventCount,
        ...(request.encodedDataLength === undefined ? {} : { encodedDataLength: request.encodedDataLength }),
        ...(dispatch ? { dispatch } : {}),
        initiatorEvidenceIds: initiator ? boundedEvidenceIds(initiator.request.evidenceIndexes) : [],
        evidenceIds: boundedEvidenceIds(request.evidenceIndexes),
        limitations,
      };
    }).sort((left, right) => left.timing.trace.startUs - right.timing.trace.startUs || left.id.localeCompare(right.id));
  }

  private finalizeTasks(navigations: readonly TraceNavigationFacts[]): TraceTaskFacts[] {
    const tasks = this.longTasks;
    return tasks.flatMap<TraceTaskFacts>(task => {
      const navigation = navigationFor(navigations, task.startUs, task.processId);
      const span = navigation?.processSpans.find(item => task.startUs >= item.startUs
        && task.startUs <= item.endUs && item.processId === task.processId);
      if (!navigation || span?.mainThreadId !== task.threadId) return [];

      const completeNodes: TaskTreeNode[] = this.completeEvents.filter(item => item !== task
        && item.processId === task.processId && item.threadId === task.threadId
        && item.startUs >= task.startUs && item.endUs <= task.endUs).map(item => ({
          key: `x:${item.eventIndex}`,
          name: item.name,
          startUs: item.startUs,
          endUs: item.endUs,
          evidenceIndexes: [item.eventIndex],
        }));
      const phaseParts = this.phaseEvents.filter(({ event }) => (
        readFiniteNumber(event.pid) === task.processId
        && readFiniteNumber(event.tid) === task.threadId
        && (readFiniteNumber(event.ts) ?? -1) >= task.startUs
        && (readFiniteNumber(event.ts) ?? -1) <= task.endUs
      )).sort((left, right) => (
        readFiniteNumber(left.event.ts)! - readFiniteNumber(right.event.ts)!
        || left.eventIndex - right.eventIndex
      ));
      const phaseStack: IndexedEvent[] = [];
      const phaseNodes: TaskTreeNode[] = [];
      let approximate = this.completeEventsDropped;
      let phasePairingIncomplete = false;
      for (const part of phaseParts) {
        if (part.event.ph === 'B') {
          phaseStack.push(part);
          continue;
        }
        const begin = phaseStack[phaseStack.length - 1];
        if (!begin || readString(begin.event.name) !== readString(part.event.name)) {
          approximate = true;
          phasePairingIncomplete = true;
          continue;
        }
        phaseStack.pop();
        const startUs = readFiniteNumber(begin.event.ts)!;
        const endUs = readFiniteNumber(part.event.ts)!;
        if (endUs <= startUs) {
          approximate = true;
          phasePairingIncomplete = true;
          continue;
        }
        phaseNodes.push({
          key: `be:${begin.eventIndex}:${part.eventIndex}`,
          name: readString(begin.event.name)!,
          startUs,
          endUs,
          evidenceIndexes: [begin.eventIndex, part.eventIndex],
        });
      }
      if (phaseStack.length > 0) {
        approximate = true;
        phasePairingIncomplete = true;
      }

      const nodes = [...completeNodes, ...phaseNodes];
      const root: TaskTreeNode = {
        key: `root:${task.eventIndex}`,
        name: task.name,
        startUs: task.startUs,
        endUs: task.endUs,
        evidenceIndexes: [task.eventIndex],
      };
      const allNodes = [root, ...nodes];
      const childrenByParent = new Map<string, TaskTreeNode[]>();
      const strictlyContains = (parent: TaskTreeNode, child: TaskTreeNode): boolean => (
        parent.startUs <= child.startUs
        && parent.endUs >= child.endUs
        && (parent.startUs < child.startUs || parent.endUs > child.endUs)
      );
      for (const child of nodes) {
        this.checkpoint();
        const parent = allNodes.filter(candidate => candidate !== child
          && strictlyContains(candidate, child)).sort((left, right) => (
          (left.endUs - left.startUs) - (right.endUs - right.startUs)
          || left.key.localeCompare(right.key)
        ))[0];
        if (!parent) continue;
        const children = childrenByParent.get(parent.key) ?? [];
        children.push(child);
        childrenByParent.set(parent.key, children);
      }
      const rootChildren = childrenByParent.get(root.key) ?? [];
      const selfTimeUs = calculateSelfTime(
        { start: root.startUs, end: root.endUs },
        rootChildren.map(item => ({ start: item.startUs, end: item.endUs })),
      );
      const categorySelfTimeMs: Partial<Record<TraceWorkCategory, number>> = {};
      const boundaries = [...new Set(allNodes.flatMap(node => [node.startUs, node.endUs]))]
        .filter(value => value >= root.startUs && value <= root.endUs)
        .sort((left, right) => left - right);
      for (let index = 0; index + 1 < boundaries.length; index += 1) {
        this.checkpoint();
        const segmentStart = boundaries[index];
        const segmentEnd = boundaries[index + 1];
        if (segmentEnd <= segmentStart) continue;
        const owner = allNodes.filter(node => node.startUs <= segmentStart
          && node.endUs >= segmentEnd).sort((left, right) => (
          (left.endUs - left.startUs) - (right.endUs - right.startUs)
          || left.key.localeCompare(right.key)
        ))[0];
        if (!owner) continue;
        const category = categoryFor(owner.name);
        categorySelfTimeMs[category] = (categorySelfTimeMs[category] ?? 0)
          + (segmentEnd - segmentStart) / 1000;
      }

      return [{
        id: `trace:task:${task.processId}:${task.threadId}:${task.startUs}:event:${task.eventIndex}`,
        navigationKey: navigation.key,
        processId: task.processId,
        threadId: task.threadId,
        startUs: task.startUs,
        durationMs: (task.endUs - task.startUs) / 1000,
        blockingContributionMs: Math.max((task.endUs - task.startUs) / 1000 - 50, 0),
        selfTimeMs: selfTimeUs / 1000,
        categorySelfTimeMs,
        selfTimeConfidence: approximate ? 'approximate' : 'exact',
        limitations: [
          ...(this.completeEventsDropped ? ['complete-event-candidate-limit'] : []),
          ...(phasePairingIncomplete ? ['incomplete-phase-pairing'] : []),
        ],
        evidenceIds: boundedEvidenceIds([
          task.eventIndex,
          ...nodes.flatMap(item => item.evidenceIndexes),
          ...phaseParts.map(item => item.eventIndex),
        ]),
      }];
    }).sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id));
  }

  private finalizeProfiles(): TraceCpuProfileFacts[] {
    return this.profileEntries.map(profile => {
      this.checkpoint();
      const profileEventIndex = profile.evidenceIndexes[0];
      const publicProfileId = `profile:${profileEventIndex}`;
      return {
      id: `trace:profile:${profile.processId}:${profile.threadId}:${publicProfileId}:event:${profileEventIndex}`,
      processId: profile.processId,
      threadId: profile.threadId,
      profileId: publicProfileId,
      startUs: profile.startUs,
      endUs: profile.endUs,
      nodeCount: profile.nodes.size,
      sampleCount: profile.sampleCount,
      evidenceIds: boundedEvidenceIds(profile.evidenceIndexes),
      limitations: [...profile.limitations].sort(),
    };
    }).sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id));
  }

  private finalizeCpuHotspots(
    navigations: readonly TraceNavigationFacts[],
    tasks: readonly TraceTaskFacts[],
  ): TraceCpuHotspot[] {
    const hotspots: TraceCpuHotspot[] = [];
    for (const profile of this.profileEntries) {
      this.checkpoint();
      const counts = new Map<string, { nodeId: number; navigationKey?: string; count: number; sampleTimeUs: number; taskIds: Set<string> }>();
      for (const sample of profile.samples) {
        this.checkpoint();
        const navigation = navigationFor(navigations, sample.timestampUs, profile.processId);
        const key = `${sample.nodeId}:${navigation?.key ?? ''}`;
        const value = counts.get(key) ?? {
          nodeId: sample.nodeId,
          navigationKey: navigation?.key,
          count: 0,
          sampleTimeUs: 0,
          taskIds: new Set(),
        };
        value.count += 1;
        value.sampleTimeUs += sample.deltaUs;
        for (const task of tasks) {
          const endUs = task.startUs + task.durationMs * 1000;
          if (task.processId === profile.processId && task.threadId === profile.threadId
            && sample.timestampUs >= task.startUs && sample.timestampUs <= endUs) value.taskIds.add(task.id);
        }
        counts.set(key, value);
      }
      const profileEventIndex = profile.evidenceIndexes[0];
      const publicProfileId = `profile:${profileEventIndex}`;
      for (const value of counts.values()) {
        const node = profile.nodes.get(value.nodeId);
        if (!node) continue;
        hotspots.push({
          id: `trace:hotspot:${profile.processId}:${profile.threadId}:${publicProfileId}:${value.navigationKey ?? 'unassigned'}:event:${profileEventIndex}:node:${value.nodeId}:sample:0`,
          processId: profile.processId,
          threadId: profile.threadId,
          profileId: publicProfileId,
          nodeId: value.nodeId,
          functionName: node.functionName,
          ...(node.script ? { script: node.script } : {}),
          ...(node.lineNumber === undefined ? {} : { lineNumber: node.lineNumber }),
          ...(node.columnNumber === undefined ? {} : { columnNumber: node.columnNumber }),
          sampleCount: value.count,
          sampleTimeMs: value.sampleTimeUs / 1000,
          ...(value.navigationKey ? { navigationKey: value.navigationKey } : {}),
          taskIds: [...value.taskIds].sort(),
          evidenceIds: boundedEvidenceIds(profile.evidenceIndexes),
        });
      }
    }
    return hotspots.sort((left, right) => right.sampleCount - left.sampleCount || left.id.localeCompare(right.id));
  }

  private finalizeMilestones(navigations: readonly TraceNavigationFacts[]): TraceMilestoneFacts[] {
    const facts = this.milestones.flatMap<TraceMilestoneFacts>(({ event, eventIndex }) => {
      this.checkpoint();
      const timestampUs = readFiniteNumber(event.ts)!;
      const data = readEventData(event);
      if (readBoolean(data?.isOutermostMainFrame) === false) return [];
      const navigation = navigationFor(
        navigations,
        timestampUs,
        readFiniteNumber(event.pid),
        readLocalId(data?.navigationId),
        readLocalId(data?.frame),
      );
      if (!navigation) return [];
      const name = MILESTONE_NAMES[readString(event.name)!];
      return [{
        id: `trace:milestone:${navigation.key}:${name}:${timestampUs}:event:${eventIndex}`,
        navigationKey: navigation.key,
        name,
        timestampUs,
        relativeUs: timestampUs - navigation.startUs,
        candidate: name === 'LCP',
        evidenceIds: [evidenceId(eventIndex)],
      }];
    });
    const selected = new Map<string, TraceMilestoneFacts>();
    for (const fact of facts) {
      const key = `${fact.navigationKey}:${fact.name}`;
      const previous = selected.get(key);
      if (!previous
        || (fact.name === 'LCP' && fact.timestampUs > previous.timestampUs)
        || (fact.name !== 'LCP' && fact.timestampUs < previous.timestampUs)) {
        selected.set(key, fact);
      }
    }
    return [...selected.values()].sort((left, right) => (
      left.timestampUs - right.timestampUs || left.id.localeCompare(right.id)
    ));
  }

  private finalizeFrames(navigations: readonly TraceNavigationFacts[]): TraceAnimationFrameFacts[] {
    const frames = [...this.frames].sort((left, right) => (
      left.startUs - right.startUs || left.eventIndex - right.eventIndex
    ));
    const derivedDrawDurations = new Map<number, number>();
    const nextDrawByThread = new Map<string, number>();
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      if (frame.name !== 'DrawFrame' || frame.durationUs !== undefined) continue;
      const key = `${frame.processId}:${frame.threadId}`;
      const nextStartUs = nextDrawByThread.get(key);
      if (nextStartUs !== undefined && nextStartUs > frame.startUs) {
        derivedDrawDurations.set(frame.eventIndex, nextStartUs - frame.startUs);
      }
      nextDrawByThread.set(key, frame.startUs);
    }
    return frames.map(frame => {
      this.checkpoint();
      const navigation = navigationFor(navigations, frame.startUs, frame.processId);
      const durationMs = (frame.durationUs
        ?? derivedDrawDurations.get(frame.eventIndex)
        ?? 0) / 1000;
      return {
        id: `trace:frame:${frame.processId}:${frame.threadId}:${frame.startUs}:event:${frame.eventIndex}`,
        ...(navigation ? { navigationKey: navigation.key } : {}),
        processId: frame.processId,
        threadId: frame.threadId,
        startUs: frame.startUs,
        durationMs,
        dropped: frame.name === 'DroppedFrame' || readBoolean(readEventData(frame.event)?.dropped) === true,
        budgetMs: 16.7,
        overBudget: durationMs > 16.7,
        evidenceIds: [evidenceId(frame.eventIndex)],
      };
    }).sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id));
  }

  private finalizeRendering(navigations: readonly TraceNavigationFacts[]): TraceRenderingEventFacts[] {
    return this.renderingEvents.map(item => {
      this.checkpoint();
      const navigation = navigationFor(navigations, item.startUs, item.processId);
      return {
        id: `trace:rendering:${item.processId}:${item.threadId}:${item.startUs}:${item.name}:event:${item.eventIndex}`,
        ...(navigation ? { navigationKey: navigation.key } : {}),
        name: item.name,
        processId: item.processId,
        threadId: item.threadId,
        startUs: item.startUs,
        durationMs: (item.endUs - item.startUs) / 1000,
        evidenceIds: [evidenceId(item.eventIndex)],
      };
    }).sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id));
  }

  private finalizeForcedReflowClues(
    navigations: readonly TraceNavigationFacts[],
    tasks: readonly TraceTaskFacts[],
  ): TraceForcedReflowClue[] {
    return this.forcedReflowEvents.map<TraceForcedReflowClue>(item => {
      this.checkpoint();
      const navigation = navigationFor(navigations, item.startUs, item.processId);
      const task = tasks.find(candidate => candidate.processId === item.processId
        && candidate.threadId === item.threadId && item.startUs >= candidate.startUs
        && item.startUs <= candidate.startUs + candidate.durationMs * 1000);
      const confidence = item.name === 'ForcedReflow' ? 'explicit' : 'observation';
      return {
        id: `trace:forced-reflow-clue:${confidence}:${item.processId}:${item.threadId}:${item.startUs}:event:${item.eventIndex}`,
        ...(navigation ? { navigationKey: navigation.key } : {}),
        startUs: item.startUs,
        confidence,
        ...(task ? { taskId: task.id } : {}),
        evidenceIds: [evidenceId(item.eventIndex)],
      };
    }).sort((left, right) => (
      (left.confidence === right.confidence ? 0 : left.confidence === 'explicit' ? -1 : 1)
      || left.startUs - right.startUs
      || left.id.localeCompare(right.id)
    ));
  }

  private finalizeInteractions(
    navigations: readonly TraceNavigationFacts[],
    tasks: readonly TraceTaskFacts[],
    rendering: readonly TraceRenderingEventFacts[],
    frames: readonly TraceAnimationFrameFacts[],
  ): TraceInteractionFacts[] {
    interface CompleteInteraction {
      startUs: number;
      endUs: number;
      inputDelayMs: number;
      processingDurationMs: number;
      presentationDelayMs: number;
      totalLatencyMs: number;
      interactionId: number;
      processId: number;
      navigationKey: string;
      evidenceIndexes: number[];
    }
    const complete: CompleteInteraction[] = [];
    const byScope = new Map<string, IndexedEvent[]>();
    for (const indexed of this.interactions) {
      this.checkpoint();
      const data = readEventData(indexed.event);
      const processId = readFiniteNumber(indexed.event.pid);
      const threadId = readFiniteNumber(indexed.event.tid);
      const traceTimestampUs = readFiniteNumber(indexed.event.ts);
      const asyncId = eventId(indexed.event.id) ?? eventId(indexed.event.id2);
      const legacyInteractionId = readFiniteNumber(data?.interactionId);
      if ((indexed.event.ph === 'b' || indexed.event.ph === 'e')
        && processId !== undefined
        && threadId !== undefined
        && traceTimestampUs !== undefined
        && (asyncId || legacyInteractionId !== undefined)) {
        const key = `${processId}:${threadId}:${readString(indexed.event.scope) ?? ''}:${
          asyncId ? `async:${asyncId}` : `interaction:${legacyInteractionId}`
        }`;
        const values = byScope.get(key) ?? [];
        values.push(indexed);
        byScope.set(key, values);
        continue;
      }
      if (!data || processId === undefined) continue;
      const interactionId = readFiniteNumber(data.interactionId);
      const eventStart = readFiniteNumber(data.eventStart);
      const processingStart = readFiniteNumber(data.processingStart);
      const processingEnd = readFiniteNumber(data.processingEnd);
      const interactionEnd = readFiniteNumber(data.interactionEnd);
      if (interactionId === undefined || interactionId <= 0 || eventStart === undefined
        || processingStart === undefined || processingEnd === undefined
        || interactionEnd === undefined) continue;
      const timing = calculateEventTiming({
        eventStart,
        processingStart,
        processingEnd,
        interactionEnd,
      });
      const startUs = traceTimestampUs ?? eventStart;
      const navigation = navigationFor(navigations, startUs, processId);
      if (!timing || !navigation) continue;
      complete.push({
        startUs,
        endUs: startUs + timing.totalLatency,
        inputDelayMs: timing.inputDelay / 1000,
        processingDurationMs: timing.processingDuration / 1000,
        presentationDelayMs: timing.presentationDelay / 1000,
        totalLatencyMs: timing.totalLatency / 1000,
        interactionId,
        processId,
        navigationKey: navigation.key,
        evidenceIndexes: [indexed.eventIndex],
      });
    }
    for (const values of byScope.values()) {
      this.checkpoint();
      values.sort((left, right) => left.eventIndex - right.eventIndex);
      const begin = values.find(item => item.event.ph === 'b');
      const end = values.find(item => item.event.ph === 'e'
        && (!begin || item.eventIndex > begin.eventIndex));
      const beginData = begin && readEventData(begin.event);
      const endData = end && readEventData(end.event);
      const interactionId = readFiniteNumber(beginData?.interactionId);
      const processId = begin && readFiniteNumber(begin.event.pid);
      const beginTimestampUs = begin && readFiniteNumber(begin.event.ts);
      const endTimestampUs = end && readFiniteNumber(end.event.ts);
      const eventStart = readFiniteNumber(beginData?.timeStamp);
      const processingStart = readFiniteNumber(beginData?.processingStart);
      const processingEnd = readFiniteNumber(beginData?.processingEnd);
      const beginNavigation = beginTimestampUs === undefined || processId === undefined
        ? undefined
        : navigationFor(navigations, beginTimestampUs, processId);
      const endNavigation = endTimestampUs === undefined || processId === undefined
        ? undefined
        : navigationFor(navigations, endTimestampUs, processId);
      if (!begin || !end || interactionId === undefined || processId === undefined
        || interactionId <= 0
        || beginTimestampUs === undefined || endTimestampUs === undefined
        || !beginNavigation || beginNavigation.key !== endNavigation?.key
        || readFiniteNumber(end.event.pid) !== processId) {
        this.warnings.add(SHAPE_WARNING);
        continue;
      }
      const legacyTiming = calculateEventTiming({
        eventStart: readFiniteNumber(beginData?.eventStart) ?? Number.NaN,
        processingStart: processingStart ?? Number.NaN,
        processingEnd: readFiniteNumber(endData?.processingEnd) ?? Number.NaN,
        interactionEnd: readFiniteNumber(endData?.interactionEnd) ?? Number.NaN,
      });
      const inputDelayMs = legacyTiming
        ? legacyTiming.inputDelay / 1000
        : (processingStart ?? Number.NaN) - (eventStart ?? Number.NaN);
      const processingDurationMs = legacyTiming
        ? legacyTiming.processingDuration / 1000
        : (processingEnd ?? Number.NaN) - (processingStart ?? Number.NaN);
      const totalLatencyMs = legacyTiming
        ? legacyTiming.totalLatency / 1000
        : (endTimestampUs - beginTimestampUs) / 1000;
      const presentationDelayMs = legacyTiming
        ? legacyTiming.presentationDelay / 1000
        : totalLatencyMs - inputDelayMs - processingDurationMs;
      if (![inputDelayMs, processingDurationMs, totalLatencyMs, presentationDelayMs]
        .every(Number.isFinite)
        || inputDelayMs < 0
        || processingDurationMs < 0
        || totalLatencyMs < 0
        || presentationDelayMs < -0.001) {
        this.warnings.add(SHAPE_WARNING);
        continue;
      }
      complete.push({
        startUs: beginTimestampUs,
        endUs: endTimestampUs,
        inputDelayMs,
        processingDurationMs,
        presentationDelayMs: Math.max(presentationDelayMs, 0),
        totalLatencyMs,
        interactionId,
        processId,
        navigationKey: beginNavigation.key,
        evidenceIndexes: [begin.eventIndex, end.eventIndex],
      });
    }
    return complete.flatMap(item => {
      this.checkpoint();
      const overlap = (startUs: number, endUs: number) => (
        endUs > item.startUs && startUs < item.endUs
      );
      return [{
        id: `trace:interaction:${item.interactionId}:${item.processId}:${item.startUs}:event:${item.evidenceIndexes[0]}`,
        interactionId: item.interactionId,
        navigationKey: item.navigationKey,
        startUs: item.startUs,
        inputDelayMs: item.inputDelayMs,
        processingDurationMs: item.processingDurationMs,
        presentationDelayMs: item.presentationDelayMs,
        totalLatencyMs: item.totalLatencyMs,
        taskIds: tasks.filter(task => task.navigationKey === item.navigationKey
          && task.processId === item.processId
          && overlap(task.startUs, task.startUs + task.durationMs * 1000)).map(task => task.id),
        renderingEventIds: rendering.filter(event => event.navigationKey === item.navigationKey
          && event.processId === item.processId
          && overlap(event.startUs, event.startUs + event.durationMs * 1000)).map(event => event.id),
        frameIds: frames.filter(frame => frame.navigationKey === item.navigationKey
          && frame.processId === item.processId
          && overlap(frame.startUs, frame.startUs + frame.durationMs * 1000)).map(frame => frame.id),
        evidenceIds: item.evidenceIndexes.map(evidenceId),
      }];
    }).sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id));
  }

}
