import type { TraceContextFacts } from '../../../parsers/trace/types';
import { useTraceTargetNavigation } from '../useTraceTargetNavigation';
import { TraceFactItem, TraceNavigationError } from './TraceTabShared';

const TraceInteractionsTab: React.FC<{ context: TraceContextFacts }> = ({ context }) => {
  const navigation = useTraceTargetNavigation('interactions');
  return <section aria-label="交互诊断" data-testid="trace-interactions-tab">
    <h2>交互事实</h2><TraceNavigationError message={navigation.navigationError} />
    <p className="trace-result-note">Trace 内的最慢交互仅为 INP 候选，不代表线上 INP 或真实用户分布。</p>
    {context.interactionSummary && <article className="trace-result-panel"><h3>交互汇总</h3><dl className="trace-fact-list"><div><dt>汇总完整性</dt><dd>{context.interactionSummary.completeness}</dd></div><div><dt>交互数量</dt><dd>{context.interactionSummary.totalCount}</dd></div>{context.interactionSummary.slowestInteractionId && <div><dt>最慢交互</dt><dd>{context.interactionSummary.slowestInteractionId}</dd></div>}{context.interactionSummary.maxTotalLatencyMs !== undefined && <div><dt>最大总延迟</dt><dd>{context.interactionSummary.maxTotalLatencyMs.toFixed(1)} ms</dd></div>}{context.interactionSummary.limitations.length > 0 && <div><dt>限制</dt><dd>{context.interactionSummary.limitations.join('；')}</dd></div>}</dl></article>}
    <ul className="trace-fact-items trace-detailed-facts">{(context.interactions ?? []).map(item => (
      <TraceFactItem factId={item.id} highlightedDomId={navigation.highlightedDomId} key={item.id}><strong>交互 {item.interactionId} · {item.totalLatencyMs.toFixed(1)} ms</strong><dl className="trace-fact-list"><div><dt>开始时间</dt><dd>{item.startUs} μs</dd></div><div><dt>输入 / 处理 / 呈现</dt><dd>{item.inputDelayMs.toFixed(1)} / {item.processingDurationMs.toFixed(1)} / {item.presentationDelayMs.toFixed(1)} ms</dd></div><div><dt>关联任务</dt><dd>{item.taskIds.join(', ') || '无'}</dd></div><div><dt>渲染事件 / 帧</dt><dd>{item.renderingEventIds.join(', ') || '无'} / {item.frameIds.join(', ') || '无'}</dd></div>{item.navigationKey && <div><dt>导航</dt><dd>{item.navigationKey}</dd></div>}</dl></TraceFactItem>
    ))}{!context.interactions?.length && <li>未取得已配对交互</li>}</ul>
  </section>;
};
export default TraceInteractionsTab;
