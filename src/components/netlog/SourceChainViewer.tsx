/**
 * SourceChainViewer - 源依赖链路可视化组件
 * 展示 URL_REQUEST → HTTP_STREAM → SOCKET 等层级关系
 * 纯 CSS + Ant Design 实现，无外部图形库依赖
 */

import { useState, useMemo } from 'react';
import { Card, Input, Tag, Tooltip, Badge, Empty, Select, Button } from 'antd';
import {
  SearchOutlined,
  ApartmentOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  LinkOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import type { ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import { SourceChain, SourceNode } from '../../parsers/netlog/sourceGraph';
import { getCachedSourceGraph } from '../../parsers/netlog/sourceGraphCache';
import { SOURCE_CHAIN_PREVIEW_COUNT, SOURCE_CHAIN_SLOW_MS } from '../../constants/analysisThresholds';
import { measurePerf } from '../../utils/perfMark';

interface SourceChainViewerProps {
  events: ParsedEvent[];
  urlRequests: URLRequest[];
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

const SourceChainViewer: React.FC<SourceChainViewerProps> = ({ events, urlRequests, onNavigateToSource }) => {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'error' | 'slow'>('all');
  const [expandedChain, setExpandedChain] = useState<number | null>(null);

  const graph = useMemo(
    () =>
      // 回归指标：用于确认 sourceGraph 缓存仍然命中，避免重复建图。
      measurePerf('SourceChain/getCachedSourceGraph', () =>
        getCachedSourceGraph(events, urlRequests)
      ),
    [events, urlRequests]
  );

  const filteredChains = useMemo(() => {
    let chains = graph.chains;

    if (filterType === 'error') {
      chains = chains.filter(c => c.hasError);
    } else if (filterType === 'slow') {
      chains = chains.filter(c => c.duration > SOURCE_CHAIN_SLOW_MS);
    }

    if (search) {
      const lower = search.toLowerCase();
      chains = chains.filter(c => c.url.toLowerCase().includes(lower));
    }

    return chains;
  }, [graph, search, filterType]);

  const stats = useMemo(() => ({
    totalChains: graph.chains.length,
    errorChains: graph.chains.filter(c => c.hasError).length,
    avgDepth: graph.chains.length > 0
      ? (graph.chains.reduce((s, c) => s + c.depth, 0) / graph.chains.length).toFixed(1)
      : '0',
    maxDepth: graph.chains.length > 0
      ? Math.max(...graph.chains.map(c => c.depth))
      : 0,
  }), [graph]);

  if (graph.chains.length === 0) {
    return (
      <Card>
        <Empty description="未发现 source_dependency 链路数据" />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
      }}>
        <StatCard label="总链路数" value={stats.totalChains} />
        <StatCard label="含错误" value={stats.errorChains} color="#ef4444" />
        <StatCard label="平均深度" value={stats.avgDepth} />
        <StatCard label="最大深度" value={stats.maxDepth} />
      </div>

      {/* Filters */}
      <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索 URL..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 300 }}
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
            <FilterOutlined /> 显示 {filteredChains.length} / {graph.chains.length} 条链路
          </span>
        </div>
      </Card>

      {/* Chain List */}
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
};

// ============ Sub-components ============

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--bg-surface)',
      borderRadius: 10,
      border: '1px solid var(--border-color)',
    }}>
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
  chain: SourceChain;
  expanded: boolean;
  onToggle: () => void;
  onNavigateToSource?: (sourceId: number) => void;
}) {
  const truncUrl = chain.url.length > 80 ? chain.url.substring(0, 80) + '...' : chain.url;

  return (
    <Card
      size="small"
      styles={{ body: { padding: '12px 16px' } }}
      style={{
        border: chain.hasError ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-color)',
        background: chain.hasError ? 'rgba(239, 68, 68, 0.02)' : 'var(--bg-surface)',
      }}
    >
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={onToggle}
      >
        <ApartmentOutlined style={{ color: '#6366f1', fontSize: 14 }} />
        <Tooltip title={chain.url}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {truncUrl}
          </span>
        </Tooltip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {chain.hasError && (
            <Badge count={<WarningOutlined style={{ color: '#ef4444', fontSize: 12 }} />} />
          )}
          <Tag style={{ margin: 0, fontSize: 11 }}>
            <ClockCircleOutlined /> {chain.duration.toFixed(0)}ms
          </Tag>
          <Tag style={{ margin: 0, fontSize: 11 }} color="blue">
            深度 {chain.depth}
          </Tag>
        </div>
      </div>

      {/* Expanded: show chain path */}
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
  nodes: SourceNode[];
  onNavigateToSource?: (sourceId: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {nodes.map((node, i) => (
        <div key={node.id} style={{ display: 'flex', alignItems: 'stretch' }}>
          {/* Connector */}
          <div style={{ width: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: SOURCE_TYPE_COLORS[node.type] || '#9ca3af',
              border: node.hasError ? '2px solid #ef4444' : '2px solid transparent',
              flexShrink: 0,
              marginTop: 6,
            }} />
            {i < nodes.length - 1 && (
              <div style={{ width: 2, flex: 1, background: 'var(--border-color)', minHeight: 16 }} />
            )}
          </div>

          {/* Node content */}
          <div style={{
            flex: 1,
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 32,
          }}>
            <Tag
              color={SOURCE_TYPE_COLORS[node.type] ? undefined : 'default'}
              style={{
                margin: 0,
                fontSize: 11,
                fontFamily: "'SF Mono', monospace",
                background: SOURCE_TYPE_COLORS[node.type] ? `${SOURCE_TYPE_COLORS[node.type]}15` : undefined,
                borderColor: SOURCE_TYPE_COLORS[node.type] || undefined,
                color: SOURCE_TYPE_COLORS[node.type] || undefined,
              }}
            >
              {node.type}
            </Tag>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'SF Mono', monospace" }}>
              #{node.id}
            </span>
            {node.url && (
              <Tooltip title={node.url}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                  {node.url}
                </span>
              </Tooltip>
            )}
            {node.hasError && (
              <Tag color="red" style={{ margin: 0, fontSize: 10 }}>
                ERR {node.errorCode}
              </Tag>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {node.eventCount} events · {(node.endTime - node.startTime).toFixed(0)}ms
            </span>
            {onNavigateToSource && (
              <Button
                type="link"
                size="small"
                style={{ fontSize: 11, padding: 0 }}
                onClick={() => onNavigateToSource(node.id)}
              >
                <LinkOutlined /> 查看事件
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default SourceChainViewer;
