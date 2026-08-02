import type {
  CrossSourceRequest,
  CrossSourceResponse,
} from '../crossSourceProtocol';

export const WORKBENCH_SPIKE_SCHEMA_VERSION = 1 as const;
export const WORKBENCH_SCHEMA_VERSION = WORKBENCH_SPIKE_SCHEMA_VERSION;

export type WorkbenchCapability =
  | 'timeline-events'
  | 'event-detail'
  | 'cpu-profile'
  | 'network'
  | 'rendering'
  | 'interactions'
  | 'frames'
  | 'screenshots'
  | 'raw-evidence';

export type AdvancedWorkbenchCapability =
  | 'layout-shifts'
  | 'animation-composition'
  | 'memory-trend'
  | 'gpu-raster';

export type WorkbenchSessionState =
  | 'creating'
  | 'indexing-minimum'
  | 'ready'
  | 'enriching'
  | 'degraded'
  | 'releasing'
  | 'released'
  | 'failed';

export type WorkbenchQueryErrorCode =
  | 'unsupported-capability'
  | 'invalid-range'
  | 'query-cancelled'
  | 'query-timeout'
  | 'result-truncated'
  | 'session-released'
  | 'worker-failed';

export interface WorkbenchSessionRef {
  sessionId: string;
  sessionRevision: number;
}

export interface WorkbenchSourceRef {
  sourceId: string;
  parserId: 'trace';
  fingerprint: string;
}

export interface WorkbenchSessionDescriptor extends WorkbenchSessionRef {
  state: WorkbenchSessionState;
  source: WorkbenchSourceRef;
  capabilities: WorkbenchCapability[];
  missingCapabilities: Array<{
    capability: WorkbenchCapability;
    reason: string;
  }>;
  range: {
    startUs: number;
    endUs: number;
  };
  eventCount: number;
  trackEventCounts: Partial<Record<
    | 'layout-shifts'
    | 'animations'
    | 'gpu-raster'
    | 'milestones'
    | 'network'
    | 'main'
    | 'rendering'
    | 'interactions'
    | 'frames',
    number
  >>;
  screenshotCount: number;
}

export interface WorkbenchTimelineEventDto {
  id: string;
  trackId: string;
  startUs: number;
  durationUs: number;
  depth: number;
  category: string;
  name: string;
  status?: 'normal' | 'warning' | 'error' | 'incomplete' | 'candidate';
}

export interface WorkbenchEventDetailDto extends WorkbenchTimelineEventDto {
  parentId?: string;
  initiatorId?: string;
  childIds: string[];
  evidenceIds: string[];
}

export interface WorkbenchTruncation {
  truncated: boolean;
  returnedCount: number;
  totalMatched: number;
  continuation?: {
    afterStartUs: number;
    afterEventId: string;
  };
}

export interface WorkbenchViewportLod {
  mode: 'raw' | 'sampled';
  level: number;
  sourceEventCount: number;
  renderedEventCount: number;
  bucketUs: number;
  explanation: string;
}

interface WorkbenchRequestBase {
  schemaVersion: typeof WORKBENCH_SPIKE_SCHEMA_VERSION;
  requestId: string;
}

interface WorkbenchSessionRequestBase extends WorkbenchRequestBase, WorkbenchSessionRef {}

export interface CreateSessionRequest extends WorkbenchRequestBase {
  type: 'create-session';
  source: WorkbenchSourceRef;
  requestedCapabilities: WorkbenchCapability[];
}

export interface QueryViewportRequest extends WorkbenchSessionRequestBase {
  type: 'query-viewport';
  range: {
    startUs: number;
    endUs: number;
  };
  limit: number;
  balanceByTrack?: boolean;
  allowTruncation?: boolean;
  continuation?: {
    afterStartUs: number;
    afterEventId: string;
  };
}

export interface QuerySelectionRequest extends WorkbenchSessionRequestBase {
  type: 'query-selection';
  range: {
    startUs: number;
    endUs: number;
  };
}

export type WorkbenchAnalysisSort =
  | 'start-time'
  | 'self-time'
  | 'total-time'
  | 'sample-hits';

