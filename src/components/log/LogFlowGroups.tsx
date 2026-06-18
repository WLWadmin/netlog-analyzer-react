import React, { useState, useMemo } from 'react';
import { Tag, Descriptions, Select } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  RightOutlined,
  DownOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { formatDuration } from '../../utils/format';
import type { LogFlowGroup, LogEntry } from '../../logParser';
import { getErrorDiagnosis } from '../../logConstants';
import useLoadMore from '../../hooks/useLoadMore';

interface LogFlowGroupsProps {
  groups: LogFlowGroup[];
  filterErrorOnly?: boolean;
}

type SortMode = 'default' | 'errorFirst' | 'slowest' | 'mostRequests';

const LogFlowGroups: React.FC<LogFlowGroupsProps> = ({ groups, filterErrorOnly }) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showDetailEntry, setShowDetailEntry] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('default');

  const sortedGroups = useMemo(() => {
    const base = filterErrorOnly ? groups.filter(g => g.hasError) : [...groups];
    switch (sortMode) {
      case 'errorFirst':
        return base.sort((a, b) => {
          if (a.hasError && !b.hasError) return -1;
          if (!a.hasError && b.hasError) return 1;
          return b.errorCount - a.errorCount;
        });
      case 'slowest':
        return base.sort((a, b) => {
          const aTotal = a.entries.reduce((sum, e) => sum + e.duration, 0);
          const bTotal = b.entries.reduce((sum, e) => sum + e.duration, 0);
          return bTotal - aTotal;
        });
      case 'mostRequests':
        return base.sort((a, b) => b.entries.length - a.entries.length);
      default:
        return base;
    }
  }, [groups, filterErrorOnly, sortMode]);

  const { visibleItems: visibleGroups, hasMore, loadMore, remainingCount } = useLoadMore<LogFlowGroup>({
    items: sortedGroups,
    initialCount: 50,
    step: 30,
  });

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };



  const renderStep = (entry: LogEntry) => {
    const isError = entry.status === 'Error';
    const diagnosis = isError && entry.statusCode
      ? getErrorDiagnosis(entry.statusCode, entry.domain)
      : null;

    return (
      <div key={entry.id} className="log-flow-step">
        <div className="log-flow-step-main">
          <span className={`log-flow-step-icon${isError ? ' log-flow-step-icon--error' : ''}`}>
            {isError ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
          </span>
          <span className={`log-flow-step-name${isError ? ' log-flow-step-name--error' : ''}`}>
            {entry.friendlyName}
          </span>
          <code style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {entry.id}
          </code>
          <Tag className="log-flow-step-method" color={isError ? 'error' : 'success'}>
            {entry.method}
          </Tag>
          <span className="log-flow-step-duration">
            <ClockCircleOutlined style={{ fontSize: 10 }} />
            {formatDuration(entry.duration)}
          </span>
          {isError && entry.statusText && (
            <Tag className="log-flow-step-status" color="error">
              {entry.statusText}
            </Tag>
          )}
          <button
            className="log-flow-step-detail-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowDetailEntry(showDetailEntry === entry.id ? null : entry.id);
            }}
          >
            <FileTextOutlined /> 详情
          </button>
        </div>

        {showDetailEntry === entry.id && (
          <div className="log-flow-step-detail">
            <Descriptions column={1} className="log-flow-detail-desc">
              <Descriptions.Item label="URL">{entry.url}</Descriptions.Item>
              <Descriptions.Item label="时间">{entry.timestamp}</Descriptions.Item>
              <Descriptions.Item label="Worker">{entry.worker}</Descriptions.Item>
              <Descriptions.Item label="耗时">{entry.durationText}</Descriptions.Item>
              {entry.statusCode !== undefined && (
                <Descriptions.Item label="状态码">
                  {entry.statusCode} {entry.statusText || ''}
                </Descriptions.Item>
              )}
            </Descriptions>

            {diagnosis && (
              <div className="log-flow-diagnosis">
                <strong>排查建议：</strong>{diagnosis.suggestion}
              </div>
            )}

            {Object.keys(entry.headers).length > 0 && (
              <div className="log-flow-detail-section">
                <div className="log-flow-detail-label">Headers</div>
                <pre className="log-flow-detail-pre">{JSON.stringify(entry.headers, null, 2)}</pre>
              </div>
            )}

            {entry.bodyRaw && (
              <div className="log-flow-detail-section">
                <div className="log-flow-detail-label">Body</div>
                <pre className="log-flow-detail-pre">
                  {entry.body ? JSON.stringify(entry.body, null, 2) : entry.bodyRaw}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="log-flow-groups">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Select
          value={sortMode}
          onChange={setSortMode}
          style={{ width: 160 }}
          size="small"
          options={[
            { value: 'default', label: '默认顺序' },
            { value: 'errorFirst', label: '错误优先' },
            { value: 'slowest', label: '耗时最长' },
            { value: 'mostRequests', label: '请求最多' },
          ]}
        />
      </div>
      {visibleGroups.map((group) => {
        const isExpanded = expandedGroups.has(group.id);

        return (
          <div
            key={group.id}
            className={`log-flow-group${group.hasError ? ' log-flow-group--error' : ''}${isExpanded ? ' log-flow-group--expanded' : ''}`}
          >
            <div className="log-flow-group-header" onClick={() => toggleGroup(group.id)}>
              <div className="log-flow-group-header-left">
                <span className="log-flow-group-time">
                  {group.startTime}
                  {group.endTime !== group.startTime && ` ~ ${group.endTime}`}
                </span>
                <div className="log-flow-group-counts">
                  <span className="log-flow-group-count log-flow-group-count--success">
                    <CheckCircleOutlined /> {group.successCount}
                  </span>
                  {group.errorCount > 0 && (
                    <span className="log-flow-group-count log-flow-group-count--error">
                      <CloseCircleOutlined /> {group.errorCount}
                    </span>
                  )}
                </div>
                {group.hasError && (
                  <Tag color="error" className="log-flow-group-error-tag">失败</Tag>
                )}
              </div>
              <div className="log-flow-group-header-right">
                {!isExpanded && (
                  <span className="log-flow-group-summary">{group.summary}</span>
                )}
                <span className="log-flow-group-arrow">
                  {isExpanded ? <DownOutlined /> : <RightOutlined />}
                </span>
              </div>
            </div>

            {isExpanded && (
              <div className="log-flow-group-body">
                <div className="log-flow-group-steps">
                  {group.entries.map((entry) => renderStep(entry))}
                </div>
              </div>
            )}
          </div>
        );
      })}

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

      <style>{`
        .log-flow-groups {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .log-flow-group {
          background: var(--bg-surface);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          overflow: hidden;
          transition: box-shadow 0.2s ease, border-color 0.2s ease;
        }
        .log-flow-group--error {
          border-color: rgba(255, 77, 79, 0.18);
        }
        .log-flow-group--expanded {
          box-shadow: 0 2px 12px rgba(0,0,0,0.04);
        }
        .log-flow-group-header {
          padding: 12px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          transition: background 0.15s ease;
          gap: 12px;
        }
        .log-flow-group--error > .log-flow-group-header {
          background: rgba(255, 77, 79, 0.03);
        }
        .log-flow-group-header:hover {
          background: var(--bg-elevated);
        }
        .log-flow-group-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
          flex-wrap: wrap;
        }
        .log-flow-group-header-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          min-width: 0;
          justify-content: flex-end;
        }
        .log-flow-group-time {
          font-size: 13px;
          color: var(--text-secondary);
          font-family: 'SF Mono', 'Cascadia Code', monospace;
          font-size: 12px;
        }
        .log-flow-group-counts {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .log-flow-group-count {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
        }
        .log-flow-group-count--success { color: #52c41a; }
        .log-flow-group-count--error { color: #ff4d4f; }
        .log-flow-group-error-tag {
          font-size: 11px !important;
          margin: 0 !important;
          height: 20px !important;
          line-height: 20px !important;
          border-radius: 6px !important;
          padding: 0 8px !important;
        }
        .log-flow-group-summary {
          font-size: 12px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }
        .log-flow-group-arrow {
          color: var(--text-muted);
          font-size: 11px;
          flex-shrink: 0;
          transition: transform 0.2s ease;
        }
        .log-flow-group-body {
          padding: 16px 18px;
          border-top: 1px solid var(--border-color);
        }
        .log-flow-group-steps {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .log-flow-step {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .log-flow-step-main {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .log-flow-step-icon {
          font-size: 14px;
          color: #52c41a;
          flex-shrink: 0;
        }
        .log-flow-step-icon--error { color: #ff4d4f; }
        .log-flow-step-name {
          font-size: 13px;
          color: var(--text-primary);
        }
        .log-flow-step-name--error {
          color: #ff4d4f;
          font-weight: 500;
        }
        .log-flow-step-method {
          font-size: 11px !important;
          margin: 0 !important;
          padding: 0 6px !important;
          height: 18px !important;
          line-height: 18px !important;
          border-radius: 4px !important;
        }
        .log-flow-step-duration {
          font-size: 12px;
          color: var(--text-muted);
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .log-flow-step-status {
          font-size: 11px !important;
          margin: 0 !important;
          padding: 0 6px !important;
          height: 18px !important;
          line-height: 18px !important;
          border-radius: 4px !important;
        }
        .log-flow-step-detail-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #0ea5e9;
          background: none;
          border: none;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          transition: background 0.15s ease;
          font-family: inherit;
        }
        .log-flow-step-detail-btn:hover {
          background: rgba(14, 165, 233, 0.06);
        }
        .log-flow-step-detail {
          margin-top: 10px;
          padding: 14px;
          background: var(--bg-elevated);
          border-radius: 12px;
          border: 1px solid var(--border-color);
        }
        .log-flow-detail-desc {
          margin-bottom: 12px;
        }
        .log-flow-diagnosis {
          padding: 8px 12px;
          background: rgba(255, 77, 79, 0.05);
          border-radius: 6px;
          margin-bottom: 12px;
          font-size: 12px;
          color: #ff4d4f;
          line-height: 1.6;
        }
        .log-flow-detail-section {
          margin-bottom: 12px;
        }
        .log-flow-detail-label {
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 6px;
          color: var(--text-secondary);
        }
        .log-flow-detail-pre {
          margin: 0;
          padding: 10px;
          background: var(--bg-base);
          border-radius: 6px;
          font-size: 11px;
          line-height: 1.5;
          overflow: auto;
          max-height: 150px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
};

export default LogFlowGroups;
