import { useState, useMemo, useRef, useEffect } from 'react';
import { Card, Table, Tag, Input, Select, Tooltip, Button, Modal, Spin } from 'antd';
import { SearchOutlined, FilterOutlined, BugOutlined } from '@ant-design/icons';
import { ParsedEvent } from '../parser';

interface EventsTabProps {
  events: ParsedEvent[];
  initialSearch?: string;
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

const EventsTab: React.FC<EventsTabProps> = ({ events, initialSearch = '' }) => {
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 当外部传入的 initialSearch 变化时，同步更新内部搜索状态
  useEffect(() => {
    setSearch(initialSearch);
    setDebouncedSearch(initialSearch);
  }, [initialSearch]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  };
  const [phaseFilter, setPhaseFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sourceIdFilter, setSourceIdFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 100 });
  const [filtering, setFiltering] = useState(false);

  // 筛选条件变化时短暂显示 loading
  useEffect(() => {
    setFiltering(true);
    const timer = setTimeout(() => setFiltering(false), 80);
    return () => clearTimeout(timer);
  }, [debouncedSearch, phaseFilter, sourceFilter, sourceIdFilter]);

  const filtered = useMemo(() => {
    return events.filter(e => {
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

      // When searching for "net_error", use special error-only filter
      if (debouncedSearch === 'net_error') {
        return e.params?.net_error !== undefined && e.params?.net_error !== 0;
      }

      const matchSearch = !debouncedSearch ||
        e.typeName.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        e.source.typeName.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        JSON.stringify(e.params).toLowerCase().includes(debouncedSearch.toLowerCase());

      return matchSearch;
    });
  }, [events, debouncedSearch, phaseFilter, sourceFilter, sourceIdFilter]);

  const phases = [...new Set(events.map(e => e.phaseName))];
  const sourceTypes = [...new Set(events.map(e => e.source.typeName))];

  // Extract top-level event types for better navigation
  const mainEventTypes = [...new Set(events.map(e => {
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
  }))].sort();

  // Quick filter for error events
  const filterByError = () => {
    setSearch('net_error');
    setDebouncedSearch('net_error');
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
    { title: '参数', dataIndex: 'params', key: 'params', width: 200, render: (p: any) => {
      const jsonStr = JSON.stringify(p, null, 2);
      const preview = JSON.stringify(p).substring(0, 50);
      const hasMore = jsonStr.length > 50;
      return (
        <Tooltip
          title={
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{jsonStr}</pre>
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
              setModalContent(jsonStr);
              setModalOpen(true);
            }}
          >
            {hasMore ? `${preview}...` : preview || '-'}
          </span>
        </Tooltip>
      );
    }},
  ];

  return (
    <Card
      title={`📋 全部事件 (${events.length.toLocaleString()})`}
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
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
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
        <Button
          icon={<BugOutlined />}
          onClick={filterByError}
          disabled={!!sourceIdFilter}
          style={{ opacity: sourceIdFilter ? 0.5 : 1 }}
        >
          只看错误
        </Button>
      </div>

      {/* Quick event type tags */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>快速筛选事件大类:</span>
        {mainEventTypes.map(type => (
          <Tag
            key={type}
            color={search === type ? 'blue' : 'default'}
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
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey={(record, index) => `${record.source.id}-${record.type}-${index}`}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            showSizeChanger: true,
            pageSizeOptions: ['50', '100', '200', '500', '1000'],
            showTotal: (total) => `共 ${total.toLocaleString()} 条`,
            onChange: (page, pageSize) => setPagination({ current: page, pageSize }),
          }}
          size="small"
          scroll={{ y: 500 }}
        />
      </Spin>
      <Modal
        open={modalOpen}
        title="事件参数详情"
        onCancel={() => setModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setModalOpen(false)}>关闭</Button>,
          <Button key="copy" type="primary" onClick={() => navigator.clipboard.writeText(modalContent)}>复制 JSON</Button>,
        ]}
        width={700}
        styles={{ body: { maxHeight: 500, overflow: 'auto' } }}
      >
        <pre style={{ margin: 0, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {modalContent}
        </pre>
      </Modal>
    </Card>
  );
};

export default EventsTab;
