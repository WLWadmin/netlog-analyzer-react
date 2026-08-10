import {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { WorkbenchInsight } from '../../../workbench/crossSourceProtocol';
import type { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';

const QUALITY_LABEL: Record<WorkbenchInsight['evidenceQuality'], string> = {
  high: '高质量证据',
  medium: '中等质量证据',
  low: '低质量证据',
};

const DEFAULT_INSIGHT_LIMIT = 5;

const InsightNavigator: React.FC<{
  client: TraceWorkbenchClient;
  store: TimelineInteractionStore;
  onNavigate(insight: WorkbenchInsight): void;
}> = ({ client, store, onNavigate }) => {
  const result = useSyncExternalStore(
    client.subscribe.bind(client),
    () => client.getSnapshot().insights,
    () => client.getSnapshot().insights,
  );
  const insightsError = useSyncExternalStore(
    client.subscribe.bind(client),
    () => client.getSnapshot().queryErrors.insights,
    () => client.getSnapshot().queryErrors.insights,
  );
  const interaction = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [showAll, setShowAll] = useState(false);
  const range = interaction.selection ?? interaction.viewport;
  const visibleInsights = result?.insights.slice(
    0,
    showAll ? result.insights.length : DEFAULT_INSIGHT_LIMIT,
  ) ?? [];

  useEffect(() => {
    setShowAll(false);
    const timer = window.setTimeout(() => {
      void client.queryInsights(range).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [client, range]);

  return (
    <section aria-labelledby="trace-insights-heading">
      <h3 id="trace-insights-heading">Insights 优先级</h3>
      {!result && <p role="status">正在生成当前选区的本地确定性 Insights。</p>}
      {insightsError && (
        <p role="alert">Insights 查询失败；时间轴和已有诊断仍可使用。</p>
      )}
      {result?.emptyReason && <p>{result.emptyReason}</p>}
      {result && result.insights.length > 0 && (
        <ol>
          {visibleInsights.map(insight => (
            <li key={insight.insightId}>
              <button type="button" onClick={() => onNavigate(insight)}>
                <strong>{insight.priority}. {insight.phenomenon}</strong>
                <span>
                  {QUALITY_LABEL[insight.evidenceQuality]}
                  {' · '}{insight.attributionLevel === 'possible-contributor'
                    ? '可能贡献'
                    : insight.attributionLevel === 'observation'
                      ? '观察项'
                      : '证据不足'}
                </span>
              </button>
              <p>原因线索：{insight.candidateReasons.join('；')}</p>
              <p>
                定位范围 {(insight.timeRange.startUs / 1_000).toFixed(2)}
                –{(insight.timeRange.endUs / 1_000).toFixed(2)} ms
              </p>
              <details>
                <summary>查看限制与验证</summary>
                <p>限制：{insight.limitations.join('；')}</p>
                <p>建议验证：{insight.verificationSteps.join('；')}</p>
              </details>
            </li>
          ))}
        </ol>
      )}
      {result && result.insights.length > DEFAULT_INSIGHT_LIMIT && (
        <button
          className="trace-insights-more"
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(value => !value)}
        >
          {showAll
            ? '收起次要 Insights'
            : `查看其余 ${result.insights.length - DEFAULT_INSIGHT_LIMIT} 条 Insights`}
        </button>
      )}
      {result?.truncation.truncated && (
        <p>
          Insights 已截断：返回 {result.truncation.returnedCount} /
          {' '}{result.truncation.totalMatched}。请缩小选区。
        </p>
      )}
      {result?.limitations.map(limitation => (
        <p key={limitation}>限制：{limitation}</p>
      ))}
    </section>
  );
};

export default InsightNavigator;
