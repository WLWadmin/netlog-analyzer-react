import React from 'react';
import { Alert, Tabs } from 'antd';
import type { AnalysisResult, ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import type { DiagnosisSummary } from '../../diagnosis/shared';
import EventsTab from './EventsTab';
import SourceChainViewer from './SourceChainViewer';
import SSLTab from './SSLTab';
import ProtocolTab from './ProtocolTab';
import PerformanceTab from './PerformanceTab';
import DiagnosisTab from './DiagnosisTab';
import BaselineCompareTab from '../shared/BaselineCompareTab';

interface ExpertAnalysisTabProps {
  result: AnalysisResult;
  events: ParsedEvent[];
  urlRequests: URLRequest[];
  activeSubTab?: string;
  onSubTabChange: (key: string) => void;
  onNavigateToSource: (sourceId: number | string) => void;
  diagnosisSummary?: DiagnosisSummary;
  diagnosisLoading?: boolean;
}

const EXPERT_TABS = ['events', 'source-chain', 'security', 'performance', 'baseline', 'report'];

const ExpertAnalysisTab: React.FC<ExpertAnalysisTabProps> = ({
  result,
  events,
  urlRequests,
  activeSubTab,
  onSubTabChange,
  onNavigateToSource,
}) => {
  const activeKey = activeSubTab && EXPERT_TABS.includes(activeSubTab) ? activeSubTab : 'events';

  return (
    <Tabs
      activeKey={activeKey}
      onChange={onSubTabChange}
      type="card"
      items={[
        { key: 'events', label: '事件列表', children: <EventsTab events={events} /> },
        {
          key: 'source-chain',
          label: '源链路',
          children: (
            <SourceChainViewer
              events={events}
              urlRequests={urlRequests}
              onNavigateToSource={(sourceId) => onNavigateToSource(sourceId)}
            />
          ),
        },
        {
          key: 'security',
          label: '安全与协议',
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <SSLTab result={result} />
              <ProtocolTab result={result} />
            </div>
          ),
        },
        { key: 'performance', label: '性能分析', children: <PerformanceTab result={result} /> },
        {
          key: 'baseline',
          label: 'A-B 对比',
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Alert
                type="info"
                showIcon
                message="A-B 对比适合已有正常/异常基线文件时使用"
                description="如果只有单个问题文件，优先查看结论与行动、请求详情和证据链。"
              />
              <BaselineCompareTab />
            </div>
          ),
        },
        {
          key: 'report',
          label: '完整诊断报告',
          children: <DiagnosisTab result={result} events={events} />,
        },
      ]}
    />
  );
};

export default ExpertAnalysisTab;
