import { useMemo, useState } from 'react';
import type { TraceContextFacts, TraceRequestFacts } from '../../../parsers/trace/types';
import {
  buildNetworkFactsViewModel,
  TRACE_EXPERT_PAGE_SIZE,
} from '../traceFactsViewModel';
import { useTraceTargetNavigation } from '../useTraceTargetNavigation';
import {
  TraceExpertDisclosure,
  TraceFactsSectionHeading,
  TraceFactTableRow,
  TraceNavigationError,
  TraceSummaryGrid,
  usePinnedTraceFactId,
} from './TraceTabShared';

const RESULT_LABEL: Record<TraceRequestFacts['result'], string> = {
  success: '成功',
  'http-error': 'HTTP 错误',
  'transport-failed': '传输失败',
  cancelled: '已取消',
  'incomplete-at-trace-end': '录制结束时未完成',
  'unknown-failure': '未知结果',
};

const CONFIDENCE_LABEL: Record<TraceRequestFacts['resultConfidence'], string> = {
  high: '较强',
  medium: '中等',
  observation: '现象',
};

function requestUrl(item: TraceRequestFacts): string {
  return item.url ? `${item.url.origin}${item.url.pathname}` : '未记录';
}

const RequestRow: React.FC<{
  item: TraceRequestFacts;
  highlightedDomId?: string;
  testId?: string;
}> = ({ item, highlightedDomId, testId }) => (
  <TraceFactTableRow
    factId={item.id}
    highlightedDomId={highlightedDomId}
    testId={testId}
  >
    <td><strong>{RESULT_LABEL[item.result]} · {item.id}</strong></td>
    <td>{item.method ?? '未知'}</td>
    <td className="trace-table-url" title={requestUrl(item)}>{requestUrl(item)}</td>
    <td>{item.timing.trace.durationMs === undefined ? '不可用' : `${item.timing.trace.durationMs.toFixed(1)} ms`}</td>
    <td>{CONFIDENCE_LABEL[item.resultConfidence]}</td>
  </TraceFactTableRow>
);

const ExpertRequestRow: React.FC<{
  item: TraceRequestFacts;
  highlightedDomId?: string;
  duplicatePriority?: boolean;
}> = ({ item, highlightedDomId, duplicatePriority }) => {
  const cells = <>
    <td>
      <strong>{RESULT_LABEL[item.result]} · {item.method ?? '方法未知'}</strong>
      <small>{item.id} · 请求 ID {item.requestId} · 证据{CONFIDENCE_LABEL[item.resultConfidence]}</small>
    </td>
    <td className="trace-table-url" title={requestUrl(item)}>
      {requestUrl(item)}
      {item.navigationKey ? <small>导航 {item.navigationKey}</small> : null}
    </td>
    <td>
      {item.timing.trace.startUs} μs
      <small>{item.timing.trace.durationMs === undefined ? '时长不可用' : `${item.timing.trace.durationMs.toFixed(1)} ms`}</small>
    </td>
    <td>
      {item.statusCode ?? '无 HTTP 状态'} / {item.protocol ?? '协议未知'}
      <small>缓存：{item.fromCache === undefined ? '未知' : item.fromCache ? '命中' : '未命中'}</small>
    </td>
    <td>
      {item.dispatch ? `派发 / 重叠 ${item.dispatch.dispatchWaitMs.toFixed(1)} / ${item.dispatch.mainThreadOverlapMs.toFixed(1)} ms` : '派发信息不可用'}
      <small>{item.limitations.join('；') || '无额外限制'}</small>
    </td>
  </>;
  return duplicatePriority
    ? <tr data-testid="trace-network-expert-row">{cells}</tr>
    : <TraceFactTableRow factId={item.id} highlightedDomId={highlightedDomId} testId="trace-network-expert-row">{cells}</TraceFactTableRow>;
};

