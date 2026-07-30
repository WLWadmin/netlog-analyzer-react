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
  | 'TRACE_EVIDENCE_TRUNCATED';

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

export interface TraceContextFacts {
  processes: TraceProcessFacts[];
  threads: TraceThreadFacts[];
  frames: TraceFrameFacts[];
  navigations: TraceNavigationFacts[];
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
