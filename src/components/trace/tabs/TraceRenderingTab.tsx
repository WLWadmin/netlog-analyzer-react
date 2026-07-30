import type { TraceContextFacts } from '../../../parsers/trace/types';
import { useTraceTargetNavigation } from '../useTraceTargetNavigation';
import { TraceFactItem, TraceNavigationError } from './TraceTabShared';

const TraceRenderingTab: React.FC<{ context: TraceContextFacts }> = ({ context }) => {
  const navigation = useTraceTargetNavigation('rendering');
  return <section aria-label="渲染诊断" data-testid="trace-rendering-tab">
    <h2>渲染事实</h2><TraceNavigationError message={navigation.navigationError} />
    {context.animationFrameSummary && <article className="trace-result-panel"><h3>帧汇总</h3><p>{context.animationFrameSummary.overBudgetCount} / {context.animationFrameSummary.totalCount} 帧超出 16.7 ms 的 60 Hz 参考预算，实际刷新率未知。</p>{context.animationFrameSummary.limitations.length > 0 && <p>限制：{context.animationFrameSummary.limitations.join('；')}</p>}</article>}
    <ul className="trace-fact-items trace-detailed-facts">
      {(context.forcedReflowClues ?? []).map(item => <TraceFactItem factId={item.id} highlightedDomId={navigation.highlightedDomId} key={item.id}><strong>Forced reflow · {item.confidence === 'observation' ? '弱线索' : '明确线索'}</strong><dl className="trace-fact-list"><div><dt>开始时间</dt><dd>{item.startUs} μs</dd></div>{item.taskId && <div><dt>关联任务</dt><dd>{item.taskId}</dd></div>}{item.navigationKey && <div><dt>导航</dt><dd>{item.navigationKey}</dd></div>}</dl></TraceFactItem>)}
      {(context.rendering ?? []).map(item => <TraceFactItem factId={item.id} highlightedDomId={navigation.highlightedDomId} key={item.id}><strong>{item.name} · {item.durationMs.toFixed(1)} ms</strong><dl className="trace-fact-list"><div><dt>进程 / 线程</dt><dd>{item.processId} / {item.threadId}</dd></div><div><dt>开始时间</dt><dd>{item.startUs} μs</dd></div>{item.navigationKey && <div><dt>导航</dt><dd>{item.navigationKey}</dd></div>}</dl></TraceFactItem>)}
      {(context.animationFrames ?? []).map(item => <TraceFactItem factId={item.id} highlightedDomId={navigation.highlightedDomId} key={item.id}><strong>帧 · {item.durationMs.toFixed(1)} ms</strong><dl className="trace-fact-list"><div><dt>进程 / 线程</dt><dd>{item.processId} / {item.threadId}</dd></div><div><dt>预算</dt><dd>{item.budgetMs.toFixed(1)} ms</dd></div><div><dt>状态</dt><dd>{item.dropped ? '丢帧' : item.overBudget ? '超预算' : '预算内'}</dd></div></dl></TraceFactItem>)}
      {!context.forcedReflowClues?.length && !context.rendering?.length && !context.animationFrames?.length && <li>未取得渲染事实</li>}
    </ul>
  </section>;
};
export default TraceRenderingTab;
