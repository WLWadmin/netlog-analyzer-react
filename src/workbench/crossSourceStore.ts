import { parseHar } from '../harParser';
import {
  alignClockDomains,
  type AlignmentAnchor,
} from '../diagnosis/shared/timeAlignment';
import {
  correlateCrossSourceRequests,
  type CrossSourceRequestFact,
} from '../diagnosis/shared/crossSourceCorrelation';
import {
  buildCrossSourceDiagnosisFindings,
  type CrossSourceDiagnosisFinding,
} from '../diagnosis/shared/crossSourceDiagnosis';
import { buildHarRedirectLinks } from '../diagnosis/shared/harRedirectChain';
import { parseLog, type AnalysisResult } from '../parsers/netlog/parser';
import type { TraceRequestFacts } from '../parsers/trace/types';
import type {
  CorrelationCandidate,
  CrossSourceEntity,
  CrossSourceKind,
  EvidenceGraphEdge,
  EvidenceGraphNode,
  SourceDescriptor,
  TimeAlignment,
  WorkbenchInsight,
} from './crossSourceProtocol';
import type { TimelineEvidenceEntity } from './timelineColumnarStore';

interface SourceRecord {
  descriptor: SourceDescriptor;
  facts: CrossSourceRequestFact[];
}

const MAX_CROSS_SOURCE_BYTES = 128 * 1024 * 1024;

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('File read failed')));
    reader.readAsText(file);
  });
}

function traceFacts(
  sourceId: string,
  requests: readonly TraceRequestFacts[],
): CrossSourceRequestFact[] {
  const entityByRequestId = new Map(requests.map((request, index) => (
    [request.id, `trace:request:${index}`]
  )));
  return requests.map((request, index) => ({
    entityId: `trace:request:${index}`,
    sourceId,
    source: 'trace',
    method: request.method,
    origin: request.url?.origin,
    pathname: request.url?.pathname,
    navigationId: request.navigationKey,
    redirectIndex: request.redirectIndex,
    ...(request.redirectPreviousRequestId
      ? { redirectFromEntityId: entityByRequestId.get(request.redirectPreviousRequestId) }
      : {}),
    ...(request.initiatorRequestId
      ? { initiatorFromEntityId: entityByRequestId.get(request.initiatorRequestId) }
      : {}),
    startUs: request.timing.trace.startUs,
    ...(request.timing.trace.endUs === undefined
      ? {}
      : {
          durationUs: Math.max(
            0,
            request.timing.trace.endUs - request.timing.trace.startUs,
          ),
        }),
    deliveryType: request.fromCache ? 'cache' : 'network',
    evidenceIds: [...request.evidenceIds],
    limitations: [...request.limitations],
  }));
}

function safeUrl(url: string): { origin?: string; pathname?: string } {
  try {
    const parsed = new URL(url);
    return { origin: parsed.origin, pathname: parsed.pathname || '/' };
  } catch {
    return {};
  }
}

function sourceLabel(kind: CrossSourceKind): string {
  return kind === 'trace' ? 'Trace 来源' : kind === 'har' ? 'HAR 来源' : 'NetLog 来源';
}

function confidenceLabel(confidence: CorrelationCandidate['confidence']): string {
  return confidence === 'high'
    ? '高置信'
    : confidence === 'medium'
      ? '中置信'
      : confidence === 'low'
        ? '低置信'
        : '不可用';
}

function timeRange(
  startUs: number | undefined,
  durationUs: number | undefined,
): { startUs: number; endUs: number } | undefined {
  return startUs === undefined
    ? undefined
    : { startUs, endUs: startUs + Math.max(0, durationUs ?? 0) };
}

function rangesOverlap(
  left: { startUs: number; endUs: number },
  right: { startUs: number; endUs: number },
): boolean {
  return left.startUs <= right.endUs && left.endUs >= right.startUs;
}

