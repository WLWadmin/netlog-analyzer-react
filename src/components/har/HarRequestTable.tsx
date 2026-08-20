import { useState, useMemo, useEffect } from 'react';
import { Table, Input, Tag, Badge, Spin, Button, Tooltip, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined, CloseOutlined } from '@ant-design/icons';
import {
  HarRequestEntry,
  HarAnalysisResult,
  CATEGORY_LABELS,
  categoryStyle,
  categoryColor,
  filterTagStyle,
  formatBytes,
  formatHarTime,
  getHarResponseStatus,
  statusStyle,
} from '../../harParser';
import { StatusTag } from '../../components/shared/StatusTag';
import HarRequestDetail from './HarRequestDetail';
import CopyText from './CopyText';
import HarWaterfallCell from './HarWaterfallCell';
import { sanitizeHarUrl } from './buildHarRequestCopyText';
import { useNavigation } from '../../contexts/NavigationContext';
import { getHarRequestIssue, type HarRequestIssue } from '../../diagnosis/shared/harRequestIssue';
import {
  buildHarWaterfallRange,
  getHarWaterfallMarkers,
  sortHarWaterfallEntries,
  type HarWaterfallSortKey,
} from '../../diagnosis/shared/harWaterfall';
import {
  DEFAULT_HAR_REQUEST_FILTER_STATE,
  filterHarRequests,
  getTopHarDomains,
  type HarIssueFilter,
} from './harRequestFilterState';
import type { HarResponseBodySource } from './harResponseBodyGateway';

export type StatusFilter = 'all' | 'failed' | 'slow';

function recordedStatusColor(entry: HarRequestEntry): string {
  const status = getHarResponseStatus(entry);
  return status === undefined ? 'var(--text-muted)' : statusStyle(status).color;
}

interface HarRequestTableProps {
  result: HarAnalysisResult;
  statusFilter?: StatusFilter;
  onStatusFilterChange?: (f: StatusFilter) => void;
  categoryFilter?: string;
  onCategoryFilterChange?: (c: string) => void;
  bodySource?: HarResponseBodySource;
}

const STATUS_FILTERS: { key: StatusFilter; label: string; color: string; bg: string }[] = [
  { key: 'all', label: '全部状态', color: '#374151', bg: '#e5e7eb' },
  { key: 'failed', label: '失败请求', color: '#b91c1c', bg: '#fee2e2' },
  { key: 'slow', label: '慢请求', color: '#c2410c', bg: '#ffedd5' },
];

const ISSUE_FILTERS: { key: HarIssueFilter; label: string }[] = [
  { key: 'all', label: '全部主问题' },
  { key: 'slow', label: '慢请求' },
  { key: 'ttfb', label: 'Waiting 慢' },
  { key: 'queueing', label: 'Queueing 慢' },
  { key: 'dns', label: 'DNS 慢' },
  { key: 'tls', label: 'TLS 慢' },
  { key: 'status-zero', label: 'status=0' },
  { key: 'net-error', label: 'netError' },
  { key: '5xx', label: '5xx' },
  { key: '4xx', label: '4xx' },
];

type HarColumnKey =
  | 'name'
  | 'requestNumber'
  | 'status'
  | 'issue'
  | 'method'
  | 'path'
  | 'url'
  | 'scheme'
  | 'protocol'
  | 'domain'
  | 'remoteAddress'
  | 'category'
  | 'size'
  | 'resourceSize'
  | 'time'
  | 'waterfall'
  | 'initiator'
  | 'priority'
  | 'connection'
  | 'requestCookieCount'
  | 'setCookieCount'
  | 'cacheSource';

const DEFAULT_COLUMN_KEYS: HarColumnKey[] = ['name', 'status', 'issue', 'protocol', 'domain', 'category', 'size', 'time', 'waterfall'];
const REQUIRED_COLUMN_KEYS: HarColumnKey[] = DEFAULT_COLUMN_KEYS;
const COLUMN_OPTIONS: { key: HarColumnKey; label: string }[] = [
  { key: 'requestNumber', label: 'Request #' },
  { key: 'method', label: 'Method' },
  { key: 'path', label: 'Path' },
  { key: 'url', label: 'URL' },
  { key: 'scheme', label: 'Scheme' },
  { key: 'remoteAddress', label: 'Remote Address' },
  { key: 'initiator', label: 'Initiator' },
  { key: 'priority', label: 'Priority' },
  { key: 'connection', label: 'Connection' },
  { key: 'requestCookieCount', label: 'Request Cookies' },
  { key: 'setCookieCount', label: 'Set-Cookies' },
  { key: 'cacheSource', label: 'Cache Source' },
  { key: 'resourceSize', label: 'Resource Size' },
];