interface WorkbenchBoundedAnalysisRequest extends WorkbenchSessionRequestBase {
  range: {
    startUs: number;
    endUs: number;
  };
  sort: WorkbenchAnalysisSort;
  limit: number;
  continuation?: string;
}

export interface QueryFlameChartRequest extends WorkbenchBoundedAnalysisRequest {
  type: 'query-flame-chart';
}

export interface QueryCallTreeRequest extends WorkbenchBoundedAnalysisRequest {
  type: 'query-call-tree';
}

export interface QueryBottomUpRequest extends WorkbenchBoundedAnalysisRequest {
  type: 'query-bottom-up';
}

export interface QueryEventLogRequest extends WorkbenchBoundedAnalysisRequest {
  type: 'query-event-log';
  filters?: {
    names?: string[];
    categories?: string[];
    trackIds?: string[];
    statuses?: Array<NonNullable<WorkbenchTimelineEventDto['status']>>;
  };
}

export interface QuerySearchRequest extends WorkbenchBoundedAnalysisRequest {
  type: 'query-search';
  query: string;
  filters?: QueryEventLogRequest['filters'];
}

export interface QueryEventDetailRequest extends WorkbenchSessionRequestBase {
  type: 'query-event-detail';
  eventId: string;
}

export interface CancelQueryRequest extends WorkbenchSessionRequestBase {
  type: 'cancel-query';
  targetRequestId: string;
}

export interface ReleaseSessionRequest extends WorkbenchSessionRequestBase {
  type: 'release-session';
}

export interface QueryCapabilitiesRequest extends WorkbenchSessionRequestBase {
  type: 'query-capabilities';
}

export interface QueryEvidenceRequest extends WorkbenchSessionRequestBase {
  type: 'query-evidence';
  evidenceId: string;
}

export interface QueryScreenshotRequest extends WorkbenchSessionRequestBase {
  type: 'query-screenshot';
  screenshotId: string;
}

export interface QueryScreenshotIndexRequest extends WorkbenchSessionRequestBase {
  type: 'query-screenshot-index';
}

export interface AddComparisonBaselineRequest extends WorkbenchSessionRequestBase {
  type: 'add-comparison-baseline';
  sourceToken: string;
}

export interface RemoveComparisonBaselineRequest extends WorkbenchSessionRequestBase {
  type: 'remove-comparison-baseline';
}

export interface QueryTraceComparisonRequest extends WorkbenchSessionRequestBase {
  type: 'query-trace-comparison';
  range: { startUs: number; endUs: number };
  sameScenarioConfirmed: boolean;
}

export interface QueryAdvancedAnalysisRequest extends WorkbenchSessionRequestBase {
  type: 'query-advanced-analysis';
  capability: AdvancedWorkbenchCapability;
  range: { startUs: number; endUs: number };
}

export type WorkbenchTimelineStatus = NonNullable<
  WorkbenchTimelineEventDto['status']
>;

export type WorkbenchCustomQueryClause =
  | {
    field: 'name' | 'category' | 'trackId';
    operator: 'equals' | 'contains';
    value: string;
  }
  | {
    field: 'status';
    operator: 'equals';
    value: WorkbenchTimelineStatus;
  }
  | {
    field: 'durationUs';
    operator: 'equals' | 'gte' | 'lte';
    value: number;
  };

export interface WorkbenchCustomQuery {
  clauses: WorkbenchCustomQueryClause[];
}

export interface QueryCustomEventsRequest extends WorkbenchSessionRequestBase {
  type: 'query-custom-events';
  range: { startUs: number; endUs: number };
  query: WorkbenchCustomQuery;
  limit: number;
  continuation?: string;
}

export interface WorkbenchTrackPluginManifest {
  pluginId: string;
  label: string;
  query: WorkbenchCustomQuery;
  maxEvents: number;
}

export interface InstallTrackPluginRequest extends WorkbenchSessionRequestBase {
  type: 'install-track-plugin';
  range: { startUs: number; endUs: number };
  manifest: WorkbenchTrackPluginManifest;
}

export interface QueryTrackPluginRequest extends WorkbenchSessionRequestBase {
  type: 'query-track-plugin';
  range: { startUs: number; endUs: number };
  pluginId: string;
}