function harFacts(sourceId: string, parsed: ReturnType<typeof parseHar>): CrossSourceRequestFact[] {
  const redirectLinks = buildHarRedirectLinks(parsed.entries);
  const previousByRequestId = new Map(redirectLinks.map(link => (
    [link.toRequestId, link.fromRequestId]
  )));
  const redirectIndex = (requestId: number): number => {
    let index = 0;
    let current = requestId;
    const visited = new Set<number>();
    while (previousByRequestId.has(current) && !visited.has(current)) {
      visited.add(current);
      current = previousByRequestId.get(current)!;
      index += 1;
    }
    return index;
  };
  return parsed.entries.map(entry => {
    const url = safeUrl(entry.url);
    return {
      entityId: `${sourceId}:request:${entry.id}`,
      sourceId,
      source: 'har',
      method: entry.method,
      origin: url.origin,
      pathname: url.pathname,
      queryPresent: entry.queryString.length > 0,
      navigationId: entry.pageRef,
      redirectIndex: redirectIndex(entry.id),
      ...(previousByRequestId.has(entry.id)
        ? { redirectFromEntityId: `${sourceId}:request:${previousByRequestId.get(entry.id)}` }
        : {}),
      ...(Number.isFinite(entry.startMs) && entry.startMs > 0
        ? { startUs: entry.startMs * 1_000 }
        : {}),
      durationUs: Math.max(0, entry.time * 1_000),
      deliveryType: entry.cacheInfo?.fromServiceWorker
        ? 'service-worker'
        : entry.cacheInfo?.fromPrefetchCache
          ? 'preload'
          : entry.cacheInfo?.fromCache
            ? 'cache'
            : 'network',
      evidenceIds: [`${sourceId}:request:${entry.id}`],
      limitations: [],
    };
  });
}

function phaseEvidence(
  sourceId: string,
  requestId: number,
  result: AnalysisResult['urlRequests'][number],
): CrossSourceRequestFact['connectionEvidence'] {
  return {
    ...(result.timeline.dns
      ? { dnsEvidenceIds: [`${sourceId}:request:${requestId}:dns`] }
      : {}),
    ...(result.timeline.connect
      ? { connectEvidenceIds: [`${sourceId}:request:${requestId}:connect`] }
      : {}),
    ...(result.timeline.ssl
      ? { tlsEvidenceIds: [`${sourceId}:request:${requestId}:tls`] }
      : {}),
  };
}

function netlogFacts(sourceId: string, parsed: AnalysisResult): CrossSourceRequestFact[] {
  return parsed.urlRequests.map(request => {
    const url = safeUrl(request.url);
    return {
      entityId: `${sourceId}:request:${request.id}`,
      sourceId,
      source: 'netlog',
      method: request.method,
      origin: url.origin,
      pathname: url.pathname,
      startUs: request.startTime * 1_000,
      ...(request.duration === undefined
        ? {}
        : { durationUs: Math.max(0, request.duration * 1_000) }),
      deliveryType: 'network',
      evidenceIds: [`${sourceId}:request:${request.id}`],
      limitations: [],
      connectionEvidence: phaseEvidence(sourceId, request.id, request),
    };
  });
}

function uniqueAnchorPairs(
  trace: CrossSourceRequestFact[],
  source: CrossSourceRequestFact[],
): AlignmentAnchor[] {
  const key = (fact: CrossSourceRequestFact) => (
    fact.method && fact.origin && fact.pathname
      ? `${fact.method.toUpperCase()} ${fact.origin.toLowerCase()}${fact.pathname}`
      : undefined
  );
  const traceByKey = new Map<string, CrossSourceRequestFact[]>();
  for (const fact of trace) {
    const value = key(fact);
    if (!value) continue;
    traceByKey.set(value, [...(traceByKey.get(value) ?? []), fact]);
  }
  return source.flatMap((fact, index) => {
    const value = key(fact);
    const matches = value ? traceByKey.get(value) ?? [] : [];
    if (matches.length !== 1 || fact.startUs === undefined || matches[0].startUs === undefined) {
      return [];
    }
    return [{
      anchorId: `${fact.source}:${index}`,
      type: fact.localRequestId === matches[0].localRequestId
        ? 'request-id' as const
        : 'safe-request-key' as const,
      sourceTime: { value: fact.startUs, unit: 'us' as const },
      traceTimeUs: matches[0].startUs,
      evidenceIds: [...matches[0].evidenceIds, ...fact.evidenceIds],
    }];
  });
}

