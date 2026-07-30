export interface ChromiumTraceEvent {
  name?: unknown;
  cat?: unknown;
  ph?: unknown;
  ts?: unknown;
  dur?: unknown;
  tdur?: unknown;
  pid?: unknown;
  tid?: unknown;
  id?: unknown;
  id2?: unknown;
  scope?: unknown;
  bind_id?: unknown;
  args?: unknown;
  [key: string]: unknown;
}

export interface ChromiumTraceFile {
  traceEvents: ChromiumTraceEvent[];
  metadata?: unknown;
  [key: string]: unknown;
}

export type TraceEncoding = 'plain-json' | 'gzip-json';

export type TraceEventFamily =
  | 'metadata'
  | 'navigation'
  | 'network'
  | 'main-thread'
  | 'rendering'
  | 'interaction'
  | 'cpu-profile';

export type TraceParserWarning =
  | 'TRACE_EXTENSION_GZIP_MISMATCH'
  | 'TRACE_SKIPPED_NON_OBJECT_EVENTS'
  | 'TRACE_METADATA_ID_MISSING'
  | 'TRACE_METADATA_VALUE_INVALID'
  | 'TRACE_FRAME_PARENT_MISSING'
  | 'TRACE_FRAME_PARENT_CYCLE'
  | 'TRACE_NAVIGATION_FRAME_MISSING'
  | 'TRACE_NAVIGATION_CAPTURE_END_FALLBACK'
  | 'TRACE_FRAME_PROCESS_MISSING'
  | 'TRACE_RENDERER_MAIN_MISSING'
  | 'TRACE_RENDERER_MAIN_AMBIGUOUS'
  | 'TRACE_EVIDENCE_TRUNCATED'
  | 'TRACE_PROFILE_CHUNK_TAIL_INCOMPLETE'
  | 'TRACE_BATCH3_EVENT_SHAPE_UNSUPPORTED'
  | 'TRACE_FACTS_TRUNCATED'
  | 'TRACE_FACT_CANDIDATES_TRUNCATED'
  | 'TRACE_PROFILE_NEGATIVE_TIME_DELTA';

export interface TraceIntakeSummary {
  format: 'chromium-trace-object';
  encoding: TraceEncoding;
  jsonBytes: number;
  eventCount: number;
  captureStartUs?: number;
  captureEndUs?: number;
  availableFamilies: TraceEventFamily[];
  warnings: TraceParserWarning[];
}

export type TraceTaskPhase =
  | 'sniffing-source'
  | 'reading-file'
  | 'decompressing'
  | 'parsing-json'
  | 'validating-trace'
  | 'summarizing-intake'
  | 'scan-events'
  | 'finalize-contexts'
  | 'build-facts';

export interface TraceTaskProgress {
  phase: TraceTaskPhase;
  processedBytes?: number;
  totalBytes?: number;
  processedEvents?: number;
  totalEvents?: number;
}

export type TraceErrorCode =
  | 'TRACE_FEATURE_DISABLED'
  | 'TRACE_ZIP_UNSUPPORTED'
  | 'TRACE_COMPRESSED_FILE_TOO_LARGE'
  | 'TRACE_JSON_TOO_LARGE'
  | 'TRACE_EVENT_LIMIT_EXCEEDED'
  | 'TRACE_GZIP_UNSUPPORTED'
  | 'TRACE_GZIP_INVALID'
  | 'TRACE_JSON_INVALID'
  | 'TRACE_TOP_LEVEL_ARRAY_UNSUPPORTED'
  | 'TRACE_SOURCE_UNKNOWN'
  | 'TRACE_SOURCE_AMBIGUOUS'
  | 'TRACE_SHAPE_INVALID'
  | 'TRACE_NON_TRACE_GZIP_UNSUPPORTED'
  | 'TRACE_CANCELLED'
  | 'TRACE_TIMEOUT'
  | 'TRACE_WORKER_FAILED';

export interface TracePublicError {
  code: TraceErrorCode;
  stage: TraceTaskPhase;
  message: string;
  recoverable: boolean;
}

export type TraceDetectedSource = 'trace' | 'har' | 'netlog';

