import React from 'react';
import { Alert, Button, Card, Descriptions, Space, Tag } from 'antd';
import type { AnalysisResult, ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import type { DiagnosisSummary } from '../../diagnosis/shared';
import type { NetlogDatasetState } from '../../workers/netlogDatasetTypes';
import { useNetlogDiagnosisSummary } from '../../hooks/useNetlogDiagnosisSummary';
import EventsTab from './EventsTab';
import DatasetEventsTab from './DatasetEventsTab';
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
  dataset?: NetlogDatasetState;
  canStartDatasetIndexing?: boolean;
  onStartDatasetIndexing?: () => void;
}

const EXPERT_TABS = ['data-loaded', 'events', 'source-chain', 'security', 'network-state', 'performance', 'baseline', 'report'];

const formatMb = (value?: number) => {
  if (!value) return '0 MB';
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const StateGapCard: React.FC<{ title: string; description: string; dataset?: NetlogDatasetState }> = ({ title, description, dataset }) => (
  <Card title={title} bordered={false}>
    <Alert
      type={dataset?.status === 'ready' ? 'warning' : 'info'}
      showIcon
      message="Dataset reducer 尚未覆盖"
      description={description}
    />
  </Card>
);

const ExpertAnalysisTab: React.FC<ExpertAnalysisTabProps> = ({
  result,
  events,
  urlRequests,
  activeSubTab,
  onSubTabChange,
  onNavigateToSource,
  diagnosisSummary,
  diagnosisLoading,
  dataset,
  canStartDatasetIndexing,
  onStartDatasetIndexing,
}) => {
  const activeKey = activeSubTab && EXPERT_TABS.includes(activeSubTab) ? activeSubTab : 'data-loaded';
  const { loading: diagnosisLoadingState, diagnosisSummary: sharedDiagnosisSummary } = useNetlogDiagnosisSummary(result, events);
  const effectiveDiagnosisSummary = diagnosisSummary || sharedDiagnosisSummary;
  const effectiveDiagnosisLoading = diagnosisLoading ?? diagnosisLoadingState;

  const contentByKey: Record<string, React.ReactNode> = {
    'data-loaded': (
      <Card
        title="Data Loaded"
        bordered={false}
        extra={
          result.largeFileMode?.enabled && dataset?.status !== 'ready' ? (
            <Button
              type="primary"
              loading={dataset?.status === 'importing'}
              disabled={!canStartDatasetIndexing || dataset?.status === 'importing'}
              onClick={onStartDatasetIndexing}
            >
              启动 Dataset 索引
            </Button>
          ) : null
        }
      >
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Dataset 状态">
            <Space>
              <Tag color={dataset?.status === 'ready' ? 'green' : dataset?.status === 'error' ? 'red' : result.largeFileMode?.enabled ? 'blue' : 'default'}>
                {dataset?.status || 'unavailable'}
              </Tag>
              {dataset?.analysisId ? <span style={{ color: 'var(--text-secondary)' }}>{dataset.analysisId}</span> : null}
              {dataset?.error ? <span style={{ color: 'var(--text-secondary)' }}>{dataset.error}</span> : null}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="事件总数">{result.totalEvents.toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="唯一 source">{result.uniqueSources.toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="时间范围">
            {result.timeRange.start} - {result.timeRange.end}
          </Descriptions.Item>
          {result.largeFileMode?.enabled && (
            <>
              <Descriptions.Item label="大文件扫描">
                已读取 {formatMb(result.largeFileMode.bytesRead)} / 文件大小 {formatMb(result.largeFileMode.fileSize)}
              </Descriptions.Item>
              <Descriptions.Item label="跳过异常事件">{result.largeFileMode.skippedEvents}</Descriptions.Item>
              <Descriptions.Item label="关键样本截断">
                {result.largeFileMode.truncatedEventsPreview ? '是' : '否'}
              </Descriptions.Item>
            </>
          )}
          <Descriptions.Item label="DNS 记录">{result.dnsRecords.length}</Descriptions.Item>
          <Descriptions.Item label="DNS Server">{result.dnsServers.length}</Descriptions.Item>
          <Descriptions.Item label="URL 请求">{result.urlRequests.length}</Descriptions.Item>
          <Descriptions.Item label="失败域名">{result.failedDomains.length}</Descriptions.Item>
        </Descriptions>
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message="Evidence gaps"
          description={
            result.largeFileMode?.enabled && dataset?.status !== 'ready'
              ? '当前处于摘要 fallback：可在本页启动 Dataset 索引。索引完成后，后续阶段会把 Events 分页和 Event detail 切换到 Dataset 查询协议。'
              : 'Dataset 未启用时，专家视图只能展示当前解析结果中的摘要字段。'
          }
        />
      </Card>
    ),
    events: dataset?.status === 'ready' && dataset.analysisId
      ? <DatasetEventsTab analysisId={dataset.analysisId} />
      : <EventsTab events={events} />,
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
    'network-state': (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <StateGapCard
          title="Proxy State"
          dataset={dataset}
          description="当前仅在诊断摘要中展示代理/VPN 线索；完整 Proxy resolver / PAC / fallback chain reducer 尚未接入 Dataset。"
        />
        <StateGapCard
          title="QUIC State"
          dataset={dataset}
          description="当前未从 Dataset reducer 构建 QUIC session 状态；后续应从 QUIC_SESSION / HTTP3 相关事件聚合。"
        />
        <StateGapCard
          title="HTTP/2 State"
          dataset={dataset}
          description="当前未从 Dataset reducer 构建 HTTP/2 session / stream 状态；后续应从 HTTP2_SESSION 与 HTTP2_STREAM 事件聚合。"
        />
        <StateGapCard
          title="Sockets State"
          dataset={dataset}
          description="当前只保留摘要中的连接/IP 线索；完整 socket pool、connect job、peer address 状态 reducer 尚未接入。"
        />
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
      {result.largeFileMode?.enabled && (
        <Alert
          type={dataset?.status === 'ready' ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          message={dataset?.status === 'ready' ? 'Dataset 模式已就绪' : '当前为大文件摘要 fallback'}
          description={
            dataset?.status === 'ready'
              ? '完整事件分页查询、Event detail 和状态视图可用。'
              : '已完整扫描 NetLog 并生成诊断摘要；当前专家视图展示关键事件样本，完整 Dataset 查询将在后续阶段启用。'
          }
        />
      )}
      <ExpertSegmentNav activeKey={activeKey} onChange={onSubTabChange} />
      {contentByKey[activeKey]}
    </div>
  );
};

export default ExpertAnalysisTab;
