import { WORKBENCH_SCHEMA_VERSION } from './protocol';
import type {
  CrossSourceRequest,
  CrossSourceResponse,
} from './crossSourceProtocol';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function text(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return integer(value) && Number(value) > 0;
}

function strings(value: unknown, limit = 100): value is string[] {
  return Array.isArray(value)
    && value.length <= limit
    && value.every(item => text(item));
}

function base(value: Record<string, unknown>): boolean {
  return value.schemaVersion === WORKBENCH_SCHEMA_VERSION
    && text(value.requestId)
    && text(value.sessionId)
    && integer(value.sessionRevision)
    && Number(value.sessionRevision) > 0;
}

function range(value: unknown): boolean {
  return record(value)
    && only(value, ['startUs', 'endUs'])
    && finite(value.startUs)
    && finite(value.endUs)
    && value.startUs <= value.endUs;
}

export function isCrossSourceRequest(value: unknown): value is CrossSourceRequest {
  if (!record(value) || !base(value)) return false;
  const common = ['type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision'];
  switch (value.type) {
    case 'add-source':
      return only(value, [...common, 'sourceToken', 'expectedKind'])
        && text(value.sourceToken)
        && (value.expectedKind === 'har' || value.expectedKind === 'netlog');
    case 'replace-source':
      return only(value, [...common, 'sourceToken', 'expectedKind', 'replacedSourceId'])
        && text(value.sourceToken)
        && text(value.replacedSourceId)
        && (value.expectedKind === 'har' || value.expectedKind === 'netlog');
    case 'remove-source':
      return only(value, [...common, 'sourceId']) && text(value.sourceId);
    case 'query-sources':
      return only(value, common);
    case 'query-alignment':
      return only(value, [...common, 'limit'])
        && positiveInteger(value.limit) && value.limit <= 1_000;
    case 'query-correlation':
      return only(value, [...common, 'entityId', 'limit'])
        && (value.entityId === undefined || text(value.entityId))
        && positiveInteger(value.limit) && value.limit <= 10_000;
    case 'query-evidence-graph':
      return only(value, [...common, 'range', 'selectedEntityId', 'limit'])
        && (value.range === undefined || range(value.range))
        && (value.selectedEntityId === undefined || text(value.selectedEntityId))
        && positiveInteger(value.limit) && value.limit <= 1_000;
    case 'query-insights':
      return only(value, [...common, 'range', 'limit'])
        && range(value.range)
        && positiveInteger(value.limit) && value.limit <= 100;
    default:
      return false;
  }
}

function clock(value: unknown): boolean {
  return record(value)
    && only(value, ['kind', 'unit', 'calibrated'])
    && ['trace-monotonic-us', 'har-epoch-ms', 'netlog-epoch-ms',
      'netlog-time-tick-ms', 'unknown'].includes(String(value.kind))
    && (value.unit === 'us' || value.unit === 'ms')
    && typeof value.calibrated === 'boolean';
}

function source(value: unknown): boolean {
  if (!record(value)) return false;
  if (!(
    only(value, [
      'sourceId', 'kind', 'parserId', 'label', 'state', 'byteLength',
      'clockDomain', 'capabilities', 'limitations',
    ])
    && text(value.sourceId) && text(value.label)
    && ['trace', 'har', 'netlog'].includes(String(value.kind))
    && ['trace', 'har@1', 'chromium-netlog@1'].includes(String(value.parserId))
    && ['loading', 'ready', 'degraded', 'rejected', 'removing', 'released']
      .includes(String(value.state))
    && integer(value.byteLength)
    && clock(value.clockDomain)
    && strings(value.capabilities)
    && strings(value.limitations)
  )) return false;
  const parserMatchesKind = (
    (value.kind === 'trace' && value.parserId === 'trace')
    || (value.kind === 'har' && value.parserId === 'har@1')
    || (value.kind === 'netlog' && value.parserId === 'chromium-netlog@1')
  );
  return parserMatchesKind
    && (value.capabilities as string[]).every(capability => (
      ['requests', 'redirects', 'network-timing', 'connection-path', 'server-timing']
        .includes(capability)
    ));
}

function responseBase(value: Record<string, unknown>): boolean {
  return base(value) && integer(value.sourceRevision);
}

function confidence(value: unknown): boolean {
  return ['high', 'medium', 'low', 'unavailable'].includes(String(value));
}

