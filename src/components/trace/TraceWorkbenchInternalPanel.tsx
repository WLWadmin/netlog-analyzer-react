import { useState, useSyncExternalStore } from 'react';
import type {
  DiagnosisFinding,
  TraceDiagnosis,
} from '../../diagnosis/trace';
import type {
  TraceWorkbenchClient,
  TraceWorkbenchClientSnapshot,
} from '../../workbench/client';
import { isTraceTimelineEnabled } from '../../workbench/featureFlag';
import TraceTimelineWorkbench from './workbench/TraceTimelineWorkbench';

interface TraceWorkbenchInternalPanelProps {
  client?: TraceWorkbenchClient;
  diagnoses?: TraceDiagnosis[];
  findings?: DiagnosisFinding[];
}

const STATUS_LABELS = {
  available: '尚未创建',
  creating: '正在建立最小索引',
  ready: '可查询',
  degraded: '部分能力可用',
  released: '已释放',
  failed: 'Worker 会话失败',
} as const;

const TraceWorkbenchInternalPanel: React.FC<TraceWorkbenchInternalPanelProps> = ({
  client,
  diagnoses = [],
  findings = [],
}) => {
  const [localError, setLocalError] = useState('');
  const fallback: TraceWorkbenchClientSnapshot = {
    status: 'released' as const,
    queryErrors: {},
    discardedResponseCount: 0,
  };
  const snapshot = useSyncExternalStore(
    listener => client?.subscribe(listener) ?? (() => undefined),
    () => client?.getSnapshot() ?? fallback,
    () => fallback,
  );

  const createSession = async () => {
    if (!client) return;
    setLocalError('');
    try {
      const session = await client.createSession();
      if (!isTraceTimelineEnabled()) {
        await client.queryViewport({
          startUs: session.range.startUs,
          endUs: Math.min(session.range.endUs, session.range.startUs + 500_000),
        }, 100);
      }
    } catch {
      setLocalError('工作台会话创建失败，现有 Trace 报告仍可继续使用。');
    }
  };

  const selectEvent = async (eventId: string, evidenceId?: string) => {
    if (!client) return;
    setLocalError('');
    try {
      await client.queryEventDetail(eventId);
      if (evidenceId) await client.queryEvidence(evidenceId);
    } catch {
      setLocalError('当前事件详情查询失败，已保留稳定视口结果。');
    }
  };

  const closeSession = async () => {
    if (!client) return;
    setLocalError('');
    try {
      await client.close();
    } catch {
      setLocalError('关闭回执未返回，Worker 已执行本地释放。');
    }
  };

  if (client && snapshot.session && isTraceTimelineEnabled()) {
    return (
      <TraceTimelineWorkbench
        client={client}
        diagnoses={diagnoses}
        findings={findings}
      />
    );
  }

  return (
    <section className="trace-workbench-internal" aria-labelledby="trace-workbench-title">
      <div className="trace-result-panel-heading">
        <div>
          <span>INTERNAL FEATURE</span>
          <h2 id="trace-workbench-title">分析工作台（内部）</h2>
        </div>
        <strong>{STATUS_LABELS[snapshot.status]}</strong>
      </div>
      <p className="trace-result-note">
        {isTraceTimelineEnabled()
          ? '阶段 2 Timeline MVP 使用同一 Worker 会话；不会重复读取或解析文件。'
          : '阶段 1 仅验证同 Worker 会话、索引和按需查询，不提供完整 Timeline 或 Flame Chart。'}
      </p>

      {!client && (
        <p role="status">当前报告没有可复用的 Workbench Worker，会话入口不可用。</p>
      )}
      {client && snapshot.status === 'available' && (
        <button type="button" onClick={createSession}>打开交互式性能分析</button>
      )}
      {snapshot.status === 'creating' && (
        <p role="status">
          正在构建最小时间轴索引
          {snapshot.progress
            ? `：${snapshot.progress.completed} / ${snapshot.progress.total} ${snapshot.progress.unit}`
            : '…'}
        </p>
      )}

      {client && snapshot.status !== 'released' && snapshot.status !== 'failed' && (
        <button type="button" onClick={closeSession}>
          {snapshot.session ? '关闭工作台' : '释放工作台资源'}
        </button>
      )}

      {snapshot.session && (
        <>
          <dl className="trace-fact-list">
            <div><dt>会话</dt><dd>{snapshot.session.sessionId}</dd></div>
            <div><dt>Revision</dt><dd>{snapshot.session.sessionRevision}</dd></div>
            <div><dt>事件数</dt><dd>{snapshot.session.eventCount}</dd></div>
            <div><dt>截图数</dt><dd>{snapshot.session.screenshotCount}</dd></div>
            <div>
              <dt>能力</dt>
              <dd>{snapshot.session.capabilities.join('、') || '无'}</dd>
            </div>
          </dl>
          {snapshot.session.missingCapabilities.length > 0 && (
            <div className="trace-workbench-limitations">
              <h3>能力缺失</h3>
              <ul>
                {snapshot.session.missingCapabilities.map(item => (
                  <li key={item.capability}>
                    <code>{item.capability}</code>：{item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {snapshot.viewport && (
            <div className="trace-workbench-query-result">
              <h3>最小视口查询</h3>
              <p>
                返回 {snapshot.viewport.events.length} / {snapshot.viewport.truncation.totalMatched}
                {snapshot.viewport.truncation.truncated ? '（已声明截断）' : ''}
              </p>
              <ul>
                {snapshot.viewport.events.slice(0, 20).map(event => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => selectEvent(event.id, `trace:event:${event.id.split(':').pop()}`)}
                    >
                      {event.name} · {event.startUs} μs
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {snapshot.eventDetail && (
            <p role="status">
              已查询事件：{snapshot.eventDetail.detail.name}，证据引用
              {' '}{snapshot.eventDetail.detail.evidenceIds.length} 项。
            </p>
          )}
          {snapshot.evidence && (
            <p role="status">
              原始证据白名单详情：{snapshot.evidence.evidence.name ?? snapshot.evidence.evidence.evidenceId}
            </p>
          )}
        </>
      )}

      {(localError || snapshot.lastError) && (
        <p className="trace-export-error" role="alert">
          {localError || snapshot.lastError?.error.message}
        </p>
      )}
      <p className="trace-result-note">
        已丢弃迟到响应：{snapshot.discardedResponseCount}
      </p>
    </section>
  );
};

export default TraceWorkbenchInternalPanel;
