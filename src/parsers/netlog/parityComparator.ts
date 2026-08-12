import { buildEvidenceNavigationTargets } from '../../diagnosis/shared/evidenceNavigation';
import { buildFinalDiagnosisSummary } from '../../diagnosis/shared/finalSummaryBuilder';
import { buildNetlogDiagnosisSummary } from '../../diagnosis/shared/fromNetlog';
import { generateSuggestions } from './diagnosis';
import type {
  AnalysisResult,
  DiagnosisIssue,
  ParsedEvent,
  URLRequest,
} from './parser';
import { hashStableValue, netlogEventIdentity } from './stableFingerprint';

export interface NetlogParityDatasetQuery {
  key: string;
  total: number;
  rows: Array<{
    eventId: number;
    typeId: number;
    sourceId: number;
    sourceTypeId: number;
    phase: number;
    hasError: boolean;
    byteStart: number;
    byteEnd: number;
  }>;
}

export interface NetlogParityDatasetDetail {
  eventId: number;
  byteStart: number;
  byteEnd: number;
  value: unknown;
}

export interface NetlogParityDatasetObservation {
  eventCount: number;
  queries: NetlogParityDatasetQuery[];
  sourceChains: Array<{
    sourceId: number;
    sourceIds: number[];
    eventCount: number;
  }>;
  details: NetlogParityDatasetDetail[];
}

export interface NetlogParityInput {
  result: AnalysisResult;
  events: ParsedEvent[];
  dataset?: NetlogParityDatasetObservation;
}

export interface NetlogParitySignatureOptions {
  allowPreviewDifferences?: boolean;
}

export interface NetlogParityDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

export function hashNetlogParityValue(value: unknown): string {
  return hashStableValue(value);
}

function hashText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return hashNetlogParityValue(String(value));
}

function sortedNumbers(values: readonly number[] | undefined): number[] {
  return [...(values || [])].sort((left, right) => left - right);
}

function sortedStrings(values: readonly string[] | undefined): string[] {
  return [...(values || [])].sort();
}

