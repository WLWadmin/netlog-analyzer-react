import type { ParsedEvent, URLRequest } from './parser';
import { buildSourceGraph, type SourceGraph } from './sourceGraph';
import { buildEventsBySourceId } from './requestLifecycle';

const sourceGraphCache = new WeakMap<
  ParsedEvent[],
  { urlRequests: URLRequest[]; graph: SourceGraph }
>();

const eventsBySourceIdCache = new WeakMap<ParsedEvent[], Map<number, ParsedEvent[]>>();

export function getCachedSourceGraph(events: ParsedEvent[], urlRequests: URLRequest[]): SourceGraph {
  const cached = sourceGraphCache.get(events);
  if (cached && cached.urlRequests === urlRequests) {
    return cached.graph;
  }

  const graph = buildSourceGraph(events, urlRequests);
  sourceGraphCache.set(events, { urlRequests, graph });
  return graph;
}

export function getCachedEventsBySourceId(events: ParsedEvent[]): Map<number, ParsedEvent[]> {
  const cached = eventsBySourceIdCache.get(events);
  if (cached) return cached;

  const map = buildEventsBySourceId(events);
  eventsBySourceIdCache.set(events, map);
  return map;
}