function alignment(value: unknown): boolean {
  return record(value)
    && only(value, [
      'alignmentId', 'sourceIds', 'anchorType', 'offsetUs', 'uncertaintyUs',
      'sampleCount', 'conflicts', 'validRange', 'confidence', 'limitations',
    ])
    && text(value.alignmentId)
    && strings(value.sourceIds, 3)
    && ['navigation-start', 'request-id', 'safe-request-key',
      'phase-feature', 'netlog-time-origin'].includes(String(value.anchorType))
    && finite(value.offsetUs)
    && finite(value.uncertaintyUs)
    && value.uncertaintyUs >= 0
    && integer(value.sampleCount)
    && strings(value.conflicts)
    && (value.validRange === undefined || range(value.validRange))
    && confidence(value.confidence)
    && strings(value.limitations);
}

function candidate(value: unknown): boolean {
  return record(value)
    && only(value, [
      'correlationId', 'entityIds', 'confidence', 'score', 'matchedFields',
      'conflictingFields', 'alignmentId', 'uncertaintyUs', 'evidenceIds',
      'limitations', 'allowsDuration', 'allowsDiagnosisUpgrade',
    ])
    && text(value.correlationId)
    && strings(value.entityIds, 3)
    && confidence(value.confidence)
    && finite(value.score) && value.score >= 0 && value.score <= 1
    && strings(value.matchedFields)
    && strings(value.conflictingFields)
    && (value.alignmentId === undefined || text(value.alignmentId))
    && (value.uncertaintyUs === undefined || (finite(value.uncertaintyUs) && value.uncertaintyUs >= 0))
    && strings(value.evidenceIds)
    && strings(value.limitations)
    && typeof value.allowsDuration === 'boolean'
    && typeof value.allowsDiagnosisUpgrade === 'boolean';
}

function measuredTime(value: unknown): boolean {
  return record(value)
    && only(value, ['value', 'unit'])
    && finite(value.value)
    && (value.unit === 'us' || value.unit === 'ms');
}

function measuredDuration(value: unknown): boolean {
  return measuredTime(value)
    && (value as { value: number }).value >= 0;
}

function entity(value: unknown): boolean {
  return record(value)
    && only(value, [
      'entityId', 'sourceId', 'kind', 'label', 'safeKey', 'method',
      'start', 'duration', 'status', 'evidenceIds', 'limitations',
    ])
    && text(value.entityId) && text(value.sourceId) && text(value.label)
    && ['request', 'redirect', 'connection', 'symptom', 'event']
      .includes(String(value.kind))
    && (value.safeKey === undefined || text(value.safeKey))
    && (value.method === undefined || text(value.method, 16))
    && (value.start === undefined || measuredTime(value.start))
    && (value.duration === undefined || measuredDuration(value.duration))
    && (value.status === undefined || text(value.status))
    && strings(value.evidenceIds)
    && strings(value.limitations);
}

function graphNode(value: unknown): boolean {
  return record(value)
    && only(value, [
      'nodeId', 'kind', 'label', 'sourceId', 'entityId', 'confidence',
      'facts', 'timeRange', 'evidenceIds', 'limitations',
    ])
    && text(value.nodeId) && text(value.label)
    && [
      'symptom', 'trace-event', 'trace-range', 'trace-stack', 'har-request',
      'har-timing', 'netlog-request', 'netlog-source', 'netlog-event',
      'alignment', 'correlation-candidate', 'limitation', 'conflict',
    ].includes(String(value.kind))
    && (value.sourceId === undefined || text(value.sourceId))
    && (value.entityId === undefined || text(value.entityId))
    && (value.confidence === undefined || confidence(value.confidence))
    && (value.facts === undefined || strings(value.facts))
    && (value.timeRange === undefined || range(value.timeRange))
    && strings(value.evidenceIds)
    && strings(value.limitations);
}

