/**
 * Source Dependency Graph
 * 从 NetLog 事件中提取 source_dependency 关系，构建有向图
 * 用于展示 URL_REQUEST → HTTP_STREAM → SOCKET 等请求链路
 */

import type { ParsedEvent, URLRequest } from './parser';

/** 图中的节点 */
export interface SourceNode {
  id: number;
  type: string; // source.typeName
  /** 如果是 URL_REQUEST，关联的 URL */
  url?: string;
  /** 该 source 的第一个事件时间 */
  startTime: number;
  /** 该 source 的最后一个事件时间 */
  endTime: number;
  /** 该 source 的事件数 */
  eventCount: number;
  /** 是否有错误 */
  hasError: boolean;
  /** 错误码（如果有） */
  errorCode?: number;
}

/** 图中的边 */
export interface SourceEdge {
  from: number; // source ID（依赖方）
  to: number;   // source ID（被依赖方）
  /** 边的创建时间 */
  time: number;
}

/** 完整的源依赖图 */
export interface SourceGraph {
  nodes: Map<number, SourceNode>;
  edges: SourceEdge[];
  /** 根节点（没有入边的节点） */
  roots: number[];
  /** 以某个 source 为根的完整链路 */
  chains: SourceChain[];
}

/** 一条从 URL_REQUEST 到底层的依赖链 */
export interface SourceChain {
  /** 链路的根 URL_REQUEST sourceId */
  rootId: number;
  /** 关联的 URL */
  url: string;
  /** 链路中的所有节点（按层级排列） */
  path: SourceNode[];
  /** 链路层级深度 */
  depth: number;
  /** 链路是否包含错误 */
  hasError: boolean;
  /** 链路总耗时（root 的 endTime - startTime） */
  duration: number;
}

/**
 * 从事件列表构建 Source Dependency Graph
 */
export function buildSourceGraph(
  events: ParsedEvent[],
  urlRequests: URLRequest[]
): SourceGraph {
  const nodes = new Map<number, SourceNode>();
  const edges: SourceEdge[] = [];
  // 邻接表：from → [to]（from 依赖 to）
  const adjacency = new Map<number, Set<number>>();
  // 反向邻接表：to → [from]（被 from 依赖）
  const reverseAdj = new Map<number, Set<number>>();

  // URL_REQUEST sourceId → URL 映射
  const requestUrlMap = new Map<number, string>();
  for (const req of urlRequests) {
    requestUrlMap.set(req.id, req.url);
  }

  // Pass 1: 收集所有节点信息
  for (const evt of events) {
    const sid = evt.source.id;
    const existing = nodes.get(sid);
    const hasError = evt.params?.net_error !== undefined && evt.params?.net_error !== 0;

    if (existing) {
      existing.eventCount++;
      if (evt.time < existing.startTime) existing.startTime = evt.time;
      if (evt.time > existing.endTime) existing.endTime = evt.time;
      if (hasError) {
        existing.hasError = true;
        existing.errorCode = existing.errorCode || evt.params?.net_error;
      }
    } else {
      nodes.set(sid, {
        id: sid,
        type: evt.source.typeName,
        url: requestUrlMap.get(sid),
        startTime: evt.time,
        endTime: evt.time,
        eventCount: 1,
        hasError,
        errorCode: hasError ? evt.params?.net_error : undefined,
      });
    }

    // Pass 2: 提取依赖边
    const dep = evt.params?.source_dependency;
    const depId = Number(dep?.id);
    if (Number.isFinite(depId) && depId > 0 && depId !== sid) {
      edges.push({ from: sid, to: depId, time: evt.time });

      if (!adjacency.has(sid)) adjacency.set(sid, new Set());
      adjacency.get(sid)!.add(depId);

      if (!reverseAdj.has(depId)) reverseAdj.set(depId, new Set());
      reverseAdj.get(depId)!.add(sid);
    }
  }

  // 找出根节点（URL_REQUEST 类型且有出边的）
  const roots: number[] = [];
  for (const [id, node] of nodes) {
    if (node.type === 'URL_REQUEST' && adjacency.has(id)) {
      roots.push(id);
    }
  }
  roots.sort((a, b) => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    return na.startTime - nb.startTime;
  });

  // 构建链路
  const chains: SourceChain[] = [];
  for (const rootId of roots) {
    const rootNode = nodes.get(rootId);
    if (!rootNode) continue;

    const url = rootNode.url || `source#${rootId}`;
    const path: SourceNode[] = [];
    const visited = new Set<number>();
    let hasError = false;

    // BFS 从根到叶
    const queue = [rootId];
    visited.add(rootId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentNode = nodes.get(current);
      if (currentNode) {
        path.push(currentNode);
        if (currentNode.hasError) hasError = true;
      }

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

    chains.push({
      rootId,
      url,
      path,
      depth: path.length,
      hasError,
      duration: rootNode.endTime - rootNode.startTime,
    });
  }

  return { nodes, edges, roots, chains };
}