const TraceNetworkTab: React.FC<{ context: TraceContextFacts }> = ({ context }) => {
  const pinnedFactId = usePinnedTraceFactId('network');
  const model = useMemo(
    () => buildNetworkFactsViewModel(context, pinnedFactId),
    [context, pinnedFactId],
  );
  const navigation = useTraceTargetNavigation('network');
  const [visibleLimit, setVisibleLimit] = useState(TRACE_EXPERT_PAGE_SIZE);
  const priorityIds = useMemo(
    () => new Set(model.priority.map(item => item.id)),
    [model.priority],
  );

  return (
    <section aria-label="网络诊断" className="trace-facts-tab" data-testid="trace-network-tab">
      <TraceFactsSectionHeading
        description="Trace 只能确认请求结果、录制内耗时与主线程派发重叠候选，不能据此确定 DNS、TCP、TLS、代理或服务端根因。"
        eyebrow="NETWORK FACTS"
        title="网络请求"
      />
      <TraceNavigationError message={navigation.navigationError} />

      <section aria-labelledby="trace-network-summary">
        <h3 id="trace-network-summary">结论摘要</h3>
        <TraceSummaryGrid items={[
          { label: '已返回请求', value: String(model.counts.total) },
          { label: '异常结果', value: String(model.failureCount), tone: model.failureCount > 0 ? 'critical' : 'neutral' },
          { label: '成功', value: String(model.counts.success) },
          { label: '主线程重叠候选', value: String(model.dispatchOverlapCount), tone: model.dispatchOverlapCount > 0 ? 'caution' : 'neutral' },
          { label: '最长请求', value: model.slowestRequest?.timing.trace.durationMs === undefined ? '不可用' : `${model.slowestRequest.timing.trace.durationMs.toFixed(1)} ms` },
        ]} />
        <p className="trace-facts-impact">
          {model.failureCount > 0
            ? `${model.failureCount} 个请求未成功完成，优先复核传输失败、HTTP 错误和取消项。`
            : '当前返回事实中未见失败结果；普通成功请求已折叠到专家区。'}
        </p>
        <p className="trace-facts-breakdown">
          结果分布：成功 {model.counts.success} · HTTP 错误 {model.counts.httpError}
          {' '}· 传输失败 {model.counts.transportFailed} · 取消 {model.counts.cancelled}
          {' '}· 录制结束未完成 {model.counts.incomplete} · 未知 {model.counts.unknownFailure}
        </p>
        {model.limitationMessages.map(message => (
          <p className="trace-facts-limitation" key={message}>{message}</p>
        ))}
      </section>

      <section aria-labelledby="trace-network-priority">
        <h3 id="trace-network-priority">优先检查</h3>
        <p className="trace-result-note">最多显示 5 条异常、耗时最长或派发重叠候选。</p>
        {model.priority.length > 0 ? (
          <div className="trace-compact-table-wrap">
            <table className="trace-compact-table">
              <thead><tr><th>结果</th><th>方法</th><th>脱敏 URL</th><th>时长</th><th>证据强度</th></tr></thead>
              <tbody>{model.priority.map(item => (
                <RequestRow
                  highlightedDomId={navigation.highlightedDomId}
                  item={item}
                  key={item.id}
                  testId="trace-network-priority-row"
                />
              ))}</tbody>
            </table>
          </div>
        ) : <p className="trace-result-note">未取得请求事实。</p>}
      </section>

      <TraceExpertDisclosure label="全部网络事实">
        <p className="trace-result-note">以下按原始事实顺序分页显示全部已返回请求；优先项会重复出现以补充复核字段。</p>
        {model.all.length > 0 ? (
          <div className="trace-compact-table-wrap">
            <table className="trace-compact-table">
              <thead><tr><th>结果 / 方法</th><th>脱敏 URL / 导航</th><th>Trace 开始 / 时长</th><th>状态 / 协议 / 缓存</th><th>派发 / 限制</th></tr></thead>
              <tbody>{model.all.slice(0, visibleLimit).map(item => (
                <ExpertRequestRow
                  duplicatePriority={priorityIds.has(item.id)}
                  highlightedDomId={navigation.highlightedDomId}
                  item={item}
                  key={item.id}
                />
              ))}</tbody>
            </table>
          </div>
        ) : <p className="trace-result-note">没有其他请求事实。</p>}
        {visibleLimit < model.all.length ? (
          <button
            className="trace-load-more"
            onClick={() => setVisibleLimit(limit => Math.min(limit + TRACE_EXPERT_PAGE_SIZE, model.all.length))}
            type="button"
          >
            继续显示 {Math.min(TRACE_EXPERT_PAGE_SIZE, model.all.length - visibleLimit)} 条
          </button>
        ) : null}
      </TraceExpertDisclosure>
    </section>
  );
};

export default TraceNetworkTab;