export interface RemoveTrackPluginRequest extends WorkbenchSessionRequestBase {
  type: 'remove-track-plugin';
  pluginId: string;
}

export type WorkbenchRequest =
  | CreateSessionRequest
  | QueryViewportRequest
  | QuerySelectionRequest
  | QueryFlameChartRequest
  | QueryCallTreeRequest
  | QueryBottomUpRequest
  | QueryEventLogRequest
  | QuerySearchRequest
  | QueryEventDetailRequest
  | QueryCapabilitiesRequest
  | QueryEvidenceRequest
  | QueryScreenshotIndexRequest
  | QueryScreenshotRequest
  | CancelQueryRequest
  | ReleaseSessionRequest
  | AddComparisonBaselineRequest
  | RemoveComparisonBaselineRequest
  | QueryTraceComparisonRequest
  | QueryAdvancedAnalysisRequest
  | QueryCustomEventsRequest
  | InstallTrackPluginRequest
  | QueryTrackPluginRequest
  | RemoveTrackPluginRequest
  | CrossSourceRequest;

interface WorkbenchResponseBase {
  schemaVersion: typeof WORKBENCH_SPIKE_SCHEMA_VERSION;
  requestId: string;
}

interface WorkbenchSessionResponseBase extends WorkbenchResponseBase, WorkbenchSessionRef {}

export interface WorkbenchProgressResponse extends WorkbenchSessionResponseBase {
  type: 'progress';
  phase: 'indexing-events' | 'querying-events' | 'releasing-session';
  unit: 'events' | 'bytes';
  completed: number;
  total: number;
}

export interface SessionCreatedResponse extends WorkbenchSessionResponseBase {
  type: 'session-created';
  session: WorkbenchSessionDescriptor;
}

export interface ViewportResultResponse extends WorkbenchSessionResponseBase {
  type: 'viewport-result';
  range: {
    startUs: number;
    endUs: number;
  };
  events: WorkbenchTimelineEventDto[];
  lod?: WorkbenchViewportLod;
  truncation: WorkbenchTruncation;
}

export interface SelectionResultResponse extends WorkbenchSessionResponseBase {
  type: 'selection-result';
  range: {
    startUs: number;
    endUs: number;
  };
  matchedCount: number;
  trackCounts: Record<string, number>;
  statusCounts: Partial<Record<
    'normal' | 'warning' | 'error' | 'incomplete' | 'candidate' | 'unmarked',
    number
  >>;
  truncation: {
    truncated: boolean;
    countedCount: number;
    totalMatched: number;
    reason?: string;
  };
}

export interface WorkbenchAnalysisNodeDto {
  id: string;
  nodeId: number;
  entityId: string;
  parentId?: string;
  functionName: string;
  selfTimeUs: number;
  totalTimeUs: number;
  sampleHits: number;
  callCount?: number;
  depth: number;
  evidenceIds: string[];
}

export interface WorkbenchFlameFrameDto {
  id: string;
  nodeId: number;
  entityId: string;
  parentId?: string;
  functionName: string;
  startUs: number;
  durationUs: number;
  depth: number;
  sampleHits: number;
  evidenceIds: string[];
}

export interface WorkbenchListTruncation {
  truncated: boolean;
  returnedCount: number;
  totalMatched: number;
  continuation?: string;
}

interface WorkbenchCpuResultBase extends WorkbenchSessionResponseBase {
  range: { startUs: number; endUs: number };
  capability: 'available' | 'partial';
  limitations: string[];
  truncation: WorkbenchListTruncation;
}

export interface FlameChartResultResponse extends WorkbenchCpuResultBase {
  type: 'flame-chart-result';
  frames: WorkbenchFlameFrameDto[];
}

export interface CallTreeResultResponse extends WorkbenchCpuResultBase {
  type: 'call-tree-result';
  nodes: WorkbenchAnalysisNodeDto[];
}

export interface BottomUpResultResponse extends WorkbenchCpuResultBase {
  type: 'bottom-up-result';
  nodes: WorkbenchAnalysisNodeDto[];
}

