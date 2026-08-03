import { useMemo, useState } from 'react';
import type {
  TraceAnimationFrameFacts,
  TraceContextFacts,
  TraceForcedReflowClue,
  TraceRenderingEventFacts,
} from '../../../parsers/trace/types';
import {
  buildRenderingFactsViewModel,
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

const FrameRow: React.FC<{
  item: TraceAnimationFrameFacts;
  highlightedDomId?: string;
  testId?: string;
}> = ({ item, highlightedDomId, testId }) => (
  <TraceFactTableRow factId={item.id} highlightedDomId={highlightedDomId} testId={testId}>
    <td><strong>{item.dropped ? '丢帧' : item.overBudget ? '超预算帧' : '预算内帧'} · {item.id}</strong></td>
    <td>{item.durationMs.toFixed(1)} ms</td>
    <td>{item.budgetMs.toFixed(1)} ms</td>
    <td>{item.startUs} μs</td>
    <td>
      {item.processId} / {item.threadId}
      {item.navigationKey ? <small>导航 {item.navigationKey}</small> : null}
    </td>
  </TraceFactTableRow>
);

const RenderingEventRow: React.FC<{
  item: TraceRenderingEventFacts;
  highlightedDomId?: string;
  testId?: string;
}> = ({ item, highlightedDomId, testId }) => (
  <TraceFactTableRow factId={item.id} highlightedDomId={highlightedDomId} testId={testId}>
    <td><strong>{item.name} · {item.id}</strong></td>
    <td>{item.durationMs.toFixed(1)} ms</td>
    <td>渲染事件</td>
    <td>{item.startUs} μs</td>
    <td>
      {item.processId} / {item.threadId}
      {item.navigationKey ? <small>导航 {item.navigationKey}</small> : null}
    </td>
  </TraceFactTableRow>
);

const ReflowRow: React.FC<{
  item: TraceForcedReflowClue;
  highlightedDomId?: string;
  testId?: string;
}> = ({ item, highlightedDomId, testId }) => (
  <TraceFactTableRow factId={item.id} highlightedDomId={highlightedDomId} testId={testId}>
    <td><strong>Forced reflow · {item.id}</strong></td>
    <td>不可用</td>
    <td>{item.confidence === 'explicit' ? '明确线索' : '弱线索'}</td>
    <td>{item.startUs} μs</td>
    <td>
      {item.taskId ?? '未关联任务'}
      {item.navigationKey ? <small>导航 {item.navigationKey}</small> : null}
    </td>
  </TraceFactTableRow>
);

const TraceRenderingTab: React.FC<{ context: TraceContextFacts }> = ({ context }) => {
  const pinnedFactId = usePinnedTraceFactId('rendering');
  const model = useMemo(
    () => buildRenderingFactsViewModel(context, pinnedFactId),
    [context, pinnedFactId],
  );
  const navigation = useTraceTargetNavigation('rendering');
  const [visibleLimit, setVisibleLimit] = useState(TRACE_EXPERT_PAGE_SIZE);
  const priorityIds = useMemo(
    () => new Set(model.priority.map(entry => entry.item.id)),
    [model.priority],
  );
  const remainingFrames = model.allFrames.filter(item => !priorityIds.has(item.id));
  const remainingEvents = model.allRenderingEvents.filter(item => !priorityIds.has(item.id));
  const remainingReflows = model.allReflowClues.filter(item => !priorityIds.has(item.id));

  return (
    <section aria-label="渲染诊断" className="trace-facts-tab" data-testid="trace-rendering-tab">
      <TraceFactsSectionHeading
        description="帧预算和 Forced reflow 都是录制内线索；弱线索不会被升级为确定问题，需结合任务和渲染事件复核。"
        eyebrow="RENDERING FACTS"
        title="渲染与帧"
      />
      <TraceNavigationError message={navigation.navigationError} />

      <section aria-labelledby="trace-rendering-summary">
        <h3 id="trace-rendering-summary">结论摘要</h3>
        <TraceSummaryGrid items={[
          { label: '超预算帧比例', value: model.summary.overBudgetRatio === undefined ? '不可用' : `${(model.summary.overBudgetRatio * 100).toFixed(1)}%`, tone: model.summary.overBudgetCount > 0 ? 'critical' : 'neutral' },
          { label: '丢帧', value: String(model.summary.droppedCount), tone: model.summary.droppedCount > 0 ? 'critical' : 'neutral' },
          { label: '最长渲染事件', value: model.summary.longestRenderingEvent ? `${model.summary.longestRenderingEvent.name} · ${model.summary.longestRenderingEvent.durationMs.toFixed(1)} ms` : '不可用' },
          { label: 'Reflow 线索', value: `${model.summary.forcedReflowClueCount}（明确 ${model.summary.explicitReflowClueCount}）`, tone: model.summary.forcedReflowClueCount > 0 ? 'caution' : 'neutral' },
        ]} />
        <p className="trace-facts-impact">
          {model.summary.overBudgetCount > 0 || model.summary.droppedCount > 0
            ? `返回事实中有 ${model.summary.overBudgetCount} 帧超出参考预算，优先复核丢帧、最长帧和同期渲染任务。`
            : '当前返回事实中未见超预算帧；正常帧已折叠到专家区。'}
        </p>
        <p className="trace-facts-limitation">{model.budgetNote}</p>
        {model.limitationMessages.map(message => (
          <p className="trace-facts-limitation" key={message}>{message}</p>
        ))}
      </section>

      <section aria-labelledby="trace-rendering-priority">
        <h3 id="trace-rendering-priority">优先检查</h3>
        <p className="trace-result-note">最多显示 5 条丢帧、超预算帧、明显耗时事件或 reflow 线索。</p>
        {model.priority.length > 0 ? (
          <div className="trace-compact-table-wrap">
            <table className="trace-compact-table">
              <thead><tr><th>事实</th><th>持续时间</th><th>状态 / 强度</th><th>开始时间</th><th>关联</th></tr></thead>
              <tbody>{model.priority.map(entry => {
                if (entry.kind === 'frame') return <FrameRow highlightedDomId={navigation.highlightedDomId} item={entry.item} key={entry.item.id} testId="trace-rendering-priority-row" />;
                if (entry.kind === 'event') return <RenderingEventRow highlightedDomId={navigation.highlightedDomId} item={entry.item} key={entry.item.id} testId="trace-rendering-priority-row" />;
                return <ReflowRow highlightedDomId={navigation.highlightedDomId} item={entry.item} key={entry.item.id} testId="trace-rendering-priority-row" />;
              })}</tbody>
            </table>
          </div>
        ) : <p className="trace-result-note">当前没有需要优先检查的渲染异常事实。</p>}
      </section>

      <TraceExpertDisclosure label="全部渲染事实">
        <section>
          <h3>帧</h3>
          {remainingFrames.length > 0 ? <div className="trace-compact-table-wrap"><table className="trace-compact-table">
            <thead><tr><th>事实</th><th>持续时间</th><th>参考预算</th><th>开始时间</th><th>进程 / 线程</th></tr></thead>
            <tbody>{remainingFrames.slice(0, visibleLimit).map(item => <FrameRow highlightedDomId={navigation.highlightedDomId} item={item} key={item.id} testId="trace-rendering-expert-row" />)}</tbody>
          </table></div> : <p className="trace-result-note">没有其他帧事实。</p>}
        </section>
        <section>
          <h3>渲染事件与 Reflow 线索</h3>
          <div className="trace-compact-table-wrap"><table className="trace-compact-table">
            <thead><tr><th>事实</th><th>持续时间</th><th>状态 / 强度</th><th>开始时间</th><th>关联</th></tr></thead>
            <tbody>
              {remainingEvents.slice(0, visibleLimit).map(item => <RenderingEventRow highlightedDomId={navigation.highlightedDomId} item={item} key={item.id} testId="trace-rendering-expert-row" />)}
              {remainingReflows.slice(0, visibleLimit).map(item => <ReflowRow highlightedDomId={navigation.highlightedDomId} item={item} key={item.id} testId="trace-rendering-expert-row" />)}
            </tbody>
          </table></div>
          {remainingEvents.length === 0 && remainingReflows.length === 0 ? <p className="trace-result-note">没有其他渲染事件或 Reflow 线索。</p> : null}
        </section>
        {visibleLimit < Math.max(remainingFrames.length, remainingEvents.length, remainingReflows.length) ? (
          <button className="trace-load-more" onClick={() => setVisibleLimit(limit => limit + TRACE_EXPERT_PAGE_SIZE)} type="button">
            继续显示更多事实
          </button>
        ) : null}
      </TraceExpertDisclosure>
    </section>
  );
};

export default TraceRenderingTab;
