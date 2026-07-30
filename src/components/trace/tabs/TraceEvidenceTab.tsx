import { useEffect, useMemo, useState } from 'react';
import type { TraceEventRef } from '../../../parsers/trace/types';
import { useNavigation } from '../../../contexts/NavigationContext';
import { traceEvidenceDomId } from '../traceDiagnosisViewModel';
import { useTraceTargetNavigation } from '../useTraceTargetNavigation';
import { TraceNavigationError } from './TraceTabShared';

const EVIDENCE_PAGE_SIZE = 100;

const TraceEvidenceTab: React.FC<{ evidence: TraceEventRef[] }> = ({ evidence }) => {
  const { intent } = useNavigation();
  const [visibleLimit, setVisibleLimit] = useState(EVIDENCE_PAGE_SIZE);
  const [pinnedEvidenceId, setPinnedEvidenceId] = useState<string>();
  const targetEvidenceId = intent?.fileType === 'trace'
    && intent.tab === 'evidence'
    && intent.scrollTo?.type === 'evidence'
    ? String(intent.scrollTo.id)
    : undefined;

  // 导航意图消费后仍保留目标项，避免目标位于首批数据之外时刚高亮就从 DOM 消失。
  useEffect(() => {
    if (targetEvidenceId) setPinnedEvidenceId(targetEvidenceId);
  }, [targetEvidenceId]);

  const visibleEvidence = useMemo(() => {
    const items = evidence.slice(0, visibleLimit);
    const targetId = targetEvidenceId ?? pinnedEvidenceId;
    if (!targetId || items.some(item => item.evidenceId === targetId)) return items;
    const target = evidence.find(item => item.evidenceId === targetId);
    return target ? [...items, target] : items;
  }, [evidence, pinnedEvidenceId, targetEvidenceId, visibleLimit]);
  const navigation = useTraceTargetNavigation('evidence');

  return <section aria-label="Trace 证据定位" data-testid="trace-evidence-tab">
    <h2>证据索引</h2>
    <p className="trace-result-note">这里只展示有限事件引用和定位字段，不包含 args、源码、Header、正文或完整原始事件。</p>
    <TraceNavigationError message={navigation.navigationError} />
    <p className="trace-evidence-count" role="status">
      已展示 {visibleEvidence.length} / {evidence.length} 条
    </p>
    <div className="trace-result-grid">{visibleEvidence.map(item => {
      const id = traceEvidenceDomId(item.evidenceId);
      return <article className={`trace-result-panel${id === navigation.highlightedDomId ? ' is-highlighted' : ''}`} id={id} key={item.evidenceId} tabIndex={-1}>
        <div className="trace-result-panel-heading"><div><span>{item.evidenceId}</span><h2>{item.name ?? '未命名事件'}</h2></div></div>
        <dl className="trace-fact-list"><div><dt>索引</dt><dd>eventIndex {item.eventIndex}</dd></div>{item.processId !== undefined && <div><dt>进程</dt><dd>{item.processId}</dd></div>}{item.threadId !== undefined && <div><dt>线程</dt><dd>{item.threadId}</dd></div>}{item.timestampUs !== undefined && <div><dt>时间</dt><dd>{item.timestampUs} μs</dd></div>}</dl>
      </article>;
    })}</div>
    {visibleLimit < evidence.length && (
      <button
        className="trace-load-more"
        onClick={() => setVisibleLimit(limit => Math.min(limit + EVIDENCE_PAGE_SIZE, evidence.length))}
        type="button"
      >
        继续显示 {Math.min(EVIDENCE_PAGE_SIZE, evidence.length - visibleLimit)} 条
      </button>
    )}
    {!evidence.length && <p className="trace-result-note">当前没有可展示的证据索引。</p>}
  </section>;
};
export default TraceEvidenceTab;
