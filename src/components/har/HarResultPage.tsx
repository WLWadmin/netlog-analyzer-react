import { useState } from 'react';
import { Tabs, Alert } from 'antd';
import { UnorderedListOutlined, MedicineBoxOutlined, WarningOutlined } from '@ant-design/icons';
import { HarAnalysisResult } from '../../harParser';
import HarSummaryCards from './HarSummaryCards';
import HarRequestTable, { StatusFilter } from './HarRequestTable';
import HarSummaryDiagnosis from './HarSummaryDiagnosis';

interface HarResultPageProps {
  result: HarAnalysisResult;
}

// HAR 解析结果整体页面（汇总卡片 + 请求列表 / 汇总诊断 两个 Tab）
const HarResultPage: React.FC<HarResultPageProps> = ({ result }) => {
  const [activeKey, setActiveKey] = useState('requests');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const jumpToRequests = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setCategoryFilter('all'); // 卡片点击时重置类型筛选为 All
    setActiveKey('requests');
  };

  const tabItems = [
    {
      key: 'requests',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <UnorderedListOutlined />
          请求列表
        </span>
      ),
      children: (
        <HarRequestTable
          result={result}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
        />
      ),
    },
    {
      key: 'diagnosis',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MedicineBoxOutlined />
          汇总诊断
        </span>
      ),
      children: <HarSummaryDiagnosis result={result} />,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <HarSummaryCards
        result={result}
        onFilterFailed={() => jumpToRequests('failed')}
        onFilterSlow={() => jumpToRequests('slow')}
        onFilterAll={() => jumpToRequests('all')}
      />
      <Alert
        message={
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            <WarningOutlined style={{ marginRight: 6, color: '#fbbf24' }} />
            HAR 解析说明
          </span>
        }
        description={
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            数据来自浏览器 DevTools → Network 导出的 .har 文件，解析结果仅供参考。Size 优先取传输大小（_transferSize），关键字段（x-tt-logid / x-tt-cip / x-lsc-source-ip / Server-Timing）依赖响应头是否存在，请结合实际链路综合判断。
          </span>
        }
        type="warning"
        showIcon={false}
        style={{ background: 'rgba(251, 191, 36, 0.06)', border: '1px solid rgba(251, 191, 36, 0.2)', borderRadius: 10 }}
      />
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
          onChange={setActiveKey}
          items={tabItems}
          type="card"
          style={{ background: 'var(--bg-surface)', padding: '8px 12px 16px' }}
        />
      </div>
    </div>
  );
};

export default HarResultPage;
