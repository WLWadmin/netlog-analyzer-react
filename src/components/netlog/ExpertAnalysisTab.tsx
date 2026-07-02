import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Space, Table, Tag, Typography } from 'antd';
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
import type { DataLoadedView, DnsStateView, ProxyStateView } from '../../workers/netlogDatasetViews';
import { getNetlogDataLoadedInWorker, getNetlogDnsStateInWorker, getNetlogEventDetailInWorker, getNetlogProxyStateInWorker } from '../../workers/workerClient';

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

const DatasetDataLoadedCard: React.FC<{ analysisId: string }> = ({ analysisId }) => {
  const [view, setView] = useState<DataLoadedView | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogDataLoadedInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) {
    return <Alert type="warning" showIcon message="Dataset Data Loaded 读取失败" description={error} />;
  }
  if (!view) {
    return <Alert type="info" showIcon message="正在读取 Dataset Data Loaded 视图" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Descriptions column={2} size="small">
        <Descriptions.Item label="文件名">{view.fileName}</Descriptions.Item>
        <Descriptions.Item label="文件大小">{formatMb(view.fileSize)}</Descriptions.Item>
        <Descriptions.Item label="事件总数">{view.eventCount.toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="事件类型数">{view.eventTypeCount}</Descriptions.Item>
        <Descriptions.Item label="Source 类型数">{view.sourceTypeCount}</Descriptions.Item>
        <Descriptions.Item label="constants">{view.hasConstants ? '存在' : '缺失'}</Descriptions.Item>
        <Descriptions.Item label="polledData">{view.hasPolledData ? '存在' : '缺失'}</Descriptions.Item>
        <Descriptions.Item label="systemInfo">{view.hasSystemInfo ? '存在' : '缺失'}</Descriptions.Item>
        <Descriptions.Item label="clientInfo">{view.hasClientInfo ? '存在' : '缺失'}</Descriptions.Item>
        <Descriptions.Item label="netLogInfo">{view.hasNetLogInfo ? '存在' : '缺失'}</Descriptions.Item>
      </Descriptions>
      {view.evidenceGaps.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Evidence gaps"
          description={view.evidenceGaps.join('；')}
        />
      )}
      <Table
        size="small"
        rowKey="name"
        pagination={false}
        columns={[
          { title: 'Top Event Types', dataIndex: 'name' },
          { title: 'Count', dataIndex: 'count', width: 120 },
        ]}
        dataSource={view.topEventTypes.slice(0, 10)}
      />
      <Table
        size="small"
        rowKey="name"
        pagination={false}
        columns={[
          { title: 'Top Source Types', dataIndex: 'name' },
          { title: 'Count', dataIndex: 'count', width: 120 },
        ]}
        dataSource={view.topSourceTypes.slice(0, 10)}
      />
    </div>
  );
};