export type TraceSourceClassification =
  | { kind: 'trace'; trace: ChromiumTraceFile; skippedEventCount: number }
  | { kind: 'detected-source'; source: 'har' | 'netlog' }
  | { kind: 'error'; code: 'TRACE_TOP_LEVEL_ARRAY_UNSUPPORTED' | 'TRACE_SOURCE_UNKNOWN' | 'TRACE_SOURCE_AMBIGUOUS' | 'TRACE_SHAPE_INVALID' | 'TRACE_EVENT_LIMIT_EXCEEDED' };

export interface TraceEventRef {
  evidenceId: string;
  eventIndex: number;
  origin: 'raw';
  name?: string;
  processId?: number;
  threadId?: number;
  timestampUs?: number;
}

export interface TraceProcessFacts {
  processId: number;
  name?: string;
  labels?: string[];
  sortIndex?: number;
  threadIds: number[];
  evidenceIds: string[];
}

export interface TraceThreadFacts {
  processId: number;
  threadId: number;
  name?: string;
  sortIndex?: number;
  isRendererMain: boolean;
  evidenceIds: string[];
}

export interface TraceFrameProcessSpan {
  processId: number;
  startUs: number;
  endUs: number;
  mainThreadId?: number;
  confidence: 'direct' | 'derived' | 'uncertain';
  evidenceIds: string[];
}

export interface TraceFrameFacts {
  frameId: string;
  parentFrameId?: string;
  outermostFrameId: string;
  isOutermost: boolean;
  processSpans: TraceFrameProcessSpan[];
  evidenceIds: string[];
}

export interface TraceNavigationFacts {
  key: string;
  navigationId?: string;
  frameId: string;
  outermostFrameId: string;
  startUs: number;
  endUs: number;
  processSpans: TraceFrameProcessSpan[];
  evidenceIds: string[];
  limitations: string[];
}

export type TraceAvailability = 'available' | 'partial' | 'missing' | 'unsupported';

export interface TraceCollectionQuality {
  level: 'good' | 'partial' | 'insufficient';
  captureWindow: TraceAvailability;
  navigationContext: TraceAvailability;
  processThreadMetadata: TraceAvailability;
  frameHierarchy: TraceAvailability;
  rendererMainThread: TraceAvailability;
  skippedEventCount: number;
  warnings: string[];
  disabledCapabilities: string[];
}

export interface TraceSanitizedUrl {
  origin: string;
  pathname: string;
}

export interface TraceRequestTiming {
  trace: {
    startUs: number;
    endUs?: number;
    durationMs?: number;
  };
  network?: {
    sendMs?: number;
    responseMs?: number;
    durationMs?: number;
    domain?: string;
  };
  renderer?: {
    responseEventMs?: number;
    mainThreadProcessingStartMs?: number;
    domain?: string;
  };
  networkToRendererMs?: number;
  rendererQueueMs?: number;
}

export interface TraceRequestFacts {
  id: string;
  requestId: string;
  navigationKey?: string;
  redirectIndex: number;
  url?: TraceSanitizedUrl;
  method?: string;
  resourceType?: string;
  statusCode?: number;
  protocol?: string;
  fromCache?: boolean;
  failed?: boolean;
  result: 'success' | 'http-error' | 'transport-failed' | 'cancelled'
    | 'incomplete-at-trace-end' | 'unknown-failure';
  resultConfidence: 'high' | 'medium' | 'observation';
  timing: TraceRequestTiming;
  initiatorEvidenceIds: string[];
  evidenceIds: string[];
  limitations: string[];
  redirectPreviousRequestId?: string;
  redirectNextRequestId?: string;
  initiatorRequestId?: string;
  dataEventCount: number;
  encodedDataLength?: number;
  dispatch?: {
    dispatchWaitMs: number;
    mainThreadOverlapMs: number;
  };
}

export type TraceWorkCategory = 'script' | 'rendering' | 'gc' | 'other';

export interface TraceTaskFacts {
  id: string;
  navigationKey?: string;
  processId: number;
  threadId: number;
  startUs: number;
  durationMs: number;
  blockingContributionMs: number;
  selfTimeMs: number;
  categorySelfTimeMs: Partial<Record<TraceWorkCategory, number>>;
  selfTimeConfidence: 'exact' | 'approximate';
  limitations: string[];
  evidenceIds: string[];
}