export interface EventLogResultResponse extends WorkbenchSessionResponseBase {
  type: 'event-log-result';
  range: { startUs: number; endUs: number };
  events: WorkbenchTimelineEventDto[];
  truncation: WorkbenchListTruncation;
}

export interface SearchResultResponse extends WorkbenchSessionResponseBase {
  type: 'search-result';
  range: { startUs: number; endUs: number };
  query: string;
  events: WorkbenchTimelineEventDto[];
  currentIndex: number;
  truncation: WorkbenchListTruncation;
}

export interface CustomQueryResultResponse extends WorkbenchSessionResponseBase {
  type: 'custom-query-result';
  range: { startUs: number; endUs: number };
  events: WorkbenchTimelineEventDto[];
  evidenceIds: string[];
  limitations: string[];
  truncation: WorkbenchListTruncation;
}

export interface EventDetailResultResponse extends WorkbenchSessionResponseBase {
  type: 'event-detail-result';
  detail: WorkbenchEventDetailDto;
}

export interface QueryCancelledResponse extends WorkbenchSessionResponseBase {
  type: 'query-cancelled';
  targetRequestId: string;
}

export interface SessionReleasedResponse extends WorkbenchSessionResponseBase {
  type: 'session-released';
  releasedRequestCount: number;
  revokedBlobUrlCount: number;
  releasedBufferCount: number;
}

export interface CapabilitiesResultResponse extends WorkbenchSessionResponseBase {
  type: 'capabilities-result';
  capabilities: WorkbenchCapability[];
  missingCapabilities: Array<{
    capability: WorkbenchCapability;
    reason: string;
  }>;
}

export interface EvidenceResultResponse extends WorkbenchSessionResponseBase {
  type: 'evidence-result';
  evidence: {
    evidenceId: string;
    name?: string;
    category?: string;
    phase?: string;
    timestampUs?: number;
    durationUs?: number;
    processId?: number;
    threadId?: number;
  };
}

export interface ScreenshotResultResponse extends WorkbenchSessionResponseBase {
  type: 'screenshot-result';
  screenshot: {
    screenshotId: string;
    mimeType: 'image/jpeg';
    bytes: Uint8Array;
  };
}

export interface ScreenshotIndexResultResponse extends WorkbenchSessionResponseBase {
  type: 'screenshot-index-result';
  screenshots: Array<{
    screenshotId: string;
    evidenceId: string;
    timestampUs: number;
    encodedBytes: number;
    decodedBytes: number;
  }>;
  rejectedCount: number;
}

export type TraceComparisonStatus =
  | 'comparable'
  | 'alignment-insufficient'
  | 'capability-mismatch'
  | 'sample-incomparable';

export interface ComparisonBaselineResultResponse extends WorkbenchSessionResponseBase {
  type: 'comparison-baseline-result';
  operation: 'added' | 'removed';
  baselineAvailable: boolean;
  sourceBytes?: number;
  eventCount?: number;
  limitations: string[];
}

export interface TraceComparisonResultResponse extends WorkbenchSessionResponseBase {
  type: 'trace-comparison-result';
  status: TraceComparisonStatus;
  range: { startUs: number; endUs: number };
  baselineRange?: { startUs: number; endUs: number };
  regression: 'regressed' | 'stable' | 'improved' | 'unavailable';
  metrics: Array<{
    metric: 'matched-events' | 'warning-events' | 'main' | 'rendering'
      | 'interactions' | 'frames';
    current: number;
    baseline: number;
    deltaPercent?: number;
  }>;
  evidenceIds: string[];
  limitations: string[];
}

export interface WorkbenchProjectedPluginEventDto {
  eventId: string;
  sourceEventId: string;
  evidenceIds: string[];
  trackId: string;
  category: string;
  name: string;
  startUs: number;
  durationUs: number;
  status?: NonNullable<WorkbenchTimelineEventDto['status']>;
}

export interface TrackPluginUpdatedResponse extends WorkbenchSessionResponseBase {
  type: 'track-plugin-result';
  operation: 'installed' | 'refreshed';
  plugin: {
    pluginId: string;
    label: string;
    trackId: `plugin:${string}`;
  };
  range: { startUs: number; endUs: number };
  projectedEvents: WorkbenchProjectedPluginEventDto[];
  evidenceIds: string[];
  limitations: string[];
  truncation: WorkbenchListTruncation;
}