const DatasetDnsStateCard: React.FC<{ analysisId: string }> = ({ analysisId }) => {
  const [view, setView] = useState<DnsStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogDnsStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) {
    return <Alert type="warning" showIcon message="Dataset DNS State 读取失败" description={error} />;
  }
  if (!view) {
    return <Alert type="info" showIcon message="正在读取 Dataset DNS State 视图" />;
  }

  const openEventDetail = async (eventId?: number) => {
    if (eventId === undefined) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailText('');
    try {
      const raw = await getNetlogEventDetailInWorker({ analysisId, eventId });
      setDetailText(JSON.stringify(raw, null, 2));
    } catch (err) {
      setDetailText('读取失败：' + (err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const answerRows = [
    ...view.hostResolverCache.map(item => ({
      key: `cache-${item.eventId}`,
      source: 'Host Resolver Cache',
      host: item.host,
      ips: item.ips.join(', '),
      aliases: item.aliases.join(', '),
      eventId: item.eventId,
    })),
    ...view.taskResults.map(item => ({
      key: `task-${item.eventId}-${item.host}`,
      source: 'DNS Task Result',
      host: item.host,
      ips: item.ips.join(', '),
      aliases: item.aliases.join(', '),
      error: item.error,
      eventId: item.eventId,
    })),
  ];

  return (
    <Card title="DNS State" bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="DNS State 依赖 NetLog 中的配置快照和 Host Resolver 事件"
          description="如果 polledData、systemInfo、Host Resolver cache 或 DNS task 事件缺失，只表示当前文件无法还原完整 DNS 状态，不代表没有发生 DNS 解析。DoH / Secure DNS 候选也不等同于当前 DNS server 配置。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type="warning" showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="DNS server 配置">{view.configServers.length}</Descriptions.Item>
          <Descriptions.Item label="DoH/Secure DNS 候选">{view.dohCandidates.length}</Descriptions.Item>
          <Descriptions.Item label="Host Resolver cache">{view.hostResolverCache.length}</Descriptions.Item>
          <Descriptions.Item label="DNS task results">{view.taskResults.length}</Descriptions.Item>
          <Descriptions.Item label="DNS errors">{view.dnsErrors.length}</Descriptions.Item>
          <Descriptions.Item label="IPv6 reachability">{view.ipv6ReachabilityChecks.length}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey={(row) => `${row.source}-${row.sourceKey}-${row.ip}`}
          pagination={false}
          columns={[
            { title: 'DNS Server', dataIndex: 'ip', width: 180, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
            { title: '来源', dataIndex: 'source', width: 130 },
            { title: '配置字段', dataIndex: 'sourceKey', ellipsis: true },
          ]}
          dataSource={view.configServers}
          locale={{ emptyText: '未发现 Dataset DNS server 配置' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.source}-${row.sourceKey}-${row.value}`}
          pagination={false}
          columns={[
            { title: 'DoH / Secure DNS 候选', dataIndex: 'value', render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
            { title: '来源', dataIndex: 'source', width: 130 },
            { title: '配置字段', dataIndex: 'sourceKey', ellipsis: true },
          ]}
          dataSource={view.dohCandidates}
          locale={{ emptyText: '未发现 Dataset DoH / Secure DNS 候选线索' }}
        />
        <Table
          size="small"
          rowKey="key"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: '来源', dataIndex: 'source', width: 170 },
            { title: 'Host', dataIndex: 'host', width: 220 },
            { title: 'IPs', dataIndex: 'ips', render: (value: string) => <Typography.Text code>{value || '-'}</Typography.Text> },
            { title: 'Aliases', dataIndex: 'aliases' },
            { title: 'Error', dataIndex: 'error', width: 90, render: (value?: number) => value ?? '-' },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => row.eventId !== undefined
                ? <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>
                : <Tag>无事件 trace</Tag>,
            },
          ]}
          dataSource={answerRows}
          locale={{ emptyText: '未发现 Dataset DNS answer 线索' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.host}-${row.queryType}-${row.error}-${row.eventId}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Host', dataIndex: 'host', width: 240 },
            { title: 'Query Type', dataIndex: 'queryType', width: 120, render: (value?: string) => value || '-' },
            { title: 'Error', dataIndex: 'error', width: 100, render: (value: number) => <Tag color="red">{value}</Tag> },
            { title: 'Source ID', dataIndex: 'sourceId', width: 110 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => row.eventId !== undefined
                ? <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>
                : <Tag>无事件 trace</Tag>,
            },
          ]}
          dataSource={view.dnsErrors}
          locale={{ emptyText: '未发现 Dataset DNS task error' }}
        />
      </Space>
      <Modal
        title="Raw Event Detail"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={900}
      >
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detailLoading ? '正在读取...' : detailText}
        </pre>
      </Modal>
    </Card>
  );
};

const DatasetProxyStateCard: React.FC<{ analysisId: string }> = ({ analysisId }) => {
  const [view, setView] = useState<ProxyStateView | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogProxyStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) {
    return <Alert type="warning" showIcon message="Dataset Proxy State 读取失败" description={error} />;
  }
  if (!view) {
    return <Alert type="info" showIcon message="正在读取 Dataset Proxy State 视图" />;
  }

  return (
    <Card title="Proxy State" bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="Proxy State 只展示配置快照和候选线索"
          description="代理配置、PAC URL 或 bypass 规则是环境事实，不能单独作为请求失败或慢请求根因；仍需要结合代理事件、目标 host、错误码或直连对比。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.hasProxyEvidence ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="代理配置项">{view.proxyConfigs.length}</Descriptions.Item>
          <Descriptions.Item label="PAC URL">{view.pacUrls.length}</Descriptions.Item>
          <Descriptions.Item label="代理服务器">{view.proxyServers.length}</Descriptions.Item>
          <Descriptions.Item label="Bypass 规则">{view.bypassRules.length}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey={(row) => `${row.source}-${row.key}-${row.value}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: '来源', dataIndex: 'source', width: 130 },
            { title: '配置字段', dataIndex: 'key', width: 260, ellipsis: true },
            { title: '值', dataIndex: 'value', render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
          ]}
          dataSource={view.proxyConfigs}
          locale={{ emptyText: '未发现 Dataset 代理配置快照' }}
        />
        <Descriptions column={1} size="small">
          <Descriptions.Item label="PAC URL">{view.pacUrls.length > 0 ? view.pacUrls.join('；') : '未发现'}</Descriptions.Item>
          <Descriptions.Item label="代理服务器">{view.proxyServers.length > 0 ? view.proxyServers.join('；') : '未发现'}</Descriptions.Item>
          <Descriptions.Item label="Bypass 规则">{view.bypassRules.length > 0 ? view.bypassRules.join('；') : '未发现'}</Descriptions.Item>
        </Descriptions>
      </Space>
    </Card>
  );
};

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
  const canShowDatasetIndexButton = dataset?.status !== 'ready' && Boolean(onStartDatasetIndexing);

  const contentByKey: Record<string, React.ReactNode> = {
    'data-loaded': (
      <Card
        title="Data Loaded"
        bordered={false}
        extra={
          canShowDatasetIndexButton ? (
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
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetDataLoadedCard analysisId={dataset.analysisId} />
        ) : (
        <>
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
            dataset?.status !== 'ready' && canStartDatasetIndexing
              ? '当前展示的是解析摘要字段；可在本页手动启动 Dataset 索引。索引完成后，Events 分页、DNS State、证据跳转和 Event detail 会切换到 Dataset 查询协议。'
              : 'Dataset 未启用时，专家视图只能展示当前解析结果中的摘要字段。'
          }
        />
        </>
        )}
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
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetDnsStateCard analysisId={dataset.analysisId} />
        ) : (
          <StateGapCard
            title="DNS State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示 summary 中的 DNS 记录；索引完成后会展示 Host Resolver cache、DNS task results 和 IPv6 reachability。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetProxyStateCard analysisId={dataset.analysisId} />
        ) : (
          <StateGapCard
            title="Proxy State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示诊断摘要中的代理/VPN 线索；索引完成后会展示代理配置、PAC URL、代理服务器和 bypass 规则。"
          />
        )}
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
