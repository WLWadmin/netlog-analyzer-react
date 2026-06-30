import React from 'react';
import { Alert } from 'antd';
import type { AnalysisResult, ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import type { DiagnosisSummary } from '../../diagnosis/shared';
import { useNetlogDiagnosisSummary } from '../../hooks/useNetlogDiagnosisSummary';
import EventsTab from './EventsTab';
import SourceChainViewer from './SourceChainViewer';
import SSLTab from './SSLTab';
import ProtocolTab from './ProtocolTab';
import PerformanceTab from './PerformanceTab';
import DiagnosisTab from './DiagnosisTab';
import BaselineCompareTab from '../shared/BaselineCompareTab';
import ExpertSegmentNav from './ExpertSegmentNav';

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
  diagnosisSummary,
  diagnosisLoading,
}) => {
  const activeKey = activeSubTab && EXPERT_TABS.includes(activeSubTab) ? activeSubTab : 'events';
  const { loading: diagnosisLoadingState, diagnosisSummary: sharedDiagnosisSummary } = useNetlogDiagnosisSummary(result, events);
  const effectiveDiagnosisSummary = diagnosisSummary || sharedDiagnosisSummary;
  const effectiveDiagnosisLoading = diagnosisLoading ?? diagnosisLoadingState;

  const contentByKey: Record<string, React.ReactNode> = {
    events: <EventsTab events={events} />,
    'source-chain': (
      <SourceChainViewer
        events={events}
        urlRequests={urlRequests}
        onNavigateToSource={(sourceId) => onNavigateToSource(sourceId)}
      />
    ),
    security: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <SSLTab result={result} />
        <ProtocolTab result={result} />
      </div>
    ),
    performance: <PerformanceTab result={result} />,
    baseline: (
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
    report: (
      <DiagnosisTab
        result={result}
        events={events}
        mode="expert-report"
        prebuiltSummary={effectiveDiagnosisSummary}
        prebuiltLoading={effectiveDiagnosisLoading}
      />
    ),
  };

  return (
    <div>
      <ExpertSegmentNav activeKey={activeKey} onChange={onSubTabChange} />
      {contentByKey[activeKey]}
    </div>
  );
};

export default ExpertAnalysisTab;
