import { useState, useMemo } from 'react';
import { Table, Input, Tag, Drawer, Badge } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import {
  HarRequestEntry,
  HarAnalysisResult,
  CATEGORY_LABELS,
  statusStyle,
  categoryStyle,
  categoryColor,
  filterTagStyle,
  formatBytes,
  formatHarTime,
} from '../../harParser';
import HarRequestDetail from './HarRequestDetail';

export type StatusFilter = 'all' | 'failed' | 'slow';

interface HarRequestTableProps {
  result: HarAnalysisResult;
  statusFilter?: StatusFilter;
  onStatusFilterChange?: (f: StatusFilter) => void;
}

const STATUS_FILTERS: { key: StatusFilter; label: string; color: string; bg: string }[] = [
  { key: 'all', label: '全部状态', color: '#374151', bg: '#e5e7eb' },
  { key: 'failed', label: '失败请求', color: '#b91c1c', bg: '#fee2e2' },
  { key: 'slow', label: '慢请求', color: '#c2410c', bg: '#ffedd5' },
];

const HarRequestTable: React.FC<HarRequestTableProps> = ({ result, statusFilter, onStatusFilterChange }) => {
  const [category, setCategory] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [innerStatus, setInnerStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<HarRequestEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const status: StatusFilter = statusFilter ?? innerStatus;
  const setStatus = (f: StatusFilter) => {
    setInnerStatus(f);
    onStatusFilterChange?.(f);
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return result.entries.filter(e => {
      if (category !== 'all' && e.category !== category) return false;
      if (status === 'failed' && !e.isFailed) return false;
      if (status === 'slow' && !e.isSlow) return false;
      if (kw && !e.url.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [result.entries, category, status, keyword]);

  const openDetail = (entry: HarRequestEntry) => {
    setSelected(entry);
    setDrawerOpen(true);
  };

  const columns: ColumnsType<HarRequestEntry> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      width: 260,
      render: (name: string, r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: categoryColor(r.category), flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)', cursor: 'pointer' }} title={r.url}>
            {name || '/'}
          </span>
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 96,
      sorter: (a, b) => a.status - b.status,
      render: (s: number) => {
        const st = statusStyle(s);
        return (
          <Tag style={{ color: st.color, background: st.bg, border: 'none', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {s === 0 ? '失败' : s}
          </Tag>
        );
      },
    },
    {
      title: 'Protocol',
      dataIndex: 'protocol',
      key: 'protocol',
      width: 90,
      render: (p: string) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{p}</span>,
    },
    {
      title: 'Domain',
      dataIndex: 'domain',
      key: 'domain',
      width: 200,
      ellipsis: true,
      sorter: (a, b) => a.domain.localeCompare(b.domain),
      render: (d: string) => <span style={{ color: 'var(--text-secondary)' }}>{d}</span>,
    },
    {
      title: 'Remote Address',
      dataIndex: 'remoteAddress',
      key: 'remoteAddress',
      width: 170,
      ellipsis: true,
      render: (ip: string) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{ip}</span>,
    },
    {
      title: 'Type',
      dataIndex: 'category',
      key: 'category',
      width: 110,
      sorter: (a, b) => a.category.localeCompare(b.category),
      render: (c: string, r) => {
        const cs = categoryStyle(r.category);
        return (
          <Tag style={{ color: cs.color, background: cs.bg, border: 'none', fontWeight: 600 }}>{r.rawType || c}</Tag>
        );
      },
    },
    {
      title: 'Size',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.size - b.size,
      render: (s: number) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatBytes(s)}</span>,
    },
    {
      title: 'Time',
      dataIndex: 'time',
      key: 'time',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.time - b.time,
      render: (t: number, r) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: r.isSlow ? 'var(--accent-orange)' : 'var(--text-secondary)', fontWeight: r.isSlow ? 600 : 400 }}>
          {formatHarTime(t)}
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 第一行：类型筛选 + 搜索 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORY_LABELS.map(c => {
            const count = c.key === 'all' ? result.totalRequests : result.typeCounts[c.key as keyof typeof result.typeCounts] || 0;
            const isActive = category === c.key;
            const st = filterTagStyle(c.key);
            return (
              <span
                key={c.key}
                onClick={() => setCategory(c.key)}
                style={{
                  cursor: 'pointer',
                  padding: '4px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  color: st.color,
                  background: st.bg,
                  border: `1.5px solid ${isActive ? st.color : 'transparent'}`,
                  boxShadow: isActive ? `0 0 0 2px ${st.bg}` : 'none',
                  opacity: isActive ? 1 : 0.78,
                  transition: 'all 0.2s',
                }}
              >
                {c.label}
                <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>{count}</span>
              </span>
            );
          })}
        </div>
        <Input
          allowClear
          placeholder="按 URL 关键词过滤"
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ width: 260 }}
        />
      </div>

      {/* 第二行：状态快捷筛选 + 计数 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 2 }}>状态：</span>
          {STATUS_FILTERS.map(f => {
            const isActive = status === f.key;
            return (
              <span
                key={f.key}
                onClick={() => setStatus(f.key)}
                style={{
                  cursor: 'pointer',
                  padding: '3px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  color: f.color,
                  background: f.bg,
                  border: `1.5px solid ${isActive ? f.color : 'transparent'}`,
                  opacity: isActive ? 1 : 0.78,
                  transition: 'all 0.2s',
                }}
              >
                {f.label}
              </span>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          共 {filtered.length} 条请求
          {category !== 'all' || keyword || status !== 'all' ? `（已从 ${result.totalRequests} 条中筛选）` : ''}
        </span>
      </div>

      <Table<HarRequestEntry>
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        size="small"
        scroll={{ x: 1100 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
        onRow={record => ({ onClick: () => openDetail(record), style: { cursor: 'pointer' } })}
      />

      <Drawer
        title={
          selected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Badge color={statusStyle(selected.status).color} />
              <span
                style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={selected.url}
              >
                {selected.name}
              </span>
            </div>
          ) : (
            '请求详情'
          )
        }
        placement="right"
        width="62%"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        className="netlog-modal-dark"
        styles={{ body: { background: 'var(--bg-elevated)' }, header: { background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-color)' } }}
      >
        {selected && <HarRequestDetail entry={selected} />}
      </Drawer>
    </div>
  );
};

export default HarRequestTable;
