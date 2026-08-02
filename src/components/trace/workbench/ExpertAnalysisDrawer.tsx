import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type {
  WorkbenchAnalysisNodeDto,
  WorkbenchTimelineEventDto,
} from '../../../workbench/protocol';
import type { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';
import { TIMELINE_TRACKS } from '../../../workbench/timelineTracks';
import FlameChartCanvas from './FlameChartCanvas';

type AnalysisTab = 'summary' | 'flame' | 'call-tree' | 'bottom-up' | 'event-log';

interface ExpertAnalysisDrawerProps {
  client: TraceWorkbenchClient;
  store: TimelineInteractionStore;
  onOpenEvent(eventId: string): void;
  onEscape(): void;
}

const TABS: Array<{ id: AnalysisTab; label: string }> = [
  { id: 'summary', label: '摘要' },
  { id: 'flame', label: 'Flame Chart' },
  { id: 'call-tree', label: 'Call Tree' },
  { id: 'bottom-up', label: 'Bottom-up' },
  { id: 'event-log', label: 'Event Log' },
];

function VirtualRows<T extends { id: string }>({
  rows,
  render,
  initialScrollTop,
  onScrollTop,
}: {
  rows: T[];
  render(row: T): React.ReactNode;
  initialScrollTop: number;
  onScrollTop(value: number): void;
}) {
  const [start, setStart] = useState(() => Math.floor(initialScrollTop / 30));
  const pageSize = 80;
  const boundedStart = Math.min(start, Math.max(0, rows.length - 1));
  const visible = rows.slice(boundedStart, boundedStart + pageSize);
  return (
    <div
      className="trace-analysis-virtual-list"
      ref={element => {
        if (element && Math.abs(element.scrollTop - initialScrollTop) > 1) {
          element.scrollTop = initialScrollTop;
        }
      }}
      onScroll={event => {
        const next = Math.floor(event.currentTarget.scrollTop / 30);
        if (next !== start) setStart(next);
        onScrollTop(event.currentTarget.scrollTop);
      }}
    >
      <div style={{ height: boundedStart * 30 }} aria-hidden="true" />
      {visible.map(render)}
      <div
        style={{ height: Math.max(0, rows.length - boundedStart - visible.length) * 30 }}
        aria-hidden="true"
      />
    </div>
  );
}

const ExpertAnalysisDrawer: React.FC<ExpertAnalysisDrawerProps> = ({
  client,
  store,
  onOpenEvent,
  onEscape,
}) => {
  const clientSnapshot = useSyncExternalStore(
    client.subscribe.bind(client),
    client.getSnapshot.bind(client),
    client.getSnapshot.bind(client),
  );
  const interaction = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [activeTab, setActiveTab] = useState<AnalysisTab>('summary');
  const [sort, setSort] = useState<'self-time' | 'total-time' | 'sample-hits'>(
    'total-time',
  );
  const [searchInput, setSearchInput] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [querying, setQuerying] = useState(false);
  const [scrollTopByTab, setScrollTopByTab] = useState<Record<AnalysisTab, number>>({
    summary: 0,
    flame: 0,
    'call-tree': 0,
    'bottom-up': 0,
    'event-log': 0,
  });
  const range = interaction.selection ?? interaction.viewport;
  const visibleTrackIds = useMemo(() => TIMELINE_TRACKS
    .map(track => track.id)
    .filter(trackId => !interaction.hiddenTrackIds.includes(trackId)), [
    interaction.hiddenTrackIds,
  ]);

  useEffect(() => {
    if (activeTab === 'summary') return;
    let disposed = false;
    const loadingTimer = window.setTimeout(() => {
      if (!disposed) setQuerying(true);
    }, 300);
    const request = activeTab === 'flame'
      ? client.queryFlameChart(range)
      : activeTab === 'call-tree'
        ? client.queryCallTree(range, sort)
        : activeTab === 'bottom-up'
          ? client.queryBottomUp(range, sort)
          : client.queryEventLog(range, { trackIds: visibleTrackIds });
    void request.catch(() => undefined).finally(() => {
      window.clearTimeout(loadingTimer);
      if (!disposed) setQuerying(false);
    });
    return () => {
      disposed = true;
      window.clearTimeout(loadingTimer);
    };
  }, [
    activeTab,
    client,
    range,
    sort,
    visibleTrackIds,
  ]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = searchInput.trim();
    if (!query) {
      client.clearSearch();
      return;
    }
    void client.querySearch(range, query, { trackIds: visibleTrackIds });
  };

  useEffect(() => {
    setSearchIndex(0);
  }, [clientSnapshot.search?.requestId]);

  const navigateSearch = (delta: number) => {
    const events = clientSnapshot.search?.events ?? [];
    if (events.length === 0) return;
    const next = (searchIndex + delta + events.length) % events.length;
    setSearchIndex(next);
    onOpenEvent(events[next].id);
  };

  const activateNode = (node: WorkbenchAnalysisNodeDto) => {
    store.highlightEntity(node.entityId);
  };

  const openNodeEvidence = (node: WorkbenchAnalysisNodeDto) => {
    const sourceIndex = node.evidenceIds
      .map(evidenceId => /^trace:event:(0|[1-9]\d*)$/.exec(evidenceId)?.[1])
      .find((value): value is string => value !== undefined);
    if (sourceIndex !== undefined) {
      onOpenEvent(`trace:timeline:${sourceIndex}`);
    }
  };

  const rememberScroll = (tab: AnalysisTab, value: number) => {
    setScrollTopByTab(current => (
      current[tab] === value ? current : { ...current, [tab]: value }
    ));
  };

  const renderEvents = (events: WorkbenchTimelineEventDto[]) => (
    <VirtualRows
      key="event-log"
      rows={events}
      initialScrollTop={scrollTopByTab['event-log']}
      onScrollTop={value => rememberScroll('event-log', value)}
      render={event => (
        <button
          className="trace-analysis-row"
          key={event.id}
          type="button"
          onClick={() => onOpenEvent(event.id)}
        >
          <strong>{event.name}</strong>
          <span>
            {TIMELINE_TRACKS.find(track => track.id === event.trackId)?.label ?? '其他轨道'}
            {' · '}{(event.startUs / 1_000).toFixed(2)} ms
          </span>
        </button>
      )}
    />
  );

  const renderNodes = (
    nodes: WorkbenchAnalysisNodeDto[],
    tab: 'call-tree' | 'bottom-up',
  ) => (
    <VirtualRows
      key={tab}
      rows={nodes}
      initialScrollTop={scrollTopByTab[tab]}
      onScrollTop={value => rememberScroll(tab, value)}
      render={node => (
        <div
          className="trace-analysis-row"
          key={node.id}
          data-selected={interaction.highlightedEntityId === node.entityId}
        >
          <button
            type="button"
            aria-pressed={interaction.highlightedEntityId === node.entityId}
            onClick={() => activateNode(node)}
          >
            <strong>{node.functionName}</strong>
          </button>
          <span>
            self {(node.selfTimeUs / 1_000).toFixed(2)} ms · total
            {' '}{(node.totalTimeUs / 1_000).toFixed(2)} ms · 采样命中
            {' '}{node.sampleHits} 次
          </span>
          <button type="button" onClick={() => openNodeEvidence(node)}>
            查看原始证据
          </button>
        </div>
      )}
    />
  );

  return (
    <section className="trace-expert-analysis" aria-labelledby="trace-expert-heading">
      <header>
        <div>
          <span>EXPERT ANALYSIS · INTERNAL</span>
          <h3 id="trace-expert-heading">专家分析</h3>
        </div>
        <form role="search" onSubmit={submitSearch}>
          <label htmlFor="trace-expert-search">搜索当前范围</label>
          <input
            id="trace-expert-search"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="名称、分类或轨道"
          />
          <button type="submit">查找</button>
          {clientSnapshot.search && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                client.clearSearch();
              }}
            >
              清空搜索
            </button>
          )}
        </form>
      </header>

      {clientSnapshot.search && (
        <section className="trace-search-results" aria-label="搜索结果">
          <p>
            “{clientSnapshot.search.query}” 共
            {' '}{clientSnapshot.search.truncation.totalMatched} 项，当前
            {' '}{clientSnapshot.search.events.length > 0 ? searchIndex + 1 : 0}，
            范围 {(clientSnapshot.search.range.startUs / 1_000).toFixed(2)}
            –{(clientSnapshot.search.range.endUs / 1_000).toFixed(2)} ms。
            {clientSnapshot.search.truncation.truncated ? '结果已截断。' : ''}
          </p>
          <button
            type="button"
            disabled={clientSnapshot.search.events.length === 0}
            onClick={() => navigateSearch(-1)}
          >
            上一个
          </button>
          <button
            type="button"
            disabled={clientSnapshot.search.events.length === 0}
            onClick={() => navigateSearch(1)}
          >
            下一个
          </button>
        </section>
      )}

      <div className="trace-analysis-tabs" role="tablist" aria-label="分析视图">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(activeTab === 'call-tree' || activeTab === 'bottom-up') && (
        <label className="trace-analysis-sort">
          排序
          <select value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
            <option value="self-time">Self time</option>
            <option value="total-time">Total time</option>
            <option value="sample-hits">采样命中次数</option>
          </select>
        </label>
      )}
      {querying && <p role="status">正在更新当前分析视图，已保留稳定结果。</p>}
      {clientSnapshot.queryErrors.cpu && (
        <p className="trace-export-error" role="alert">CPU 分析查询失败，其他标签仍可使用。</p>
      )}
      {clientSnapshot.queryErrors.search && (
        <p className="trace-export-error" role="alert">搜索失败，当前选区未改变。</p>
      )}
      {clientSnapshot.queryErrors['event-log'] && (
        <p className="trace-export-error" role="alert">Event Log 查询失败，其他标签仍可使用。</p>
      )}

      <div role="tabpanel" className="trace-analysis-tabpanel">
        {activeTab === 'summary' && (
          <p>
            当前范围 {(range.startUs / 1_000).toFixed(2)}
            –{(range.endUs / 1_000).toFixed(2)} ms。
            CPU 数量表示采样命中次数，不等同于函数真实调用次数。
          </p>
        )}
        {activeTab === 'flame' && clientSnapshot.flameChart && (
          <FlameChartCanvas
            frames={clientSnapshot.flameChart.frames}
            store={store}
            onEscape={onEscape}
          />
        )}
        {activeTab === 'call-tree' && clientSnapshot.callTree
          ? renderNodes(clientSnapshot.callTree.nodes, 'call-tree')
          : null}
        {activeTab === 'bottom-up' && clientSnapshot.bottomUp
          ? renderNodes(clientSnapshot.bottomUp.nodes, 'bottom-up')
          : null}
        {activeTab === 'event-log' && clientSnapshot.eventLog
          ? renderEvents(clientSnapshot.eventLog.events)
          : null}
      </div>
    </section>
  );
};

export default ExpertAnalysisDrawer;
