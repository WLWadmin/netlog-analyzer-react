export type CrossSourceKind = 'trace' | 'har' | 'netlog';
export type SourceState =
  | 'loading'
  | 'ready'
  | 'degraded'
  | 'rejected'
  | 'removing'
  | 'released';
export type SourceCapability =
  | 'requests'
  | 'redirects'
  | 'network-timing'
  | 'connection-path'
  | 'server-timing';
export type CorrelationConfidence = 'high' | 'medium' | 'low' | 'unavailable';

export interface ClockDomain {
  kind: 'trace-monotonic-us' | 'har-epoch-ms' | 'netlog-epoch-ms'
    | 'netlog-time-tick-ms' | 'unknown';
  unit: 'us' | 'ms';
  calibrated: boolean;
}

export interface SourceDescriptor {
  sourceId: string;
  kind: CrossSourceKind;
  parserId: 'trace' | 'har@1' | 'chromium-netlog@1';
  label: string;
  state: SourceState;
  byteLength: number;
  clockDomain: ClockDomain;
  capabilities: SourceCapability[];
  limitations: string[];
}

export interface TimeAlignment {
  alignmentId: string;
  sourceIds: string[];
  anchorType: 'navigation-start' | 'request-id' | 'safe-request-key'
    | 'phase-feature' | 'netlog-time-origin';
  offsetUs: number;
  uncertaintyUs: number;
  sampleCount: number;
  conflicts: string[];
  validRange?: { startUs: number; endUs: number };
  confidence: CorrelationConfidence;
  limitations: string[];
}

export interface CorrelationCandidate {
  correlationId: string;
  entityIds: string[];
  confidence: CorrelationConfidence;
  score: number;
  matchedFields: string[];
  conflictingFields: string[];
  alignmentId?: string;
  uncertaintyUs?: number;
  evidenceIds: string[];
  limitations: string[];
  allowsDuration: boolean;
  allowsDiagnosisUpgrade: boolean;
}

export interface CrossSourceEntity {
  entityId: string;
  sourceId: string;
  kind: 'request' | 'redirect' | 'connection' | 'symptom' | 'event';
  label: string;
  safeKey?: string;
  method?: string;
  start?: { value: number; unit: 'us' | 'ms' };
  duration?: { value: number; unit: 'us' | 'ms' };
  status?: string;
  evidenceIds: string[];
  limitations: string[];
}

export type EvidenceGraphNodeKind =
  | 'symptom'
  | 'trace-event'
  | 'trace-range'
  | 'trace-stack'
  | 'har-request'
  | 'har-timing'
  | 'netlog-request'
  | 'netlog-source'
  | 'netlog-event'
  | 'alignment'
  | 'correlation-candidate'
  | 'limitation'
  | 'conflict';

export type EvidenceGraphEdgeKind =
  | 'observed-in'
  | 'aligned-by'
  | 'candidate-match'
  | 'supports'
  | 'contradicts'
  | 'initiates'
  | 'redirects-to'
  | 'connection-path';

export interface EvidenceGraphNode {
  nodeId: string;
  kind: EvidenceGraphNodeKind;
  label: string;
  sourceId?: string;
  entityId?: string;
  confidence?: CorrelationConfidence;
  evidenceIds: string[];
  limitations: string[];
}

export interface EvidenceGraphEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: EvidenceGraphEdgeKind;
  label: string;
  confidence: CorrelationConfidence;
  matchedFields: string[];
  conflictingFields: string[];
  limitations: string[];
}

interface CrossSourceRequestBase {
  schemaVersion: 1;
  requestId: string;
  sessionId: string;
  sessionRevision: number;
}

export type CrossSourceRequest =
  | (CrossSourceRequestBase & {
    type: 'add-source';
    sourceToken: string;
    expectedKind: 'har' | 'netlog';
  })
  | (CrossSourceRequestBase & {
    type: 'replace-source';
    sourceToken: string;
    expectedKind: 'har' | 'netlog';
    replacedSourceId: string;
  })
  | (CrossSourceRequestBase & {
    type: 'remove-source';
    sourceId: string;
  })
  | (CrossSourceRequestBase & { type: 'query-sources' })
  | (CrossSourceRequestBase & { type: 'query-alignment'; limit: number })
  | (CrossSourceRequestBase & {
    type: 'query-correlation';
    entityId?: string;
    limit: number;
  })
  | (CrossSourceRequestBase & {
    type: 'query-evidence-graph';
    range?: { startUs: number; endUs: number };
    selectedEntityId?: string;
    limit: number;
  });

interface CrossSourceResponseBase {
  schemaVersion: 1;
  requestId: string;
  sessionId: string;
  sessionRevision: number;
  sourceRevision: number;
}

export type CrossSourceResponse =
  | (CrossSourceResponseBase & {
    type: 'sources-result';
    sources: SourceDescriptor[];
  })
  | (CrossSourceResponseBase & {
    type: 'source-change-result';
    operation: 'added' | 'replaced' | 'removed';
    sources: SourceDescriptor[];
    revokedEdgeCount: number;
    revokedFindingCount: number;
  })
  | (CrossSourceResponseBase & {
    type: 'alignment-result';
    alignments: TimeAlignment[];
  })
  | (CrossSourceResponseBase & {
    type: 'correlation-result';
    candidates: CorrelationCandidate[];
    entities: CrossSourceEntity[];
    truncation: { truncated: boolean; totalMatched: number; returnedCount: number };
  })
  | (CrossSourceResponseBase & {
    type: 'evidence-graph-result';
    nodes: EvidenceGraphNode[];
    edges: EvidenceGraphEdge[];
    limitations: string[];
    truncation: { truncated: boolean; totalMatched: number; returnedCount: number };
  });
