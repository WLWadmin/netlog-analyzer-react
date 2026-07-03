import { useEffect, useMemo, useState } from 'react';
import { Card, Input, Tag, Tooltip, Badge, Empty, Select } from 'antd';
import {
  SearchOutlined,
  ApartmentOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import { SOURCE_CHAIN_PREVIEW_COUNT, SOURCE_CHAIN_SLOW_MS } from '../../constants/analysisThresholds';
import { getNetlogSourceChainInWorker } from '../../workers/workerClient';
import type { NetlogSourceChainNodeView, NetlogSourceChainView } from '../../workers/netlogDatasetViews';

interface DatasetSourceChainViewerProps {
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

export default function DatasetSourceChainViewer({ analysisId, onNavigateToSource }: DatasetSourceChainViewerProps) {
  const [view, setView] = useState<NetlogSourceChainView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'error' | 'slow'>('all');
  const [expandedChain, setExpandedChain] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setView(null);
    getNetlogSourceChainInWorker({ analysisId })
      .then(result => {
        if (!cancelled) setView(result);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const filteredChains = useMemo(() => {
    const chains = view?.chains || [];
    return chains.filter(chain => {
      if (filterType === 'error' && !chain.hasError) return false;
      if (filterType === 'slow' && chain.duration <= SOURCE_CHAIN_SLOW_MS) return false;
      if (search && !chain.url.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [view, filterType, search]);

  const stats = useMemo(() => ({
    totalChains: view?.chains.length || 0,
    errorChains: (view?.chains || []).filter(chain => chain.hasError).length,
    avgDepth: view?.chains.length
      ? ((view.chains.reduce((sum, chain) => sum + chain.depth, 0)) / view.chains.length).toFixed(1)
      : '0',
    maxDepth: view?.chains.length ? Math.max(...view.chains.map(chain => chain.depth)) : 0,
  }), [view]);

  if (error) {
    return (
      <Card>
        <Empty description={`Source Chain Dataset 读取失败：${error}`} />
      </Card>
    );
  }

  if (!view) {
    return (
      <Card loading>
        <div style={{ minHeight: 120 }} />
      </Card>
    );
  }

  if (view.chains.length === 0) {
    return (
      <Card>
        <Empty description="Dataset 中未发现 source_dependency 链路数据" />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="总链路数" value={stats.totalChains} />
        <StatCard label="含错误" value={stats.errorChains} color="#ef4444" />
        <StatCard label="平均深度" value={stats.avgDepth} />
        <StatCard label="最大深度" value={stats.maxDepth} />
      </div>

      <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索 URL 或 source#ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 320 }}
            allowClear
          />
          <Select
            value={filterType}
            onChange={setFilterType}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部链路' },
              { value: 'error', label: '仅错误链路' },
              { value: 'slow', label: `慢请求 (>${SOURCE_CHAIN_SLOW_MS / 1000}s)` },
            ]}
          />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            <FilterOutlined /> 显示 {filteredChains.length} / {view.chains.length} 条链路
          </span>
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredChains.slice(0, SOURCE_CHAIN_PREVIEW_COUNT).map((chain) => (
          <ChainCard
            key={chain.rootId}
            chain={chain}
            expanded={expandedChain === chain.rootId}
            onToggle={() => setExpandedChain(expandedChain === chain.rootId ? null : chain.rootId)}
            onNavigateToSource={onNavigateToSource}
          />
        ))}
        {filteredChains.length > SOURCE_CHAIN_PREVIEW_COUNT && (
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
            仅显示前 {SOURCE_CHAIN_PREVIEW_COUNT} 条链路（共 {filteredChains.length} 条）
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border-color)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function ChainCard({
  chain,
  expanded,
  onToggle,
  onNavigateToSource,
}: {
  chain: NetlogSourceChainView['chains'][number];
  expanded: boolean;
  onToggle: () => void;
  onNavigateToSource?: (sourceId: number) => void;
}) {
  const truncUrl = chain.url.length > 80 ? `${chain.url.substring(0, 80)}...` : chain.url;
  return (
    <Card
      size="small"
      styles={{ body: { padding: '12px 16px' } }}
      style={{
        border: chain.hasError ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-color)',
        background: chain.hasError ? 'rgba(239, 68, 68, 0.02)' : 'var(--bg-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={onToggle}>
        <ApartmentOutlined style={{ color: '#6366f1', fontSize: 14 }} />
        <Tooltip title={chain.url}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {truncUrl}
          </span>
        </Tooltip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {chain.hasError && <Badge count={<WarningOutlined style={{ color: '#ef4444', fontSize: 12 }} />} />}
          <Tag style={{ margin: 0, fontSize: 11 }}>
            <ClockCircleOutlined /> {chain.duration.toFixed(0)}ms
          </Tag>
          <Tag style={{ margin: 0, fontSize: 11 }} color="blue">深度 {chain.depth}</Tag>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, paddingLeft: 8 }}>
          <ChainPath nodes={chain.path} onNavigateToSource={onNavigateToSource} />
        </div>
      )}
    </Card>
  );
}

function ChainPath({
  nodes,
  onNavigateToSource,
}: {
  nodes: NetlogSourceChainNodeView[];
  onNavigateToSource?: (sourceId: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {nodes.map((node, index) => (
        <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 16, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
            {index > 0 ? '↳' : ''}
          </div>
          <Tag color={SOURCE_TYPE_COLORS[node.type] || 'default'} style={{ margin: 0, minWidth: 120, textAlign: 'center' }}>
            {node.type}
          </Tag>
          <button
            type="button"
            onClick={() => onNavigateToSource?.(node.id)}
            style={{ border: 0, background: 'transparent', padding: 0, cursor: onNavigateToSource ? 'pointer' : 'default', color: 'var(--accent-primary)' }}
          >
            source#{node.id}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{node.eventCount} events</span>
          {node.hasError && (
            <Tag color="red" style={{ margin: 0 }}>
              error{node.errorCode !== undefined ? ` ${node.errorCode}` : ''}
            </Tag>
          )}
        </div>
      ))}
    </div>
  );
}
