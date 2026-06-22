import { useState, useMemo, useRef, useEffect } from 'react';
import { Card, Table, Tag, Input, Select, Tooltip, Button, Modal, Spin, message, Timeline, Alert } from 'antd';
import { SearchOutlined, FilterOutlined, BugOutlined, UnorderedListOutlined, ClockCircleOutlined, FieldTimeOutlined } from '@ant-design/icons';
import { ParsedEvent } from '../../parsers/netlog/parser';
import { MAX_TIMELINE_GROUPS, MAX_TIMELINE_EVENTS_PER_GROUP, SEARCH_DEBOUNCE_MS, FILTER_SPINNER_DELAY_MS } from '../../constants/analysisThresholds';
import { copyText } from '../../utils/copyText';
import { useNavigation } from '../../contexts/NavigationContext';

interface EventsTabProps {
  events: ParsedEvent[];
}

// Extract error info from event params
const extractErrorInfo = (params: any): { hasError: boolean; errorCode?: string; errorText?: string; ip?: string; duration?: string } => {
  const result: any = { hasError: false };

  // Check for net_error - 0 means OK (no error), only show non-zero values
  if (params?.net_error !== undefined && params?.net_error !== 0) {
    result.hasError = true;
    result.errorCode = params.net_error.toString();
    result.errorText = params?.net_error_string || '';
  }

  // Check for error in params - 0 means OK
  if (params?.error !== undefined && params?.error !== 0) {
    result.hasError = true;
    result.errorCode = params.error.toString();
  }

  // Extract IP info
  if (params?.ip_endpoint) {
    result.ip = params.ip_endpoint;
  } else if (params?.address) {
    result.ip = params.address;
  } else if (params?.peer_address) {
    result.ip = params.peer_address;
  }

  // Extract duration info
  if (params?.total_duration_ms !== undefined) {
    result.duration = params.total_duration_ms + 'ms';
  } else if (params?.duration_ms !== undefined) {
    result.duration = params.duration_ms + 'ms';
  }

  return result;
};

interface EventTableRow extends ParsedEvent {
  searchText: string;
  paramsPreview: string;
  originalIndex: number;
}

