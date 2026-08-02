import {
  WORKBENCH_SPIKE_SCHEMA_VERSION,
  type AdvancedWorkbenchCapability,
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
import {
  isCrossSourceRequest,
  isCrossSourceResponse,
} from '../crossSourceProtocolGuards';

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

const ADVANCED_CAPABILITIES: AdvancedWorkbenchCapability[] = [
  'layout-shifts',
  'animation-composition',
  'memory-trend',
  'gpu-raster',
];
const TIMELINE_STATUSES = [
  'normal',
  'warning',
  'error',
  'incomplete',
  'candidate',
] as const;

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

function isAdvancedCapability(value: unknown): value is AdvancedWorkbenchCapability {
  return typeof value === 'string'
    && ADVANCED_CAPABILITIES.includes(value as AdvancedWorkbenchCapability);
}

function isTimelineStatus(value: unknown): boolean {
  return typeof value === 'string'
    && TIMELINE_STATUSES.includes(value as typeof TIMELINE_STATUSES[number]);
}

function isCustomQuery(value: unknown): boolean {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['clauses'])
    || !Array.isArray(value.clauses)
    || value.clauses.length < 1
    || value.clauses.length > 8
  ) {
    return false;
  }
  return value.clauses.every(clause => {
    if (
      !isRecord(clause)
      || !hasOnlyKeys(clause, ['field', 'operator', 'value'])
    ) {
      return false;
    }
    if (
      clause.field === 'name'
      || clause.field === 'category'
      || clause.field === 'trackId'
    ) {
      return (clause.operator === 'equals' || clause.operator === 'contains')
        && isNonEmptyString(clause.value)
        && clause.value.length <= 128;
    }
    if (clause.field === 'status') {
      return clause.operator === 'equals' && isTimelineStatus(clause.value);
    }
    return clause.field === 'durationUs'
      && (
        clause.operator === 'equals'
        || clause.operator === 'gte'
        || clause.operator === 'lte'
      )
      && isFiniteNumber(clause.value)
      && clause.value >= 0;
  });
}

function isPluginId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
}

function isTrackPluginManifest(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['pluginId', 'label', 'query', 'maxEvents'])
    && isPluginId(value.pluginId)
    && isNonEmptyString(value.label)
    && value.label.length <= 60
    && isCustomQuery(value.query)
    && Number.isInteger(value.maxEvents)
    && Number(value.maxEvents) >= 1
    && Number(value.maxEvents) <= 2_000;
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
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'limit', 'balanceByTrack', 'allowTruncation', 'continuation',
      ])
        && isSessionRef(value)
        && isRange(value.range)
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
    case 'add-comparison-baseline':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'sourceToken',
      ])
        && isSessionRef(value)
        && isNonEmptyString(value.sourceToken);
    case 'remove-comparison-baseline':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
      ])
        && isSessionRef(value);
    case 'query-trace-comparison':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'sameScenarioConfirmed',
      ])
        && isSessionRef(value)
        && isRange(value.range)
        && typeof value.sameScenarioConfirmed === 'boolean';
    case 'query-advanced-analysis':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'capability', 'range',
      ])
        && isSessionRef(value)
        && isAdvancedCapability(value.capability)
        && isRange(value.range);
    case 'query-custom-events':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'query', 'limit', 'continuation',
      ])
        && isSessionRef(value)
        && isRange(value.range)
        && isCustomQuery(value.query)
        && Number.isInteger(value.limit)
        && Number(value.limit) >= 1
        && Number(value.limit) <= 2_000
        && (
          value.continuation === undefined
          || (
            isNonEmptyString(value.continuation)
            && /^trace:timeline:(0|[1-9]\d*)$/.test(value.continuation)
          )
        );
    case 'install-track-plugin':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'manifest',
      ])
        && isSessionRef(value)
        && isRange(value.range)
        && isTrackPluginManifest(value.manifest);
    case 'query-track-plugin':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'pluginId',
      ])
        && isSessionRef(value)
        && isRange(value.range)
        && isPluginId(value.pluginId);
    case 'remove-track-plugin':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'pluginId',
      ])
        && isSessionRef(value)
        && isPluginId(value.pluginId);
    case 'add-source':
    case 'replace-source':
    case 'remove-source':
    case 'query-sources':
    case 'query-alignment':
    case 'query-correlation':
    case 'query-evidence-graph':
    case 'query-insights':
      return isCrossSourceRequest(value);
    default:
      return false;
  }
}

