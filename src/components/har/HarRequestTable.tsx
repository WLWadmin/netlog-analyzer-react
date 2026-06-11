import { useState, useMemo } from 'react';
import { Table, Input, Tag, Drawer, Badge } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import {
  HarRequestEntry,
  HarAnalysisResult,
  CATEGORY_LABELS,
  statusColor,
  categoryColor,
  formatBytes,
  formatHarTime,
} from '../../harParser';
import HarRequestDetail from './HarRequestDetail';

interface HarRequestTableProps {
  result: HarAnalysisResult;
}

const HarRequestTable: React.FC<HarRequestTableProps> = ({ result }) => {
  const [filter, setFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<HarRequestEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return result.entries.filter(e => {
      if (filter !== 'all' && e.category !== filter) return false;
      if (kw && !e.url.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [result.entries, filter, keyword]);

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
          <span
            style={{ width: 6, height: 6, borderRadius: '50%', background: categoryColor(r.category), flexShrink: 0 }}
          />
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
      width: 90,
      sorter: (a, b) => a.status - b.status,
      render: (s: number, r) => (
        <Tag color={statusColor(s)} style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
          {s === 0 ? '失败' : s}
        </Tag>
      ),
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
      render: (c: string, r) => (
        <Tag style={{ color: categoryColor(r.category), background: `${categoryColor(r.category)}1a` }}>
          {r.rawType || c}
        </Tag>
      ),
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 工具栏：类型筛选 + 搜索 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORY_LABELS.map(c => {
            const count =
              c.key === 'all' ? result.totalRequests : result.typeCounts[c.key as keyof typeof result.typeCounts] || 0;
            const isActive = filter === c.key;
            return (
              <span
                key={c.key}
                onClick={() => setFilter(c.key)}
                style={{
                  cursor: 'pointer',
                  padding: '4px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#fff' : 'var(--text-secondary)',
                  background: isActive ? 'var(--accent-blue)' : 'var(--bg-surface)',
                  border: `1px solid ${isActive ? 'var(--accent-blue)' : 'var(--border-color)'}`,
                  transition: 'all 0.2s',
                }}
              >
                {c.label}
                <span style={{ marginLeft: 6, opacity: 0.7, fontSize: 12 }}>{count}</span>
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

      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        共 {filtered.length} 条请求
        {filter !== 'all' || keyword ? `（已从 ${result.totalRequests} 条中筛选）` : ''}
      </div>

      <Table<HarRequestEntry>
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        size="small"
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
        onRow={record => ({
          onClick: () => openDetail(record),
          style: { cursor: 'pointer' },
        })}
      />

      <Drawer
        title={
          selected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Badge color={statusColor(selected.status)} />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
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
