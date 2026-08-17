import { useState } from 'react';
import { Alert } from 'antd';
import { UnorderedListOutlined, MedicineBoxOutlined, ToolOutlined, FileSearchOutlined } from '@ant-design/icons';
import { HarAnalysisResult } from '../../harParser';
import HarSummaryCards from './HarSummaryCards';
import HarRequestTable, { StatusFilter } from './HarRequestTable';
import HarNoviceDiagnosisOverview from './HarNoviceDiagnosisOverview';
import { AnalysisDisclaimer } from '../shared/AnalysisDisclaimer';
import RawEvidenceExplorer from '../raw/RawEvidenceExplorer';
import ResultWorkbenchShell, { type ResultWorkbenchNavItem } from '../shared/ResultWorkbenchShell';
import './harResultPage.css';

interface HarResultPageProps {
  result: HarAnalysisResult;
  rawData?: unknown;
  rawDataId?: string;
  /** 外层控制的 activeTab，由 App hash 路由驱动 */
  activeTab?: string;
  /** tab 切换回调，用于同步 hash */
  onTabChange?: (tab: string) => void;
}

// HAR 解析结果整体页面：请求详情优先，现象摘要仅描述请求层表现。
const HarResultPage: React.FC<HarResultPageProps> = ({ result, rawData, rawDataId, activeTab: externalActiveTab, onTabChange }) => {
  const [internalActiveKey, setInternalActiveKey] = useState('summary');
  const validTabs = ['requests', 'summary', 'raw-evidence'];
  const activeKey = externalActiveTab && validTabs.includes(externalActiveTab) ? externalActiveTab : internalActiveKey;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const jumpToRequests = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setCategoryFilter('all'); // 卡片点击时重置类型筛选为 All
    const nextKey = 'requests';
    setInternalActiveKey(nextKey);
    onTabChange?.(nextKey);
  };

  const handleTabChange = (key: string) => {
    setInternalActiveKey(key);
    onTabChange?.(key);
  };

  const tabItems = [
    {
      key: 'requests',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <UnorderedListOutlined />
          请求详情
        </span>
      ),
      children: (
        <HarRequestTable
          result={result}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          bodySource={{ rawData, rawDataId }}
        />
      ),
    },
    {
      key: 'summary',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MedicineBoxOutlined />
          网络问题定位
        </span>
      ),
      children: <HarNoviceDiagnosisOverview result={result} onOpenRequests={() => handleTabChange('requests')} />,
    },
    {
      key: 'raw-evidence',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileSearchOutlined />
          原始证据
        </span>
      ),
      children: (rawData || rawDataId) ? <RawEvidenceExplorer rawData={rawData} rawDataId={rawDataId} fileName="HAR 原始证据" /> : null,
    },
  ];
  const activeContent = tabItems.find(item => item.key === activeKey)?.children ?? tabItems[1].children;
  const navItems: ResultWorkbenchNavItem[] = [
    { key: 'summary', label: '网络问题定位', icon: <MedicineBoxOutlined />, group: '诊断' },
    { key: 'requests', label: '请求详情', icon: <UnorderedListOutlined />, group: '诊断', count: result.totalRequests },
    { key: 'raw-evidence', label: '原始证据', icon: <FileSearchOutlined />, group: '深度核验' },
  ];

  return (
    <ResultWorkbenchShell
      parser="har"
      parserLabel="HAR"
      statusLabel={`${result.totalRequests.toLocaleString()} 个请求`}
      activeKey={activeKey}
      items={navItems}
      onChange={handleTabChange}
    >
      <div className="har-result-page">
        {result.repairInfo?.repaired && (
          <Alert
            type="warning"
            showIcon
            icon={<ToolOutlined />}
            message={result.repairInfo.reason}
            description={
              <div className="har-repair-detail">
                <div>恢复率：{result.repairInfo.recoveryRate}% · 已恢复 {result.repairInfo.recoveredEntries}/{result.repairInfo.totalEntries} 条请求</div>
                {result.repairInfo.droppedEntries > 0 && (
                  <div className="har-repair-detail__dropped">丢弃了 {result.repairInfo.droppedEntries} 条损坏请求</div>
                )}
                {result.repairInfo.warnings.map((warning, index) => (
                  <div className="har-repair-detail__warning" key={index}>{warning}</div>
                ))}
              </div>
            }
          />
        )}
        {result.bodyRetention.mode === 'optimized' && result.bodyRetention.omittedCount > 0 && (
          <Alert
            type="info"
            showIcon
            message="已启用大 HAR 内存优化"
            description={`${result.bodyRetention.reason || '部分大型响应体已省略。'} 共省略 ${result.bodyRetention.omittedCount} 个大型响应体，约 ${Math.round(result.bodyRetention.omittedBytes / 1024 / 1024 * 10) / 10}MB；请求、响应头、timing、状态码和诊断字段仍会完整参与分析。`}
          />
        )}
        <div className="har-result-content">
          {activeContent}
        </div>
        {activeKey === 'summary' ? (
          <section className="har-session-summary" aria-label="请求概览">
            <div className="har-session-summary__heading">
              <span>REQUEST SUMMARY</span>
              <strong>请求概览</strong>
            </div>
            <HarSummaryCards
              result={result}
              onFilterFailed={() => jumpToRequests('failed')}
              onFilterSlow={() => jumpToRequests('slow')}
              onFilterAll={() => jumpToRequests('all')}
            />
          </section>
        ) : null}
        <AnalysisDisclaimer variant="har" title="HAR 解析说明" />
      </div>
    </ResultWorkbenchShell>
  );
};

export default HarResultPage;
