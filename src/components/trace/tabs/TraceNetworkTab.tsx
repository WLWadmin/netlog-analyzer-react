import type { TraceContextFacts } from '../../../parsers/trace/types';
import { useTraceTargetNavigation } from '../useTraceTargetNavigation';
import { TraceFactItem, TraceNavigationError } from './TraceTabShared';

const RESULT_LABEL = { success: '成功', 'http-error': 'HTTP 错误', 'transport-failed': '传输失败', cancelled: '已取消', 'incomplete-at-trace-end': '录制结束时未完成', 'unknown-failure': '未知结果' } as const;

const TraceNetworkTab: React.FC<{ context: TraceContextFacts }> = ({ context }) => {
  const navigation = useTraceTargetNavigation('network');
  return <section aria-label="网络诊断" data-testid="trace-network-tab">
    <h2>网络事实</h2><TraceNavigationError message={navigation.navigationError} />
    <ul className="trace-fact-items trace-detailed-facts">{(context.requests ?? []).map(item => (
      <TraceFactItem factId={item.id} highlightedDomId={navigation.highlightedDomId} key={item.id}>
        <strong>{RESULT_LABEL[item.result]} · {item.id}</strong>
        <dl className="trace-fact-list">
          <div><dt>请求 ID</dt><dd>{item.requestId}</dd></div>
          <div><dt>结果置信度</dt><dd>{item.resultConfidence}</dd></div>
          <div><dt>Trace 开始</dt><dd>{item.timing.trace.startUs} μs</dd></div>
          {item.timing.trace.durationMs !== undefined && <div><dt>持续时间</dt><dd>{item.timing.trace.durationMs.toFixed(1)} ms</dd></div>}
          {item.method && <div><dt>方法</dt><dd>{item.method}</dd></div>}
          {item.statusCode !== undefined && <div><dt>HTTP 状态</dt><dd>{item.statusCode}</dd></div>}
          {item.protocol && <div><dt>协议</dt><dd>{item.protocol}</dd></div>}
          <div><dt>缓存</dt><dd>{item.fromCache === undefined ? '未知' : item.fromCache ? '命中' : '未命中'}</dd></div>
          {item.dispatch && <div><dt>派发等待 / 主线程重叠</dt><dd>{item.dispatch.dispatchWaitMs.toFixed(1)} / {item.dispatch.mainThreadOverlapMs.toFixed(1)} ms</dd></div>}
          {item.url && <div><dt>URL</dt><dd>{item.url.origin}{item.url.pathname}</dd></div>}
          {item.navigationKey && <div><dt>导航</dt><dd>{item.navigationKey}</dd></div>}
          {item.limitations.length > 0 && <div><dt>限制</dt><dd>{item.limitations.join('；')}</dd></div>}
        </dl>
      </TraceFactItem>
    ))}{!context.requests?.length && <li>未取得请求事实</li>}</ul>
  </section>;
};
export default TraceNetworkTab;
