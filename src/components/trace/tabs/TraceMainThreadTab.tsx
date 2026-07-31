import type { TraceContextFacts } from '../../../parsers/trace/types';
import { useTraceTargetNavigation } from '../useTraceTargetNavigation';
import { TraceFactItem, TraceNavigationError } from './TraceTabShared';

const TraceMainThreadTab: React.FC<{ context: TraceContextFacts }> = ({ context }) => {
  const navigation = useTraceTargetNavigation('main-thread');
  return <section aria-label="主线程诊断" data-testid="trace-main-thread-tab">
    <h2>主线程事实</h2><TraceNavigationError message={navigation.navigationError} />
    <ul className="trace-fact-items trace-detailed-facts">
      {(context.profiles ?? []).map(item => <TraceFactItem factId={item.id} highlightedDomId={navigation.highlightedDomId} key={item.id}><strong>Profile · {item.id}</strong><dl className="trace-fact-list"><div><dt>进程 / 线程</dt><dd>{item.processId} / {item.threadId}</dd></div><div><dt>Profile ID</dt><dd>{item.profileId}</dd></div><div><dt>时间范围</dt><dd>{item.startUs} - {item.endUs} μs</dd></div><div><dt>节点 / 样本</dt><dd>{item.nodeCount} / {item.sampleCount}</dd></div>{item.limitations.length > 0 && <div><dt>限制</dt><dd>{item.limitations.join('；')}</dd></div>}</dl></TraceFactItem>)}
      {(context.tasks ?? []).map(item => <TraceFactItem factId={item.id} highlightedDomId={navigation.highlightedDomId} key={item.id}><strong>任务 · {item.id}</strong><dl className="trace-fact-list"><div><dt>进程 / 线程</dt><dd>{item.processId} / {item.threadId}</dd></div><div><dt>开始时间</dt><dd>{item.startUs} μs</dd></div><div><dt>持续 / 阻塞贡献</dt><dd>{item.durationMs.toFixed(1)} / {item.blockingContributionMs.toFixed(1)} ms</dd></div><div><dt>自耗时</dt><dd>{item.selfTimeMs.toFixed(1)} ms · {item.selfTimeConfidence}</dd></div>{item.navigationKey && <div><dt>导航</dt><dd>{item.navigationKey}</dd></div>}</dl></TraceFactItem>)}
      {(context.cpuHotspots ?? []).map(item => <TraceFactItem factId={item.id} highlightedDomId={navigation.highlightedDomId} key={item.id}><strong>{item.functionName} · {item.sampleCount} samples</strong><dl className="trace-fact-list"><div><dt>进程 / 线程</dt><dd>{item.processId} / {item.threadId}</dd></div><div><dt>采样时间</dt><dd>{item.sampleTimeMs.toFixed(1)} ms</dd></div><div><dt>Profile / Node</dt><dd>{item.profileId} / {item.nodeId}</dd></div>{item.script && <div><dt>脚本</dt><dd>{item.script.origin}{item.script.pathname}</dd></div>}{(item.lineNumber !== undefined || item.columnNumber !== undefined) && <div><dt>行 / 列</dt><dd>{item.lineNumber ?? '未知'} / {item.columnNumber ?? '未知'}</dd></div>}</dl></TraceFactItem>)}
      {!context.profiles?.length && !context.tasks?.length && !context.cpuHotspots?.length && <li>未取得主线程事实</li>}
    </ul>
  </section>;
};
export default TraceMainThreadTab;