const EventsTab: React.FC<EventsTabProps> = ({ events }) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { intent, consumeIntent } = useNavigation();

  // 当导航意图指向事件列表时，自动应用搜索条件
  useEffect(() => {
    if (!intent || intent.tab !== 'events') return;
    const filters = intent.filters;

    setSearch("");
    setDebouncedSearch("");
    setSourceIdFilter("");
    setSourceFilter("");
    setPhaseFilter("");
    setParamFieldFilter("");
    setPagination(prev => ({ ...prev, current: 1 }));

    let nextSearch = "";
    if (filters?.errorCode) {
      nextSearch = `net_error:${filters.errorCode}`;
    } else if (filters?.eventType) {
      nextSearch = filters.eventType;
    } else if (filters?.keyword) {
      nextSearch = filters.keyword;
    } else if (filters?.errorOnly) {
      nextSearch = 'net_error';
    }

    if (nextSearch) {
      setSearch(nextSearch);
      setDebouncedSearch(nextSearch);
    }
    if (filters?.sourceId) {
      setSourceIdFilter(filters.sourceId);
    }
    if (filters?.sourceType) {
      setSourceFilter(filters.sourceType);
    }
    if (filters?.phase) {
      setPhaseFilter(filters.phase);
    }
    if (filters?.paramField) {
      setParamFieldFilter(filters.paramField);
    }
    consumeIntent();
  }, [intent, consumeIntent]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };
  const [phaseFilter, setPhaseFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sourceIdFilter, setSourceIdFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 100 });
  const [filtering, setFiltering] = useState(false);

  // 新增：视图模式（列表 / 时间线）
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  // 新增：参数字段级过滤
  const [paramFieldFilter, setParamFieldFilter] = useState('');
  // 新增：上下文窗口
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [contextIndex, setContextIndex] = useState<number>(-1);
  const [contextWindowSize, setContextWindowSize] = useState(10);

  // 筛选条件变化时短暂显示 loading
  useEffect(() => {
    setFiltering(true);
    const timer = setTimeout(() => setFiltering(false), FILTER_SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [debouncedSearch, phaseFilter, sourceFilter, sourceIdFilter, paramFieldFilter]);

  const eventRows = useMemo<EventTableRow[]>(() => {
    return events.map((e, originalIndex) => {
      // 只索引关键字段，params 做 shallow 索引（只取第一层值）
      const paramsShallow = e.params ? Object.entries(e.params).map(([k, v]) => `${k}:${v}`).join(' ') : '';
      return {
        ...e,
        originalIndex,
        paramsPreview: paramsShallow.substring(0, 50),
        searchText: `${e.typeName} ${e.source.typeName} ${e.source.id} ${e.time} ${paramsShallow}`.toLowerCase(),
      };
    });
  }, [events]);

  // 提取所有参数字段名
  const paramFields = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (e.params && typeof e.params === 'object') {
        Object.keys(e.params).forEach(k => set.add(k));
      }
    }
    return ['', ...Array.from(set).sort()];
  }, [events]);

  const filtered = useMemo(() => {
    const normalizedSearch = debouncedSearch.toLowerCase();
    return eventRows
      .filter(e => {
      // Source ID exact match takes priority
      if (sourceIdFilter) {
        return e.source.id.toString() === sourceIdFilter;
      }

      // Phase filter must always be respected
      if (phaseFilter && e.phaseName !== phaseFilter) {
        return false;
      }

      // Source type filter must always be respected
      if (sourceFilter && e.source.typeName !== sourceFilter) {
        return false;
      }

      // Param field filter
      if (paramFieldFilter) {
        if (!e.params || !(paramFieldFilter in e.params)) return false;
      }

      // When searching for "net_error", use special error-only filter
      if (normalizedSearch === 'net_error') {
        return e.params?.net_error !== undefined && e.params?.net_error !== 0;
      }

      // 支持 "net_error:-105" 精确匹配语法
      if (normalizedSearch.startsWith('net_error:')) {
        const targetCode = normalizedSearch.replace('net_error:', '');
        return e.params?.net_error !== undefined
          && e.params?.net_error !== 0
          && e.params?.net_error.toString() === targetCode;
      }

      return !normalizedSearch || e.searchText.includes(normalizedSearch);
    });
  }, [eventRows, debouncedSearch, phaseFilter, sourceFilter, sourceIdFilter, paramFieldFilter]);

  const phases = useMemo(() => [...new Set(events.map(e => e.phaseName))], [events]);
  const sourceTypes = useMemo(() => [...new Set(events.map(e => e.source.typeName))], [events]);

  // Extract top-level event types for better navigation
  const mainEventTypes = useMemo(() => [...new Set(events.map(e => {
    const name = e.typeName;
    if (name.startsWith('URL_REQUEST')) return 'URL_REQUEST';
    if (name.startsWith('HTTP_STREAM')) return 'HTTP_STREAM';
    if (name.startsWith('HTTP_TRANSACTION')) return 'HTTP_TRANSACTION';
    if (name.startsWith('SOCKET')) return 'SOCKET';
    if (name.startsWith('DNS')) return 'DNS';
    if (name.startsWith('PROXY')) return 'PROXY';
    if (name.startsWith('SSL')) return 'SSL';
    if (name.startsWith('QUIC')) return 'QUIC';
    if (name.startsWith('TCP')) return 'TCP';
    return 'OTHER';
  }))].sort(), [events]);

  // Quick filter for error events
  const filterByError = () => {
    setSearch('net_error');
    setDebouncedSearch('net_error');
  };

  const handleCopyModalContent = async () => {
    try {
      await copyText(modalContent);
      message.success('JSON 已复制');
    } catch {
      message.error('复制失败，请手动选择内容复制');
    }
  };

  // 上下文窗口数据
  const contextEvents = useMemo(() => {
    if (contextIndex < 0) return [];
    const start = Math.max(0, contextIndex - contextWindowSize);
    const end = Math.min(events.length, contextIndex + contextWindowSize + 1);
    return events.slice(start, end).map((e, i) => ({ ...e, relativeIndex: start + i }));
  }, [contextIndex, contextWindowSize, events]);

  const openContext = (index: number) => {
    setContextIndex(index);
    setContextModalOpen(true);
  };

  const columns = [
    { title: '时间', dataIndex: 'time', key: 'time', width: 90, render: (t: number) => <span style={{ fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: 12, color: 'var(--text-muted)' }}>{t.toFixed(0)}</span> },
    { title: '阶段', dataIndex: 'phaseName', key: 'phase', width: 80, render: (p: string) => (
      <Tag color={p === 'BEGIN' ? 'green' : p === 'END' ? 'blue' : 'default'} style={{ fontSize: 11 }}>{p}</Tag>
    )},
    { title: '事件类型', dataIndex: 'typeName', key: 'type', width: 220, render: (t: string) => (
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{t}</span>
    )},
    { title: '来源类型', dataIndex: 'source', key: 'source', width: 120, render: (s: any) => (
      <Tooltip title={s.typeName} placement="top">
        <span style={{ display: 'inline-block', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Tag color="cyan" style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.typeName}</Tag>
        </span>
      </Tooltip>
    )},
    { title: '来源ID', dataIndex: 'source', key: 'sourceId', width: 80, render: (s: any) => (
      <span style={{ fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: 12, color: 'var(--text-muted)' }}>{s.id}</span>
    )},
    { title: '错误/状态', dataIndex: 'params', key: 'error', width: 140, render: (p: any) => {
      const errorInfo = extractErrorInfo(p);
      if (!errorInfo.hasError) {
        return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>;
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Tag color="red" style={{ fontSize: 11, margin: 0 }}>
            {errorInfo.errorCode} {errorInfo.errorText}
          </Tag>
          {errorInfo.duration && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>耗时: {errorInfo.duration}</span>
          )}
          {errorInfo.ip && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>IP: {errorInfo.ip}</span>
          )}
        </div>
      );
    }},
    { title: '参数', key: 'params', width: 200, render: (_: unknown, row: EventTableRow) => {
      const paramsPreview = row.paramsPreview || '-';
      return (
        <Tooltip
          title={
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(row.params || {}, null, 2)}
              </pre>
            </div>
          }
          placement="left"
          overlayStyle={{ maxWidth: 500 }}
        >
          <span
            style={{
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontSize: 13,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-block',
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            onClick={() => {
              setModalContent(JSON.stringify(row.params || {}, null, 2));
              setModalOpen(true);
            }}
          >
            {paramsPreview}
          </span>
        </Tooltip>
      );
    }},
    {
      title: '上下文',
      key: 'context',
      width: 80,
      align: 'center' as const,
      render: (_: unknown, row: EventTableRow, index: number) => (
        <Button
          size="small"
          type="link"
          style={{ fontSize: 12, padding: 0 }}
          onClick={() => openContext(row.originalIndex)}
        >
          <FieldTimeOutlined /> 前后
        </Button>
      ),
    },
  ];

  // Source ID 聚合时间线数据
  const timelineData = useMemo(() => {
    const groups = new Map<number, ParsedEvent[]>();
    for (const e of filtered) {
      const list = groups.get(e.source.id) || [];
      list.push(e);
      groups.set(e.source.id, list);
    }
    const sortedGroups = Array.from(groups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sourceId, evs]) => ({
        sourceId,
        sourceType: evs[0]?.source.typeName || 'Unknown',
        events: evs.sort((a, b) => a.time - b.time),
        count: evs.length,
        hasError: evs.some(e => {
          const info = extractErrorInfo(e.params);
          return info.hasError;
        }),
      }));
    return sortedGroups;
  }, [filtered]);

  const limitedTimelineData = useMemo(() => {
    return timelineData
      .slice(0, MAX_TIMELINE_GROUPS)
      .map(g => ({
        ...g,
        totalEvents: g.events.length,
        events: g.events.slice(0, MAX_TIMELINE_EVENTS_PER_GROUP),
      }));
  }, [timelineData]) as Array<{
    sourceId: number;
    sourceType: string;
    events: ParsedEvent[];
    count: number;
    hasError: boolean;
    totalEvents?: number;
  }>;

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UnorderedListOutlined /> 全部事件 ({events.length.toLocaleString()})
        </span>
      }
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
    >
      {/* Source ID Filter - Prominent exact match */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FilterOutlined style={{ color: 'var(--accent-blue)', fontSize: 14 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>来源ID精确筛选:</span>
        </div>
        <div style={{ position: 'relative', width: 320 }}>
          <Input
            placeholder="输入来源ID精确匹配..."
            value={sourceIdFilter}
            onChange={e => {
              setSourceIdFilter(e.target.value);
              setPagination({ ...pagination, current: 1 });
            }}
            style={{
              width: '100%',
              background: 'var(--bg-base)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
        {sourceIdFilter && (
          <Tag color="blue" style={{ fontSize: 12 }}>
            来源ID: {sourceIdFilter} ({filtered.length} 条)
          </Tag>
        )}
      </div>

      {/* General Search & Filters */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: 320 }}>
          <SearchOutlined style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', zIndex: 1, fontSize: 14 }} />
          <Input
            placeholder="搜索事件类型、参数内容..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            disabled={!!sourceIdFilter}
            style={{
              width: '100%',
              paddingLeft: 36,
              background: 'var(--bg-base)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-primary)',
              opacity: sourceIdFilter ? 0.5 : 1,
            }}
          />
        </div>
        <Select
          placeholder="阶段筛选"
          value={phaseFilter || undefined}
          onChange={setPhaseFilter}
          disabled={!!sourceIdFilter}
          allowClear
          style={{ width: 140, opacity: sourceIdFilter ? 0.5 : 1 }}
          options={phases.map(p => ({ label: p, value: p }))}
        />
        <Select
          placeholder="来源类型筛选"
          value={sourceFilter || undefined}
          onChange={setSourceFilter}
          disabled={!!sourceIdFilter}
          allowClear
          style={{ width: 200, opacity: sourceIdFilter ? 0.5 : 1 }}
          options={sourceTypes.map(s => ({ label: s, value: s }))}
        />
        <Select
          placeholder="参数字段筛选"
          value={paramFieldFilter || undefined}
          onChange={setParamFieldFilter}
          disabled={!!sourceIdFilter}
          allowClear
          style={{ width: 180, opacity: sourceIdFilter ? 0.5 : 1 }}
          options={paramFields.map(f => ({ label: f || '全部字段', value: f }))}
          showSearch
        />
        <Button
          icon={<BugOutlined />}
          onClick={filterByError}
          disabled={!!sourceIdFilter}
          style={{ opacity: sourceIdFilter ? 0.5 : 1 }}
        >
          只看错误
        </Button>
      </div>

      {/* View Mode Toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>视图模式:</span>
        <Tag
          color={viewMode === 'list' ? 'blue' : 'default'}
          style={{ cursor: 'pointer', fontSize: 12 }}
          onClick={() => setViewMode('list')}
        >
          <UnorderedListOutlined /> 列表
        </Tag>
        <Tag
          color={viewMode === 'timeline' ? 'blue' : 'default'}
          style={{ cursor: 'pointer', fontSize: 12 }}
          onClick={() => setViewMode('timeline')}
        >
          <ClockCircleOutlined /> 时间线
        </Tag>
      </div>

      {/* Quick event type tags */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>快速筛选事件大类:</span>
        {mainEventTypes.map(type => (
          <Tag
            key={type}
            color={search === type ? 'blue' : 'default'}
            className="event-filter-tag"
            style={{ cursor: 'pointer', fontSize: 12 }}
            onClick={() => {
              if (sourceIdFilter) return;
              const next = search === type ? '' : type;
              setSearch(next);
              setDebouncedSearch(next);
            }}
          >
            {type}
          </Tag>
        ))}
      </div>

      <Spin spinning={filtering} tip="筛选中..." size="small">
        {viewMode === 'list' ? (
          <Table
            dataSource={filtered}
            columns={columns}
            rowKey={(record, index) => `${record.source.id}-${record.type}-${index}`}
            pagination={false}
            virtual
            scroll={{ y: 600 }}
            size="small"
          />
        ) : (
          <div style={{ maxHeight: 600, overflow: 'auto', padding: '8px 0' }}>
            {timelineData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                <FilterOutlined style={{ fontSize: 32, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
                <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>数据量过大，请先通过 Source ID 或事件类型筛选后再查看时间线</div>
              </div>
            ) : (
              <>
                {timelineData.length > MAX_TIMELINE_GROUPS && (
                  <Alert
                    type="warning"
                    message={`时间线数据量过大（${timelineData.length} 个分组），仅展示前 ${MAX_TIMELINE_GROUPS} 个分组。建议使用筛选条件缩小范围。`}
                    style={{ marginBottom: 16 }}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {limitedTimelineData.map(group => (
                  <Card
                    key={group.sourceId}
                    size="small"
                    style={{
                      background: 'var(--bg-surface)',
                      borderColor: group.hasError ? 'rgba(255, 77, 79, 0.2)' : 'var(--border-color)',
                      borderLeft: group.hasError ? '3px solid #ff4d4f' : 'none',
                    }}
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag color="cyan">{group.sourceType}</Tag>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                          Source ID: {group.sourceId}
                        </span>
                        <Tag style={{ fontSize: 11, margin: 0 }}>{group.count} 个事件</Tag>
                        {group.hasError && <Tag color="error" style={{ fontSize: 11, margin: 0 }}>含错误</Tag>}
                      </div>
                    }
                  >
                    <Timeline mode="left" style={{ marginTop: 8 }}>
                      {group.events.map((ev, i) => {
                        const errInfo = extractErrorInfo(ev.params);
                        return (
                          <Timeline.Item
                            key={i}
                            color={errInfo.hasError ? 'red' : ev.phaseName === 'BEGIN' ? 'green' : ev.phaseName === 'END' ? 'blue' : 'gray'}
                            label={
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                                {ev.time.toFixed(0)}ms
                              </span>
                            }
                          >
                            <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                              {ev.typeName}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {ev.phaseName}
                              {errInfo.hasError && (
                                <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                                  {errInfo.errorCode} {errInfo.errorText}
                                </span>
                              )}
                            </div>
                          </Timeline.Item>
                        );
                      })}
                    </Timeline>
                    {group.totalEvents !== undefined && group.totalEvents > group.events.length && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0 8px 24px' }}>
                        还有 {group.totalEvents - group.events.length} 条事件未显示，请使用筛选条件缩小范围
                      </div>
                    )}
                  </Card>
                ))}
              </div>
              </>
            )}
          </div>
        )}
      </Spin>

      {/* 事件参数详情弹窗 */}
      <Modal
        open={modalOpen}
        title="事件参数详情"
        onCancel={() => setModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setModalOpen(false)}>关闭</Button>,
          <Button key="copy" type="primary" onClick={handleCopyModalContent}>复制 JSON</Button>,
        ]}
        width={700}
        styles={{ body: { maxHeight: 500, overflow: 'auto' } }}
      >
        <pre style={{ margin: 0, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {modalContent}
        </pre>
      </Modal>

      {/* 上下文窗口弹窗 */}
      <Modal
        open={contextModalOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FieldTimeOutlined style={{ color: 'var(--accent-blue)' }} />
            <span>事件上下文窗口</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              (前后 {contextWindowSize} 条，共 {contextEvents.length} 条)
            </span>
          </div>
        }
        onCancel={() => setContextModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setContextModalOpen(false)}>关闭</Button>,
        ]}
        width={800}
        styles={{ body: { maxHeight: 600, overflow: 'auto', background: 'var(--bg-elevated)' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>窗口大小:</span>
          <Select
            value={contextWindowSize}
            onChange={setContextWindowSize}
            size="small"
            style={{ width: 100 }}
            options={[
              { value: 5, label: '5 条' },
              { value: 10, label: '10 条' },
              { value: 20, label: '20 条' },
              { value: 50, label: '50 条' },
            ]}
          />
        </div>
        <Timeline mode="left">
          {contextEvents.map((ev, i) => {
            const isCenter = ev.relativeIndex === contextIndex;
            const errInfo = extractErrorInfo(ev.params);
            return (
              <Timeline.Item
                key={i}
                color={isCenter ? 'blue' : errInfo.hasError ? 'red' : ev.phaseName === 'BEGIN' ? 'green' : ev.phaseName === 'END' ? 'blue' : 'gray'}
                label={
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: isCenter ? 'var(--accent-blue)' : 'var(--text-muted)',
                    fontWeight: isCenter ? 700 : 400,
                  }}>
                    {ev.time.toFixed(0)}ms
                  </span>
                }
              >
                <div style={{
                  padding: '8px 12px',
                  background: isCenter ? 'rgba(74, 158, 255, 0.06)' : 'transparent',
                  borderRadius: 6,
                  border: isCenter ? '1px solid rgba(74, 158, 255, 0.2)' : 'none',
                }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {ev.typeName}
                    {isCenter && <Tag color="blue" style={{ fontSize: 10, marginLeft: 8, margin: 0 }}>当前位置</Tag>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {ev.phaseName} · {ev.source.typeName} · Source ID: {ev.source.id}
                    {errInfo.hasError && (
                      <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                        {errInfo.errorCode} {errInfo.errorText}
                      </span>
                    )}
                  </div>
                  {ev.params && Object.keys(ev.params).length > 0 && (
                    <pre style={{
                      margin: '6px 0 0 0',
                      padding: 6,
                      background: 'var(--bg-base)',
                      borderRadius: 4,
                      fontSize: 10,
                      lineHeight: 1.4,
                      color: 'var(--text-muted)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      maxHeight: 80,
                      overflow: 'auto',
                    }}>
                      {JSON.stringify(ev.params, null, 2)}
                    </pre>
                  )}
                </div>
              </Timeline.Item>
            );
          })}
        </Timeline>
      </Modal>
    </Card>
  );
};

export default EventsTab;