export class CrossSourceStore {
  private readonly sources = new Map<string, SourceRecord>();
  private sourceSequence = 0;
  private sourceRevision = 0;
  private alignments: TimeAlignment[] = [];
  private candidates: CorrelationCandidate[] = [];
  private entities: CrossSourceEntity[] = [];
  private nodes: EvidenceGraphNode[] = [];
  private edges: EvidenceGraphEdge[] = [];
  private findings: CrossSourceDiagnosisFinding[] = [];
  private mutationActive = false;

  constructor(
    traceSourceId: string,
    traceRequests: readonly TraceRequestFacts[],
    traceByteLength: number,
    private readonly timelineEntities: readonly TimelineEvidenceEntity[] = [],
  ) {
    this.sources.set(traceSourceId, {
      descriptor: {
        sourceId: traceSourceId,
        kind: 'trace',
        parserId: 'trace',
        label: sourceLabel('trace'),
        state: 'ready',
        byteLength: traceByteLength,
        clockDomain: {
          kind: 'trace-monotonic-us',
          unit: 'us',
          calibrated: true,
        },
        capabilities: ['requests'],
        limitations: [],
      },
      facts: traceFacts(traceSourceId, traceRequests),
    });
  }

  getSourceRevision(): number {
    return this.sourceRevision;
  }

  getSources(): SourceDescriptor[] {
    return [...this.sources.values()]
      .map(record => record.descriptor)
      .sort((left, right) => left.kind.localeCompare(right.kind));
  }

  getAlignments(): TimeAlignment[] {
    return this.alignments;
  }

  getCorrelations(limit: number, entityId?: string) {
    const filtered = entityId
      ? this.candidates.filter(candidate => candidate.entityIds.includes(entityId))
      : this.candidates;
    return {
      candidates: filtered.slice(0, limit),
      entities: this.entities.filter(entity => (
        !entityId || entity.entityId === entityId
        || filtered.some(candidate => candidate.entityIds.includes(entity.entityId))
      )).slice(0, limit),
      totalMatched: filtered.length,
    };
  }