export interface TrackPluginRemovedResponse extends WorkbenchSessionResponseBase {
  type: 'track-plugin-result';
  operation: 'removed';
  pluginId: string;
}

export type TrackPluginResultResponse =
  | TrackPluginUpdatedResponse
  | TrackPluginRemovedResponse;

export interface LayoutShiftAnalysisDto {
  kind: 'layout-shifts';
  clusters: Array<{
    clusterId: string;
    startUs: number;
    endUs: number;
    cumulativeScore: number;
    memberEventIds: string[];
    evidenceIds: string[];
    limitations: string[];
  }>;
}

export interface AnimationCompositionAnalysisDto {
  kind: 'animation-composition';
  animations: Array<{
    animationId: string;
    startUs: number;
    endUs: number;
    state: 'composited' | 'not-composited' | 'unknown';
    frameEventIds: string[];
    renderingEventIds: string[];
    evidenceIds: string[];
    limitations: string[];
  }>;
}

export interface MemoryTrendAnalysisDto {
  kind: 'memory-trend';
  samples: Array<{
    timestampUs: number;
    metric: 'js-heap-used';
    bytes: number;
    evidenceIds: string[];
  }>;
  gcEvents: Array<{
    eventId: string;
    type: 'minor' | 'major' | 'incremental' | 'other';
    startUs: number;
    durationUs: number;
    interactionEventIds: string[];
    longTaskEventIds: string[];
    evidenceIds: string[];
  }>;
  summary: {
    gcCount: number;
    totalPauseUs: number;
    maxPauseUs: number;
  };
}

export interface GpuRasterAnalysisDto {
  kind: 'gpu-raster';
  intervals: Array<{
    eventId: string;
    activity: 'gpu' | 'raster';
    startUs: number;
    durationUs: number;
    evidenceIds: string[];
  }>;
  summary: {
    intervalCount: number;
    gpuIntervalCount: number;
    rasterIntervalCount: number;
    totalDurationUs: number;
    maxDurationUs: number;
  };
}

export type AdvancedAnalysisDto =
  | LayoutShiftAnalysisDto
  | AnimationCompositionAnalysisDto
  | MemoryTrendAnalysisDto
  | GpuRasterAnalysisDto;

export interface AdvancedAnalysisResultResponse extends WorkbenchSessionResponseBase {
  type: 'advanced-analysis-result';
  capability: AdvancedWorkbenchCapability;
  status: 'available' | 'insufficient' | 'unavailable';
  evidenceIds: string[];
  limitations: string[];
  result: AdvancedAnalysisDto;
}

export interface CapabilityMissingResponse extends WorkbenchSessionResponseBase {
  type: 'capability-missing';
  capability: WorkbenchCapability;
  reason: string;
}

export interface StructuredErrorResponse extends WorkbenchResponseBase {
  type: 'structured-error';
  sessionId?: string;
  sessionRevision?: number;
  error: {
    code: WorkbenchQueryErrorCode;
    message: string;
    recoverable: boolean;
    capability?: WorkbenchCapability;
  };
}

export type WorkbenchResponse =
  | WorkbenchProgressResponse
  | SessionCreatedResponse
  | ViewportResultResponse
  | SelectionResultResponse
  | FlameChartResultResponse
  | CallTreeResultResponse
  | BottomUpResultResponse
  | EventLogResultResponse
  | SearchResultResponse
  | CustomQueryResultResponse
  | EventDetailResultResponse
  | QueryCancelledResponse
  | SessionReleasedResponse
  | CapabilitiesResultResponse
  | EvidenceResultResponse
  | ScreenshotIndexResultResponse
  | ScreenshotResultResponse
  | ComparisonBaselineResultResponse
  | TraceComparisonResultResponse
  | AdvancedAnalysisResultResponse
  | TrackPluginResultResponse
  | CapabilityMissingResponse
  | StructuredErrorResponse
  | CrossSourceResponse;
