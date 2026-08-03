import { useMemo, useState } from 'react';
import type {
  TraceContextFacts,
  TraceCpuHotspot,
  TraceCpuProfileFacts,
  TraceTaskFacts,
} from '../../../parsers/trace/types';
import {
  buildMainThreadFactsViewModel,
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

const TaskRow: React.FC<{
  item: TraceTaskFacts;
  highlightedDomId?: string;
  testId?: string;
}> = ({ item, highlightedDomId, testId }) => (
  <TraceFactTableRow factId={item.id} highlightedDomId={highlightedDomId} testId={testId}>
    <td><strong>长任务 · {item.id}</strong><small>开始 {item.startUs} μs</small></td>
    <td>{item.durationMs.toFixed(1)} ms</td>
    <td>{item.blockingContributionMs.toFixed(1)} ms</td>
    <td>{item.selfTimeMs.toFixed(1)} ms · {item.selfTimeConfidence === 'exact' ? '精确' : '近似'}</td>
    <td>
      {item.processId} / {item.threadId}
      <small>{item.navigationKey ? `导航 ${item.navigationKey}` : '未关联导航'}</small>
      {item.limitations.length > 0 ? <small>{item.limitations.join('；')}</small> : null}
    </td>
  </TraceFactTableRow>
);

const HotspotRow: React.FC<{
  item: TraceCpuHotspot;
  highlightedDomId?: string;
  testId?: string;
}> = ({ item, highlightedDomId, testId }) => (
  <TraceFactTableRow factId={item.id} highlightedDomId={highlightedDomId} testId={testId}>
    <td><strong>{item.functionName} · {item.sampleCount} samples</strong></td>
    <td>{item.sampleTimeMs.toFixed(1)} ms</td>
    <td>{item.script ? `${item.script.origin}${item.script.pathname}` : '未记录'}</td>
    <td>{item.lineNumber ?? '未知'} / {item.columnNumber ?? '未知'}</td>
    <td>
      {item.processId} / {item.threadId}
      <small>Profile / Node {item.profileId} / {item.nodeId}</small>
      {item.navigationKey ? <small>导航 {item.navigationKey}</small> : null}
    </td>
  </TraceFactTableRow>
);

const ProfileRow: React.FC<{
  item: TraceCpuProfileFacts;
  highlightedDomId?: string;
}> = ({ item, highlightedDomId }) => (
  <TraceFactTableRow factId={item.id} highlightedDomId={highlightedDomId} testId="trace-main-priority-row">
    <td><strong>CPU Profile · {item.profileId}</strong></td>
    <td>{item.sampleCount} samples</td>
    <td>{item.nodeCount} nodes</td>
    <td>{item.startUs} - {item.endUs} μs</td>
    <td>
      {item.processId} / {item.threadId}
      {item.limitations.length > 0 ? <small>{item.limitations.join('；')}</small> : null}
    </td>
  </TraceFactTableRow>
);

const TraceMainThreadTab: React.FC<{ context: TraceContextFacts }> = ({ context }) => {
  const pinnedFactId = usePinnedTraceFactId('main-thread');
  const model = useMemo(
    () => buildMainThreadFactsViewModel(context, pinnedFactId),
    [context, pinnedFactId],
  );
  const navigation = useTraceTargetNavigation('main-thread');
  const [visibleLimit, setVisibleLimit] = useState(TRACE_EXPERT_PAGE_SIZE);
  const priorityIds = useMemo(
    () => new Set(model.priority.map(entry => entry.item.id)),
    [model.priority],
  );
  const remainingTasks = model.allTasks.filter(item => !priorityIds.has(item.id));
  const remainingHotspots = model.allHotspots.filter(item => !priorityIds.has(item.id));

  return (
    <section aria-label="主线程诊断" className="trace-facts-tab" data-testid="trace-main-thread-tab">
      <TraceFactsSectionHeading
        description="长任务说明主线程在录制窗口内持续占用；CPU Profile 热点用于复核采样贡献，二者不能单独证明业务根因。"
        eyebrow="MAIN THREAD FACTS"
        title="主线程与 CPU"
      />
      <TraceNavigationError message={navigation.navigationError} />

      <section aria-labelledby="trace-main-summary">
        <h3 id="trace-main-summary">结论摘要</h3>
        <TraceSummaryGrid items={[
          { label: '已返回长任务', value: String(model.summary.longTaskCount), tone: model.summary.longTaskCount > 0 ? 'critical' : 'neutral' },
          { label: '阻塞贡献合计', value: `${model.summary.totalBlockingContributionMs.toFixed(1)} ms` },
          { label: '最长任务', value: model.summary.longestTaskMs === undefined ? '不可用' : `${model.summary.longestTaskMs.toFixed(1)} ms` },
          { label: '主要 CPU 热点', value: model.summary.primaryHotspot?.functionName ?? '不可用' },
          { label: 'Profile 能力', value: model.summary.profileCapability === 'available' ? '可用' : '缺失', tone: model.summary.profileCapability === 'missing' ? 'caution' : 'neutral' },
        ]} />
        <p className="trace-facts-impact">
          {model.summary.longTaskCount > 0
            ? `${model.summary.longTaskCount} 个长任务可能延迟交互或渲染，先检查最长任务及其阻塞贡献。`
            : '当前返回事实中未取得长任务；仍需结合采集完整性判断。'}
        </p>
        <p className="trace-facts-limitation">{model.capabilityMessage}</p>
        {model.limitationMessages.map(message => (
          <p className="trace-facts-limitation" key={message}>{message}</p>
        ))}
      </section>

      <section aria-labelledby="trace-main-priority">
        <h3 id="trace-main-priority">优先检查</h3>
        <p className="trace-result-note">最多显示 5 条长任务与 CPU 热点。</p>
        {model.priority.length > 0 ? (
          <div className="trace-compact-table-wrap">
            <table className="trace-compact-table">
              <thead><tr><th>事实</th><th>持续 / 采样</th><th>阻塞 / 脚本</th><th>自耗时 / 位置</th><th>进程 / 线程</th></tr></thead>
              <tbody>{model.priority.map(entry => {
                if (entry.kind === 'task') return <TaskRow highlightedDomId={navigation.highlightedDomId} item={entry.item} key={entry.item.id} testId="trace-main-priority-row" />;
                if (entry.kind === 'hotspot') return <HotspotRow highlightedDomId={navigation.highlightedDomId} item={entry.item} key={entry.item.id} testId="trace-main-priority-row" />;
                return <ProfileRow highlightedDomId={navigation.highlightedDomId} item={entry.item} key={entry.item.id} />;
              })}</tbody>
            </table>
          </div>
        ) : <p className="trace-result-note">未取得主线程任务或 CPU 热点事实。</p>}
      </section>

      <TraceExpertDisclosure label="全部主线程事实">
        <section>
          <h3>长任务</h3>
          {remainingTasks.length > 0 ? (
            <div className="trace-compact-table-wrap"><table className="trace-compact-table">
              <thead><tr><th>事实</th><th>持续时间</th><th>阻塞贡献</th><th>自耗时</th><th>进程 / 线程</th></tr></thead>
              <tbody>{remainingTasks.slice(0, visibleLimit).map(item => (
                <TaskRow highlightedDomId={navigation.highlightedDomId} item={item} key={item.id} testId="trace-main-expert-row" />
              ))}</tbody>
            </table></div>
          ) : <p className="trace-result-note">没有其他长任务。</p>}
        </section>
        <section>
          <h3>CPU 热点</h3>
          {remainingHotspots.length > 0 ? (
            <div className="trace-compact-table-wrap"><table className="trace-compact-table">
              <thead><tr><th>热点</th><th>采样时间</th><th>脚本</th><th>行 / 列</th><th>进程 / 线程</th></tr></thead>
              <tbody>{remainingHotspots.slice(0, visibleLimit).map(item => (
                <HotspotRow highlightedDomId={navigation.highlightedDomId} item={item} key={item.id} testId="trace-main-expert-row" />
              ))}</tbody>
            </table></div>
          ) : <p className="trace-result-note">没有其他 CPU 热点。</p>}
        </section>
        <section>
          <h3>Profile 能力背景</h3>
          {model.profiles.length > 0 ? (
            <div className="trace-compact-table-wrap">
              <table className="trace-compact-table">
                <thead><tr><th>Profile</th><th>进程 / 线程</th><th>时间范围</th><th>节点 / 样本</th><th>限制</th></tr></thead>
                <tbody>{model.profiles.slice(0, visibleLimit).map(item => (
                  <tr data-testid="trace-profile-expert-row" key={item.id}>
                    <td><strong>{item.profileId}</strong><small>{item.id}</small></td>
                    <td>{item.processId} / {item.threadId}</td>
                    <td>{item.startUs} - {item.endUs} μs</td>
                    <td>{item.nodeCount} / {item.sampleCount}</td>
                    <td>{item.limitations.join('；') || '无额外限制'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="trace-result-note">{model.capabilityMessage}</p>}
        </section>
        {visibleLimit < Math.max(remainingTasks.length, remainingHotspots.length, model.profiles.length) ? (
          <button className="trace-load-more" onClick={() => setVisibleLimit(limit => limit + TRACE_EXPERT_PAGE_SIZE)} type="button">
            继续显示更多事实
          </button>
        ) : null}
      </TraceExpertDisclosure>
    </section>
  );
};

export default TraceMainThreadTab;