export interface TraceCpuProfileFacts {
  id: string;
  processId: number;
  threadId: number;
  profileId: string;
  startUs: number;
  endUs: number;
  nodeCount: number;
  sampleCount: number;
  evidenceIds: string[];
  limitations: string[];
}

export interface TraceMilestoneFacts {
  id: string;
  navigationKey: string;
  name: 'DCL' | 'Load' | 'FCP' | 'LCP';
  timestampUs: number;
  relativeUs: number;
  candidate: boolean;
  evidenceIds: string[];
}

export interface TraceAnimationFrameFacts {
  id: string;
  navigationKey?: string;
  processId: number;
  threadId: number;
  startUs: number;
  durationMs: number;
  dropped: boolean;
  budgetMs: number;
  overBudget: boolean;
  evidenceIds: string[];
}

export interface TraceAnimationFrameSummary {
  completeness: 'complete' | 'partial';
  limitations: string[];
  totalCount: number;
  overBudgetCount: number;
  maxDurationMs: number;
  budgetMs: 16.7;
  budgetBasis: '60hz-reference';
  refreshRate: 'unknown';
}

export interface TraceRenderingEventFacts {
  id: string;
  navigationKey?: string;
  name: string;
  processId: number;
  threadId: number;
  startUs: number;
  durationMs: number;
  evidenceIds: string[];
}

export interface TraceInteractionFacts {
  id: string;
  interactionId: number;
  navigationKey?: string;
  startUs: number;
  inputDelayMs: number;
  processingDurationMs: number;
  presentationDelayMs: number;
  totalLatencyMs: number;
  taskIds: string[];
  renderingEventIds: string[];
  frameIds: string[];
  evidenceIds: string[];
}

export interface TraceInteractionSummary {
  completeness: 'complete' | 'partial';
  limitations: string[];
  totalCount: number;
  slowestInteractionId?: string;
  maxTotalLatencyMs?: number;
}

export interface TraceCpuHotspot {
  id: string;
  processId: number;
  threadId: number;
  profileId: string;
  nodeId: number;
  functionName: string;
  script?: TraceSanitizedUrl;
  lineNumber?: number;
  columnNumber?: number;
  sampleCount: number;
  sampleTimeMs: number;
  navigationKey?: string;
  taskIds: string[];
  evidenceIds: string[];
}

export interface TraceForcedReflowClue {
  id: string;
  navigationKey?: string;
  startUs: number;
  confidence: 'explicit' | 'observation';
  taskId?: string;
  evidenceIds: string[];
}

export interface TraceFactCount {
  total: number;
  returned: number;
  truncated: boolean;
}

export interface TraceFactCounts {
  requests: TraceFactCount;
  tasks: TraceFactCount;
  profiles: TraceFactCount;
  milestones: TraceFactCount;
  animationFrames: TraceFactCount;
  rendering: TraceFactCount;
  interactions: TraceFactCount;
  cpuHotspots: TraceFactCount;
  forcedReflowClues: TraceFactCount;
}

export interface TraceContextFacts {
  processes: TraceProcessFacts[];
  threads: TraceThreadFacts[];
  frames: TraceFrameFacts[];
  navigations: TraceNavigationFacts[];
  requests?: TraceRequestFacts[];
  tasks?: TraceTaskFacts[];
  profiles?: TraceCpuProfileFacts[];
  milestones?: TraceMilestoneFacts[];
  animationFrames?: TraceAnimationFrameFacts[];
  animationFrameSummary?: TraceAnimationFrameSummary;
  rendering?: TraceRenderingEventFacts[];
  interactions?: TraceInteractionFacts[];
  interactionSummary?: TraceInteractionSummary;
  cpuHotspots?: TraceCpuHotspot[];
  forcedReflowClues?: TraceForcedReflowClue[];
  factCounts?: TraceFactCounts;
  evidence: TraceEventRef[];
  evidenceTotalCount: number;
  evidenceReturnedCount: number;
  quality: TraceCollectionQuality;
  warnings: TraceParserWarning[];
}

export interface TraceContextResult {
  intake: TraceIntakeSummary;
  context: TraceContextFacts;
}
