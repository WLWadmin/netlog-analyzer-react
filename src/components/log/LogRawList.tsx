import React, { useState, useMemo, useEffect } from 'react';
import { Card, Input, Select, Tag, DatePicker, Button, message } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  SearchOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FilterOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { formatDuration } from '../../utils/format';
import type { LogEntry } from '../../logParser';
import { LOG_RAW_INITIAL_COUNT, LOG_RAW_LOAD_STEP, SEARCH_DEBOUNCE_MS } from '../../constants/analysisThresholds';
import useLoadMore from '../../hooks/useLoadMore';
import HighlightedText from './HighlightedText';
import LogRawContextModal from './LogRawContextModal';
import { exportLogEntriesAsJson, exportLogEntriesAsText } from './exportLogEntries';

interface LogRawListProps {
  entries: LogEntry[];
}

const LogRawList: React.FC<LogRawListProps> = ({ entries }) => {
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [contextEntryId, setContextEntryId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchText(searchText), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const indexedEntries = useMemo(() => {
    return entries.map(entry => ({
      entry,
      // 核心字段索引（快速搜索）
      searchText: `${entry.url} ${entry.method} ${entry.statusCode ?? ''} ${entry.statusText ?? ''} ${entry.friendlyName} ${entry.domain} ${entry.path} ${entry.worker} ${entry.level}`.toLowerCase(),
    }));
  }, [entries]);

  // 获取所有域名选项
  const domains = useMemo(() => {
    const domainSet = new Set(entries.map(e => e.domain).filter(Boolean));
    return ['all', ...Array.from(domainSet)];
  }, [entries]);

  // 获取所有日志级别选项
  const levels = useMemo(() => {
    const levelSet = new Set(entries.map(e => e.level).filter(Boolean));
    return ['all', ...Array.from(levelSet)];
  }, [entries]);

  // 筛选条目
  const filteredEntries = useMemo(() => {
    const lowerSearch = debouncedSearchText.trim().toLowerCase();
    return indexedEntries.filter(({ entry, searchText: indexedSearch }) => {
      // 状态筛选
      if (statusFilter !== 'all') {
        if (statusFilter === 'success' && entry.status !== 'Success') return false;
        if (statusFilter === 'error' && entry.status !== 'Error') return false;
      }

      // 域名筛选
      if (domainFilter !== 'all' && entry.domain !== domainFilter) return false;

      // 日志级别筛选
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;

      // 时间范围筛选
      if (timeRange && timeRange[0] && timeRange[1]) {
        const entryTime = dayjs(entry.timestampMs);
        if (entryTime.isBefore(timeRange[0]) || entryTime.isAfter(timeRange[1])) return false;
      }

      // 搜索筛选：先搜核心字段，无结果时按需检查大字段
      if (lowerSearch) {
        const coreMatch = indexedSearch.includes(lowerSearch);
        if (!coreMatch && lowerSearch.length > 3) {
          // 按需拼接大字段（仅在核心字段未命中且搜索词较长时）
          const fullText = `${entry.rawLine} ${JSON.stringify(entry.headers)} ${entry.bodyRaw ?? ''}`.toLowerCase();
          if (!fullText.includes(lowerSearch)) return false;
        } else if (!coreMatch) {
          return false;
        }
      }

      return true;
    }).map(({ entry }) => entry);
  }, [indexedEntries, debouncedSearchText, statusFilter, domainFilter, levelFilter, timeRange]);

  const { visibleItems: visibleEntries, hasMore, loadMore, remainingCount } = useLoadMore<LogEntry>({
    items: filteredEntries,
    initialCount: LOG_RAW_INITIAL_COUNT,
    step: LOG_RAW_LOAD_STEP,
  });

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <FileTextOutlined style={{ color: 'var(--text-secondary)' }} />
          原始日志列表
          <Tag style={{ fontSize: 11, marginLeft: 8 }}>{filteredEntries.length} / {entries.length}</Tag>
        </span>
      }
      bodyStyle={{ padding: '16px 20px' }}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
      }}
      extra={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            size="small"
            onClick={() => exportLogEntriesAsText(filteredEntries, 'log-filtered')}
            disabled={filteredEntries.length === 0}
          >
            导出 TXT
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => exportLogEntriesAsJson(filteredEntries, 'log-filtered')}
            disabled={filteredEntries.length === 0}
          >
            导出 JSON
          </Button>
        </div>
      }
    >
      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input
          placeholder="搜索 URL、方法、状态码、域名、路径、Worker、Headers、Body..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ width: 280, flex: '1 1 200px' }}
          allowClear
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'success', label: '成功' },
            { value: 'error', label: '失败' },
          ]}
        />
        <Select
          value={domainFilter}
          onChange={setDomainFilter}
          style={{ width: 180 }}
          options={domains.map(d => ({
            value: d,
            label: d === 'all' ? '全部域名' : d,
          }))}
        />
        <Select
          value={levelFilter}
          onChange={setLevelFilter}
          style={{ width: 130 }}
          options={levels.map(l => ({
            value: l,
            label: l === 'all' ? '全部级别' : l,
          }))}
        />
        <DatePicker.RangePicker
          showTime={{ format: 'HH:mm' }}
          format="MM-DD HH:mm"
          value={timeRange}
          onChange={setTimeRange}
          style={{ width: 280 }}
          placeholder={['开始时间', '结束时间']}
          suffixIcon={<ClockCircleOutlined />}
        />
        {(levelFilter !== 'all' || timeRange) && (
          <Button
            icon={<FilterOutlined />}
            onClick={() => { setLevelFilter('all'); setTimeRange(null); }}
          >
            重置筛选
          </Button>
        )}
      </div>

      {/* 日志列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visibleEntries.map(entry => {
          const isExpanded = expandedEntry === entry.id;
          const isError = entry.status === 'Error';
          const statusCodeColor = entry.statusCode === undefined ? 'default' : entry.statusCode >= 400 ? 'error' : entry.statusCode >= 300 ? 'processing' : 'success';
          return (
            <div
              key={entry.id}
              style={{
                border: `1px solid ${isError ? 'rgba(255, 77, 79, 0.15)' : 'var(--border-color)'}`,
                borderRadius: 8,
                overflow: 'hidden',
                background: isError ? 'rgba(255, 77, 79, 0.02)' : 'var(--bg-elevated)',
              }}
            >
              {/* 日志行摘要 */}
              <div
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  flexWrap: 'wrap',
                }}
                onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
              >
                {isError ? (
                  <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                ) : (
                  <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />
                )}
                <Tag style={{ fontSize: 10, margin: 0, height: 18, lineHeight: '18px', fontFamily: 'var(--font-mono)' }} color="default">
                  {entry.id}
                </Tag>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {entry.timestamp}
                </span>
                <Tag
                 
                  color={isError ? 'error' : 'success'}
                  style={{ fontSize: 11, margin: 0, height: 18, lineHeight: '18px' }}
                >
                  {entry.method}
                </Tag>
                <span
                  style={{
                    fontSize: 13,
                    color: isError ? '#ff4d4f' : 'var(--text-primary)',
                    fontWeight: isError ? 500 : 400,
                    flex: 1,
                    minWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={entry.url}
                >
                  <HighlightedText
                    text={entry.friendlyName !== entry.url ? `${entry.friendlyName} (${entry.url})` : entry.url}
                    keyword={debouncedSearchText}
                  />
                </span>
                {entry.statusCode !== undefined && (
                  <Tag
                   
                    color={statusCodeColor}
                    style={{ fontSize: 11, margin: 0, height: 18, lineHeight: '18px' }}
                  >
                    {entry.statusCode}
                  </Tag>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {formatDuration(entry.duration)}
                </span>
              </div>

              {/* 展开详情 */}
              {isExpanded && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderTop: '1px solid var(--border-color)',
                    background: 'var(--bg-base)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
                      原始日志行
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <Button size="small" onClick={(e) => { e.stopPropagation(); setContextEntryId(entry.id); }}>
                        查看上下文
                      </Button>
                      <Button
                        size="small"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await navigator.clipboard.writeText(entry.rawLine);
                            message.success('已复制原始行');
                          } catch {
                            message.error('复制失败');
                          }
                        }}
                      >
                        复制原始行
                      </Button>
                    </div>
                  </div>
                  <pre
                    style={{
                      margin: '0 0 12px 0',
                      padding: 10,
                      background: 'var(--bg-elevated)',
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: 1.5,
                      overflow: 'auto',
                      maxHeight: 120,
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    <HighlightedText text={entry.rawLine} keyword={debouncedSearchText} />
                  </pre>

                  {Object.keys(entry.headers).length > 0 && (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
                        Headers
                      </div>
                      <pre
                        style={{
                          margin: '0 0 12px 0',
                          padding: 10,
                          background: 'var(--bg-elevated)',
                          borderRadius: 6,
                          fontSize: 11,
                          lineHeight: 1.5,
                          overflow: 'auto',
                          maxHeight: 150,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {JSON.stringify(entry.headers, null, 2)}
                      </pre>
                    </>
                  )}

                  {entry.bodyRaw && (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
                        Body
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          padding: 10,
                          background: 'var(--bg-elevated)',
                          borderRadius: 6,
                          fontSize: 11,
                          lineHeight: 1.5,
                          overflow: 'auto',
                          maxHeight: 200,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {entry.body ? JSON.stringify(entry.body, null, 2) : entry.bodyRaw}
                      </pre>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <button
            onClick={loadMore}
            style={{
              padding: '8px 24px',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            加载更多 ({remainingCount} 条剩余)
          </button>
        </div>
      )}

      <LogRawContextModal
        open={Boolean(contextEntryId)}
        onClose={() => setContextEntryId(null)}
        entries={entries}
        centerEntryId={contextEntryId}
        keyword={debouncedSearchText}
      />
    </Card>
  );
};

export default LogRawList;