function numericRecord(value: Record<string, number>): Array<[string, number]> {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function textRecord(value: Record<string, string>): Array<[string, string]> {
  return Object.entries(value)
    .map(([key, text]) => [key, hashNetlogParityValue(text)] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
}

function eventCollection(
  events: ParsedEvent[],
  stat?: { count: number; sequenceFingerprint: string },
): JsonValue {
  return {
    count: stat?.count ?? events.length,
    sequenceHash: stat?.sequenceFingerprint
      ?? hashNetlogParityValue(events.map(netlogEventIdentity)),
  };
}

function timelineSignature(request: URLRequest): JsonValue {
  return Object.fromEntries(
    Object.entries(request.timeline)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([phase, value]) => [
        phase,
        value
          ? {
              start: value.start,
              end: value.end,
              duration: value.duration,
            }
          : null,
      ]),
  ) as JsonValue;
}

function requestSignature(request: URLRequest): JsonValue {
  return {
    id: request.id,
    urlHash: hashNetlogParityValue(request.url),
    method: request.method,
    status: request.status ?? null,
    statusCode: request.statusCode ?? null,
    startTime: request.startTime,
    endTime: request.endTime ?? null,
    duration: request.duration ?? null,
    error: request.error ?? null,
    errorDescHash: hashText(request.errorDesc),
    protocol: request.protocol ?? null,
    resolvedIpHash: hashText(request.resolvedIp),
    remoteIpHash: hashText(request.remoteIp),
    timeline: timelineSignature(request),
    eventCount: request.eventCount ?? request.events.length,
    eventSequenceHash: request.eventSequenceFingerprint
      ?? hashNetlogParityValue(request.events.map(netlogEventIdentity)),
  };
}

function requestSet(requests: URLRequest[]): JsonValue[] {
  return requests
    .map(requestSignature)
    .sort((left, right) => Number(
      (left as { id: number }).id,
    ) - Number((right as { id: number }).id));
}

function issueSignature(issue: DiagnosisIssue): JsonValue {
  return {
    severity: issue.severity,
    category: issue.category,
    messageHash: hashNetlogParityValue(issue.message),
    detailHash: hashNetlogParityValue(issue.detail),
    time: issue.time,
  };
}

function issueSet(issues: DiagnosisIssue[]): JsonValue[] {
  return issues
    .map(issueSignature)
    .sort((left, right) => hashStableValue(left).localeCompare(hashStableValue(right)));
}

function datasetSignature(dataset: NetlogParityDatasetObservation | undefined): JsonValue | null {
  if (!dataset) return null;
  return {
    eventCount: dataset.eventCount,
    queries: [...dataset.queries]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(query => ({
        key: query.key,
        total: query.total,
        rows: query.rows.map(row => ({ ...row })),
      })),
    sourceChains: [...dataset.sourceChains]
      .sort((left, right) => left.sourceId - right.sourceId)
      .map(chain => ({
        sourceId: chain.sourceId,
        sourceIds: sortedNumbers(chain.sourceIds),
        eventCount: chain.eventCount,
      })),
    details: [...dataset.details]
      .sort((left, right) => left.eventId - right.eventId)
      .map(detail => ({
        eventId: detail.eventId,
        byteStart: detail.byteStart,
        byteEnd: detail.byteEnd,
        valueHash: hashNetlogParityValue(detail.value),
      })),
  };
}

function diagnosisSignature(result: AnalysisResult, events: ParsedEvent[]): JsonValue {
  const diagnosis = buildNetlogDiagnosisSummary(result, generateSuggestions(result), events);
  const finalSummary = buildFinalDiagnosisSummary(diagnosis, 'netlog');
  return {
    status: finalSummary.status,
    overallSeverity: diagnosis.overallSeverity,
    cards: finalSummary.expertCards
      .map(card => ({
        semanticId: hashNetlogParityValue({
          category: card.category,
          title: card.title,
          conclusion: card.conclusion,
        }),
        category: card.category,
        severity: card.severity,
        confidence: card.confidence,
        titleHash: hashNetlogParityValue(card.title),
        conclusionHash: hashNetlogParityValue(card.conclusion),
        scope: {
          type: card.scope.type,
          affectedRequestCount: card.scope.affectedRequestCount ?? null,
          affectedDomainCount: card.scope.affectedDomainCount ?? null,
        },
        relatedRequestIds: sortedNumbers(card.relatedRequestIds),
        relatedSourceIds: sortedNumbers(card.relatedSourceIds),
        relatedEventIds: sortedStrings(card.relatedEventIds),
        evidence: card.evidence.map(evidence => ({
          source: evidence.source,
          originalSource: evidence.originalSource ?? null,
          fieldPath: evidence.fieldPath ?? null,
          requestIds: sortedNumbers(evidence.requestIds),
          sourceIds: sortedNumbers(evidence.sourceIds),
          eventIds: sortedStrings(evidence.eventIds),
          byteRanges: [...(evidence.byteRanges || [])]
            .sort((left, right) => left.byteStart - right.byteStart),
          valueHash: hashNetlogParityValue(evidence.value),
        })),
        navigation: buildEvidenceNavigationTargets(card).map(target => ({
          kind: target.kind,
          tab: target.intent.tab,
          requestIds: sortedNumbers(target.intent.highlight?.requestIds),
          sourceIds: sortedNumbers(target.intent.highlight?.sourceIds),
          requestId: target.intent.filters?.requestId ?? null,
          sourceId: target.intent.filters?.sourceId ?? null,
          errorCode: target.intent.filters?.errorCode ?? null,
          keywordHash: hashText(target.intent.filters?.keyword),
          paramFieldHash: hashText(target.intent.filters?.paramField),
        })),
      }))
      .sort((left, right) => left.semanticId.localeCompare(right.semanticId)),
  };
}

export function buildNetlogParitySignature(
  input: NetlogParityInput,
  options: NetlogParitySignatureOptions = {},
): JsonValue {
  const { result, events } = input;
  return {
    counters: {
      totalEvents: result.totalEvents,
      uniqueSources: result.uniqueSources,
      peakConcurrency: result.peakConcurrency,
      timeRange: { ...result.timeRange },
    },
    requests: requestSet(result.urlRequests),
    failedRequests: requestSet(result.urlRequests.filter(request => request.status === 'error')),
    stalledRequests: requestSet(result.stalledRequests),
    slowRequests: requestSet(result.slowRequests),
    connectionFailures: result.connectionFailures
      .map(failure => ({
        requestId: failure.requestId ?? null,
        urlHash: hashNetlogParityValue(failure.url),
        error: failure.error,
        time: failure.time,
      }))
      .sort((left, right) => hashStableValue(left).localeCompare(hashStableValue(right))),
    failedDomains: result.failedDomains
      .map(domain => ({
        domainHash: hashNetlogParityValue(domain.domain),
        count: domain.count,
        errorCodes: sortedNumbers(domain.errorCodes),
        firstTime: domain.firstTime,
        lastTime: domain.lastTime,
        urlHashes: domain.urls.map(hashNetlogParityValue).sort(),
        resolvedIpHash: hashText(domain.resolvedIp),
        remoteIpHash: hashText(domain.remoteIp),
      }))
      .sort((left, right) => left.domainHash.localeCompare(right.domainHash)),
    protocols: numericRecord(result.protocols),
    hosts: textRecord(result.hosts),
    errorSources: numericRecord(result.errorSources),
    dns: {
      servers: result.dnsServers.map(hashNetlogParityValue).sort(),
      records: result.dnsRecords
        .map(record => ({
          hostHash: hashNetlogParityValue(record.host),
          ipHashes: record.ips.map(hashNetlogParityValue).sort(),
          source: record.source,
          time: record.time ?? null,
        }))
        .sort((left, right) => hashStableValue(left).localeCompare(hashStableValue(right))),
      dohCandidates: (result.dohCandidates || [])
        .map(candidate => ({
          valueHash: hashNetlogParityValue(candidate.value),
          source: candidate.source,
        }))
        .sort((left, right) => hashStableValue(left).localeCompare(hashStableValue(right))),
    },
    proxy: {
      hasProxy: result.proxyInfo.hasProxy,
      proxyType: result.proxyInfo.proxyType,
      pacUrlHash: hashText(result.proxyInfo.pacUrl),
      proxyListHashes: result.proxyInfo.proxyList.map(hashNetlogParityValue).sort(),
      proxyFallbackHash: hashText(result.proxyInfo.proxyFallback),
      isVPN: result.proxyInfo.isVPN,
      vpnHintHashes: result.proxyInfo.vpnHints.map(hashNetlogParityValue).sort(),
      settingsHash: hashNetlogParityValue(result.proxyInfo.proxySettings),
      effectiveHash: hashNetlogParityValue(result.proxyInfo.effectiveProxy),
      originalHash: hashNetlogParityValue(result.proxyInfo.originalProxy),
    },
    categories: {
      all: options.allowPreviewDifferences
        ? { count: result.totalEvents }
        : eventCollection(events),
      dns: eventCollection(result.dnsEvents, result.eventCategoryStats?.dns),
      connect: eventCollection(result.connectEvents, result.eventCategoryStats?.connect),
      ssl: eventCollection(result.sslEvents, result.eventCategoryStats?.ssl),
      quic: eventCollection(result.quicEvents, result.eventCategoryStats?.quic),
      http2: eventCollection(result.http2Events, result.eventCategoryStats?.http2),
      cache: eventCollection(result.cacheEvents, result.eventCategoryStats?.cache),
      networkChange: eventCollection(
        result.networkChanges,
        result.eventCategoryStats?.networkChange,
      ),
    },
    sslIssues: result.sslIssues
      .map(issue => ({
        event: netlogEventIdentity(issue.event),
        error: issue.error,
        hostHash: hashNetlogParityValue(issue.host),
        category: issue.category,
      }))
      .sort((left, right) => hashStableValue(left).localeCompare(hashStableValue(right))),
    certIssues: result.certIssues
      .map(issue => ({
        event: netlogEventIdentity(issue.event),
        error: issue.error,
        hostHash: hashNetlogParityValue(issue.host),
        category: issue.category,
      }))
      .sort((left, right) => hashStableValue(left).localeCompare(hashStableValue(right))),
    issues: {
      errors: issueSet(result.errors),
      warnings: issueSet(result.warnings),
      info: issueSet(result.info),
    },
    diagnosis: diagnosisSignature(result, events),
    dataset: datasetSignature(input.dataset),
  };
}

function firstDifference(expected: unknown, actual: unknown, path: string): NetlogParityDifference | null {
  if (Object.is(expected, actual)) return null;
  if (
    expected === null
    || actual === null
    || typeof expected !== 'object'
    || typeof actual !== 'object'
  ) {
    return { path, expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { path, expected, actual };
    }
    if (expected.length !== actual.length) {
      return {
        path: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const expectedRecord = expected as Record<string, unknown>;
  const actualRecord = actual as Record<string, unknown>;
  const keys = Array.from(new Set([
    ...Object.keys(expectedRecord),
    ...Object.keys(actualRecord),
  ])).sort((left, right) => {
    if (path === '$') {
      if (left === 'diagnosis') return 1;
      if (right === 'diagnosis') return -1;
    }
    return left.localeCompare(right);
  });
  for (const key of keys) {
    if (!(key in expectedRecord) || !(key in actualRecord)) {
      return {
        path: `${path}.${key}`,
        expected: expectedRecord[key],
        actual: actualRecord[key],
      };
    }
    const difference = firstDifference(
      expectedRecord[key],
      actualRecord[key],
      `${path}.${key}`,
    );
    if (difference) return difference;
  }
  return null;
}

export function compareNetlogParitySignatures(
  expected: JsonValue,
  actual: JsonValue,
): NetlogParityDifference | null {
  return firstDifference(expected, actual, '$');
}
