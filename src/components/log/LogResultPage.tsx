import React, { useState } from 'react';
import { Tag, Button } from 'antd';
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
import ResultWorkbenchShell, { type ResultWorkbenchNavItem } from '../shared/ResultWorkbenchShell';
import './logResultPage.css';

interface LogResultPageProps {
  result: LogAnalysisResult;
  /** 外层控制的 activeTab，由 App hash 路由驱动 */
  activeTab?: string;
  /** tab 切换回调，用于同步 hash */
  onTabChange?: (tab: string) => void;
}

const LogResultPage: React.FC<LogResultPageProps> = ({ result, activeTab: externalActiveTab, onTabChange }) => {
  const [internalActiveTab, setInternalActiveTab] = useState('overview');
  const validTabs = ['overview', 'flows', 'performance', 'raw'];
  const activeTab = externalActiveTab && validTabs.includes(externalActiveTab) ? externalActiveTab : internalActiveTab;
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
          日志概览
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
            <LogFlowGroups groups={groups.slice(0, TOP_PREVIEW_COUNT)} allEntries={entries} />
          </div>
        </div>
      ),
    },
    {
      key: 'flows',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <BranchesOutlined />
          操作流程 / 结构化日志
          {filterErrorOnly && (
            <span style={{ fontSize: 11, color: '#ff4d4f', marginLeft: 4 }}>(仅失败)</span>
          )}
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="log-filter-btn"
              data-active={filterErrorOnly}
              onClick={() => setFilterErrorOnly(!filterErrorOnly)}
            >
              {filterErrorOnly ? '显示全部' : '仅显示失败'}
            </button>
          </div>
          <LogFlowGroups groups={groups} allEntries={entries} filterErrorOnly={filterErrorOnly} />
        </div>
      ),
    },
    {
      key: 'performance',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DashboardOutlined />
          日志统计
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
  const activeContent = tabItems.find(item => item.key === activeTab)?.children ?? tabItems[0].children;
  const navItems: ResultWorkbenchNavItem[] = [
    { key: 'overview', label: '日志概览', icon: <DashboardOutlined />, group: '分析' },
    { key: 'flows', label: '操作流程', icon: <BranchesOutlined />, group: '分析', count: groups.length },
    { key: 'performance', label: '日志统计', icon: <DashboardOutlined />, group: '分析' },
    { key: 'raw', label: '原始日志', icon: <FileTextOutlined />, group: '深度核验', count: entries.length },
  ];

  return (
    <ResultWorkbenchShell
      parser="log"
      parserLabel="Log"
      statusLabel={`${stats.total.toLocaleString()} 条日志`}
      activeKey={activeTab}
      items={navItems}
      onChange={handleTabChange}
    >
      <div className="log-result-page">
        <div className="log-result-content">
          {activeContent}
        </div>
        <AnalysisDisclaimer variant="log" />
      </div>
    </ResultWorkbenchShell>
  );
};

export default LogResultPage;