  getEvidenceGraph(
    limit: number,
    selectedEntityId?: string,
    range?: { startUs: number; endUs: number },
  ) {
    const selectedNodeIds = selectedEntityId
      ? this.nodes.filter(node => node.entityId === selectedEntityId).map(node => node.nodeId)
      : [];
    if (selectedEntityId && selectedNodeIds.length === 0) {
      return {
        nodes: [],
        edges: [],
        limitations: ['所选跨源实体当前不可用，可能已随来源移除或替换撤销。'],
        totalMatched: 0,
      };
    }
    const rangeNodeIds = range
      ? this.entities.filter(item => (
          item.entityId.startsWith('trace:')
          && item.start?.unit === 'us'
          && item.start.value <= range.endUs
          && item.start.value + (
            item.duration?.unit === 'us' ? item.duration.value : 0
          ) >= range.startUs
        )).map(item => `node:${item.entityId}`)
      : [];
    const seedNodeIds = selectedNodeIds.length > 0 ? selectedNodeIds : rangeNodeIds;
    const relevantNodeIds = new Set(seedNodeIds);
    const candidateNodeIds = new Set<string>();
    if (seedNodeIds.length > 0) {
      for (const edge of this.edges) {
        if (
          (edge.kind === 'supports' || edge.kind === 'connection-path'
            || edge.kind === 'redirects-to' || edge.kind === 'initiates')
          && (
            relevantNodeIds.has(edge.fromNodeId)
            || relevantNodeIds.has(edge.toNodeId)
          )
        ) {
          relevantNodeIds.add(edge.fromNodeId);
          relevantNodeIds.add(edge.toNodeId);
        }
      }
      for (const edge of this.edges) {
        if (
          edge.kind === 'candidate-match'
          && (
            relevantNodeIds.has(edge.fromNodeId)
            || relevantNodeIds.has(edge.toNodeId)
          )
        ) {
          candidateNodeIds.add(edge.toNodeId);
        }
      }
      for (const edge of this.edges) {
        if (
          edge.kind === 'candidate-match'
          && candidateNodeIds.has(edge.toNodeId)
        ) {
          relevantNodeIds.add(edge.fromNodeId);
          relevantNodeIds.add(edge.toNodeId);
        }
        if (
          edge.kind === 'aligned-by'
          && candidateNodeIds.has(edge.fromNodeId)
        ) {
          relevantNodeIds.add(edge.fromNodeId);
          relevantNodeIds.add(edge.toNodeId);
        }
      }
      for (const edge of this.edges) {
        if (
          (edge.kind === 'connection-path' || edge.kind === 'redirects-to'
            || edge.kind === 'initiates' || edge.kind === 'supports')
          && (
            relevantNodeIds.has(edge.fromNodeId)
            || relevantNodeIds.has(edge.toNodeId)
          )
        ) {
          relevantNodeIds.add(edge.fromNodeId);
          relevantNodeIds.add(edge.toNodeId);
        }
      }
    }
    const nodeBudget = Math.max(1, Math.floor(limit * 0.67));
    if (seedNodeIds.length === 0 && !range) {
      for (const edge of this.edges) {
        const additions = [edge.fromNodeId, edge.toNodeId]
          .filter(nodeId => !relevantNodeIds.has(nodeId));
        if (relevantNodeIds.size + additions.length > nodeBudget) break;
        additions.forEach(nodeId => relevantNodeIds.add(nodeId));
      }
      if (relevantNodeIds.size === 0) {
        this.nodes.slice(0, nodeBudget).forEach(node => relevantNodeIds.add(node.nodeId));
      }
    }
    const relevantEdges = this.edges.filter(edge => (
      relevantNodeIds.has(edge.fromNodeId) && relevantNodeIds.has(edge.toNodeId)
    ));
    const chosenNodeIds = new Set<string>();
    for (const edge of relevantEdges) {
      const additions = [edge.fromNodeId, edge.toNodeId]
        .filter(nodeId => !chosenNodeIds.has(nodeId));
      if (chosenNodeIds.size + additions.length > nodeBudget) continue;
      additions.forEach(nodeId => chosenNodeIds.add(nodeId));
    }
    for (const nodeId of relevantNodeIds) {
      if (chosenNodeIds.size >= nodeBudget) break;
      chosenNodeIds.add(nodeId);
    }
    const matchedNodes = this.nodes.filter(node => relevantNodeIds.has(node.nodeId));
    const nodes = this.nodes.filter(node => chosenNodeIds.has(node.nodeId));
    const nodeIds = new Set(nodes.map(node => node.nodeId));
    const matchedEdges = this.edges.filter(edge => (
      nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)
    ));
    const edges = matchedEdges.slice(0, Math.max(0, limit - nodes.length));
    return {
      nodes: nodes.slice(0, limit),
      edges,
      totalMatched: matchedNodes.length + relevantEdges.length,
      limitations: this.alignments.some(item => item.confidence !== 'high')
        ? ['部分来源时间未达到高置信校准，候选边不参与确定归因。']
        : [],
    };
  }

  getInsights(
    range: { startUs: number; endUs: number },
    limit: number,
  ): {
    insights: WorkbenchInsight[];
    totalMatched: number;
    emptyReason?: string;
    limitations: string[];
  } {
    const contributionsByTarget = new Map<string, EvidenceGraphEdge[]>();
    for (const edge of this.edges) {
      if (edge.relationship !== 'candidate-contribution') continue;
      const edges = contributionsByTarget.get(edge.toNodeId) ?? [];
      edges.push(edge);
      contributionsByTarget.set(edge.toNodeId, edges);
    }
    const ranked: Array<{
      item: TimelineEvidenceEntity;
      evidenceNodeId: string;
      contributionEdges: EvidenceGraphEdge[];
      sortWeight: number;
    }> = [];
    let totalMatched = 0;
    for (const item of this.timelineEntities) {
      if (!rangesOverlap(range, {
        startUs: item.startUs,
        endUs: item.startUs + item.durationUs,
      })) continue;
      totalMatched += 1;
      const evidenceNodeId = `node:${item.entityId}`;
      const contributionEdges = contributionsByTarget.get(evidenceNodeId) ?? [];
      const sortWeight = (
        (item.kind === 'symptom' ? 1_000_000_000 : 0)
        + item.durationUs
        + contributionEdges.length * 100_000_000
      );
      const insertAt = ranked.findIndex(entry => (
        sortWeight > entry.sortWeight
        || (
          sortWeight === entry.sortWeight
          && item.entityId.localeCompare(entry.item.entityId) < 0
        )
      ));
      if (insertAt >= 0) {
        ranked.splice(insertAt, 0, {
          item,
          evidenceNodeId,
          contributionEdges,
          sortWeight,
        });
      } else if (ranked.length < limit) {
        ranked.push({
          item,
          evidenceNodeId,
          contributionEdges,
          sortWeight,
        });
      }
      if (ranked.length > limit) ranked.pop();
    }
    const insights = ranked.map(({
      item,
      evidenceNodeId,
      contributionEdges,
    }, index) => {
        const evidenceQuality = contributionEdges.length > 0
          ? 'high' as const
          : item.evidenceIds.length > 0
            ? 'medium' as const
            : 'low' as const;
        const attributionLevel = contributionEdges.length > 0
          ? 'possible-contributor' as const
          : evidenceQuality === 'low'
            ? 'insufficient' as const
            : 'observation' as const;
        const candidateReasons = contributionEdges.length > 0
          ? contributionEdges.map(edge => edge.label)
          : ['当前仅有 Trace 现象证据，未建立合格的跨源贡献关系。'];
        return {
          insightId: `insight:${item.entityId}`,
          priority: index + 1,
          phenomenon: item.label,
          evidenceQuality,
          attributionLevel,
          candidateReasons,
          limitations: [
            ...item.limitations,
            ...contributionEdges.flatMap(edge => edge.limitations),
          ],
          verificationSteps: contributionEdges.length > 0
            ? [
                '沿证据路径复核请求匹配、校时锚点和连接阶段。',
                '对照不包含该请求或主线程工作量不同的同场景 Trace。',
              ]
            : ['补充同场景 HAR/NetLog 或对照 Trace 后重新验证。'],
          timeRange: {
            startUs: item.startUs,
            endUs: item.startUs + item.durationUs,
          },
          evidenceNodeIds: [
            evidenceNodeId,
            ...contributionEdges.map(edge => edge.fromNodeId),
          ],
        };
      });
    return {
      insights,
      totalMatched,
      ...(totalMatched === 0
        ? {
            emptyReason: this.timelineEntities.length === 0
              ? '当前 Trace 缺少可用于 Insights 的症状、长任务、渲染、帧或交互实体。'
              : '当前选区没有可排序的 Insight，请扩大范围或清除选区。',
          }
        : {}),
      limitations: [
        ...(this.candidates.some(candidate => candidate.confidence !== 'high')
          ? ['中低置信跨源关联仅作为候选展示，不参与原因升级。']
          : []),
      ],
    };
  }

  async addSource(
    kind: 'har' | 'netlog',
    file: File,
    replacedSourceId?: string,
  ): Promise<{
    operation: 'added' | 'replaced';
    revokedEdgeCount: number;
    revokedFindingCount: number;
  }> {
    if (this.mutationActive) throw new Error('A source mutation is already in progress');
    if (file.size > MAX_CROSS_SOURCE_BYTES) {
      throw new Error('Cross-source JSON exceeds the 128 MiB limit');
    }
    const replaced = replacedSourceId
      ? this.sources.get(replacedSourceId)
      : undefined;
    if (replacedSourceId && (!replaced || replaced.descriptor.kind !== kind)) {
      throw new Error('Replacement source does not match the requested source kind');
    }
    if (!replacedSourceId && [...this.sources.values()].some(source => (
      source.descriptor.kind === kind
    ))) {
      throw new Error(`A ${kind} source already exists and requires explicit replacement`);
    }
    this.mutationActive = true;
    try {
      const text = await readFileText(file);
      const json = JSON.parse(text) as unknown;
      const sourceId = `${kind}:${++this.sourceSequence}`;
      let record: SourceRecord;
      if (kind === 'har') {
        const parsed = parseHar(json);
        record = {
          descriptor: {
            sourceId,
            kind,
            parserId: 'har@1',
            label: sourceLabel(kind),
            state: 'ready',
            byteLength: file.size,
            clockDomain: { kind: 'har-epoch-ms', unit: 'ms', calibrated: false },
            capabilities: ['requests', 'redirects', 'network-timing', 'server-timing'],
            limitations: [],
          },
          facts: harFacts(sourceId, parsed),
        };
      } else {
        const parsed = parseLog(json).result;
        const clock = parsed.netlogClockContext;
        const calibrated = clock?.confidence === 'verified'
          && (
            clock.kind === 'epoch'
            || (clock.kind === 'time-tick-offset' && Number.isFinite(clock.originMs))
          );
        record = {
          descriptor: {
            sourceId,
            kind,
            parserId: 'chromium-netlog@1',
            label: sourceLabel(kind),
            state: calibrated ? 'ready' : 'degraded',
            byteLength: file.size,
            clockDomain: {
              kind: clock?.kind === 'epoch'
                ? 'netlog-epoch-ms'
                : clock?.kind === 'time-tick-offset'
                  ? 'netlog-time-tick-ms'
                  : 'unknown',
              unit: 'ms',
              calibrated: false,
            },
            capabilities: ['requests', 'connection-path'],
            limitations: calibrated ? [] : ['NetLog time origin 缺失或未验证。'],
          },
          facts: netlogFacts(sourceId, parsed),
        };
      }
      const revokedEdgeCount = replacedSourceId
        ? this.edges.filter(edge => edge.edgeId.includes(replacedSourceId)).length
        : 0;
      const revokedFindingCount = replacedSourceId
        ? this.findings.filter(finding => (
            finding.entityIds.some(entityId => entityId.startsWith(`${replacedSourceId}:`))
          )).length
        : 0;
      if (replacedSourceId) this.sources.delete(replacedSourceId);
      this.sources.set(sourceId, record);
      this.sourceRevision += 1;
      this.rebuild();
      return {
        operation: replacedSourceId ? 'replaced' : 'added',
        revokedEdgeCount,
        revokedFindingCount,
      };
    } finally {
      this.mutationActive = false;
    }
  }

  removeSource(sourceId: string): { revokedEdgeCount: number; revokedFindingCount: number } {
    if (this.mutationActive) throw new Error('A source mutation is already in progress');
    const revokedEdgeCount = this.edges.filter(edge => edge.edgeId.includes(sourceId)).length;
    const revokedFindingCount = this.findings.filter(finding => (
      finding.entityIds.some(entityId => entityId.startsWith(`${sourceId}:`))
    )).length;
    const removed = this.sources.get(sourceId);
    if (!removed || removed.descriptor.kind === 'trace') {
      throw new Error('Only an existing HAR or NetLog source can be removed');
    }
    removed.facts.length = 0;
    this.sources.delete(sourceId);
    this.sourceRevision += 1;
    this.rebuild();
    return { revokedEdgeCount, revokedFindingCount };
  }

  release(): void {
    for (const source of this.sources.values()) source.facts.length = 0;
    this.sources.clear();
    this.alignments = [];
    this.candidates = [];
    this.entities = [];
    this.nodes = [];
    this.edges = [];
    this.findings = [];
  }

  private rebuild(): void {
    const trace = [...this.sources.values()].find(item => item.descriptor.kind === 'trace');
    if (!trace) return;
    this.alignments = [...this.sources.values()]
      .filter(item => item.descriptor.kind !== 'trace')
      .map(source => {
        const anchors = uniqueAnchorPairs(trace.facts, source.facts);
        const unavailableReason = source.descriptor.kind === 'netlog'
          && source.descriptor.state === 'degraded'
          ? 'NetLog time origin 缺失或未验证。'
          : undefined;
        const alignment = alignClockDomains({
          alignmentId: `alignment:${trace.descriptor.sourceId}:${source.descriptor.sourceId}`,
          sourceIds: [trace.descriptor.sourceId, source.descriptor.sourceId],
          anchors,
          unavailableReason,
        });
        source.descriptor.clockDomain.calibrated = alignment.confidence === 'high'
          || alignment.confidence === 'medium';
        return alignment;
      });
    const facts = [...this.sources.values()].flatMap(source => source.facts);
    const result = correlateCrossSourceRequests({ facts, alignments: this.alignments });
    this.candidates = result.candidates;
    this.entities = result.entities;
    this.findings = buildCrossSourceDiagnosisFindings({
      candidates: result.candidates,
      connectionPaths: result.connectionPaths,
    });
    this.nodes = [
      ...this.entities.map((item): EvidenceGraphNode => ({
        nodeId: `node:${item.entityId}`,
        kind: item.entityId.startsWith('trace:')
          ? 'trace-event'
          : item.entityId.startsWith('har:')
            ? 'har-request'
            : 'netlog-request',
        label: item.label,
        sourceId: item.sourceId,
        entityId: item.entityId,
        facts: [
          ...(item.method ? [`方法：${item.method}`] : []),
          ...(item.safeKey ? [`脱敏请求键：${item.safeKey}`] : []),
        ],
        ...(item.start?.unit === 'us'
          ? {
              timeRange: {
                startUs: item.start.value,
                endUs: item.start.value + (
                  item.duration?.unit === 'us' ? item.duration.value : 0
                ),
              },
            }
          : {}),
        evidenceIds: item.evidenceIds,
        limitations: item.limitations,
      })),
      ...this.timelineEntities.map((item): EvidenceGraphNode => ({
        nodeId: `node:${item.entityId}`,
        kind: item.kind === 'symptom' ? 'symptom' : 'trace-event',
        label: item.label,
        sourceId: trace.descriptor.sourceId,
        entityId: item.entityId,
        facts: [`轨道：${item.trackId}`],
        timeRange: {
          startUs: item.startUs,
          endUs: item.startUs + item.durationUs,
        },
        evidenceIds: item.evidenceIds,
        limitations: item.limitations,
      })),
      ...this.alignments.map((item): EvidenceGraphNode => ({
        nodeId: `node:${item.alignmentId}`,
        kind: 'alignment',
        label: `时间校准 · ${confidenceLabel(item.confidence)}`,
        entityId: item.alignmentId,
        confidence: item.confidence,
        facts: [
          `锚点：${item.anchorType}`,
          `不确定性：${item.uncertaintyUs} μs`,
          `样本数：${item.sampleCount}`,
        ],
        evidenceIds: [],
        limitations: item.limitations,
      })),
      ...this.candidates.map((item): EvidenceGraphNode => ({
        nodeId: `node:${item.correlationId}`,
        kind: item.conflictingFields.length > 0
          ? 'conflict'
          : 'correlation-candidate',
        label: item.confidence === 'high' ? '高置信请求关联' : '候选请求关联',
        entityId: item.correlationId,
        confidence: item.confidence,
        facts: [
          `匹配：${item.matchedFields.join('、') || '无'}`,
          `冲突：${item.conflictingFields.join('、') || '无'}`,
        ],
        evidenceIds: item.evidenceIds,
        limitations: item.limitations,
      })),
      ...this.findings.map((item): EvidenceGraphNode => ({
        nodeId: `node:${item.findingId}`,
        kind: 'symptom',
        label: item.title,
        entityId: item.findingId,
        evidenceIds: item.evidenceIds,
        limitations: item.limitations,
      })),
      ...result.connectionPaths.flatMap(path => path.phases.map(phase => ({
        nodeId: `node:connection:${path.entityId}:${phase.phase}`,
        kind: 'netlog-event' as const,
        label: `NetLog ${phase.phase} 证据`,
        entityId: `connection:${path.entityId}:${phase.phase}`,
        evidenceIds: phase.evidenceIds,
        limitations: [],
      }))),
    ];
    this.edges = this.candidates.flatMap((item): EvidenceGraphEdge[] => {
      const candidateNodeId = `node:${item.correlationId}`;
      const candidateEdges = item.entityIds.map((entityId, index): EvidenceGraphEdge => ({
        edgeId: `edge:${item.correlationId}:${index}`,
        fromNodeId: `node:${entityId}`,
        toNodeId: candidateNodeId,
        kind: 'candidate-match',
        label: item.confidence === 'high' ? '高置信关联' : '候选关联',
        confidence: item.confidence,
        matchedFields: item.matchedFields,
        conflictingFields: item.conflictingFields,
        limitations: item.limitations,
      }));
      const alignmentEdge = item.alignmentId
        ? [{
            edgeId: `edge:${item.correlationId}:alignment`,
            fromNodeId: candidateNodeId,
            toNodeId: `node:${item.alignmentId}`,
            kind: 'aligned-by' as const,
            label: '由时间校准支持',
            confidence: item.confidence,
            matchedFields: ['alignment'],
            conflictingFields: item.conflictingFields,
            limitations: item.limitations,
          }]
        : [];
      return [...candidateEdges, ...alignmentEdge];
    }).concat(this.candidates.flatMap(candidate => {
      if (
        candidate.confidence !== 'high'
        || !candidate.allowsDiagnosisUpgrade
        || candidate.conflictingFields.length > 0
      ) return [];
      const alignment = this.alignments.find(item => (
        item.alignmentId === candidate.alignmentId
      ));
      if (!alignment || alignment.confidence !== 'high') return [];
      const traceEntity = candidate.entityIds
        .map(entityId => this.entities.find(item => item.entityId === entityId))
        .find(entity => entity?.sourceId === trace.descriptor.sourceId);
      const requestRange = traceEntity?.start?.unit === 'us'
        ? timeRange(
            traceEntity.start.value,
            traceEntity.duration?.unit === 'us'
              ? traceEntity.duration.value
              : undefined,
          )
        : undefined;
      if (!requestRange) return [];
      return this.timelineEntities
        .filter(item => rangesOverlap(requestRange, {
          startUs: item.startUs,
          endUs: item.startUs + item.durationUs,
        }))
        .map((item): EvidenceGraphEdge => ({
          edgeId: `edge:contribution:${candidate.correlationId}:${item.entityId}`,
          fromNodeId: `node:${candidate.correlationId}`,
          toNodeId: `node:${item.entityId}`,
          kind: 'supports',
          label: '候选贡献关系',
          confidence: 'high',
          relationship: 'candidate-contribution',
          matchedFields: candidate.matchedFields,
          conflictingFields: [],
          counterEvidence: ['时间重叠不能证明该请求导致了当前症状。'],
          alternativeExplanations: [
            '主线程工作量、渲染活动或其他并发请求也可能贡献耗时。',
          ],
          timeRange: {
            startUs: Math.max(requestRange.startUs, item.startUs),
            endUs: Math.min(requestRange.endUs, item.startUs + item.durationUs),
          },
          limitations: [
            ...candidate.limitations,
            '该边仅表示高质量关联支持下的候选贡献，不是 confirmed 根因。',
          ],
        }));
    })).concat(result.connectionPaths.flatMap(path => path.phases.map(phase => ({
      edgeId: `edge:connection:${path.entityId}:${phase.phase}`,
      fromNodeId: `node:${path.entityId}`,
      toNodeId: `node:connection:${path.entityId}:${phase.phase}`,
      kind: 'connection-path' as const,
      label: 'NetLog 明确连接阶段',
      confidence: 'high' as const,
      relationship: 'evidence-support' as const,
      matchedFields: [phase.phase],
      conflictingFields: [],
      limitations: [],
    })))).concat(facts.flatMap(fact => {
      const edges: EvidenceGraphEdge[] = [];
      if (fact.redirectFromEntityId) {
        edges.push({
          edgeId: `edge:redirect:${fact.redirectFromEntityId}:${fact.entityId}`,
          fromNodeId: `node:${fact.redirectFromEntityId}`,
          toNodeId: `node:${fact.entityId}`,
          kind: 'redirects-to',
          label: '明确重定向',
          confidence: 'high',
          matchedFields: ['redirect-index'],
          conflictingFields: [],
          limitations: [],
        });
      }
      if (fact.initiatorFromEntityId) {
        edges.push({
          edgeId: `edge:initiator:${fact.initiatorFromEntityId}:${fact.entityId}`,
          fromNodeId: `node:${fact.initiatorFromEntityId}`,
          toNodeId: `node:${fact.entityId}`,
          kind: 'initiates',
          label: '明确发起关系',
          confidence: 'high',
          matchedFields: ['initiator'],
          conflictingFields: [],
          limitations: [],
        });
      }
      return edges;
    })).concat(this.findings.flatMap((finding): EvidenceGraphEdge[] => (
      finding.entityIds.map((entityId, index) => ({
        edgeId: `edge:${finding.findingId}:${index}`,
        fromNodeId: `node:${entityId}`,
        toNodeId: `node:${finding.findingId}`,
        kind: 'supports',
        label: '专属连接阶段证据',
        confidence: 'high',
        matchedFields: [finding.phase],
        conflictingFields: [],
        limitations: finding.limitations,
      }))
    )));
  }
}
