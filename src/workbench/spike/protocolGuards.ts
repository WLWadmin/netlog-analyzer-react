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

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every(key => allowedKeys.includes(key));
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
        && (value.balanceByTrack === undefined || typeof value.balanceByTrack === 'boolean')
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
    case 'query-selection':
      return isSessionRef(value) && isRange(value.range);
    case 'query-flame-chart':
      return value.sort === 'start-time'
        && hasOnlyKeys(value, [
          'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
          'range', 'sort', 'limit', 'continuation',
        ])
        && isBoundedAnalysisRequest(value);
    case 'query-call-tree':
    case 'query-bottom-up':
      return value.sort !== 'start-time'
        && hasOnlyKeys(value, [
          'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
          'range', 'sort', 'limit', 'continuation',
        ])
        && isBoundedAnalysisRequest(value);
    case 'query-event-log':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'sort', 'limit', 'continuation', 'filters',
      ])
        && value.sort === 'start-time'
        && isBoundedAnalysisRequest(value)
        && isEventFilters(value.filters);
    case 'query-search':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'sort', 'limit', 'continuation', 'query', 'filters',
      ])
        && value.sort === 'start-time'
        && isBoundedAnalysisRequest(value)
        && isNonEmptyString(value.query)
        && value.query.length <= 256
        && isEventFilters(value.filters);
    case 'query-event-detail':
      return isSessionRef(value) && isNonEmptyString(value.eventId);
    case 'query-capabilities':
      return isSessionRef(value);
    case 'query-evidence':
      return isSessionRef(value) && isNonEmptyString(value.evidenceId);
    case 'query-screenshot-index':
      return isSessionRef(value);
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

function isAnalysisSort(value: unknown): boolean {
  return value === 'start-time'
    || value === 'self-time'
    || value === 'total-time'
    || value === 'sample-hits';
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= 100
    && value.every(item => isNonEmptyString(item) && item.length <= 256);
}

function isEventFilters(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const allowed = new Set(['names', 'categories', 'trackIds', 'statuses']);
  if (Object.keys(value).some(key => !allowed.has(key))) return false;
  return (value.names === undefined || isStringArray(value.names))
    && (value.categories === undefined || isStringArray(value.categories))
    && (value.trackIds === undefined || isStringArray(value.trackIds))
    && (
      value.statuses === undefined
      || (
        Array.isArray(value.statuses)
        && value.statuses.length <= 5
        && value.statuses.every(status => (
          status === 'normal'
          || status === 'warning'
          || status === 'error'
          || status === 'incomplete'
          || status === 'candidate'
        ))
      )
    );
}

function isBoundedAnalysisRequest(value: Record<string, unknown>): boolean {
  return isSessionRef(value)
    && isRange(value.range)
    && isAnalysisSort(value.sort)
    && Number.isInteger(value.limit)
    && Number(value.limit) > 0
    && Number(value.limit) <= 10_000
    && (value.continuation === undefined || isNonEmptyString(value.continuation));
}

function isTimelineEventShape(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.trackId)
    && isFiniteNumber(value.startUs)
    && isFiniteNumber(value.durationUs)
    && Number.isInteger(value.depth)
    && isNonEmptyString(value.category)
    && isNonEmptyString(value.name)
    && (
      value.status === undefined
      || value.status === 'normal'
      || value.status === 'warning'
      || value.status === 'error'
      || value.status === 'incomplete'
      || value.status === 'candidate'
    );
}

function isTimelineEvent(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'id', 'trackId', 'startUs', 'durationUs', 'depth', 'category', 'name', 'status',
    ])
    && isTimelineEventShape(value);
}

function isEventDetail(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'id', 'trackId', 'startUs', 'durationUs', 'depth', 'category', 'name', 'status',
      'parentId', 'initiatorId', 'childIds', 'evidenceIds',
    ])
    && isTimelineEventShape(value)
    && (value.parentId === undefined || isNonEmptyString(value.parentId))
    && (value.initiatorId === undefined || isNonEmptyString(value.initiatorId))
    && Array.isArray(value.childIds)
    && value.childIds.every(isNonEmptyString)
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every(isNonEmptyString);
}

function isListTruncation(value: unknown, returnedCount: number): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'truncated', 'returnedCount', 'totalMatched', 'continuation',
    ])
    && typeof value.truncated === 'boolean'
    && isNonNegativeInteger(value.returnedCount)
    && value.returnedCount === returnedCount
    && isNonNegativeInteger(value.totalMatched)
    && value.totalMatched >= returnedCount
    && (
      value.truncated
        ? returnedCount > 0 && isNonEmptyString(value.continuation)
        : value.continuation === undefined
    );
}

