import {
  WORKBENCH_SPIKE_SCHEMA_VERSION,
  type WorkbenchCapability,
  type WorkbenchQueryErrorCode,
  type WorkbenchRequest,
  type WorkbenchResponse,
  type WorkbenchSessionRef,
} from './protocol';
import {
  WORKBENCH_BENCHMARK_EVENT_COUNTS,
  type WorkbenchBenchmarkWorkerRequest,
  type WorkbenchBenchmarkWorkerResponse,
  type WorkbenchBenchmarkCorpusMetrics,
} from './benchmarkProtocol';

const CAPABILITIES: WorkbenchCapability[] = [
  'timeline-events',
  'event-detail',
  'cpu-profile',
  'network',
  'rendering',
  'interactions',
  'frames',
  'screenshots',
  'raw-evidence',
];

const ERROR_CODES: WorkbenchQueryErrorCode[] = [
  'unsupported-capability',
  'invalid-range',
  'query-cancelled',
  'query-timeout',
  'result-truncated',
  'session-released',
  'worker-failed',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isSessionRef(value: Record<string, unknown>): value is Record<string, unknown> & WorkbenchSessionRef {
  return isNonEmptyString(value.sessionId)
    && Number.isInteger(value.sessionRevision)
    && Number(value.sessionRevision) > 0;
}

function isCapability(value: unknown): value is WorkbenchCapability {
  return typeof value === 'string' && CAPABILITIES.includes(value as WorkbenchCapability);
}

function isErrorCode(value: unknown): value is WorkbenchQueryErrorCode {
  return typeof value === 'string'
    && ERROR_CODES.includes(value as WorkbenchQueryErrorCode);
}

function hasBase(value: Record<string, unknown>): boolean {
  return value.schemaVersion === WORKBENCH_SPIKE_SCHEMA_VERSION
    && isNonEmptyString(value.requestId)
    && isNonEmptyString(value.type);
}

export function isWorkbenchRequest(value: unknown): value is WorkbenchRequest {
  if (!isRecord(value) || !hasBase(value)) return false;
  switch (value.type) {
    case 'create-session':
      return isRecord(value.source)
        && isNonEmptyString(value.source.sourceId)
        && value.source.parserId === 'trace'
        && isNonEmptyString(value.source.fingerprint)
        && Array.isArray(value.requestedCapabilities)
        && value.requestedCapabilities.every(isCapability);
    case 'query-viewport':
      return isSessionRef(value)
        && isRecord(value.range)
        && typeof value.range.startUs === 'number'
        && Number.isFinite(value.range.startUs)
        && typeof value.range.endUs === 'number'
        && Number.isFinite(value.range.endUs)
        && Number.isInteger(value.limit)
        && (value.allowTruncation === undefined || typeof value.allowTruncation === 'boolean')
        && (
          value.continuation === undefined
          || (
            isRecord(value.continuation)
            && typeof value.continuation.afterStartUs === 'number'
            && Number.isFinite(value.continuation.afterStartUs)
            && isNonEmptyString(value.continuation.afterEventId)
          )
        );
    case 'query-event-detail':
      return isSessionRef(value) && isNonEmptyString(value.eventId);
    case 'query-capabilities':
      return isSessionRef(value);
    case 'query-evidence':
      return isSessionRef(value) && isNonEmptyString(value.evidenceId);
    case 'query-screenshot':
      return isSessionRef(value) && isNonEmptyString(value.screenshotId);
    case 'cancel-query':
      return isSessionRef(value) && isNonEmptyString(value.targetRequestId);
    case 'release-session':
      return isSessionRef(value);
    default:
      return false;
  }
}

function isRange(value: unknown): value is { startUs: number; endUs: number } {
  return isRecord(value)
    && isFiniteNumber(value.startUs)
    && isFiniteNumber(value.endUs);
}

function isTimelineEvent(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.trackId)
    && isFiniteNumber(value.startUs)
    && isFiniteNumber(value.durationUs)
    && Number.isInteger(value.depth)
    && isNonEmptyString(value.category)
    && isNonEmptyString(value.name);
}

