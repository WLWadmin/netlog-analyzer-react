import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  DiagnosisFinding,
  TraceDiagnosis,
} from '../../../diagnosis/trace';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { WorkbenchEventDetailDto } from '../../../workbench/protocol';
import { isTraceExpertAnalysisEnabled } from '../../../workbench/featureFlag';
import { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';
import { TIMELINE_TRACKS } from '../../../workbench/timelineTracks';
import ScreenshotFilmstrip from './ScreenshotFilmstrip';
import TimelineCanvas from './TimelineCanvas';
import ExpertAnalysisDrawer from './ExpertAnalysisDrawer';

interface TraceTimelineWorkbenchProps {
  client: TraceWorkbenchClient;
  diagnoses: TraceDiagnosis[];
  findings?: DiagnosisFinding[];
}

function timelineIdFromEvidence(evidenceId: string): string | undefined {
  const match = /^trace:event:(0|[1-9]\d*)$/.exec(evidenceId);
  return match ? `trace:timeline:${match[1]}` : undefined;
}

function focusedRange(detail: WorkbenchEventDetailDto) {
  const duration = Math.max(detail.durationUs, 50_000);
  const padding = duration * 2;
  return {
    startUs: detail.startUs - padding,
    endUs: detail.startUs + detail.durationUs + padding,
  };
}

const PAGE_STATE_LABELS: Record<string, string> = {
  ready: '可交互',
  degraded: '部分能力不可用',
  'empty-range': '当前范围无事件',
  'query-error': '当前范围更新失败',
  'fatal-worker-error': '分析会话已失败',
  releasing: '正在释放资源',
  released: '资源已释放',
};

const DIAGNOSIS_CONFIDENCE_LABELS: Record<TraceDiagnosis['confidence'], string> = {
  confirmed: '已确认',
  high: '高置信',
  medium: '中等置信',
  observation: '观察项',
};

const DIAGNOSIS_CATEGORY_LABELS: Record<TraceDiagnosis['category'], string> = {
  quality: '采集质量',
  network: '网络',
  'main-thread': '主线程',
  interaction: '交互',
  rendering: '渲染',
  loading: '加载',
  security: '安全',
};

const ATTRIBUTION_LABELS: Record<DiagnosisFinding['attributionLevel'], string> = {
  confirmed: '已确认归因',
  'highly-correlated': '高度相关',
  'possible-contributor': '可能贡献',
  observation: '观察项',
  insufficient: '证据不足',
};

const CAPABILITY_LABELS: Record<string, string> = {
  'cpu-profile': 'CPU 调用栈',
  network: '网络',
  rendering: '渲染',
  interactions: '交互',
  frames: '帧',
  screenshots: '截图',
};

const TraceTimelineWorkbench: React.FC<TraceTimelineWorkbenchProps> = ({
  client,
  diagnoses,
  findings = [],
}) => {
  const clientSnapshot = useSyncExternalStore(
    client.subscribe.bind(client),
    client.getSnapshot.bind(client),
    client.getSnapshot.bind(client),
  );
  const retainedSession = useRef(clientSnapshot.session);
  const session = clientSnapshot.session ?? retainedSession.current;
  if (!session) throw new Error('Timeline Workbench requires a ready session');
  const store = useMemo(
    () => new TimelineInteractionStore(session.range),
    [session.range],
  );
  const findingsById = useMemo(
    () => new Map(findings.map(finding => [finding.id, finding])),
    [findings],
  );
  const interaction = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [querying, setQuerying] = useState(false);
  const [viewportRetry, setViewportRetry] = useState(0);
  const [closing, setClosing] = useState(false);
  const [viewportError, setViewportError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [evidenceError, setEvidenceError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const expertAnalysisEnabled = isTraceExpertAnalysisEnabled();
  const returnFocus = useRef<Array<HTMLElement | null>>([]);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let disposed = false;
    let requestSequence = 0;
    let lastStart = Number.NaN;
    let lastEnd = Number.NaN;
    const queryCurrentViewport = async (force = false) => {
      const { viewport } = store.getSnapshot();
      if (
        !force
        && viewport.startUs === lastStart
        && viewport.endUs === lastEnd
      ) return;
      lastStart = viewport.startUs;
      lastEnd = viewport.endUs;
      const sequence = ++requestSequence;
      const loadingTimer = window.setTimeout(() => {
        if (!disposed && sequence === requestSequence) setQuerying(true);
      }, 300);
      setViewportError('');
      try {
        await client.queryViewport(viewport, 2_000, true);
      } catch {
        if (!disposed && sequence === requestSequence) {
          setViewportError('当前范围查询失败，已保留最后稳定画面。');
        }
      } finally {
        window.clearTimeout(loadingTimer);
        if (!disposed && sequence === requestSequence) setQuerying(false);
      }
    };
    void queryCurrentViewport(viewportRetry > 0);
    const unsubscribe = store.subscribe(() => {
      void queryCurrentViewport();
    });
    return () => {
      disposed = true;
      requestSequence += 1;
      unsubscribe();
    };
  }, [client, store, viewportRetry]);

  useEffect(() => {
    let disposed = false;
    let lastSelectionKey = '';
    let requestSequence = 0;
    const querySelection = () => {
      const selection = store.getSnapshot().selection;
      const key = selection ? `${selection.startUs}:${selection.endUs}` : '';
      if (!selection || key === lastSelectionKey) return;
      lastSelectionKey = key;
      const sequence = ++requestSequence;
      setSelectionError('');
      void client.querySelection(selection).then(response => {
        if (
          !disposed
          && sequence === requestSequence
          && response?.type === 'structured-error'
        ) {
          setSelectionError('选区统计失败，当前时间轴与事件详情仍可使用。');
        }
      }).catch(() => {
        if (!disposed && sequence === requestSequence) {
          setSelectionError('选区统计失败，当前时间轴与事件详情仍可使用。');
        }
      });
    };
    querySelection();
    const unsubscribe = store.subscribe(querySelection);
    return () => {
      disposed = true;
      requestSequence += 1;
      unsubscribe();
    };
  }, [client, store]);

  const availableTracks = TIMELINE_TRACKS.filter(track => (
    (session.trackEventCounts[track.id] ?? 0) > 0
    && (
      track.capability === 'timeline-events'
      || session.capabilities.includes(track.capability)
    )
  ));
  const events = clientSnapshot.viewport?.events ?? [];
  const stableEvent = events.find(event => event.id === interaction.selectedEventId);
  const hoveredEvent = events.find(event => event.id === interaction.hoveredEventId);
  const pageState = closing
    ? 'releasing'
    : clientSnapshot.status === 'failed'
      ? 'fatal-worker-error'
      : clientSnapshot.status === 'released'
        ? 'released'
        : viewportError || clientSnapshot.queryErrors.viewport || clientSnapshot.lastError
          ? 'query-error'
          : clientSnapshot.viewport && events.length === 0
            ? 'empty-range'
            : session.state === 'degraded'
              ? 'degraded'
              : 'ready';

  if (pageState === 'released') {
    return (
      <section
        className="trace-timeline-workbench is-released"
        aria-labelledby="trace-timeline-released-title"
        data-state="released"
      >
        <header className="trace-workbench-toolbar">
          <div>
            <span>PERFORMANCE WORKBENCH · TIMELINE MVP</span>
            <h2 id="trace-timeline-released-title">分析工作台资源已释放</h2>
            <p>Timeline、Canvas、截图 URL 和 Worker 会话已关闭。</p>
          </div>
          <span className="trace-workbench-state" role="status">资源已释放</span>
        </header>
      </section>
    );
  }

  const openDetail = async (eventId: string) => {
    setDetailError('');
    try {
      const response = await client.queryEventDetail(eventId);
      if (response.type === 'event-detail-result') {
        store.saveHistory({
          drawerOpen,
          scrollTop: mainRef.current?.scrollTop ?? 0,
        });
        returnFocus.current.push(
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
        );
        store.selectEvent(eventId);
        setDrawerOpen(true);
      } else if (response.type === 'structured-error') {
        setDetailError('事件详情查询失败，Timeline 当前范围保持不变。');
      }
    } catch {
      setDetailError('事件详情查询失败，Timeline 当前范围保持不变。');
    }
  };

  const navigateDiagnosis = async (diagnosis: TraceDiagnosis) => {
    const eventId = diagnosis.evidenceIds
      .map(timelineIdFromEvidence)
      .find((value): value is string => value !== undefined);
    if (!eventId) {
      setDetailError('该诊断没有可定位的 Trace 事件。请在报告证据页复核。');
      return;
    }
    const focus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setDetailError('');
    try {
      const response = await client.queryEventDetail(eventId);
      if (response.type !== 'event-detail-result') {
        setDetailError('诊断关联事件当前不可用。请返回报告证据页复核。');
        return;
      }
      store.navigateTo({
        viewport: focusedRange(response.detail),
        selectedEventId: eventId,
      }, {
        drawerOpen,
        scrollTop: mainRef.current?.scrollTop ?? 0,
      });
      returnFocus.current.push(focus);
      setDrawerOpen(true);
    } catch {
      setDetailError('诊断跳转失败，已保留当前视口。');
    }
  };

  const restorePrevious = () => {
    const previous = store.restorePrevious();
    if (!previous) return;
    setDrawerOpen(previous.drawerOpen);
    const focus = returnFocus.current.pop();
    requestAnimationFrame(() => {
      if (mainRef.current) mainRef.current.scrollTop = previous.scrollTop;
      focus?.focus();
    });
  };

  const queryEvidence = async () => {
    const evidenceId = clientSnapshot.eventDetail?.detail.evidenceIds[0];
    if (!evidenceId) {
      setEvidenceError('当前事件没有可公开查询的原始证据引用。');
      return;
    }
    setEvidenceError('');
    try {
      const response = await client.queryEvidence(evidenceId);
      if (response.type === 'structured-error') {
        setEvidenceError('原始证据详情查询失败，事件详情仍可使用。');
      }
    } catch {
      setEvidenceError('原始证据详情查询失败，事件详情仍可使用。');
    }
  };

  const close = async () => {
    setClosing(true);
    try {
      await client.close();
    } catch {
      setViewportError('关闭回执未返回，Worker 已执行本地释放。');
    } finally {
      setClosing(false);
    }
  };

  return (
    <section
      className={`trace-timeline-workbench is-${pageState}`}
      aria-labelledby="trace-timeline-workbench-title"
      data-state={pageState}
    >
      <a className="trace-workbench-skip-link" href="#trace-timeline-canvas-region">
        跳到时间轴
      </a>
      <a className="trace-workbench-skip-link" href="#trace-analysis-drawer">
        跳到当前详情
      </a>
      <header className="trace-workbench-toolbar">
        <div>
          <span>PERFORMANCE WORKBENCH · TIMELINE MVP</span>
          <h2 id="trace-timeline-workbench-title">Performance Timeline</h2>
          <p>
            会话 {session.sessionId} · Revision {session.sessionRevision}
            {' · '}{session.eventCount.toLocaleString()} 个索引事件
          </p>
        </div>
        <div className="trace-workbench-toolbar-actions">
          <span className="trace-workbench-state" role="status" aria-live="polite">
            {PAGE_STATE_LABELS[pageState] ?? pageState}
            {querying ? ' · 正在更新当前范围' : ''}
          </span>
          <button type="button" onClick={close} disabled={closing}>关闭工作台</button>
        </div>
      </header>

      <div className="trace-timeline-layout">
        <aside className="trace-insight-navigator" aria-label="诊断与时间范围导航">
          <h3>诊断观察</h3>
          <p>定位仅基于当前 Trace 录制窗口，不升级为跨层根因。</p>
          {diagnoses.length === 0 ? (
            <p>当前没有可定位诊断。可直接检查时间轴事件。</p>
          ) : (
            <ul>
              {diagnoses.slice(0, 8).map(diagnosis => {
                const finding = findingsById.get(`finding:${diagnosis.id}`);
                return (
                  <li key={diagnosis.id}>
                    <button
                      type="button"
                      aria-label={`定位诊断：${diagnosis.title}`}
                      onClick={() => navigateDiagnosis(diagnosis)}
                    >
                      <strong>{diagnosis.title}</strong>
                      <span>
                        {DIAGNOSIS_CONFIDENCE_LABELS[diagnosis.confidence]}
                        {' · '}{DIAGNOSIS_CATEGORY_LABELS[diagnosis.category]}
                        {finding
                          ? ` · ${ATTRIBUTION_LABELS[finding.attributionLevel]}`
                          : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="trace-timeline-main" ref={mainRef}>
          {session.missingCapabilities.length > 0 && (
            <section className="trace-workbench-limitations" aria-labelledby="trace-missing-capabilities">
              <h3 id="trace-missing-capabilities">能力缺失</h3>
              <ul>
                {session.missingCapabilities.map(item => (
                  <li key={item.capability}>
                    {CAPABILITY_LABELS[item.capability] ?? item.capability}
                    ：当前 Trace 未提供该类数据。相关轨道已隐藏，其他轨道仍可使用。
                  </li>
                ))}
              </ul>
            </section>
          )}

          {session.capabilities.includes('screenshots') ? (
            <ScreenshotFilmstrip
              client={client}
              screenshotCount={session.screenshotCount}
              captureRange={session.range}
              hoveredTimestampUs={hoveredEvent?.startUs}
              onSelectTimestamp={timestampUs => {
                const duration = interaction.viewport.endUs - interaction.viewport.startUs;
                store.setCursor(timestampUs);
                store.setSelection({
                  startUs: timestampUs - 5_000,
                  endUs: timestampUs + 5_000,
                });
                store.setViewport({
                  startUs: timestampUs - duration / 2,
                  endUs: timestampUs + duration / 2,
                });
              }}
            />
          ) : (
            <section className="trace-filmstrip is-unavailable" aria-label="截图胶片">
              <strong>Screenshot Filmstrip</strong>
              <p>录制文件未包含截图能力。不会生成或推测历史画面。</p>
            </section>
          )}

          <div id="trace-timeline-canvas-region">
            <TimelineCanvas
              events={events}
              store={store}
              tracks={availableTracks}
              displayedViewport={clientSnapshot.viewport?.range}
              onOpenDetail={openDetail}
              onEscape={() => {
                if (store.hasHistory()) restorePrevious();
                else {
                  setDrawerOpen(false);
                  store.selectEvent(undefined);
                }
              }}
            />
          </div>

          {clientSnapshot.viewport && (
            <p className="trace-result-note" role="status">
              已选择范围内返回 {events.length} 个事件，共匹配
              {' '}{clientSnapshot.viewport.truncation.totalMatched} 个。
              {clientSnapshot.viewport.truncation.truncated
                ? '结果已按上限截断；请缩小范围继续检查。'
                : ''}
            </p>
          )}
          {pageState === 'empty-range' && (
            <div className="trace-workbench-empty" role="status">
              <p>当前范围没有匹配事件。</p>
              <button type="button" onClick={() => store.setViewport(session.range)}>
                返回全局范围
              </button>
            </div>
          )}
          {pageState === 'fatal-worker-error' && (
            <div className="trace-export-error" role="alert">
              <p>
                Worker 会话已失败。不会自动回退到主线程解析；
                请关闭工作台后重新建立会话，或使用报告页的“重新上传”选择文件。
              </p>
            </div>
          )}
          {(viewportError || clientSnapshot.queryErrors.viewport || clientSnapshot.lastError) && (
            <div className="trace-export-error" role="alert">
              <p>
                {viewportError
                  || clientSnapshot.queryErrors.viewport?.error.message
                  || clientSnapshot.lastError?.error.message}
              </p>
              {pageState === 'query-error' && (
                <button type="button" onClick={() => setViewportRetry(value => value + 1)}>
                  重试当前范围
                </button>
              )}
            </div>
          )}

          <section
            id="trace-analysis-drawer"
            className="trace-analysis-drawer"
            aria-labelledby="trace-analysis-drawer-heading"
            aria-hidden={!expertAnalysisEnabled && !drawerOpen && !interaction.selection}
            hidden={!expertAnalysisEnabled && !drawerOpen && !interaction.selection}
          >
            <div>
              <h3 id="trace-analysis-drawer-heading">分析详情</h3>
              {store.hasHistory() && (
                <button type="button" onClick={restorePrevious}>返回先前视口</button>
              )}
            </div>
            {clientSnapshot.eventDetail ? (
              <>
                <p>
                  事件详情 · {clientSnapshot.eventDetail.detail.name}
                  {' · '}{clientSnapshot.eventDetail.detail.category}
                </p>
                <dl>
                  <div><dt>开始</dt><dd>{clientSnapshot.eventDetail.detail.startUs} μs</dd></div>
                  <div><dt>持续</dt><dd>{clientSnapshot.eventDetail.detail.durationUs} μs</dd></div>
                  <div><dt>轨道</dt><dd>{clientSnapshot.eventDetail.detail.trackId}</dd></div>
                  <div>
                    <dt>状态</dt>
                    <dd>{clientSnapshot.eventDetail.detail.status ?? '未标记异常'}</dd>
                  </div>
                  <div>
                    <dt>发起事件</dt>
                    <dd>
                      {clientSnapshot.eventDetail.detail.initiatorId ? (
                        <button
                          type="button"
                          onClick={() => openDetail(clientSnapshot.eventDetail!.detail.initiatorId!)}
                        >
                          跳转发起事件
                        </button>
                      ) : '当前 Trace 未提供'}
                    </dd>
                  </div>
                  <div>
                    <dt>父事件</dt>
                    <dd>
                      {clientSnapshot.eventDetail.detail.parentId ? (
                        <button
                          type="button"
                          onClick={() => openDetail(clientSnapshot.eventDetail!.detail.parentId!)}
                        >
                          跳转父事件
                        </button>
                      ) : '当前 Trace 未提供'}
                    </dd>
                  </div>
                  <div>
                    <dt>子事件</dt>
                    <dd>
                      {clientSnapshot.eventDetail.detail.childIds.length > 0
                        ? clientSnapshot.eventDetail.detail.childIds.slice(0, 5).map(childId => (
                            <button type="button" key={childId} onClick={() => openDetail(childId)}>
                              跳转子事件
                            </button>
                          ))
                        : '当前 Trace 未提供'}
                    </dd>
                  </div>
                </dl>
                <button type="button" onClick={queryEvidence}>查看原始证据白名单详情</button>
              </>
            ) : stableEvent ? (
              <p>已选择 {stableEvent.name}。按 Enter 打开详情。</p>
            ) : (
              <p>选择事件后查看受控详情和原始证据引用。</p>
            )}
            {clientSnapshot.selection && interaction.selection && (
              <section aria-label="当前选区统计">
                <p>
                  选区匹配 {clientSnapshot.selection.matchedCount} 个事件
                  {' · '}
                  {Object.entries(clientSnapshot.selection.trackCounts)
                    .map(([trackId, count]) => `${trackId} ${count}`)
                    .join('，')}
                </p>
                <p>
                  {clientSnapshot.selection.truncation.truncated
                    ? `统计已截断：${clientSnapshot.selection.truncation.reason ?? '请缩小选区'}`
                    : '统计完整，未截断。'}
                </p>
              </section>
            )}
            {clientSnapshot.evidence && (
              <p role="status">
                证据 · {clientSnapshot.evidence.evidence.name
                  ?? clientSnapshot.evidence.evidence.evidenceId}
              </p>
            )}
            {detailError && <p className="trace-export-error" role="alert">{detailError}</p>}
            {selectionError && <p className="trace-export-error" role="alert">{selectionError}</p>}
            {evidenceError && <p className="trace-export-error" role="alert">{evidenceError}</p>}
            {expertAnalysisEnabled && (
              <ExpertAnalysisDrawer
                client={client}
                store={store}
                onOpenEvent={openDetail}
                onEscape={() => {
                  if (store.hasHistory()) restorePrevious();
                  else store.highlightEntity(undefined);
                }}
              />
            )}
          </section>

          <section className="trace-timeline-narrow-list" aria-labelledby="trace-narrow-list-heading">
            <h3 id="trace-narrow-list-heading">窄屏事件列表</h3>
            <p>当前宽度不足以可靠展示完整 Canvas，以下为当前范围的受控事件列表。</p>
            <ol>
              {events.slice(0, 100).map(event => (
                <li key={event.id}>
                  <button type="button" onClick={() => openDetail(event.id)}>
                    {event.name} · {(event.startUs / 1_000).toFixed(2)} ms
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </main>
      </div>
    </section>
  );
};

export default TraceTimelineWorkbench;
