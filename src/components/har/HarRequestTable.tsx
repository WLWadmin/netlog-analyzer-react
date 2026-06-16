import { useState, useMemo, useEffect } from 'react';
import { Table, Input, Tag, Badge, Spin, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined, CloseOutlined } from '@ant-design/icons';
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
import CopyText from './CopyText';

export type StatusFilter = 'all' | 'failed' | 'slow';

interface HarRequestTableProps {
  result: HarAnalysisResult;
  statusFilter?: StatusFilter;
  onStatusFilterChange?: (f: StatusFilter) => void;
  categoryFilter?: string;
  onCategoryFilterChange?: (c: string) => void;
}

const STATUS_FILTERS: { key: StatusFilter; label: string; color: string; bg: string }[] = [
  { key: 'all', label: '全部状态', color: '#374151', bg: '#e5e7eb' },
  { key: 'failed', label: '失败请求', color: '#b91c1c', bg: '#fee2e2' },
  { key: 'slow', label: '慢请求', color: '#c2410c', bg: '#ffedd5' },
];

const HarRequestTable: React.FC<HarRequestTableProps> = ({ result, statusFilter, onStatusFilterChange, categoryFilter, onCategoryFilterChange }) => {
  const [keyword, setKeyword] = useState('');
  const [blockedInput, setBlockedInput] = useState('');
  const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
  const [innerStatus, setInnerStatus] = useState<StatusFilter>('all');
  const [innerCategory, setInnerCategory] = useState<string>('all');
  const [selected, setSelected] = useState<HarRequestEntry | null>(null);
  const [filtering, setFiltering] = useState(false);

  const status: StatusFilter = statusFilter ?? innerStatus;
  const setStatus = (f: StatusFilter) => {
    setInnerStatus(f);
    onStatusFilterChange?.(f);
  };
  const category: string = categoryFilter ?? innerCategory;
  const setCat = (c: string) => {
    setInnerCategory(c);
    onCategoryFilterChange?.(c);
  };

  // 筛选条件变化时短暂显示 loading，避免用户觉得卡顿
  useEffect(() => {
    setFiltering(true);
    const timer = setTimeout(() => setFiltering(false), 80);
    return () => clearTimeout(timer);
  }, [category, status, keyword, blockedDomains]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return result.entries.filter(e => {
      if (category !== 'all' && e.category !== category) return false;
      if (status === 'failed' && !e.isFailed) return false;
      if (status === 'slow' && !e.isSlow) return false;
      if (kw && !e.url.toLowerCase().includes(kw)) return false;
      if (blockedDomains.length > 0 && blockedDomains.some(d => e.domain.toLowerCase().includes(d))) return false;
      return true;
    });
  }, [result.entries, category, status, keyword, blockedDomains]);

  const columns: ColumnsType<HarRequestEntry> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 300,
      render: (name: string, r) => {
        // 域名 + 路径，超宽省略号
        const path = r.url.includes('?')
          ? r.url.substring(r.url.indexOf('?'))
          : name !== r.domain ? name : '/';
        const display = r.domain + path;
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: categoryColor(r.category), flexShrink: 0 }} />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--accent-blue)',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                flex: '1 1 auto',
              }}
              title={r.url}
            >
              {display}
            </span>
          </span>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      sorter: (a, b) => a.status - b.status,
      render: (s: number) => {
        const st = statusStyle(s);
        return (
          <Tag style={{ color: st.color, background: st.bg, border: 'none', fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}>
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
      render: (p: string) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{p}</span>,
    },
    {
      title: 'Domain',
      dataIndex: 'domain',
      key: 'domain',
      width: 200,
      ellipsis: true,
      sorter: (a, b) => a.domain.localeCompare(b.domain),
      render: (d: string) => (
        <CopyText text={d} label="Domain" mono={false} />
      ),
    },
    {
      title: 'Remote Address',
      dataIndex: 'remoteAddress',
      key: 'remoteAddress',
      width: 170,
      ellipsis: true,
      render: (ip: string) => (
        <CopyText text={ip} label="Remote Address" />
      ),
    },
    {
      title: 'Type',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      sorter: (a, b) => a.category.localeCompare(b.category),
      render: (c: string, r) => {
        const cs = categoryStyle(r.category);
        return (
          <Tag style={{ color: cs.color, background: cs.bg, border: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.rawType || c}</Tag>
        );
      },
    },
    {
      title: 'Size',
      dataIndex: 'size',
      key: 'size',
      width: 90,
      align: 'right',
      sorter: (a, b) => a.size - b.size,
      render: (s: number) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatBytes(s)}</span>,
    },
    {
      title: 'Time',
      dataIndex: 'time',
      key: 'time',
      width: 90,
      align: 'right',
      sorter: (a, b) => a.time - b.time,
      render: (t: number, r) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: r.isSlow ? 'var(--accent-orange)' : 'var(--text-secondary)', fontWeight: r.isSlow ? 600 : 400, whiteSpace: 'nowrap' }}>
          {formatHarTime(t)}
        </span>
      ),
    },
  ];

  const rowClassName = (record: HarRequestEntry) =>
    selected?.id === record.id ? 'har-request-row-selected' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 第一行：类型筛选 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {CATEGORY_LABELS.map(c => {
          const count = c.key === 'all' ? result.totalRequests : result.typeCounts[c.key as keyof typeof result.typeCounts] || 0;
          const isActive = category === c.key;
          const st = filterTagStyle(c.key);
          return (
            <span
              key={c.key}
              onClick={() => setCat(c.key)}
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

      {/* 第二行：状态筛选 + 计数 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
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
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          共 {filtered.length} 条请求
          {category !== 'all' || keyword || status !== 'all' ? `（已从 ${result.totalRequests} 条中筛选）` : ''}
        </span>
      </div>

      {/* 第三行：搜索框独占一行 */}
      <div style={{ display: 'flex', gap: 12 }}>
        <Input
          allowClear
          placeholder="按 URL 关键词过滤"
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ flex: 1 }}
        />
        <Input
          allowClear
          placeholder="屏蔽域名（逗号分隔）"
          value={blockedInput}
          onChange={e => {
            const val = e.target.value;
            setBlockedInput(val);
            setBlockedDomains(val.split(/[,\s]+/).filter(Boolean).map(d => d.toLowerCase()));
          }}
          style={{ flex: 1 }}
        />
      </div>

      <Spin spinning={filtering} tip="筛选中..." size="small">
        <Table<HarRequestEntry>
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          size="small"
          scroll={{ x: 1100, y: 'calc(100vh - 320px)' }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
          onRow={record => ({
            onClick: () => setSelected(record),
            style: { cursor: 'pointer' },
          })}
          rowClassName={rowClassName}
        />
      </Spin>

      {/* 详情面板：右侧抽屉，左侧留 1/3 空白可点击关闭 */}
      {selected && (
        <div
          style={{
            position: 'fixed',
            top: 60,
            left: 0,
            width: '100vw',
            height: 'calc(100vh - 60px)',
            zIndex: 101,
            display: 'flex',
          }}
        >
          {/* 左侧空白区域：点击关闭 */}
          <div
            style={{
              flex: '1 1 33%',
              background: 'rgba(0, 0, 0, 0.35)',
              cursor: 'pointer',
            }}
            onClick={() => setSelected(null)}
          />
          {/* 右侧详情面板 */}
          <div
            style={{
              flex: '1 1 67%',
              background: 'var(--bg-elevated)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.2)',
              animation: 'harDetailSlideIn 0.2s ease',
            }}
          >
            {/* 详情面板 Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 24px',
                borderBottom: '1px solid var(--border-color)',
                background: 'var(--bg-elevated)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <Badge color={statusStyle(selected.status).color} />
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
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={() => setSelected(null)}
                style={{ color: 'var(--text-muted)', flexShrink: 0 }}
              />
            </div>

            {/* 详情面板内容 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
              <HarRequestDetail entry={selected} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HarRequestTable;
