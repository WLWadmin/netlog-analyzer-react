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
}

export interface WorkbenchEventDetailDto extends WorkbenchTimelineEventDto {
  parentId?: string;
  initiatorId?: string;
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
  allowTruncation?: boolean;
  continuation?: {
    afterStartUs: number;
    afterEventId: string;
  };
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

export type WorkbenchRequest =
  | CreateSessionRequest
  | QueryViewportRequest
  | QueryEventDetailRequest
  | QueryCapabilitiesRequest
  | QueryEvidenceRequest
  | QueryScreenshotRequest
  | CancelQueryRequest
  | ReleaseSessionRequest;

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
  truncation: WorkbenchTruncation;
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
  | EventDetailResultResponse
  | QueryCancelledResponse
  | SessionReleasedResponse
  | CapabilitiesResultResponse
  | EvidenceResultResponse
  | ScreenshotResultResponse
  | CapabilityMissingResponse
  | StructuredErrorResponse;