function isRange(value: unknown): value is { startUs: number; endUs: number } {
  return isRecord(value)
    && hasOnlyKeys(value, ['startUs', 'endUs'])
    && isFiniteNumber(value.startUs)
    && isFiniteNumber(value.endUs)
    && value.startUs <= value.endUs;
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

function isViewportLod(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'mode', 'level', 'sourceEventCount', 'renderedEventCount',
      'bucketUs', 'explanation',
    ])
    && (value.mode === 'raw' || value.mode === 'sampled')
    && Number.isInteger(value.level) && Number(value.level) >= 1
    && isNonNegativeInteger(value.sourceEventCount)
    && isNonNegativeInteger(value.renderedEventCount)
    && isFiniteNumber(value.bucketUs) && value.bucketUs >= 0
    && isNonEmptyString(value.explanation);
}

function isComparisonMetric(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['metric', 'current', 'baseline', 'deltaPercent'])
    && [
      'matched-events', 'warning-events', 'main', 'rendering',
      'interactions', 'frames',
    ].includes(String(value.metric))
    && isNonNegativeInteger(value.current)
    && isNonNegativeInteger(value.baseline)
    && (value.deltaPercent === undefined || isFiniteNumber(value.deltaPercent));
}

function isEvidenceIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 10_000
    && value.every(isNonEmptyString);
}