function isAnalysisNode(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'id', 'nodeId', 'entityId', 'parentId', 'functionName', 'selfTimeUs',
      'totalTimeUs', 'sampleHits', 'callCount', 'depth', 'evidenceIds',
    ])
    && isNonEmptyString(value.id)
    && isNonNegativeInteger(value.nodeId)
    && isNonEmptyString(value.entityId)
    && (value.parentId === undefined || isNonEmptyString(value.parentId))
    && isNonEmptyString(value.functionName)
    && isFiniteNumber(value.selfTimeUs)
    && value.selfTimeUs >= 0
    && isFiniteNumber(value.totalTimeUs)
    && value.totalTimeUs >= value.selfTimeUs
    && isNonNegativeInteger(value.sampleHits)
    && (value.callCount === undefined || isNonNegativeInteger(value.callCount))
    && isNonNegativeInteger(value.depth)
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every(isNonEmptyString);
}

function isFlameFrame(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'id', 'nodeId', 'entityId', 'parentId', 'functionName', 'startUs',
      'durationUs', 'depth', 'sampleHits', 'evidenceIds',
    ])
    && isNonEmptyString(value.id)
    && isNonNegativeInteger(value.nodeId)
    && isNonEmptyString(value.entityId)
    && (value.parentId === undefined || isNonEmptyString(value.parentId))
    && isNonEmptyString(value.functionName)
    && isFiniteNumber(value.startUs)
    && isFiniteNumber(value.durationUs)
    && value.durationUs >= 0
    && isNonNegativeInteger(value.depth)
    && isNonNegativeInteger(value.sampleHits)
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every(isNonEmptyString);
}

function hasCpuResultBase(value: Record<string, unknown>, returnedCount: number): boolean {
  return isSessionRef(value)
    && isRange(value.range)
    && (value.capability === 'available' || value.capability === 'partial')
    && Array.isArray(value.limitations)
    && value.limitations.every(isNonEmptyString)
    && isListTruncation(value.truncation, returnedCount);
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
    && isRecord(value.trackEventCounts)
    && Object.entries(value.trackEventCounts).every(([trackId, count]) => (
      ['milestones', 'network', 'main', 'rendering', 'interactions', 'frames'].includes(trackId)
      && isNonNegativeInteger(count)
      && count > 0
    ))
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
    case 'selection-result':
      return isSessionRef(value)
        && isRange(value.range)
        && isNonNegativeInteger(value.matchedCount)
        && isRecord(value.trackCounts)
        && Object.values(value.trackCounts).every(isNonNegativeInteger)
        && isRecord(value.statusCounts)
        && Object.entries(value.statusCounts).every(([status, count]) => (
          ['normal', 'warning', 'error', 'incomplete', 'candidate', 'unmarked'].includes(status)
          && isNonNegativeInteger(count)
        ))
        && isRecord(value.truncation)
        && typeof value.truncation.truncated === 'boolean'
        && isNonNegativeInteger(value.truncation.countedCount)
        && isNonNegativeInteger(value.truncation.totalMatched)
        && (
          value.truncation.reason === undefined
          || isNonEmptyString(value.truncation.reason)
        );
    case 'flame-chart-result':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'capability', 'limitations', 'truncation', 'frames',
      ])
        && Array.isArray(value.frames)
        && value.frames.every(isFlameFrame)
        && hasCpuResultBase(value, value.frames.length);
    case 'call-tree-result':
    case 'bottom-up-result':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'capability', 'limitations', 'truncation', 'nodes',
      ])
        && Array.isArray(value.nodes)
        && value.nodes.every(isAnalysisNode)
        && hasCpuResultBase(value, value.nodes.length);
    case 'event-log-result':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'events', 'truncation',
      ])
        && isSessionRef(value)
        && isRange(value.range)
        && Array.isArray(value.events)
        && value.events.every(isTimelineEvent)
        && isListTruncation(value.truncation, value.events.length);
    case 'search-result':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'query', 'events', 'currentIndex', 'truncation',
      ])
        && isSessionRef(value)
        && isRange(value.range)
        && isNonEmptyString(value.query)
        && Array.isArray(value.events)
        && value.events.every(isTimelineEvent)
        && isNonNegativeInteger(value.currentIndex)
        && (
          value.events.length === 0
            ? value.currentIndex === 0
            : value.currentIndex >= 1 && value.currentIndex <= value.events.length
        )
        && isListTruncation(value.truncation, value.events.length);
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
    case 'screenshot-index-result':
      return isSessionRef(value)
        && Array.isArray(value.screenshots)
        && value.screenshots.every(item => (
          isRecord(item)
          && isNonEmptyString(item.screenshotId)
          && isNonEmptyString(item.evidenceId)
          && isFiniteNumber(item.timestampUs)
          && isNonNegativeInteger(item.encodedBytes)
          && isNonNegativeInteger(item.decodedBytes)
        ))
        && isNonNegativeInteger(value.rejectedCount);
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
  if (value.type === 'prepare-workbench-product-benchmark') {
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
    case 'workbench-product-benchmark-prepared':
      return isNonEmptyString(value.requestId)
        && isBenchmarkMetrics(value.metrics)
        && isRecord(value.source)
        && isNonEmptyString(value.source.sourceId)
        && value.source.parserId === 'trace'
        && isNonEmptyString(value.source.fingerprint)
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