function issueStyle(severity: HarRequestIssue['severity']): { color: string; bg: string } {
  switch (severity) {
    case 'critical': return { color: '#b91c1c', bg: '#fee2e2' };
    case 'warning': return { color: '#c2410c', bg: '#ffedd5' };
    case 'info': return { color: '#0e7490', bg: '#cffafe' };
    case 'normal': return { color: '#15803d', bg: '#dcfce7' };
  }
}

function compactHarName(name: string, maxLength = 72): string {
  if (name.length <= maxLength) return name;
  const head = Math.ceil((maxLength - 1) * 0.58);
  const tail = Math.floor((maxLength - 1) * 0.42);
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}

function safeUrlPart(url: string, part: 'pathname' | 'protocol' | 'originless'): string {
  try {
    const parsed = new URL(url);
    if (part === 'pathname') return parsed.pathname || '/';
    if (part === 'protocol') return parsed.protocol.replace(':', '') || '-';
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    if (part === 'protocol') return '-';
    return url.split('?')[0].split('#')[0];
  }
}

const HarRequestTable: React.FC<HarRequestTableProps> = ({ result, statusFilter, onStatusFilterChange, categoryFilter, onCategoryFilterChange, bodySource }) => {
  const [keyword, setKeyword] = useState('');
  const [blockedInput, setBlockedInput] = useState('');
  const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
  const [innerStatus, setInnerStatus] = useState<StatusFilter>('all');
  const [innerCategory, setInnerCategory] = useState<string>('all');
  const [issueFilter, setIssueFilter] = useState<HarIssueFilter>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'GET' | 'POST' | 'OPTIONS' | 'other'>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [hasLogidFilter, setHasLogidFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [hasServerTimingFilter, setHasServerTimingFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<HarColumnKey[]>(DEFAULT_COLUMN_KEYS);
  const [waterfallSort, setWaterfallSort] = useState<HarWaterfallSortKey>('start-time');
  const [focusedRequestIds, setFocusedRequestIds] = useState<number[] | undefined>(undefined);
  const [selected, setSelected] = useState<HarRequestEntry | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [highlightIds, setHighlightIds] = useState<Set<number>>(new Set());
  const { intent, consumeIntent } = useNavigation();

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

  // 消费导航意图：筛选 + 高亮 + 滚动定位
  useEffect(() => {
    if (!intent || intent.tab !== 'requests') return;
    const filters = intent.filters;
    const highlight = intent.highlight;

    // 重置筛选
    setKeyword('');
    setBlockedDomains([]);
    setBlockedInput('');
    setInnerStatus('all');
    setInnerCategory('all');
    setIssueFilter('all');
    setMethodFilter('all');
    setDomainFilter('all');
    setHasLogidFilter('all');
    setHasServerTimingFilter('all');
    setFocusedRequestIds(undefined);
    setSelected(null);
    setHighlightIds(new Set());

    // 应用筛选
    if (filters?.keyword) setKeyword(filters.keyword);
    if (filters?.requestId) {
      const entry = result.entries.find(e => e.id === filters.requestId);
      if (entry) {
        setFocusedRequestIds([entry.id]);
      }
    }
    if (filters?.requestIds?.length) {
      setFocusedRequestIds(filters.requestIds);
    }
    if (filters?.errorOnly) {
      setInnerStatus('failed');
      onStatusFilterChange?.('failed');
    }

    // 应用高亮
    if (highlight?.requestIds && highlight.requestIds.length > 0) {
      setHighlightIds(new Set(highlight.requestIds));
      setFocusedRequestIds(highlight.requestIds);
    }

    consumeIntent();
  }, [intent, consumeIntent, result.entries, onStatusFilterChange]);

  // 筛选条件变化时短暂显示 loading，避免用户觉得卡顿
  useEffect(() => {
    setFiltering(true);
    const timer = setTimeout(() => setFiltering(false), 80);
    return () => clearTimeout(timer);
  }, [category, status, issueFilter, methodFilter, domainFilter, hasLogidFilter, hasServerTimingFilter, keyword, blockedDomains, focusedRequestIds]);

  const filterState = useMemo(() => ({
    ...DEFAULT_HAR_REQUEST_FILTER_STATE,
    category: category as any,
    status,
    issue: issueFilter,
    method: methodFilter,
    domain: domainFilter,
    hasLogid: hasLogidFilter,
    hasServerTiming: hasServerTimingFilter,
    keyword,
    blockedDomains,
    requestIds: focusedRequestIds,
  }), [category, status, issueFilter, methodFilter, domainFilter, hasLogidFilter, hasServerTimingFilter, keyword, blockedDomains, focusedRequestIds]);

  const filtered = useMemo(() => {
    return filterHarRequests(result.entries, filterState);
  }, [result.entries, filterState]);

  const sortedFiltered = useMemo(
    () => sortHarWaterfallEntries(filtered, waterfallSort),
    [filtered, waterfallSort],
  );

  const topDomains = useMemo(() => getTopHarDomains(result.entries), [result.entries]);
  const waterfallRange = useMemo(() => buildHarWaterfallRange(result.entries), [result.entries]);
  const waterfallMarkers = useMemo(
    () => getHarWaterfallMarkers(result.pageMarkers, waterfallRange),
    [result.pageMarkers, waterfallRange],
  );

  const issueById = useMemo(() => {
    const map = new Map<number, HarRequestIssue>();
    result.entries.forEach(e => {
      map.set(e.id, getHarRequestIssue(e));
    });
    return map;
  }, [result.entries]);

  const columns: ColumnsType<HarRequestEntry> = [
    {
      title: '#',
      key: 'requestNumber',
      width: 70,
      sorter: (a, b) => a.id - b.id,
      render: (_: unknown, r) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{r.id + 1}</span>,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 320,
      ellipsis: true,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, r) => {
        const displayName = compactHarName(name || sanitizeHarUrl(r.url));
        return (
          <Tooltip
            title={
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all' }}>
                {sanitizeHarUrl(r.url)}
              </div>
            }
            placement="topLeft"
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                maxWidth: '100%',
                overflow: 'hidden',
                minWidth: 0,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: categoryColor(r.category), flexShrink: 0 }} />
              <span
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--accent-blue)',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  maxWidth: '100%',
                  flex: '1 1 auto',
                  letterSpacing: -0.15,
                }}
              >
                {displayName}
              </span>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      sorter: (a, b) => (getHarResponseStatus(a) ?? -1) - (getHarResponseStatus(b) ?? -1),
      render: (_s: number, r) => {
        const status = getHarResponseStatus(r);
        if (status === undefined) {
          return <Tag style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>未记录</Tag>;
        }
        return (
          <StatusTag statusCode={status}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {status === 0 ? `失败${r.netErrorText ? ` ${r.netErrorText}` : ''}` : status}
            </span>
          </StatusTag>
        );
      },
    },
    {
      title: '主问题',
      key: 'issue',
      width: 200,
      render: (_: unknown, r) => {
        const issue = issueById.get(r.id) || getHarRequestIssue(r);
        const st = issueStyle(issue.severity);
        return (
          <Tooltip title={issue.detail}>
            <Tag style={{ color: st.color, background: st.bg, border: 'none', fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
              {issue.label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Method',
      dataIndex: 'method',
      key: 'method',
      width: 90,
      sorter: (a, b) => a.method.localeCompare(b.method),
      render: (method: string) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{method}</span>
      ),
    },
    {
      title: 'Path',
      key: 'path',
      width: 220,
      ellipsis: true,
      sorter: (a, b) => safeUrlPart(a.url, 'pathname').localeCompare(safeUrlPart(b.url, 'pathname')),
      render: (_: unknown, r) => <span title={safeUrlPart(r.url, 'pathname')} style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{safeUrlPart(r.url, 'pathname')}</span>,
    },
    {
      title: 'URL',
      key: 'url',
      width: 260,
      ellipsis: true,
      sorter: (a, b) => sanitizeHarUrl(a.url).localeCompare(sanitizeHarUrl(b.url)),
      render: (_: unknown, r) => <CopyText text={sanitizeHarUrl(r.url)} label="URL（脱敏）" />,
    },
    {
      title: 'Scheme',
      key: 'scheme',
      width: 90,
      sorter: (a, b) => safeUrlPart(a.url, 'protocol').localeCompare(safeUrlPart(b.url, 'protocol')),
      render: (_: unknown, r) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{safeUrlPart(r.url, 'protocol')}</span>,
    },
    {
      title: 'Protocol',
      dataIndex: 'protocol',
      key: 'protocol',
      width: 90,
      sorter: (a, b) => a.protocol.localeCompare(b.protocol),
      render: (p: string) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{p}</span>,
    },
    {
      title: 'Initiator',
      key: 'initiator',
      width: 210,
      ellipsis: true,
      sorter: (a, b) => (a.initiator?.type || '').localeCompare(b.initiator?.type || ''),
      render: (_: unknown, entry) => {
        if (!entry.initiator) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
        const url = entry.initiator.url ? sanitizeHarUrl(entry.initiator.url) : '';
        const label = [entry.initiator.type, url].filter(Boolean).join(' · ') || '-';
        return <span title={label} style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{label}</span>;
      },
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 90,
      sorter: (a, b) => (a.priority || '').localeCompare(b.priority || ''),
      render: (priority?: string) => (
        <span style={{ color: priority ? 'var(--text-secondary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{priority || '-'}</span>
      ),
    },
    {
      title: 'Connection',
      key: 'connection',
      width: 110,
      sorter: (a, b) => (a.connectionInfo?.connectionId || a.connectionId || '').localeCompare(b.connectionInfo?.connectionId || b.connectionId || ''),
      render: (_: unknown, entry) => (
        <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {entry.connectionInfo?.connectionId || entry.connectionId || '-'}
        </span>
      ),
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
      sorter: (a, b) => (a.sizeInfo?.transferSize ?? a.size) - (b.sizeInfo?.transferSize ?? b.size),
      render: (s: number, r) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatBytes(r.sizeInfo?.transferSize ?? s)}</span>,
    },
    {
      title: 'Resource Size',
      key: 'resourceSize',
      width: 120,
      align: 'right',
      sorter: (a, b) => (a.sizeInfo?.resourceSize || a.contentSize || 0) - (b.sizeInfo?.resourceSize || b.contentSize || 0),
      render: (_: unknown, r) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatBytes(r.sizeInfo?.resourceSize ?? r.contentSize)}</span>,
    },
    {
      title: 'Req Cookies',
      key: 'requestCookieCount',
      width: 115,
      align: 'right',
      sorter: (a, b) => (a.requestCookies?.length || 0) - (b.requestCookies?.length || 0),
      render: (_: unknown, r) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{r.requestCookies?.length || 0}</span>,
    },
    {
      title: 'Set-Cookies',
      key: 'setCookieCount',
      width: 110,
      align: 'right',
      sorter: (a, b) => (a.responseCookies?.length || 0) - (b.responseCookies?.length || 0),
      render: (_: unknown, r) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{r.responseCookies?.length || 0}</span>,
    },
    {
      title: 'Cache Source',
      key: 'cacheSource',
      width: 120,
      sorter: (a, b) => (a.cacheInfo?.source || '').localeCompare(b.cacheInfo?.source || ''),
      render: (_: unknown, r) => <span style={{ fontFamily: 'var(--font-mono)', color: r.cacheInfo?.source ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{r.cacheInfo?.source || '-'}</span>,
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
    {
      title: 'Waterfall',
      key: 'waterfall',
      width: 300,
      render: (_: unknown, r) => (
        <HarWaterfallCell
          entry={r}
          range={waterfallRange}
          markers={waterfallMarkers}
          issue={issueById.get(r.id) || getHarRequestIssue(r)}
        />
      ),
    },
  ];

  const visibleColumns = columns.filter(column => {
    const key = column.key as HarColumnKey | undefined;
    return key ? visibleColumnKeys.includes(key) : true;
  });
  const visibleTableWidth = Math.max(
    960,
    visibleColumns.reduce((sum, column) => sum + (typeof column.width === 'number' ? column.width : 120), 0)
  );
  const useVirtualScroll = sortedFiltered.length > 500;

  const rowClassName = (record: HarRequestEntry) => {
    const classes: string[] = [];
    if (selected?.id === record.id) classes.push('har-request-row-selected');
    if (highlightIds.has(record.id)) classes.push('har-request-row-highlight');
    return classes.join(' ');
  };

  const hasActiveFilters = category !== 'all'
    || status !== 'all'
    || issueFilter !== 'all'
    || methodFilter !== 'all'
    || domainFilter !== 'all'
    || hasLogidFilter !== 'all'
    || hasServerTimingFilter !== 'all'
    || !!keyword.trim()
    || blockedDomains.length > 0
    || Boolean(focusedRequestIds?.length);
  const activeFilterCount = [
    category !== 'all',
    status !== 'all',
    issueFilter !== 'all',
    methodFilter !== 'all',
    domainFilter !== 'all',
    hasLogidFilter !== 'all',
    hasServerTimingFilter !== 'all',
    !!keyword.trim(),
    blockedDomains.length > 0,
    Boolean(focusedRequestIds?.length),
  ].filter(Boolean).length;

  const activeFilterChips = [
    category !== 'all' ? { key: 'category', label: `类型：${CATEGORY_LABELS.find(item => item.key === category)?.label || category}`, onClose: () => setCat('all') } : undefined,
    status !== 'all' ? { key: 'status', label: `状态：${STATUS_FILTERS.find(item => item.key === status)?.label || status}`, onClose: () => setStatus('all') } : undefined,
    issueFilter !== 'all' ? { key: 'issue', label: `主问题：${ISSUE_FILTERS.find(item => item.key === issueFilter)?.label || issueFilter}`, onClose: () => setIssueFilter('all') } : undefined,
    focusedRequestIds?.length ? { key: 'requestIds', label: `相关请求：${focusedRequestIds.length} 条`, onClose: () => { setFocusedRequestIds(undefined); setHighlightIds(new Set()); } } : undefined,
    methodFilter !== 'all' ? { key: 'method', label: `Method：${methodFilter}`, onClose: () => setMethodFilter('all') } : undefined,
    domainFilter !== 'all' ? { key: 'domain', label: `Domain：${domainFilter}`, onClose: () => setDomainFilter('all') } : undefined,
    hasLogidFilter !== 'all' ? { key: 'logid', label: `Logid：${hasLogidFilter === 'yes' ? '有' : '无'}`, onClose: () => setHasLogidFilter('all') } : undefined,
    hasServerTimingFilter !== 'all' ? { key: 'serverTiming', label: `Server-Timing：${hasServerTimingFilter === 'yes' ? '有' : '无'}`, onClose: () => setHasServerTimingFilter('all') } : undefined,
    keyword.trim() ? { key: 'keyword', label: `关键词：${keyword.trim()}`, onClose: () => setKeyword('') } : undefined,
    blockedDomains.length > 0 ? { key: 'blocked', label: `屏蔽域名：${blockedDomains.length} 个`, onClose: () => { setBlockedDomains([]); setBlockedInput(''); } } : undefined,
  ].filter((item): item is { key: string; label: string; onClose: () => void } => Boolean(item));

  const resetFilters = () => {
    setCat('all');
    setStatus('all');
    setIssueFilter('all');
    setMethodFilter('all');
    setDomainFilter('all');
    setHasLogidFilter('all');
    setHasServerTimingFilter('all');
    setKeyword('');
    setBlockedInput('');
    setBlockedDomains([]);
    setFocusedRequestIds(undefined);
    setSelected(null);
    setHighlightIds(new Set());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 高亮样式注入 */}
      <style>{`
        .har-request-row-highlight td {
          background-color: rgba(245, 158, 11, 0.12) !important;
          animation: harHighlightPulse 2s ease-in-out;
        }
        @keyframes harHighlightPulse {
          0% { background-color: rgba(245, 158, 11, 0.3); }
          100% { background-color: rgba(245, 158, 11, 0.12); }
        }
      `}</style>
      {/* 第一行：类型筛选 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {CATEGORY_LABELS.map(c => {
          const count = c.key === 'all' ? result.totalRequests : result.typeCounts[c.key as keyof typeof result.typeCounts] || 0;
          const isActive = category === c.key;
          const st = filterTagStyle(c.key);
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setCat(c.key)}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? st.color : 'var(--text-secondary)',
                background: isActive ? st.bg : 'var(--bg-elevated)',
                border: `1.5px solid ${isActive ? st.color : 'var(--border-color)'}`,
                transform: isActive ? 'scale(1.02)' : 'scale(1)',
                transition: 'all 0.2s',
                fontFamily: 'inherit',
              }}
            >
              {c.label}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: '16px',
                  padding: '0 6px',
                  borderRadius: 10,
                  background: isActive ? st.color : 'var(--border-color)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 第二行：状态筛选 + 计数 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 2 }}>状态：</span>
          {STATUS_FILTERS.map(f => {
            const isActive = status === f.key;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => setStatus(f.key)}
                style={{
                  appearance: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? f.color : 'var(--text-secondary)',
                  background: isActive ? f.bg : 'var(--bg-elevated)',
                  border: `1.5px solid ${isActive ? f.color : 'var(--border-color)'}`,
                  transform: isActive ? 'scale(1.02)' : 'scale(1)',
                  transition: 'all 0.2s',
                  fontFamily: 'inherit',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Select
            aria-label="Waterfall 排序"
            size="small"
            value={waterfallSort}
            onChange={value => setWaterfallSort(value as HarWaterfallSortKey)}
            style={{ width: 190 }}
            options={[
              { value: 'start-time', label: 'Waterfall：Start Time' },
              { value: 'response-time', label: 'Waterfall：Response Time' },
              { value: 'end-time', label: 'Waterfall：End Time' },
              { value: 'total-duration', label: 'Waterfall：Total Duration' },
              { value: 'latency', label: 'Waterfall：Latency' },
            ]}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            共 {filtered.length} 条请求
            {hasActiveFilters ? `（已从 ${result.totalRequests} 条中筛选）` : ''}
          </span>
        </div>
      </div>

      {/* 第三行：搜索框独占一行 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
        {hasActiveFilters && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              width: '100%',
              padding: '8px 10px',
              borderRadius: 12,
              border: '1px solid rgba(14, 116, 144, 0.18)',
              background: 'linear-gradient(135deg, rgba(236, 254, 255, 0.72), rgba(248, 250, 252, 0.88))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.75)',
            }}
          >
            <span style={{ fontSize: 12, color: '#0e7490', fontWeight: 700, marginRight: 2 }}>
              已启用 {activeFilterCount} 个筛选
            </span>
            {activeFilterChips.map(chip => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onClose}
                title={`取消${chip.label}`}
                style={{
                  appearance: 'none',
                  border: '1px solid rgba(14, 116, 144, 0.22)',
                  background: 'rgba(255,255,255,0.86)',
                  color: '#155e75',
                  borderRadius: 999,
                  padding: '4px 8px 4px 10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  maxWidth: 260,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  lineHeight: 1.2,
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chip.label}</span>
                <CloseOutlined style={{ fontSize: 10, color: '#0e7490', flexShrink: 0 }} />
              </button>
            ))}
            <Button size="small" type="text" icon={<CloseOutlined />} onClick={resetFilters} style={{ marginLeft: 'auto', color: '#0e7490' }}>
              全部清空
            </Button>
          </div>
        )}
      </div>

      {/* 第四行：主问题快捷筛选 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 2 }}>主问题：</span>
        {ISSUE_FILTERS.map(item => {
          const isActive = issueFilter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setIssueFilter(isActive && item.key !== 'all' ? 'all' : item.key)}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: isActive && item.key !== 'all' ? '5px 8px 5px 11px' : '5px 11px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#0e7490' : 'var(--text-secondary)',
                background: isActive ? 'linear-gradient(135deg, #ecfeff, #cffafe)' : 'var(--bg-elevated)',
                border: `1px solid ${isActive ? 'rgba(14, 116, 144, 0.45)' : 'var(--border-color)'}`,
                boxShadow: isActive ? '0 2px 8px rgba(14, 116, 144, 0.12)' : 'none',
                fontFamily: 'inherit',
              }}
            >
              {item.label}
              {isActive && item.key !== 'all' && (
                <CloseOutlined style={{ fontSize: 9, color: '#0e7490' }} />
              )}
            </button>
          );
        })}
        <Button size="small" type="text" onClick={() => setShowMoreFilters(v => !v)}>
          {showMoreFilters ? '收起更多筛选' : '更多筛选'}
        </Button>
      </div>

      {showMoreFilters && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
            padding: 12,
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            background: 'var(--bg-surface)',
          }}
        >
          <Select
            size="small"
            value={methodFilter}
            onChange={setMethodFilter}
            options={[
              { value: 'all', label: '全部 Method' },
              { value: 'GET', label: 'GET' },
              { value: 'POST', label: 'POST' },
              { value: 'OPTIONS', label: 'OPTIONS' },
              { value: 'other', label: '其他 Method' },
            ]}
          />
          <Select
            size="small"
            value={domainFilter}
            onChange={setDomainFilter}
            options={[
              { value: 'all', label: '全部 Domain' },
              ...topDomains.map(domain => ({ value: domain, label: domain })),
            ]}
          />
          <Select
            size="small"
            value={hasLogidFilter}
            onChange={setHasLogidFilter}
            options={[
              { value: 'all', label: '全部 logid' },
              { value: 'yes', label: '有 x-tt-logid' },
              { value: 'no', label: '无 x-tt-logid' },
            ]}
          />
          <Select
            size="small"
            value={hasServerTimingFilter}
            onChange={setHasServerTimingFilter}
            options={[
              { value: 'all', label: '全部 Server-Timing' },
              { value: 'yes', label: '有 Server-Timing' },
              { value: 'no', label: '无 Server-Timing' },
            ]}
          />
          <Select
            mode="multiple"
            size="small"
            value={visibleColumnKeys.filter(key => !REQUIRED_COLUMN_KEYS.includes(key))}
            onChange={keys => setVisibleColumnKeys([...REQUIRED_COLUMN_KEYS, ...(keys as HarColumnKey[])])}
            options={COLUMN_OPTIONS.map(item => ({ value: item.key, label: item.label }))}
            maxTagCount="responsive"
            placeholder="添加扩展列"
          />
        </div>
      )}

      {result.pageMarkers?.length ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>Page markers:</span>
          {result.pageMarkers.map((marker, index) => (
            <span
              key={`${marker.pageId || index}`}
              style={{
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                padding: '4px 8px',
                borderRadius: 999,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
              }}
              title={marker.title || marker.pageId || undefined}
            >
              {marker.domContentLoadedMs !== undefined && <span>DCL {formatHarTime(marker.domContentLoadedMs)}</span>}
              {marker.loadMs !== undefined && <span>Load {formatHarTime(marker.loadMs)}</span>}
            </span>
          ))}
        </div>
      ) : null}

      {filtering && (
        <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          筛选中...
        </div>
      )}
      <Spin spinning={filtering} size="small">
        {/* HAR 请求列表对标浏览器 Network：关闭分页，使用连续滚动；
            大 HAR 使用虚拟滚动，避免一次性渲染全部 DOM 行。 */}
        <Table<HarRequestEntry>
          columns={visibleColumns}
          dataSource={sortedFiltered}
          rowKey="id"
          size="small"
          tableLayout="fixed"
          scroll={{ x: visibleTableWidth, y: useVirtualScroll ? 560 : 'calc(100vh - 320px)' }}
          virtual={useVirtualScroll}
          pagination={false}
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
              minWidth: 0,
              background: 'var(--bg-elevated)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.2)',
              animation: 'harDetailSlideIn 0.2s ease',
              overflow: 'hidden',
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
                <Badge color={recordedStatusColor(selected)} />
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
              <HarRequestDetail entry={selected} allEntries={result.entries} bodySource={bodySource} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HarRequestTable;