function isEventDetail(value: unknown): boolean {
  return isTimelineEvent(value)
    && isRecord(value)
    && (value.parentId === undefined || isNonEmptyString(value.parentId))
    && (value.initiatorId === undefined || isNonEmptyString(value.initiatorId))
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every(isNonEmptyString);
}

function isTruncation(value: unknown, returnedEventCount: number): boolean {
  if (
    !isRecord(value)
    || typeof value.truncated !== 'boolean'
    || !isNonNegativeInteger(value.returnedCount)
    || value.returnedCount !== returnedEventCount
    || !isNonNegativeInteger(value.totalMatched)
    || value.totalMatched < value.returnedCount
  ) {
    return false;
  }
  return value.continuation === undefined
    || (
      isRecord(value.continuation)
      && isFiniteNumber(value.continuation.afterStartUs)
      && isNonEmptyString(value.continuation.afterEventId)
    );
}

function isSessionDescriptor(value: unknown): boolean {
  return isRecord(value)
    && isSessionRef(value)
    && (
      value.state === 'creating'
      || value.state === 'indexing-minimum'
      || value.state === 'ready'
      || value.state === 'enriching'
      || value.state === 'degraded'
      || value.state === 'releasing'
      || value.state === 'released'
      || value.state === 'failed'
    )
    && isRecord(value.source)
    && isNonEmptyString(value.source.sourceId)
    && value.source.parserId === 'trace'
    && isNonEmptyString(value.source.fingerprint)
    && Array.isArray(value.capabilities)
    && value.capabilities.every(isCapability)
    && Array.isArray(value.missingCapabilities)
    && value.missingCapabilities.every(item => (
      isRecord(item)
      && isCapability(item.capability)
      && isNonEmptyString(item.reason)
    ))
    && isRange(value.range)
    && isNonNegativeInteger(value.eventCount)
    && isNonNegativeInteger(value.screenshotCount);
}

function hasOptionalSessionRef(value: Record<string, unknown>): boolean {
  const hasSessionField = value.sessionId !== undefined
    || value.sessionRevision !== undefined;
  return !hasSessionField || isSessionRef(value);
}

export function isWorkbenchResponse(value: unknown): value is WorkbenchResponse {
  if (!isRecord(value) || !hasBase(value)) return false;
  switch (value.type) {
    case 'progress':
      return isSessionRef(value)
        && (
          value.phase === 'indexing-events'
          || value.phase === 'querying-events'
          || value.phase === 'releasing-session'
        )
        && value.unit === 'events'
        && isNonNegativeInteger(value.completed)
        && isNonNegativeInteger(value.total)
        && value.completed <= value.total;
    case 'session-created':
      return isSessionRef(value)
        && isSessionDescriptor(value.session)
        && isRecord(value.session)
        && (value.session.state === 'ready' || value.session.state === 'degraded')
        && value.session.sessionId === value.sessionId
        && value.session.sessionRevision === value.sessionRevision;
    case 'viewport-result':
      return isSessionRef(value)
        && isRange(value.range)
        && Array.isArray(value.events)
        && value.events.every(isTimelineEvent)
        && isTruncation(value.truncation, value.events.length);
    case 'event-detail-result':
      return isSessionRef(value) && isEventDetail(value.detail);
    case 'query-cancelled':
      return isSessionRef(value) && isNonEmptyString(value.targetRequestId);
    case 'session-released':
      return isSessionRef(value)
        && isNonNegativeInteger(value.releasedRequestCount)
        && isNonNegativeInteger(value.revokedBlobUrlCount)
        && isNonNegativeInteger(value.releasedBufferCount);
    case 'capabilities-result':
      return isSessionRef(value)
        && Array.isArray(value.capabilities)
        && value.capabilities.every(isCapability)
        && Array.isArray(value.missingCapabilities)
        && value.missingCapabilities.every(item => (
          isRecord(item)
          && isCapability(item.capability)
          && isNonEmptyString(item.reason)
        ));
    case 'evidence-result':
      return isSessionRef(value)
        && isRecord(value.evidence)
        && isNonEmptyString(value.evidence.evidenceId)
        && (value.evidence.name === undefined || isNonEmptyString(value.evidence.name))
        && (value.evidence.category === undefined || isNonEmptyString(value.evidence.category))
        && (value.evidence.phase === undefined || isNonEmptyString(value.evidence.phase))
        && (value.evidence.timestampUs === undefined || isFiniteNumber(value.evidence.timestampUs))
        && (value.evidence.durationUs === undefined || isFiniteNumber(value.evidence.durationUs))
        && (value.evidence.processId === undefined || isFiniteNumber(value.evidence.processId))
        && (value.evidence.threadId === undefined || isFiniteNumber(value.evidence.threadId));
    case 'screenshot-result':
      return isSessionRef(value)
        && isRecord(value.screenshot)
        && isNonEmptyString(value.screenshot.screenshotId)
        && value.screenshot.mimeType === 'image/jpeg'
        && value.screenshot.bytes instanceof Uint8Array;
    case 'capability-missing':
      return isSessionRef(value)
        && isCapability(value.capability)
        && isNonEmptyString(value.reason);
    case 'structured-error':
      return hasOptionalSessionRef(value)
        && isRecord(value.error)
        && isErrorCode(value.error.code)
        && isNonEmptyString(value.error.message)
        && typeof value.error.recoverable === 'boolean'
        && (
          value.error.capability === undefined
          || isCapability(value.error.capability)
        );
    default:
      return false;
  }
}