function graphEdge(value: unknown): boolean {
  return record(value)
    && only(value, [
      'edgeId', 'fromNodeId', 'toNodeId', 'kind', 'label', 'confidence',
      'relationship', 'matchedFields', 'conflictingFields', 'counterEvidence',
      'alternativeExplanations', 'timeRange', 'limitations',
    ])
    && text(value.edgeId) && text(value.fromNodeId) && text(value.toNodeId)
    && text(value.label)
    && [
      'observed-in', 'aligned-by', 'candidate-match', 'supports',
      'contradicts', 'initiates', 'redirects-to', 'connection-path',
    ].includes(String(value.kind))
    && confidence(value.confidence)
    && (
      value.relationship === undefined
      || value.relationship === 'evidence-support'
      || value.relationship === 'candidate-contribution'
    )
    && strings(value.matchedFields)
    && strings(value.conflictingFields)
    && (value.counterEvidence === undefined || strings(value.counterEvidence))
    && (
      value.alternativeExplanations === undefined
      || strings(value.alternativeExplanations)
    )
    && (value.timeRange === undefined || range(value.timeRange))
    && strings(value.limitations);
}

function insight(value: unknown): boolean {
  return record(value)
    && only(value, [
      'insightId', 'priority', 'phenomenon', 'evidenceQuality',
      'attributionLevel', 'candidateReasons', 'limitations',
      'verificationSteps', 'timeRange', 'evidenceNodeIds',
    ])
    && text(value.insightId)
    && positiveInteger(value.priority)
    && text(value.phenomenon)
    && ['high', 'medium', 'low'].includes(String(value.evidenceQuality))
    && ['possible-contributor', 'observation', 'insufficient']
      .includes(String(value.attributionLevel))
    && strings(value.candidateReasons)
    && strings(value.limitations)
    && strings(value.verificationSteps)
    && range(value.timeRange)
    && strings(value.evidenceNodeIds);
}

function truncation(value: unknown, returnedCount: number): boolean {
  return record(value)
    && only(value, ['truncated', 'totalMatched', 'returnedCount'])
    && typeof value.truncated === 'boolean'
    && integer(value.totalMatched)
    && integer(value.returnedCount)
    && value.returnedCount === returnedCount
    && value.totalMatched >= returnedCount;
}

export function isCrossSourceResponse(value: unknown): value is CrossSourceResponse {
  if (!record(value) || !responseBase(value)) return false;
  const common = [
    'type', 'schemaVersion', 'requestId', 'sessionId', 'sessionRevision',
    'sourceRevision',
  ];
  if (value.type === 'sources-result') {
    return only(value, [...common, 'sources'])
      && Array.isArray(value.sources)
      && value.sources.length <= 3
      && value.sources.every(source);
  }
  if (value.type === 'source-change-result') {
    return only(value, [
      ...common, 'operation', 'sources', 'revokedEdgeCount', 'revokedFindingCount',
    ])
      && ['added', 'replaced', 'removed'].includes(String(value.operation))
      && Array.isArray(value.sources) && value.sources.length <= 3
      && value.sources.every(source)
      && integer(value.revokedEdgeCount)
      && integer(value.revokedFindingCount);
  }
  if (value.type === 'alignment-result') {
    return only(value, [...common, 'alignments'])
      && Array.isArray(value.alignments) && value.alignments.length <= 1_000
      && value.alignments.every(alignment);
  }
  if (value.type === 'correlation-result') {
    return only(value, [...common, 'candidates', 'entities', 'truncation'])
      && Array.isArray(value.candidates) && value.candidates.length <= 10_000
      && Array.isArray(value.entities) && value.entities.length <= 10_000
      && value.candidates.every(candidate)
      && value.entities.every(entity)
      && truncation(value.truncation, value.candidates.length);
  }
  if (value.type === 'evidence-graph-result') {
    return only(value, [
      ...common, 'nodes', 'edges', 'limitations', 'truncation',
    ])
      && Array.isArray(value.nodes) && value.nodes.length <= 1_000
      && Array.isArray(value.edges) && value.edges.length <= 1_000
      && value.nodes.every(graphNode)
      && value.edges.every(graphEdge)
      && strings(value.limitations)
      && truncation(value.truncation, value.nodes.length + value.edges.length);
  }
  if (value.type === 'insights-result') {
    return only(value, [
      ...common, 'range', 'insights', 'emptyReason', 'limitations', 'truncation',
    ])
      && range(value.range)
      && Array.isArray(value.insights) && value.insights.length <= 100
      && value.insights.every(insight)
      && (value.emptyReason === undefined || text(value.emptyReason))
      && strings(value.limitations)
      && truncation(value.truncation, value.insights.length);
  }
  return false;
}
