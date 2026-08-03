import { useEffect, useMemo, useState } from 'react';
import type { TraceContextFacts } from '../../../parsers/trace/types';
import { useNavigation } from '../../../contexts/NavigationContext';
import { traceEvidenceDomId } from '../traceDiagnosisViewModel';
import { buildEvidenceFactsViewModel } from '../traceFactsViewModel';
import { useTraceTargetNavigation } from '../useTraceTargetNavigation';
import {
  TraceFactsSectionHeading,
  TraceNavigationError,
  TraceSummaryGrid,
} from './TraceTabShared';

const EVIDENCE_PAGE_SIZE = 25;

const TraceEvidenceTab: React.FC<{
  context: TraceContextFacts;
  onReturnToConclusion?: () => void;
}> = ({ context, onReturnToConclusion }) => {
  const { evidence } = context;
  const { intent } = useNavigation();
  const [visibleLimit, setVisibleLimit] = useState(EVIDENCE_PAGE_SIZE);
  const [pinnedEvidenceId, setPinnedEvidenceId] = useState<string>();
  const targetEvidenceId = intent?.fileType === 'trace'
    && intent.tab === 'evidence'
    && intent.scrollTo?.type === 'evidence'
    ? String(intent.scrollTo.id)
    : undefined;

  useEffect(() => {
    if (targetEvidenceId) setPinnedEvidenceId(targetEvidenceId);
  }, [targetEvidenceId]);

  const activeTargetId = targetEvidenceId ?? pinnedEvidenceId;
  const target = useMemo(
    () => evidence.find(item => item.evidenceId === activeTargetId),
    [activeTargetId, evidence],
  );
  const visibleEvidence = useMemo(() => {
    const withoutTarget = target
      ? evidence.filter(item => item.evidenceId !== target.evidenceId)
      : evidence;
    const page = withoutTarget.slice(0, Math.max(0, visibleLimit - (target ? 1 : 0)));
    return target ? [target, ...page] : page;
  }, [evidence, target, visibleLimit]);
  const evidenceViewModel = useMemo(
    () => buildEvidenceFactsViewModel(context),
    [context],
  );
  const navigation = useTraceTargetNavigation('evidence');

  return (
    <section aria-label="Trace 证据定位" className="trace-facts-tab" data-testid="trace-evidence-tab">
      <TraceFactsSectionHeading
        description="这里只展示有限事件引用和定位字段，不包含 args、源码、Header、正文或完整原始事件。"
        eyebrow="RAW EVIDENCE INDEX"
        title="全部证据 · 高级"
      />
      <TraceNavigationError message={navigation.navigationError} />

      <section aria-labelledby="trace-evidence-summary">
        <h3 id="trace-evidence-summary">类别与数量摘要</h3>
        <TraceSummaryGrid items={[
          {
            label: '可定位索引',
            value: evidenceViewModel.truncated
              ? `${evidenceViewModel.availableCount} / ${evidenceViewModel.totalCount}`
              : String(evidenceViewModel.availableCount),
          },
          { label: '网络', value: String(evidenceViewModel.counts['网络']) },
          { label: '主线程 / CPU', value: String(evidenceViewModel.counts['主线程 / CPU']) },
          { label: '渲染', value: String(evidenceViewModel.counts['渲染']) },
          { label: '其他', value: String(evidenceViewModel.counts['其他']) },
        ]} />
        <p className="trace-facts-breakdown">
          类别按既有事实引用统计；同一证据关联多个类别时会分别计数。
        </p>
        {evidenceViewModel.truncated ? (
          <p className="trace-facts-limitation">
            类别统计只覆盖已返回的 {evidenceViewModel.availableCount} 条索引；
            其余 {evidenceViewModel.totalCount - evidenceViewModel.availableCount} 条当前不可定位。
          </p>
        ) : null}
      </section>

      {target ? (
        <aside className="trace-evidence-association" role="status">
          <div>
            <strong>从诊断结论定位的关联证据</strong>
            <p>{target.name ?? '未命名事件'} · {target.evidenceId} 已置顶并聚焦。</p>
          </div>
          {onReturnToConclusion ? (
            <button onClick={onReturnToConclusion} type="button">返回诊断结论</button>
          ) : null}
        </aside>
      ) : null}

      <section aria-labelledby="trace-evidence-list">
        <h3 id="trace-evidence-list">证据索引</h3>
        <p className="trace-evidence-count" role="status">
          已展示 {visibleEvidence.length} / {evidenceViewModel.availableCount} 条可定位索引
          {evidenceViewModel.truncated ? `（Trace 共 ${evidenceViewModel.totalCount} 条）` : ''}
        </p>
        {visibleEvidence.length > 0 ? (
          <div className="trace-compact-table-wrap">
            <table className="trace-compact-table trace-evidence-table">
              <thead><tr><th>Evidence ID</th><th>事件名</th><th>类别</th><th>时间</th><th>进程 / 线程</th></tr></thead>
              <tbody>{visibleEvidence.map(item => {
                const id = traceEvidenceDomId(item.evidenceId);
                return (
                  <tr
                    className={id === navigation.highlightedDomId ? 'is-highlighted' : undefined}
                    data-testid="trace-evidence-row"
                    id={id}
                    key={item.evidenceId}
                    tabIndex={-1}
                  >
                    <td><code>{item.evidenceId}</code></td>
                    <td><strong>{item.name ?? '未命名事件'}</strong><small>eventIndex {item.eventIndex}</small></td>
                    <td>{evidenceViewModel.categoryByEvidenceId.get(item.evidenceId) ?? '其他'}</td>
                    <td>{item.timestampUs === undefined ? '不可用' : `${item.timestampUs} μs`}</td>
                    <td>{item.processId ?? '未知'} / {item.threadId ?? '未知'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="trace-result-note">当前没有可展示的证据索引。</p>}
        {visibleLimit < evidence.length ? (
          <button
            className="trace-load-more"
            onClick={() => setVisibleLimit(limit => Math.min(limit + EVIDENCE_PAGE_SIZE, evidence.length))}
            type="button"
          >
            继续显示 {Math.min(EVIDENCE_PAGE_SIZE, evidence.length - visibleLimit)} 条
          </button>
        ) : null}
      </section>
    </section>
  );
};

export default TraceEvidenceTab;