function isBenchmarkMetrics(value: unknown): value is WorkbenchBenchmarkCorpusMetrics {
  return isRecord(value)
    && isNonNegativeInteger(value.sourceBytes)
    && isNonNegativeInteger(value.jsonBytes)
    && isNonNegativeInteger(value.eventCount)
    && isRecord(value.eventFamilyDistribution)
    && Object.values(value.eventFamilyDistribution).every(isNonNegativeInteger)
    && isNonNegativeInteger(value.screenshotEncodedBytes)
    && isNonNegativeInteger(value.screenshotDecodedBytes)
    && isFiniteNumber(value.fileReadMs)
    && value.fileReadMs >= 0
    && isFiniteNumber(value.jsonParseMs)
    && value.jsonParseMs >= 0
    && isFiniteNumber(value.indexBuildMs)
    && value.indexBuildMs >= 0
    && isNonEmptyString(value.sampleHash);
}

function hasWorkerMeasurement(value: Record<string, unknown>): boolean {
  return isFiniteNumber(value.workerElapsedMs)
    && value.workerElapsedMs >= 0
    && isNonNegativeInteger(value.uiTransferBytes);
}

export function isWorkbenchBenchmarkWorkerRequest(
  value: unknown,
): value is WorkbenchBenchmarkWorkerRequest {
  if (!isRecord(value) || !isNonEmptyString(value.type)) return false;
  if (value.type === 'prepare-workbench-benchmark') {
    return isNonEmptyString(value.requestId)
      && WORKBENCH_BENCHMARK_EVENT_COUNTS.includes(
        value.eventCount as typeof WORKBENCH_BENCHMARK_EVENT_COUNTS[number],
      );
  }
  return value.type === 'dispatch-workbench-request'
    && isWorkbenchRequest(value.request);
}

export function isWorkbenchBenchmarkWorkerResponse(
  value: unknown,
): value is WorkbenchBenchmarkWorkerResponse {
  if (!isRecord(value) || !isNonEmptyString(value.type)) return false;
  switch (value.type) {
    case 'workbench-benchmark-prepared':
      return isNonEmptyString(value.requestId)
        && isBenchmarkMetrics(value.metrics)
        && isWorkbenchResponse(value.session)
        && value.session.type === 'session-created'
        && hasWorkerMeasurement(value);
    case 'workbench-response':
      return isWorkbenchResponse(value.response) && hasWorkerMeasurement(value);
    case 'workbench-benchmark-failed':
      return isNonEmptyString(value.requestId)
        && isRecord(value.error)
        && value.error.code === 'worker-failed'
        && isNonEmptyString(value.error.message);
    default:
      return false;
  }
}
