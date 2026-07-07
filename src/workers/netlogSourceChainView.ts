import type { CompactEventIndex } from './netlogDatasetIndexer';
import { queryNetlogEvents } from './netlogDatasetQuery';
import type { NetlogSourceChainDetailView, NetlogSourceChainEdgeView, NetlogSourceChainNodeView, NetlogSourceChainView } from './netlogDatasetViews';

function buildSourceGraph(eventIndex: CompactEventIndex) {
  const nodes = new Map<number, NetlogSourceChainNodeView>();
  const adjacency = new Map<number, Set<number>>();
  const edges: NetlogSourceChainEdgeView[] = [];
  const edgeCount = Math.min(eventIndex.sourceDependencyFrom?.length || 0, eventIndex.sourceDependencyTo?.length || 0);

  for (let i = 0; i < eventIndex.count; i += 1) {
    const sourceId = eventIndex.sourceId[i];
    if (!Number.isFinite(sourceId) || sourceId <= 0) continue;
    const typeName = eventIndex.sourceTypeNames?.[eventIndex.sourceTypeId[i]] || `SOURCE_TYPE_${eventIndex.sourceTypeId[i]}`;
    const existing = nodes.get(sourceId);
    const hasError = eventIndex.flags[i] === 1;
    const errorCode = eventIndex.sourceErrorCodes?.[sourceId];
    if (existing) {
      existing.eventCount += 1;
      existing.startTime = Math.min(existing.startTime, eventIndex.time[i]);
      existing.endTime = Math.max(existing.endTime, eventIndex.time[i]);
      existing.lastEventId = eventIndex.sourceLastEventId?.[sourceId] ?? i;
      existing.url = existing.url || eventIndex.sourceUrls?.[sourceId];
      existing.host = existing.host || eventIndex.sourceHosts?.[sourceId];
      if (errorCode !== undefined) existing.errorCode = errorCode;
      if (hasError) {
        existing.hasError = true;
      }
    } else {
      const url = eventIndex.sourceUrls?.[sourceId];
      const evidenceGaps: string[] = [];
      if (typeName === 'URL_REQUEST' && !url) {
        evidenceGaps.push('该 URL_REQUEST source 未在 compact index 中发现请求 URL。');
      }
      nodes.set(sourceId, {
        id: sourceId,
        type: typeName,
        url,
        host: eventIndex.sourceHosts?.[sourceId],
        startTime: eventIndex.time[i],
        endTime: eventIndex.time[i],
        firstEventId: eventIndex.sourceFirstEventId?.[sourceId] ?? i,
        lastEventId: eventIndex.sourceLastEventId?.[sourceId] ?? i,
        eventCount: 1,
        hasError,
        errorCode,
        evidenceGaps,
      });
    }
  }

  for (let i = 0; i < edgeCount; i += 1) {
    const from = eventIndex.sourceDependencyFrom?.[i];
    const to = eventIndex.sourceDependencyTo?.[i];
    if (!from || !to || from === to) continue;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
    const fromNode = nodes.get(from);
    const toNode = nodes.get(to);
    const sampleEventId = eventIndex.sourceDependencyEventId?.[i];
    edges.push({
      fromSourceId: from,
      toSourceId: to,
      fromType: fromNode?.type || 'UNKNOWN_SRC',
      toType: toNode?.type || 'UNKNOWN_SRC',
      sampleEventId,
      byteStart: sampleEventId !== undefined ? eventIndex.byteStart[sampleEventId] : undefined,
      byteEnd: sampleEventId !== undefined ? eventIndex.byteEnd[sampleEventId] : undefined,
    });
  }

  return { nodes, adjacency, edges };
}

function traverseSourceIds(sourceId: number, adjacency: Map<number, Set<number>>): number[] {
  const queue = [sourceId];
  const visited = new Set<number>([sourceId]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const deps = adjacency.get(current);
    if (!deps) continue;
    for (const dep of deps) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }
  return queue;
}

export function buildNetlogSourceChainView(eventIndex: CompactEventIndex): NetlogSourceChainView {
  const { nodes, adjacency } = buildSourceGraph(eventIndex);

  const roots = Array.from(nodes.values())
    .filter(node => node.type === 'URL_REQUEST')
    .sort((a, b) => a.startTime - b.startTime)
    .map(node => node.id);

  const chains = roots.map(rootId => {
    const rootNode = nodes.get(rootId)!;
    const path: NetlogSourceChainNodeView[] = traverseSourceIds(rootId, adjacency)
      .map(id => nodes.get(id))
      .filter((node): node is NetlogSourceChainNodeView => Boolean(node));
    let hasError = false;
    for (const node of path) {
      if (node.hasError) hasError = true;
    }
    const evidenceGaps = [
      ...(rootNode.evidenceGaps || []),
    ];
    if (!adjacency.has(rootId)) {
      evidenceGaps.push('该 URL_REQUEST 没有 source_dependency 边；只能展示孤立 source，不能确认底层 socket/DNS/stream 链路。');
    }
    return {
      rootId,
      url: rootNode.url || `source#${rootId}`,
      host: rootNode.host,
      path,
      depth: path.length,
      hasError,
      duration: rootNode.endTime - rootNode.startTime,
      evidenceGaps,
    };
  });

  return {
    roots,
    chains,
    evidenceGaps: roots.length === 0
      ? ['Dataset 中没有可作为 Source Chain root 的 URL_REQUEST source。']
      : [],
  };
}

export function buildNetlogSourceChainDetailView(
  analysisId: string,
  eventIndex: CompactEventIndex,
  sourceId: number,
  page = 1,
  pageSize = 100
): NetlogSourceChainDetailView {
  const { nodes, adjacency, edges } = buildSourceGraph(eventIndex);
  const targetNode = nodes.get(sourceId);
  if (!targetNode) {
    return {
      sourceId,
      nodes: [],
      edges: [],
      events: queryNetlogEvents(eventIndex, { analysisId, sourceChainId: sourceId, page, pageSize }),
      evidenceGaps: [`source#${sourceId} 不存在于 Dataset compact index。`],
    };
  }

  const sourceIds = new Set(traverseSourceIds(sourceId, adjacency));
  const chainNodes = Array.from(sourceIds)
    .map(id => nodes.get(id))
    .filter((node): node is NetlogSourceChainNodeView => Boolean(node))
    .sort((a, b) => a.startTime - b.startTime);
  const chainEdges = edges.filter(edge => sourceIds.has(edge.fromSourceId) && sourceIds.has(edge.toSourceId));
  const evidenceGaps = [...(targetNode.evidenceGaps || [])];
  if (!adjacency.has(sourceId)) {
    evidenceGaps.push(`source#${sourceId} 没有 source_dependency 边；只能展示该 source 自身事件。`);
  }
  if (!chainEdges.length) {
    evidenceGaps.push('该 source chain 没有可展示的 dependency edge。');
  }

  return {
    sourceId,
    nodes: chainNodes,
    edges: chainEdges,
    events: queryNetlogEvents(eventIndex, { analysisId, sourceChainId: sourceId, page, pageSize }),
    evidenceGaps,
  };
}
