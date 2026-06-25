import React, { useState } from 'react';
import { Tabs, Tag, Button } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import type { LogAnalysisResult } from '../../logParser';
import { TOP_PREVIEW_COUNT } from '../../constants/analysisThresholds';
import LogInsightBanner from './LogInsightBanner';
import LogSummaryCards from './LogSummaryCards';
import LogStatsCharts from './LogStatsCharts';
import LogFlowGroups from './LogFlowGroups';
import LogRawList from './LogRawList';
import LogPerformanceTab from './LogPerformanceTab';
import { AnalysisDisclaimer } from '../shared/AnalysisDisclaimer';

interface LogResultPageProps {
  result: LogAnalysisResult;
  /** 外层控制的 activeTab，由 App hash 路由驱动 */
  activeTab?: string;
  /** tab 切换回调，用于同步 hash */
  onTabChange?: (tab: string) => void;
}

const LogResultPage: React.FC<LogResultPageProps> = ({ result, activeTab: externalActiveTab, onTabChange }) => {
  const [internalActiveTab, setInternalActiveTab] = useState('overview');
  const activeTab = externalActiveTab || internalActiveTab;
  const [filterErrorOnly, setFilterErrorOnly] = useState(false);

  const { insight, stats, groups, entries } = result;

  const handleTabChange = (key: string) => {
    setInternalActiveTab(key);
    onTabChange?.(key);
  };

  const tabItems = [
    {
      key: 'overview',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DashboardOutlined />
          概览
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <LogInsightBanner insight={insight} />
          <LogSummaryCards
            stats={stats}
            onFilterError={() => {
              setFilterErrorOnly(true);
              handleTabChange('flows');
            }}
          />
          <LogStatsCharts stats={stats} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Tag color="blue" style={{ fontSize: 11, marginBottom: 0 }}>Top {TOP_PREVIEW_COUNT} 预览</Tag>
              {groups.length > TOP_PREVIEW_COUNT && (
                <Button size="small" type="link" onClick={() => handleTabChange('flows')} style={{ padding: 0 }}>
                  查看全部 {groups.length} 条
                </Button>
              )}
            </div>
            <LogFlowGroups groups={groups.slice(0, TOP_PREVIEW_COUNT)} />
          </div>
        </div>
      ),
    },
    {
      key: 'flows',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <BranchesOutlined />
          操作流程
          {filterErrorOnly && (
            <span style={{ fontSize: 11, color: '#ff4d4f', marginLeft: 4 }}>(仅失败)</span>
          )}
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="log-filter-btn"
              data-active={filterErrorOnly}
              onClick={() => setFilterErrorOnly(!filterErrorOnly)}
            >
              {filterErrorOnly ? '显示全部' : '仅显示失败'}
            </button>
          </div>
          <LogFlowGroups groups={groups} filterErrorOnly={filterErrorOnly} />
        </div>
      ),
    },
    {
      key: 'performance',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DashboardOutlined />
          性能分析
        </span>
      ),
      children: <LogPerformanceTab result={result} />,
    },
    {
      key: 'raw',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileTextOutlined />
          原始日志
        </span>
      ),
      children: <LogRawList entries={entries} />,
    },
  ];

  return (
    <div className="log-result-page">
      <AnalysisDisclaimer variant="log" />

      <div className="log-tabs-container">
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={tabItems}
          type="card"
          className="log-analysis-tabs"
        />
      </div>

      <style>{`
        .log-result-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
          width: 100%;
        }
        .log-disclaimer-alert {
          background: rgba(251, 191, 36, 0.06) !important;
          border: 1px solid rgba(251, 191, 36, 0.2) !important;
          border-radius: 12px !important;
        }
        .log-disclaimer-title {
          font-weight: 600;
          font-size: 14px;
          color: var(--text-primary);
        }
        .log-disclaimer-desc {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.6;
        }
        .log-tabs-container {
          background: var(--bg-surface);
          border-radius: 14px;
          border: 1px solid var(--border-color);
          overflow: hidden;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }
        .log-analysis-tabs .ant-tabs-nav {
          margin-bottom: 0 !important;
          padding: 0 8px;
          background: var(--bg-elevated);
        }
        .log-analysis-tabs .ant-tabs-nav-list {
          gap: 4px;
        }
        .log-analysis-tabs .ant-tabs-tab {
          border-radius: 8px 8px 0 0 !important;
          border: 1px solid transparent !important;
          border-bottom: none !important;
          padding: 10px 20px !important;
          font-size: 14px;
          color: var(--text-secondary) !important;
          transition: all 0.2s ease !important;
          margin: 8px 2px 0 2px !important;
        }
        .log-analysis-tabs .ant-tabs-tab:hover {
          color: var(--text-primary) !important;
          background: rgba(24, 144, 255, 0.04);
        }
        .log-analysis-tabs .ant-tabs-tab-active {
          background: var(--bg-surface) !important;
          border-color: var(--border-color) !important;
          border-bottom-color: var(--bg-surface) !important;
        }
        .log-analysis-tabs .ant-tabs-tab-active .ant-tabs-tab-btn {
          color: #0ea5e9 !important;
          font-weight: 600;
        }
        .log-analysis-tabs .ant-tabs-content {
          padding: 24px 28px;
        }
        .log-analysis-tabs .ant-tabs-card {
          border: none;
        }
        .log-filter-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 6px 16px;
          border-radius: 8px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-color);
          transition: all 0.2s ease;
          font-family: inherit;
          line-height: 1.4;
        }
        .log-filter-btn:hover {
          color: var(--text-primary);
          border-color: rgba(24, 144, 255, 0.4);
          background: rgba(24, 144, 255, 0.04);
        }
        .log-filter-btn[data-active="true"] {
          color: #ff4d4f;
          background: rgba(255, 77, 79, 0.06);
          border-color: rgba(255, 77, 79, 0.25);
        }
        .log-filter-btn[data-active="true"]:hover {
          background: rgba(255, 77, 79, 0.1);
        }
      `}</style>
    </div>
  );
};

export default LogResultPage;