function isAdvancedAnalysisResult(
  capability: AdvancedWorkbenchCapability,
  value: unknown,
): boolean {
  if (!isRecord(value) || value.kind !== capability) return false;
  switch (value.kind) {
    case 'layout-shifts':
      return hasOnlyKeys(value, ['kind', 'clusters'])
        && Array.isArray(value.clusters)
        && value.clusters.every(cluster => (
          isRecord(cluster)
          && hasOnlyKeys(cluster, [
            'clusterId', 'startUs', 'endUs', 'cumulativeScore',
            'memberEventIds', 'evidenceIds', 'limitations',
          ])
          && isNonEmptyString(cluster.clusterId)
          && isFiniteNumber(cluster.startUs)
          && isFiniteNumber(cluster.endUs)
          && cluster.startUs <= cluster.endUs
          && isFiniteNumber(cluster.cumulativeScore)
          && cluster.cumulativeScore >= 0
          && isEvidenceIds(cluster.memberEventIds)
          && isEvidenceIds(cluster.evidenceIds)
          && isStringArray(cluster.limitations)
        ));
    case 'animation-composition':
      return hasOnlyKeys(value, ['kind', 'animations'])
        && Array.isArray(value.animations)
        && value.animations.every(animation => (
          isRecord(animation)
          && hasOnlyKeys(animation, [
            'animationId', 'startUs', 'endUs', 'state', 'frameEventIds',
            'renderingEventIds', 'evidenceIds', 'limitations',
          ])
          && isNonEmptyString(animation.animationId)
          && isFiniteNumber(animation.startUs)
          && isFiniteNumber(animation.endUs)
          && animation.startUs <= animation.endUs
          && ['composited', 'not-composited', 'unknown']
            .includes(String(animation.state))
          && isEvidenceIds(animation.frameEventIds)
          && isEvidenceIds(animation.renderingEventIds)
          && isEvidenceIds(animation.evidenceIds)
          && isStringArray(animation.limitations)
        ));
    case 'memory-trend':
      return hasOnlyKeys(value, ['kind', 'samples', 'gcEvents', 'summary'])
        && Array.isArray(value.samples)
        && value.samples.length <= 2_000
        && value.samples.every(sample => (
          isRecord(sample)
          && hasOnlyKeys(sample, [
            'timestampUs', 'metric', 'bytes', 'evidenceIds',
          ])
          && isFiniteNumber(sample.timestampUs)
          && sample.metric === 'js-heap-used'
          && isNonNegativeInteger(sample.bytes)
          && isEvidenceIds(sample.evidenceIds)
        ))
        && Array.isArray(value.gcEvents)
        && value.gcEvents.length <= 2_000
        && value.gcEvents.every(event => (
          isRecord(event)
          && hasOnlyKeys(event, [
            'eventId', 'type', 'startUs', 'durationUs',
            'interactionEventIds', 'longTaskEventIds', 'evidenceIds',
          ])
          && isNonEmptyString(event.eventId)
          && ['minor', 'major', 'incremental', 'other']
            .includes(String(event.type))
          && isFiniteNumber(event.startUs)
          && isFiniteNumber(event.durationUs)
          && event.durationUs >= 0
          && isEvidenceIds(event.interactionEventIds)
          && isEvidenceIds(event.longTaskEventIds)
          && isEvidenceIds(event.evidenceIds)
        ))
        && value.gcEvents.reduce((sum, event) => (
          sum
          + event.interactionEventIds.length
          + event.longTaskEventIds.length
        ), 0) <= 2_000
        && isRecord(value.summary)
        && hasOnlyKeys(value.summary, [
          'gcCount', 'totalPauseUs', 'maxPauseUs',
        ])
        && isNonNegativeInteger(value.summary.gcCount)
        && value.summary.gcCount >= value.gcEvents.length
        && isFiniteNumber(value.summary.totalPauseUs)
        && value.summary.totalPauseUs >= 0
        && isFiniteNumber(value.summary.maxPauseUs)
        && value.summary.maxPauseUs >= 0;
    case 'gpu-raster':
      return hasOnlyKeys(value, ['kind', 'intervals', 'summary'])
        && Array.isArray(value.intervals)
        && value.intervals.length <= 2_000
        && value.intervals.every(interval => (
          isRecord(interval)
          && hasOnlyKeys(interval, [
            'eventId', 'activity', 'startUs', 'durationUs', 'evidenceIds',
          ])
          && isNonEmptyString(interval.eventId)
          && (interval.activity === 'gpu' || interval.activity === 'raster')
          && isFiniteNumber(interval.startUs)
          && isFiniteNumber(interval.durationUs)
          && interval.durationUs >= 0
          && isEvidenceIds(interval.evidenceIds)
        ))
        && isRecord(value.summary)
        && hasOnlyKeys(value.summary, [
          'intervalCount', 'gpuIntervalCount', 'rasterIntervalCount',
          'totalDurationUs', 'maxDurationUs',
        ])
        && isNonNegativeInteger(value.summary.intervalCount)
        && value.summary.intervalCount >= value.intervals.length
        && isNonNegativeInteger(value.summary.gpuIntervalCount)
        && isNonNegativeInteger(value.summary.rasterIntervalCount)
        && value.summary.gpuIntervalCount + value.summary.rasterIntervalCount
          === value.summary.intervalCount
        && isFiniteNumber(value.summary.totalDurationUs)
        && value.summary.totalDurationUs >= 0
        && isFiniteNumber(value.summary.maxDurationUs)
        && value.summary.maxDurationUs >= 0;
    default:
      return false;
  }
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
      [
        'layout-shifts', 'animations', 'milestones', 'network', 'main', 'rendering',
        'interactions', 'frames', 'gpu-raster',
      ].includes(trackId)
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
        && (value.lod === undefined || isViewportLod(value.lod))
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
    case 'custom-query-result':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'range', 'events', 'evidenceIds', 'limitations', 'truncation',
      ])
        && isSessionRef(value)
        && isRange(value.range)
        && Array.isArray(value.events)
        && value.events.length <= 2_000
        && value.events.every(isTimelineEvent)
        && isEvidenceIds(value.evidenceIds)
        && value.evidenceIds.length <= 2_000
        && isStringArray(value.limitations)
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
    case 'comparison-baseline-result':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'operation', 'baselineAvailable', 'sourceBytes', 'eventCount',
        'limitations',
      ])
        && isSessionRef(value)
        && (value.operation === 'added' || value.operation === 'removed')
        && typeof value.baselineAvailable === 'boolean'
        && (value.sourceBytes === undefined || isNonNegativeInteger(value.sourceBytes))
        && (value.eventCount === undefined || isNonNegativeInteger(value.eventCount))
        && (
          value.operation === 'added'
            ? value.baselineAvailable === true
              && isNonNegativeInteger(value.sourceBytes)
              && isNonNegativeInteger(value.eventCount)
            : value.baselineAvailable === false
              && value.sourceBytes === undefined
              && value.eventCount === undefined
        )
        && isStringArray(value.limitations);
    case 'trace-comparison-result':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'status', 'range', 'baselineRange', 'regression', 'metrics',
        'evidenceIds', 'limitations',
      ])
        && isSessionRef(value)
        && [
          'comparable', 'alignment-insufficient', 'capability-mismatch',
          'sample-incomparable',
        ].includes(String(value.status))
        && isRange(value.range)
        && (value.baselineRange === undefined || isRange(value.baselineRange))
        && ['regressed', 'stable', 'improved', 'unavailable']
          .includes(String(value.regression))
        && (
          value.status === 'comparable'
          || value.regression === 'unavailable'
        )
        && Array.isArray(value.metrics)
        && value.metrics.length <= 6
        && value.metrics.every(isComparisonMetric)
        && isStringArray(value.evidenceIds)
        && isStringArray(value.limitations);
    case 'advanced-analysis-result':
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'capability', 'status', 'evidenceIds', 'limitations', 'result',
      ])
        && isSessionRef(value)
        && isAdvancedCapability(value.capability)
        && ['available', 'insufficient', 'unavailable'].includes(String(value.status))
        && isEvidenceIds(value.evidenceIds)
        && isStringArray(value.limitations)
        && isAdvancedAnalysisResult(value.capability, value.result);
    case 'track-plugin-result': {
      if (
        !isSessionRef(value)
        || (
          value.operation !== 'installed'
          && value.operation !== 'refreshed'
          && value.operation !== 'removed'
        )
      ) {
        return false;
      }
      if (value.operation === 'removed') {
        return hasOnlyKeys(value, [
          'type', 'schemaVersion', 'requestId', 'sessionId',
          'sessionRevision', 'operation', 'pluginId',
        ]) && isPluginId(value.pluginId);
      }
      const plugin = value.plugin;
      return hasOnlyKeys(value, [
        'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
        'operation', 'plugin', 'range', 'projectedEvents', 'evidenceIds',
        'limitations', 'truncation',
      ])
        && isRecord(plugin)
        && hasOnlyKeys(plugin, ['pluginId', 'label', 'trackId'])
        && isPluginId(plugin.pluginId)
        && isNonEmptyString(plugin.label)
        && plugin.label.length <= 60
        && plugin.trackId === `plugin:${plugin.pluginId}`
        && isRange(value.range)
        && Array.isArray(value.projectedEvents)
        && value.projectedEvents.length <= 2_000
        && value.projectedEvents.every(event => (
          isRecord(event)
          && hasOnlyKeys(event, [
            'eventId', 'sourceEventId', 'evidenceIds', 'trackId',
            'category', 'name', 'startUs', 'durationUs', 'status',
          ])
          && isNonEmptyString(event.eventId)
          && isNonEmptyString(event.sourceEventId)
          && /^trace:timeline:(0|[1-9]\d*)$/.test(event.sourceEventId)
          && event.eventId === (
            `plugin:${plugin.pluginId}:${event.sourceEventId}`
          )
          && isEvidenceIds(event.evidenceIds)
          && event.evidenceIds.length <= 2_000
          && event.trackId === plugin.trackId
          && isNonEmptyString(event.category)
          && isNonEmptyString(event.name)
          && isFiniteNumber(event.startUs)
          && isFiniteNumber(event.durationUs)
          && event.durationUs >= 0
          && (event.status === undefined || isTimelineStatus(event.status))
        ))
        && isEvidenceIds(value.evidenceIds)
        && (
          value.evidenceIds.length
          + value.projectedEvents.reduce(
            (sum, event) => sum + event.evidenceIds.length,
            0,
          )
        ) <= 2_000
        && isStringArray(value.limitations)
        && isListTruncation(
          value.truncation,
          value.projectedEvents.length,
        );
    }
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
    case 'sources-result':
    case 'source-change-result':
    case 'alignment-result':
    case 'correlation-result':
    case 'evidence-graph-result':
    case 'insights-result':
      return isCrossSourceResponse(value);
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
  if (value.type === 'dispatch-workbench-request') {
    return isWorkbenchRequest(value.request);
  }
  return value.type === 'dispatch-workbench-source-file'
    && isWorkbenchRequest(value.request)
    && isRecord(value.request)
    && (
      value.request.type === 'add-source'
      || value.request.type === 'replace-source'
      || value.request.type === 'add-comparison-baseline'
    )
    && typeof File !== 'undefined'
    && value.file instanceof File;
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
