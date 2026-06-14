import React, { useState, useMemo } from 'react';
import { Card, Input, Select, Tag } from 'antd';
import {
  SearchOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import type { LogEntry } from '../../logParser';

interface LogRawListProps {
  entries: LogEntry[];
}

const LogRawList: React.FC<LogRawListProps> = ({ entries }) => {
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  // 获取所有域名选项
  const domains = useMemo(() => {
    const domainSet = new Set(entries.map(e => e.domain).filter(Boolean));
    return ['all', ...Array.from(domainSet)];
  }, [entries]);

  // 筛选条目
  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      // 状态筛选
      if (statusFilter !== 'all') {
        if (statusFilter === 'success' && entry.status !== 'Success') return false;
        if (statusFilter === 'error' && entry.status !== 'Error') return false;
      }

      // 域名筛选
      if (domainFilter !== 'all' && entry.domain !== domainFilter) return false;

      // 搜索筛选
      if (searchText) {
        const lowerSearch = searchText.toLowerCase();
        const matchUrl = entry.url.toLowerCase().includes(lowerSearch);
        const matchMethod = entry.method.toLowerCase().includes(lowerSearch);
        const matchStatus = entry.statusCode?.toString().includes(lowerSearch);
        const matchName = entry.friendlyName.toLowerCase().includes(lowerSearch);
        if (!matchUrl && !matchMethod && !matchStatus && !matchName) return false;
      }

      return true;
    });
  }, [entries, searchText, statusFilter, domainFilter]);

  const formatDuration = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
  };

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
    >
      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input
          placeholder="搜索 URL、方法、状态码..."
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
      </div>

      {/* 日志列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredEntries.map(entry => {
          const isExpanded = expandedEntry === entry.id;
          const isError = entry.status === 'Error';

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
                  {entry.friendlyName !== entry.url ? `${entry.friendlyName} (${entry.url})` : entry.url}
                </span>
                {entry.statusCode && (
                  <Tag
                   
                    color="error"
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
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
                    原始日志行
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
                    {entry.rawLine}
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
    </Card>
  );
};

export default LogRawList;
