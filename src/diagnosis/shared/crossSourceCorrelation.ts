import type {
  CorrelationCandidate,
  CrossSourceEntity,
  TimeAlignment,
} from '../../workbench/crossSourceProtocol';
import { projectAlignedTimeUs } from './timeAlignment';

export interface CrossSourceRequestFact {
  entityId: string;
  sourceId: string;
  source: 'trace' | 'har' | 'netlog';
  localRequestId?: string;
  method?: string;
  origin?: string;
  pathname?: string;
  queryPresent?: boolean;
  navigationId?: string;
  frameId?: string;
  redirectIndex?: number;
  redirectFromEntityId?: string;
  initiatorFromEntityId?: string;
  startUs?: number;
  durationUs?: number;
  deliveryType?: 'network' | 'service-worker' | 'cache' | 'preload';
  evidenceIds: string[];
  limitations: string[];
  connectionEvidence?: {
    dnsEvidenceIds?: string[];
    connectEvidenceIds?: string[];
    tlsEvidenceIds?: string[];
    socketEvidenceIds?: string[];
    proxyEvidenceIds?: string[];
  };
}

export interface ConnectionPath {
  entityId: string;
  phases: Array<{
    phase: 'dns' | 'connect' | 'tls' | 'socket' | 'proxy';
    evidenceIds: string[];
  }>;
}

function requestKey(fact: CrossSourceRequestFact): string | undefined {
  if (!fact.origin || !fact.pathname || !fact.method) return undefined;
  try {
    const origin = new URL(fact.origin).origin.toLowerCase();
    const pathname = fact.pathname.startsWith('/') ? fact.pathname : `/${fact.pathname}`;
    return `${fact.method.toUpperCase()} ${origin}${pathname}`;
  } catch {
    return undefined;
  }
}

function maskPathSegment(segment: string): string {
  if (
    /^\d{6,}$/.test(segment)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)
    || /^[0-9a-f]{16,}$/i.test(segment)
    || /^[A-Za-z0-9_-]{24,}$/.test(segment)
    || segment.includes('@')
  ) return ':id';
  return segment;
}

function projectedSafeKey(fact: CrossSourceRequestFact): string | undefined {
  const key = requestKey(fact);
  if (!key) return undefined;
  const separator = key.indexOf(' ');
  const method = key.slice(0, separator);
  const url = new URL(key.slice(separator + 1));
  const pathname = url.pathname.split('/').map(maskPathSegment).join('/');
  const projected = `${method} ${url.origin}${pathname}`;
  return projected.length <= 512
    ? projected
    : `${method} ${url.origin}/[path-truncated]`;
}

function entity(fact: CrossSourceRequestFact): CrossSourceEntity {
  const safeKey = projectedSafeKey(fact);
  return {
    entityId: fact.entityId,
    sourceId: fact.sourceId,
    kind: fact.redirectIndex && fact.redirectIndex > 0 ? 'redirect' : 'request',
    label: `${fact.source.toUpperCase()} 请求`,
    ...(safeKey ? { safeKey } : {}),
    ...(fact.method ? { method: fact.method.toUpperCase() } : {}),
    ...(fact.startUs === undefined
      ? {}
      : { start: { value: fact.startUs, unit: 'us' as const } }),
    ...(fact.durationUs === undefined
      ? {}
      : { duration: { value: fact.durationUs, unit: 'us' as const } }),
    evidenceIds: [...fact.evidenceIds],
    limitations: [...fact.limitations],
  };
}

function connectionPath(fact: CrossSourceRequestFact): ConnectionPath | undefined {
  if (fact.source !== 'netlog' || !fact.connectionEvidence) return undefined;
  const phases: ConnectionPath['phases'] = [];
  for (const phase of ['dns', 'connect', 'tls', 'socket', 'proxy'] as const) {
    const key = `${phase}EvidenceIds` as keyof NonNullable<
      CrossSourceRequestFact['connectionEvidence']
    >;
    const evidenceIds = fact.connectionEvidence[key];
    if (evidenceIds && evidenceIds.length > 0) phases.push({ phase, evidenceIds });
  }
  return phases.length > 0 ? { entityId: fact.entityId, phases } : undefined;
}

function alignedStartUs(
  fact: CrossSourceRequestFact,
  alignment: TimeAlignment | undefined,
): number | undefined {
  if (fact.startUs === undefined) return undefined;
  if (fact.source === 'trace') return fact.startUs;
  if (!alignment) return undefined;
  return projectAlignedTimeUs(
    { value: fact.startUs, unit: 'us' },
    alignment,
  );
}

