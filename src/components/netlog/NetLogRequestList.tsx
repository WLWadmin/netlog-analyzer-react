import { useEffect, useMemo, useState } from 'react';
import { Card, Input, Select, Table, Tag, Modal } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { queryRequestPageInWorker, getRequestDetailInWorker } from '../../workers/workerClient';
import type { NetlogRequestPreview } from '../../workers/summaryTypes';
import type { QueryRequestPageResponsePayload } from '../../workers/queryTypes';
import { formatDuration } from '../../parsers/netlog/parser';
import { SLOW_REQUEST_MS } from '../../constants/analysisThresholds';

interface NetLogRequestListProps {
  analysisId: string;
  timeRange?: { start: number; end: number };
}

const NetLogRequestList: React.FC<NetLogRequestListProps> = ({ analysisId, timeRange }) => {
  const [keyword, setKeyword] = useState('');
  const [host, setHost] = useState<string>('all');
  const [protocol, setProtocol] = useState<string>('all');
  const [status, setStatus] = useState<'all' | 'success' | 'error'>('all');
  const [slowOnly, setSlowOnly] = useState(false);
  const [errorOnly, setErrorOnly] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<NetlogRequestPreview[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<QueryRequestPageResponsePayload['facets'] | undefined>(undefined);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<NetlogRequestPreview | null>(null);

  const filters = useMemo(() => ({
    keyword: keyword.trim() || undefined,
    host: host === 'all' ? undefined : host,
    protocol: protocol === 'all' ? undefined : protocol,
    status,
    slowOnly: slowOnly || undefined,
    errorOnly: errorOnly || undefined,
  }), [keyword, host, protocol, status, slowOnly, errorOnly]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await queryRequestPageInWorker({
          analysisId,
          page,
          pageSize,
          filters,
        } as any);
        if (cancelled) return;
        setData(res.items);
        setTotal(res.total);
        setFacets(res.facets);
      } catch {
        if (cancelled) return;
        setData([]);
        setTotal(0);
        setFacets(undefined);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [analysisId, page, pageSize, filters]);

  const range = timeRange && timeRange.end > timeRange.start ? timeRange : null;
  const renderWaterfall = (req: NetlogRequestPreview) => {
    if (!range || !req.endTime) return null;
    const totalSpan = range.end - range.start;
    const left = ((req.startTime - range.start) / totalSpan) * 100;
    const width = ((req.endTime - req.startTime) / totalSpan) * 100;
    return (
      <div style={{ height: 8, position: 'relative', background: 'rgba(148, 163, 184, 0.15)', borderRadius: 4 }}>
        <div
          style={{
            position: 'absolute',
            left: `${Math.max(0, Math.min(100, left))}%`,
            width: `${Math.max(0.6, Math.min(100 - left, width))}%`,
            height: 8,
            borderRadius: 4,
            background: req.error ? 'rgba(239, 68, 68, 0.6)' : (req.duration || 0) > SLOW_REQUEST_MS ? 'rgba(251, 146, 60, 0.65)' : 'rgba(34, 211, 238, 0.6)',
          }}
        />
      </div>
    );
  };

  const columns = [
    {
      title: '方法',
      dataIndex: 'method',
      width: 80,
      render: (v: string) => <Tag style={{ margin: 0 }}>{v}</Tag>,
    },
    {
      title: 'URL',
      dataIndex: 'url',
      ellipsis: true,
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_: unknown, r: NetlogRequestPreview) => {
        if (r.error) return <Tag color="red" style={{ margin: 0 }}>ERR {r.error}</Tag>;
        if (r.statusCode) return <Tag color={r.statusCode >= 400 ? 'red' : 'green'} style={{ margin: 0 }}>{r.statusCode}</Tag>;
        return <Tag style={{ margin: 0 }}>-</Tag>;
      },
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      width: 110,
      render: (v?: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v || 0)}</span>,
    },
    {
      title: '协议',
      dataIndex: 'protocol',
      width: 90,
      render: (v?: string) => v ? <Tag style={{ margin: 0 }}>{v}</Tag> : <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    {
      title: '瀑布',
      key: 'waterfall',
      width: 220,
      render: (_: unknown, r: NetlogRequestPreview) => renderWaterfall(r),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
        bodyStyle={{ padding: 16 }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索 URL / method / error / protocol"
            style={{ width: 360 }}
          />
          <Select
            value={host}
            onChange={(v) => { setHost(v); setPage(1); }}
            style={{ width: 180 }}
            options={[
              { value: 'all', label: '全部 Host' },
              ...((facets?.hosts || []).slice(0, 200).map(h => ({ value: h, label: h }))),
            ]}
          />
          <Select
            value={protocol}
            onChange={(v) => { setProtocol(v); setPage(1); }}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部协议' },
              ...((facets?.protocols || []).map(p => ({ value: p, label: p }))),
            ]}
          />
          <Select
            value={status}
            onChange={(v) => { setStatus(v as any); setPage(1); }}
            style={{ width: 120 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'success', label: '仅成功' },
              { value: 'error', label: '仅失败' },
            ]}
          />
          <Select
            value={slowOnly ? 'slow' : 'all'}
            onChange={(v) => { setSlowOnly(v === 'slow'); setPage(1); }}
            style={{ width: 130 }}
            options={[
              { value: 'all', label: '全部耗时' },
              { value: 'slow', label: `仅慢请求(>${SLOW_REQUEST_MS}ms)` },
            ]}
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
          rowKey={(r) => String(r.id)}
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
              setDetail(null);
              try {
                const res = await getRequestDetailInWorker({ analysisId, requestId: row.id } as any);
                setDetail(res.request);
              } catch {
                setDetail(null);
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
        title={detail ? `${detail.method} ${detail.url}` : '请求详情'}
        width={980}
      >
        {detail ? (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(detail, null, 2)}
          </pre>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>加载中或加载失败。</div>
        )}
      </Modal>
    </div>
  );
};

export default NetLogRequestList;

