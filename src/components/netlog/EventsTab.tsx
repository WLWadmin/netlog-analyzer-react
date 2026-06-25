import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Select, Table, Tag } from 'antd';
import { CopyOutlined, SearchOutlined } from '@ant-design/icons';
import { SEARCH_DEBOUNCE_MS } from '../../constants/analysisThresholds';
import { copyText } from '../../utils/copyText';
import { useNavigation } from '../../contexts/NavigationContext';
import { getEventDetailInWorker, queryEventsInWorker } from '../../workers/workerClient';
import type { EventRowPreview, QueryEventsResponsePayload } from '../../workers/queryTypes';
import { ENABLE_EVENTS_CONTEXT, ENABLE_EVENTS_TIMELINE } from '../../constants/featureFlags';

interface EventsTabProps {
  analysisId: string;
}

const EventsTab: React.FC<EventsTabProps> = ({ analysisId }) => {
  const { intent, consumeIntent } = useNavigation();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [phaseFilter, setPhaseFilter] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState('');
  const [sourceIdFilter, setSourceIdFilter] = useState('');
  const [paramFieldFilter, setParamFieldFilter] = useState('');
  const [errorOnly, setErrorOnly] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<EventRowPreview[]>([]);
  const [facets, setFacets] = useState<QueryEventsResponsePayload['facets'] | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailText, setDetailText] = useState('');
  const [detailTitle, setDetailTitle] = useState<string>('');

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  };

  // 消费导航意图
  useEffect(() => {
    if (!intent || intent.tab !== 'events') return;
    const f = intent.filters;
    setSearch('');
    setDebouncedSearch('');
    setPhaseFilter('');
    setSourceTypeFilter('');
    setSourceIdFilter('');
    setParamFieldFilter('');
    setErrorOnly(false);
    setPage(1);

    if (f?.keyword) {
      setSearch(f.keyword);
      setDebouncedSearch(f.keyword);
    }
    if (f?.sourceId) setSourceIdFilter(String(f.sourceId));
    if (f?.sourceType) setSourceTypeFilter(String(f.sourceType));
    if (f?.phase) setPhaseFilter(String(f.phase));
    if (f?.paramField) setParamFieldFilter(String(f.paramField));
    if (f?.errorOnly) setErrorOnly(true);
    if (f?.errorCode) {
      setErrorOnly(true);
      setSearch(String(f.errorCode));
      setDebouncedSearch(String(f.errorCode));
    }
    consumeIntent();
  }, [intent, consumeIntent]);

  const currentFilters = useMemo(() => ({
    keyword: debouncedSearch || undefined,
    phase: phaseFilter || undefined,
    sourceType: sourceTypeFilter || undefined,
    sourceId: sourceIdFilter || undefined,
    paramField: paramFieldFilter || undefined,
    errorOnly: errorOnly || undefined,
  }), [debouncedSearch, phaseFilter, sourceTypeFilter, sourceIdFilter, paramFieldFilter, errorOnly]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await queryEventsInWorker({
          analysisId,
          page,
          pageSize,
          filters: currentFilters,
        } as any);
        if (cancelled) return;
        setData(res.items);
        setFacets(res.facets);
        setTotal(res.total);
      } catch {
        if (cancelled) return;
        setData([]);
        setTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [analysisId, page, pageSize, currentFilters]);

  const columns = [
    {
      title: '时间',
      dataIndex: 'time',
      width: 100,
      render: (v: string) => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span>,
    },
    {
      title: 'Source',
      key: 'source',
      width: 180,
      render: (_: unknown, row: EventRowPreview) => (
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {row.sourceType || '-'}#{row.sourceId ?? '-'}
        </span>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'typeName',
      ellipsis: true,
      render: (v: string) => <Tag color="blue" style={{ margin: 0 }}>{v}</Tag>,
    },
    {
      title: 'Phase',
      dataIndex: 'phase',
      width: 120,
      render: (v: string) => <Tag style={{ margin: 0 }}>{v}</Tag>,
    },
    {
      title: 'Error',
      dataIndex: 'errorCode',
      width: 100,
      render: (v: string) => v ? <Tag color="red" style={{ margin: 0 }}>{v}</Tag> : <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    {
      title: 'URL',
      dataIndex: 'url',
      ellipsis: true,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, row: EventRowPreview) => (
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            void copyText(JSON.stringify(row.shortParams || {}, null, 2));
          }}
        >
          复制参数
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(ENABLE_EVENTS_TIMELINE || ENABLE_EVENTS_CONTEXT) ? null : (
        <Alert
          type="info"
          showIcon
          message="性能模式已启用"
          description="事件列表已切换为 Worker 分页查询；时间线视图/上下文窗口/全量 params 搜索默认关闭（可通过 feature flag 恢复）。"
        />
      )}

      <Card
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
        bodyStyle={{ padding: 16 }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索：type/source/phase/error/url（轻量匹配）"
            style={{ width: 360 }}
          />
          <Select
            value={phaseFilter || undefined}
            onChange={(v) => { setPhaseFilter(v || ''); setPage(1); }}
            style={{ width: 160 }}
            allowClear
            placeholder="Phase"
            options={(facets?.phases || []).map(p => ({ value: p, label: p }))}
          />
          <Select
            value={sourceTypeFilter || undefined}
            onChange={(v) => { setSourceTypeFilter(v || ''); setPage(1); }}
            style={{ width: 180 }}
            allowClear
            placeholder="SourceType"
            options={(facets?.sourceTypes || []).map(s => ({ value: s, label: s }))}
          />
          <Input
            value={sourceIdFilter}
            onChange={(e) => { setSourceIdFilter(e.target.value); setPage(1); }}
            allowClear
            placeholder="sourceId"
            style={{ width: 120 }}
          />
          <Input
            value={paramFieldFilter}
            onChange={(e) => { setParamFieldFilter(e.target.value); setPage(1); }}
            allowClear
            placeholder="paramField（仅存在性过滤）"
            style={{ width: 190 }}
          />
          <Select
            value={errorOnly ? 'error' : 'all'}
            onChange={(v) => { setErrorOnly(v === 'error'); setPage(1); }}
            style={{ width: 110 }}
            options={[
              { value: 'all', label: '全部' },
              { value: 'error', label: '仅错误' },
            ]}
          />
        </div>
      </Card>

      <Card
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          rowKey="eventKey"
          size="small"
          columns={columns as any}
          loading={loading}
          dataSource={data}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (current, ps) => { setPage(current); setPageSize(ps); },
          }}
          onRow={(row) => ({
            onClick: async () => {
              setDetailOpen(true);
              setDetailTitle(`${row.typeName} (${row.sourceType}#${row.sourceId})`);
              setDetailText('加载中...');
              try {
                const res = await getEventDetailInWorker({ analysisId, eventKey: row.eventKey, maxParamChars: 5000 } as any);
                setDetailText(res.paramsPreview || '');
              } catch {
                setDetailText('加载失败');
              }
            },
          })}
        />
      </Card>

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        onOk={() => setDetailOpen(false)}
        okText="关闭"
        cancelButtonProps={{ style: { display: 'none' } }}
        title={detailTitle}
        width={980}
      >
        <pre style={{ margin: 0, maxHeight: 520, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {detailText}
        </pre>
      </Modal>
    </div>
  );
};

export default EventsTab;