export function correlateCrossSourceRequests(input: {
  facts: CrossSourceRequestFact[];
  alignments: TimeAlignment[];
}): {
  candidates: CorrelationCandidate[];
  entities: CrossSourceEntity[];
  connectionPaths: ConnectionPath[];
} {
  const candidates: CorrelationCandidate[] = [];
  for (let leftIndex = 0; leftIndex < input.facts.length; leftIndex += 1) {
    const left = input.facts[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < input.facts.length; rightIndex += 1) {
      const right = input.facts[rightIndex];
      if (left.source === right.source) continue;
      const alignment = input.alignments.find(item => (
        item.sourceIds.includes(left.sourceId)
        && item.sourceIds.includes(right.sourceId)
      ));
      const matchedFields: string[] = [];
      const conflictingFields: string[] = [];
      if (left.localRequestId && left.localRequestId === right.localRequestId) {
        matchedFields.push('request-id');
      }
      const leftKey = requestKey(left);
      const rightKey = requestKey(right);
      if (leftKey && rightKey) {
        if (leftKey === rightKey) matchedFields.push('safe-request-key');
        else conflictingFields.push('safe-request-key');
      }
      if (left.method && right.method) {
        if (left.method.toUpperCase() === right.method.toUpperCase()) {
          matchedFields.push('method');
        } else {
          conflictingFields.push('method');
        }
      }
      if (left.navigationId && right.navigationId) {
        if (left.navigationId === right.navigationId) matchedFields.push('navigation');
        else conflictingFields.push('navigation');
      }
      if (left.frameId && right.frameId) {
        if (left.frameId === right.frameId) matchedFields.push('frame');
        else conflictingFields.push('frame');
      }
      if (
        left.redirectIndex !== undefined
        && right.redirectIndex !== undefined
      ) {
        if (left.redirectIndex === right.redirectIndex) {
          matchedFields.push('redirect-index');
        } else {
          conflictingFields.push('redirect-index');
        }
      }
      if (left.deliveryType && right.deliveryType) {
        if (left.deliveryType === right.deliveryType) matchedFields.push('delivery-type');
        else conflictingFields.push('delivery-type');
      }
      const leftAlignedStartUs = alignedStartUs(left, alignment);
      const rightAlignedStartUs = alignedStartUs(right, alignment);
      const deltaUs = leftAlignedStartUs !== undefined && rightAlignedStartUs !== undefined
        ? Math.abs(leftAlignedStartUs - rightAlignedStartUs)
        : undefined;
      if (
        deltaUs !== undefined
        && alignment
        && alignment.confidence !== 'low'
        && deltaUs <= Math.max(5_000, alignment.uncertaintyUs)
      ) matchedFields.push('time-window');
      if (matchedFields.length === 0) continue;

      const direct = matchedFields.includes('request-id');
      const contextual = matchedFields.includes('safe-request-key')
        && matchedFields.includes('method')
        && (
          matchedFields.includes('navigation')
          || matchedFields.includes('redirect-index')
          || matchedFields.includes('frame')
          || matchedFields.includes('delivery-type')
        )
        && matchedFields.includes('time-window');
      const leftAmbiguousCount = input.facts.filter(fact => (
        fact.sourceId === left.sourceId && requestKey(fact) === leftKey
      )).length;
      const rightAmbiguousCount = input.facts.filter(fact => (
        fact.sourceId === right.sourceId && requestKey(fact) === leftKey
      )).length;
      const ambiguousCount = Math.max(leftAmbiguousCount, rightAmbiguousCount);
      const high = conflictingFields.length === 0
        && ambiguousCount <= 1
        && alignment?.confidence === 'high'
        && matchedFields.includes('time-window')
        && (direct || contextual);
      const confidence = high
        ? 'high'
        : matchedFields.includes('safe-request-key')
          ? 'medium'
          : 'low';
      const score = Math.min(1, (
        matchedFields.length * 0.15
        + (direct ? 0.25 : 0)
        - conflictingFields.length * 0.2
        - (ambiguousCount > 1 ? 0.2 : 0)
      ));
      candidates.push({
        correlationId: `correlation:${left.entityId}:${right.entityId}`,
        entityIds: [left.entityId, right.entityId],
        confidence,
        score: Math.max(0, score),
        matchedFields,
        conflictingFields,
        ...(alignment ? { alignmentId: alignment.alignmentId } : {}),
        ...(deltaUs === undefined ? {} : { uncertaintyUs: deltaUs }),
        evidenceIds: [...left.evidenceIds, ...right.evidenceIds],
        limitations: [
          ...(ambiguousCount > 1 ? ['同一脱敏请求键存在多个并发候选。'] : []),
          ...(alignment?.confidence !== 'high' ? ['时间校准不足以支持确定性关联。'] : []),
          ...(conflictingFields.length > 0 ? ['来源字段存在冲突。'] : []),
        ],
        allowsDuration: high,
        allowsDiagnosisUpgrade: high,
      });
    }
  }
  return {
    candidates: candidates.sort((left, right) => right.score - left.score
      || left.correlationId.localeCompare(right.correlationId)),
    entities: input.facts.map(entity),
    connectionPaths: input.facts.flatMap(fact => {
      const path = connectionPath(fact);
      return path ? [path] : [];
    }),
  };
}
