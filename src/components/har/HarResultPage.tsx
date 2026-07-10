import { useState } from 'react';
import { Tabs, Alert } from 'antd';
import { UnorderedListOutlined, MedicineBoxOutlined, ToolOutlined, FileSearchOutlined } from '@ant-design/icons';
import { HarAnalysisResult } from '../../harParser';
import HarSummaryCards from './HarSummaryCards';
import HarRequestTable, { StatusFilter } from './HarRequestTable';
import HarNoviceDiagnosisOverview from './HarNoviceDiagnosisOverview';
import { AnalysisDisclaimer } from '../shared/AnalysisDisclaimer';
import RawEvidenceExplorer from '../raw/RawEvidenceExplorer';

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {result.repairInfo?.repaired && (
        <Alert
          type="warning"
          showIcon
          icon={<ToolOutlined />}
          message={result.repairInfo.reason}
          description={
            <div style={{ lineHeight: 1.6 }}>
              <div>恢复率：{result.repairInfo.recoveryRate}% · 已恢复 {result.repairInfo.recoveredEntries}/{result.repairInfo.totalEntries} 条请求</div>
              {result.repairInfo.droppedEntries > 0 && (
                <div style={{ color: '#f87171' }}>丢弃了 {result.repairInfo.droppedEntries} 条损坏请求</div>
              )}
              {result.repairInfo.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{w}</div>
              ))}
            </div>
          }
          style={{ background: 'var(--bg-surface)', borderRadius: 12 }}
        />
      )}
      {result.bodyRetention.mode === 'optimized' && result.bodyRetention.omittedCount > 0 && (
        <Alert
          type="info"
          showIcon
          message="已启用大 HAR 内存优化"
          description={`${result.bodyRetention.reason || '部分大型响应体已省略。'} 共省略 ${result.bodyRetention.omittedCount} 个大型响应体，约 ${Math.round(result.bodyRetention.omittedBytes / 1024 / 1024 * 10) / 10}MB；请求、响应头、timing、状态码和诊断字段仍会完整参与分析。`}
          style={{ background: 'var(--bg-surface)', borderRadius: 12 }}
        />
      )}
      <HarSummaryCards
        result={result}
        onFilterFailed={() => jumpToRequests('failed')}
        onFilterSlow={() => jumpToRequests('slow')}
        onFilterAll={() => jumpToRequests('all')}
      />
      <AnalysisDisclaimer variant="har" title="HAR 解析说明" />
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 14,
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          padding: '0 4px',
        }}
      >
        <Tabs
          activeKey={activeKey}
          onChange={handleTabChange}
          items={tabItems}
          type="card"
          style={{ background: 'var(--bg-surface)', padding: '8px 12px 16px' }}
        />
      </div>
    </div>
  );
};

export default HarResultPage;
