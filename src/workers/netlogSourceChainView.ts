import type { CompactEventIndex } from './netlogDatasetIndexer';
import type { NetlogSourceChainNodeView, NetlogSourceChainView } from './netlogDatasetViews';

export function buildNetlogSourceChainView(eventIndex: CompactEventIndex): NetlogSourceChainView {
  const nodes = new Map<number, NetlogSourceChainNodeView>();
  const adjacency = new Map<number, Set<number>>();
  const edgeCount = Math.min(eventIndex.sourceDependencyFrom?.length || 0, eventIndex.sourceDependencyTo?.length || 0);

  for (let i = 0; i < eventIndex.count; i += 1) {
    const sourceId = eventIndex.sourceId[i];
    if (!Number.isFinite(sourceId) || sourceId <= 0) continue;
    const typeName = eventIndex.sourceTypeNames?.[eventIndex.sourceTypeId[i]] || `SOURCE_TYPE_${eventIndex.sourceTypeId[i]}`;
    const existing = nodes.get(sourceId);
    const hasError = eventIndex.flags[i] === 1;
    if (existing) {
      existing.eventCount += 1;
      existing.startTime = Math.min(existing.startTime, eventIndex.time[i]);
      existing.endTime = Math.max(existing.endTime, eventIndex.time[i]);
      if (hasError) {
        existing.hasError = true;
      }
    } else {
      nodes.set(sourceId, {
        id: sourceId,
        type: typeName,
        url: typeName === 'URL_REQUEST' ? `source#${sourceId}` : undefined,
        startTime: eventIndex.time[i],
        endTime: eventIndex.time[i],
        eventCount: 1,
        hasError,
      });
    }
  }

  for (let i = 0; i < edgeCount; i += 1) {
    const from = eventIndex.sourceDependencyFrom?.[i];
    const to = eventIndex.sourceDependencyTo?.[i];
    if (!from || !to || from === to) continue;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from)!.add(to);
  }

  const roots = Array.from(nodes.values())
    .filter(node => node.type === 'URL_REQUEST' && adjacency.has(node.id))
    .sort((a, b) => a.startTime - b.startTime)
    .map(node => node.id);

  const chains = roots.map(rootId => {
    const rootNode = nodes.get(rootId)!;
    const path: NetlogSourceChainNodeView[] = [];
    const queue = [rootId];
    const visited = new Set<number>([rootId]);
    let hasError = false;
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = nodes.get(current);
      if (!node) continue;
      path.push(node);
      if (node.hasError) hasError = true;
      const deps = adjacency.get(current);
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            queue.push(dep);
          }
        }
      }
    }
    return {
      rootId,
      url: rootNode.url || `source#${rootId}`,
      path,
      depth: path.length,
      hasError,
      duration: rootNode.endTime - rootNode.startTime,
    };
  });

  return {
    roots,
    chains,
  };
}
