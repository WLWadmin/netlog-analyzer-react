import {
  useEffect,
  useSyncExternalStore,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';

const CONFIDENCE_LABEL = {
  high: '高置信',
  medium: '中置信候选',
  low: '低置信候选',
  unavailable: '不可用',
} as const;

const CrossSourceEvidenceGraph: React.FC<{
  client: TraceWorkbenchClient;
  store: TimelineInteractionStore;
  onNavigate(entityId: string): void;
  onEscape(): void;
}> = ({ client, store, onNavigate, onEscape }) => {
  const clientSnapshot = useSyncExternalStore(
    client.subscribe.bind(client),
    client.getSnapshot.bind(client),
    client.getSnapshot.bind(client),
  );
  const interaction = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const highlightedGraphEntityId = interaction.highlightedEntityId
    && clientSnapshot.evidenceGraph?.nodes.some(node => (
      node.entityId === interaction.highlightedEntityId
    ))
    ? interaction.highlightedEntityId
    : undefined;

  useEffect(() => {
    void client.queryEvidenceGraph({
      range: interaction.selection ?? interaction.viewport,
      selectedEntityId: highlightedGraphEntityId,
      limit: 300,
    }).catch(() => undefined);
  }, [
    client,
    highlightedGraphEntityId,
    interaction.selection,
    interaction.viewport,
  ]);

  const graph = clientSnapshot.evidenceGraph;
  if (!graph) {
    return <p role="status">正在查询当前范围的跨源证据路径。</p>;
  }
  const selectedNode = highlightedGraphEntityId
    ? graph.nodes.find(node => node.entityId === highlightedGraphEntityId)
    : undefined;
  const selectedEntity = highlightedGraphEntityId
    ? clientSnapshot.correlations?.entities.find(entity => (
      entity.entityId === highlightedGraphEntityId
    ))
    : undefined;
  const selectedCandidate = highlightedGraphEntityId
    ? clientSnapshot.correlations?.candidates.find(candidate => (
      candidate.correlationId === highlightedGraphEntityId
    ))
    : undefined;
  const selectedAlignment = highlightedGraphEntityId
    ? clientSnapshot.alignments?.alignments.find(alignment => (
      alignment.alignmentId === highlightedGraphEntityId
    ))
    : undefined;
  return (
    <section
      className="trace-evidence-graph"
      aria-labelledby="trace-evidence-graph-heading"
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') onEscape();
      }}
    >
      <h4 id="trace-evidence-graph-heading">Cross-source Evidence Graph</h4>
      <p>
        当前返回 {graph.nodes.length} 个节点、{graph.edges.length} 条边。
        中低置信边仅表示候选关联。
      </p>
      <div className="trace-evidence-graph-grid">
        <ul aria-label="证据图节点">
          {graph.nodes.slice(0, 100).map(node => (
            <li key={node.nodeId}>
              <button
                type="button"
                data-evidence-entity-id={node.entityId}
                aria-pressed={interaction.highlightedEntityId === node.entityId}
                onClick={() => {
                  if (node.entityId) onNavigate(node.entityId);
                }}
              >
                {node.label}
                {node.confidence ? ` · ${CONFIDENCE_LABEL[node.confidence]}` : ''}
              </button>
              {node.facts?.map(fact => <span key={fact}>事实：{fact}</span>)}
              {node.timeRange && (
                <span>
                  范围：{(node.timeRange.startUs / 1_000).toFixed(2)}
                  –{(node.timeRange.endUs / 1_000).toFixed(2)} ms
                </span>
              )}
              {node.limitations.map(limitation => (
                <span key={limitation}>限制：{limitation}</span>
              ))}
            </li>
          ))}
        </ul>
        <ol aria-label="等价证据路径">
          {graph.edges.slice(0, 100).map(edge => (
            <li key={edge.edgeId}>
              <strong>{edge.label}</strong>
              {' · '}{CONFIDENCE_LABEL[edge.confidence]}
              {edge.matchedFields.length > 0
                ? ` · 匹配：${edge.matchedFields.join('、')}`
                : ''}
              {edge.conflictingFields.length > 0
                ? ` · 冲突：${edge.conflictingFields.join('、')}`
                : ''}
              {edge.relationship === 'candidate-contribution'
                ? ' · 仅候选贡献，不是已确认根因'
                : ''}
              {edge.counterEvidence?.map(item => (
                <span key={item}>反证：{item}</span>
              ))}
              {edge.alternativeExplanations?.map(item => (
                <span key={item}>替代解释：{item}</span>
              ))}
              {edge.timeRange && (
                <span>
                  定位范围：{(edge.timeRange.startUs / 1_000).toFixed(2)}
                  –{(edge.timeRange.endUs / 1_000).toFixed(2)} ms
                </span>
              )}
              {edge.limitations.map(limitation => (
                <span key={limitation}>限制：{limitation}</span>
              ))}
            </li>
          ))}
        </ol>
      </div>
      {graph.limitations.map(limitation => (
        <p key={limitation}>限制：{limitation}</p>
      ))}
      {selectedNode && (
        <section aria-labelledby="trace-evidence-graph-detail-heading">
          <h5 id="trace-evidence-graph-detail-heading">所选来源事实</h5>
          <p>{selectedNode.label}</p>
          {selectedEntity?.safeKey && <p>脱敏请求键：{selectedEntity.safeKey}</p>}
          {selectedEntity?.method && <p>方法：{selectedEntity.method}</p>}
          {selectedEntity?.start && (
            <p>来源时间：{selectedEntity.start.value} {selectedEntity.start.unit}</p>
          )}
          {selectedEntity?.duration && (
            <p>来源持续：{selectedEntity.duration.value} {selectedEntity.duration.unit}</p>
          )}
          {selectedCandidate && (
            <>
              <p>
                匹配依据：{selectedCandidate.matchedFields.join('、') || '无'}
              </p>
              <p>
                冲突字段：{selectedCandidate.conflictingFields.join('、') || '无'}
              </p>
            </>
          )}
          {selectedAlignment && (
            <p>
              校时：offset {selectedAlignment.offsetUs} us，
              uncertainty {selectedAlignment.uncertaintyUs} us
            </p>
          )}
          {selectedNode.evidenceIds.length > 0 && (
            <p>
              证据引用：{selectedNode.evidenceIds.slice(0, 10).join('、')}
              {selectedNode.evidenceIds.length > 10 ? '（仅显示前 10 条）' : ''}
            </p>
          )}
          {selectedNode.limitations.map(limitation => (
            <p key={limitation}>限制：{limitation}</p>
          ))}
        </section>
      )}
    </section>
  );
};

export default CrossSourceEvidenceGraph;
