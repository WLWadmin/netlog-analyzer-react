import React, { useState } from 'react';
import { Tabs, Alert } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  WarningOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import type { LogAnalysisResult } from '../../logParser';
import LogInsightBanner from './LogInsightBanner';
import LogSummaryCards from './LogSummaryCards';
import LogStatsCharts from './LogStatsCharts';
import LogFlowGroups from './LogFlowGroups';
import LogRawList from './LogRawList';

interface LogResultPageProps {
  result: LogAnalysisResult;
}

const LogResultPage: React.FC<LogResultPageProps> = ({ result }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [filterErrorOnly, setFilterErrorOnly] = useState(false);

  const { insight, stats, groups, entries } = result;

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
              setActiveTab('flows');
            }}
          />
          <LogStatsCharts stats={stats} />
          <LogFlowGroups groups={groups.slice(0, 10)} />
          {groups.length > 10 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>
              还有 {groups.length - 10} 个流程分组，请在"操作流程"标签页查看全部
            </div>
          )}
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
      <Alert
        message={
          <span className="log-disclaimer-title">
            <WarningOutlined style={{ marginRight: 6, color: '#fbbf24' }} />
            郑重说明
          </span>
        }
        description={
          <span className="log-disclaimer-desc">
            本工具解析内容仅供参考，具体原因需人工二次确认或自行尝试建议操作。分析结果可能因日志版本、格式差异等因素存在偏差，请结合实际情况综合判断。
          </span>
        }
        type="warning"
        showIcon={false}
        className="log-disclaimer-alert"
      />

      <div className="log-tabs-container">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
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
