import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, Input, Select, Tag } from 'antd';
import { ApartmentOutlined, ClockCircleOutlined, FilterOutlined, LinkOutlined, SearchOutlined, WarningOutlined } from '@ant-design/icons';
import { formatDuration } from '../../parsers/netlog/parser';
import { getSourceChainDetailInWorker, querySourceChainsInWorker } from '../../workers/workerClient';
import type { GetSourceChainDetailResponsePayload, QuerySourceChainsResponsePayload } from '../../workers/queryTypes';

interface SourceChainViewerProps {
  analysisId: string;
  onNavigateToSource?: (sourceId: number) => void;
}

const SOURCE_TYPE_COLORS: Record<string, string> = {
  URL_REQUEST: '#0ea5e9',
  HTTP_STREAM_JOB: '#6366f1',
  HTTP_STREAM: '#8b5cf6',
  TRANSPORT_CONNECT_JOB: '#f59e0b',
  SOCKET: '#10b981',
  DNS_TRANSACTION: '#ec4899',
  CONNECT_JOB: '#f97316',
  HOST_RESOLVER_IMPL_JOB: '#14b8a6',
  SSL_CONNECT_JOB: '#eab308',
};

const SourceChainViewer: React.FC<SourceChainViewerProps> = ({ analysisId, onNavigateToSource }) => {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'all' | 'error' | 'slow'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [list, setList] = useState<QuerySourceChainsResponsePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedRootId, setExpandedRootId] = useState<number | null>(null);
  const [detail, setDetail] = useState<GetSourceChainDetailResponsePayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const filters = useMemo(() => ({
    keyword: search.trim() || undefined,
    mode,
  }), [search, mode]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await querySourceChainsInWorker({
          analysisId,
          page,
          pageSize,
          filters,
        } as any);
        if (cancelled) return;
        setList(res);
      } catch {
        if (cancelled) return;
        setList({ total: 0, page, pageSize, items: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [analysisId, page, pageSize, filters]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (expandedRootId === null) return;
      setDetailLoading(true);
      setDetail(null);
      try {
        const res = await getSourceChainDetailInWorker({ analysisId, rootId: expandedRootId } as any);
        if (cancelled) return;
        setDetail(res);
      } catch {
        if (cancelled) return;
        setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [analysisId, expandedRootId]);

  const items = list?.items || [];
  if (!loading && items.length === 0) {
    return (
      <Card style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
        <Empty description="未发现 source_dependency 链路数据（或当前筛选无结果）" />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
        bodyStyle={{ padding: 16 }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按 URL 搜索"
            style={{ width: 320 }}
          />
          <Select
            value={mode}
            onChange={(v) => { setMode(v); setPage(1); }}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部' },
              { value: 'error', label: '仅错误' },
              { value: 'slow', label: '仅慢链路' },
            ]}
            suffixIcon={<FilterOutlined />}
          />
          <Select
            value={pageSize}
            onChange={(v) => { setPageSize(v); setPage(1); }}
            style={{ width: 120 }}
            options={[20, 50, 100].map(v => ({ value: v, label: `${v}/页` }))}
          />
          <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12 }}>
            总数：{list?.total ?? '-'}
          </div>
        </div>
      </Card>

      <Card
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
        bodyStyle={{ padding: 12 }}
        title={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ApartmentOutlined /> 源链路</span>}
        loading={loading}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((c) => {
            const expanded = expandedRootId === c.rootId;
            return (
              <div
                key={c.rootId}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  padding: 12,
                  background: 'var(--bg-base)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 200, flex: '1 1 auto' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                      {c.url}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Tag icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{formatDuration(c.duration)}</Tag>
                      <Tag icon={<LinkOutlined />} style={{ margin: 0 }}>深度 {c.depth}</Tag>
                      {c.hasError && (
                        <Tag color="red" icon={<WarningOutlined />} style={{ margin: 0 }}>含错误</Tag>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="small" onClick={() => setExpandedRootId(expanded ? null : c.rootId)}>
                      {expanded ? '收起' : '查看链路'}
                    </Button>
                    <Button
                      size="small"
                      disabled={!onNavigateToSource}
                      onClick={() => onNavigateToSource?.(c.rootId)}
                    >
                      查看 Root 事件
                    </Button>
                  </div>
                </div>

                {expanded && (
                  <div style={{ marginTop: 12 }}>
                    <Card
                      size="small"
                      loading={detailLoading}
                      style={{ background: 'var(--bg-surface)' }}
                      bodyStyle={{ padding: 12 }}
                    >
                      {detail ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, color: 'var(--text-muted)', fontSize: 12 }}>
                            <span>节点数：{detail.nodes.length}{detail.truncated ? '（已截断）' : ''}</span>
                            <Badge count={detail.hasError ? 'error' : 'ok'} color={detail.hasError ? '#ff4d4f' : '#52c41a'} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {detail.nodes.map(n => (
                              <div
                                key={n.id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  padding: '6px 10px',
                                  borderRadius: 8,
                                  border: '1px solid var(--border-color)',
                                  background: 'var(--bg-base)',
                                }}
                              >
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                  <Tag color={SOURCE_TYPE_COLORS[n.type] || 'default'} style={{ margin: 0 }}>{n.type}</Tag>
                                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>#{n.id}</code>
                                  {n.hasError && <Tag color="red" style={{ margin: 0 }}>error</Tag>}
                                </div>
                                <Button size="small" type="link" onClick={() => onNavigateToSource?.(n.id)}>
                                  跳到事件
                                </Button>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div style={{ color: 'var(--text-muted)' }}>未加载到链路详情。</div>
                      )}
                    </Card>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <Button size="small" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</Button>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              第 {page} 页
            </span>
            <Button
              size="small"
              disabled={list ? page * pageSize >= list.total : true}
              onClick={() => setPage(p => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SourceChainViewer;

