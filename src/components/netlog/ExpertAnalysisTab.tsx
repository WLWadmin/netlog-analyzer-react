import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Space, Table, Tag, Typography } from 'antd';
import type { AnalysisResult, ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import type { DiagnosisSummary } from '../../diagnosis/shared';
import type { NetlogDatasetState } from '../../workers/netlogDatasetTypes';
import { useNetlogDiagnosisSummary } from '../../hooks/useNetlogDiagnosisSummary';
import EventsTab from './EventsTab';
import DatasetEventsTab from './DatasetEventsTab';
import DatasetSourceChainViewer from './DatasetSourceChainViewer';
import SourceChainViewer from './SourceChainViewer';
import SSLTab from './SSLTab';
import ProtocolTab from './ProtocolTab';
import PerformanceTab from './PerformanceTab';
import DiagnosisTab from './DiagnosisTab';
import BaselineCompareTab from '../shared/BaselineCompareTab';
import ExpertSegmentNav from './ExpertSegmentNav';
import type { DataLoadedView, DnsStateView, ProxyStateView, QuicStateView, Http2StateView, SocketsStateView } from '../../workers/netlogDatasetViews';
import { getNetlogDataLoadedInWorker, getNetlogDnsStateInWorker, getNetlogEventDetailInWorker, getNetlogProxyStateInWorker, getNetlogQuicStateInWorker, getNetlogHttp2StateInWorker, getNetlogSocketsStateInWorker } from '../../workers/workerClient';

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
      type={dataset?.status === 'error' ? 'warning' : 'info'}
      showIcon
      message={dataset?.status === 'importing' ? 'Dataset 正在后台索引' : dataset?.status === 'error' ? 'Dataset 索引失败，当前保留 summary preview' : 'Dataset 尚未接管该视图'}
      description={description}
    />
  </Card>
);

function datasetStatusDescription(dataset?: NetlogDatasetState): { type: 'success' | 'info' | 'warning' | 'error'; message: string; description: string } {
  if (dataset?.status === 'ready') {
    return {
      type: 'success',
      message: 'Dataset 已接管专家证据视图',
      description: `Dataset 已完成索引${dataset.eventCount !== undefined ? `（${dataset.eventCount.toLocaleString()} 条事件）` : ''}，Events/Data Loaded/DNS/Proxy/QUIC/HTTP/2/Sockets/Endpoint Evidence 可基于全量事件查询。注意：状态事实仍只是证据浏览，不等同于已确认根因。`,
    };
  }
  if (dataset?.status === 'importing') {
    return {
      type: 'info',
      message: 'Dataset 正在后台索引全量 NetLog 事件',
      description: dataset.phase
        ? `${dataset.phase}。索引完成后，Events/Data Loaded/DNS/Proxy/QUIC/HTTP/2/Sockets/Endpoint Evidence 将切换到完整 Dataset。当前结果仍可能只包含 preview 或 summary fallback。`
        : '索引完成后，Events/Data Loaded/DNS/Proxy/QUIC/HTTP/2/Sockets/Endpoint Evidence 将切换到完整 Dataset。当前结果仍可能只包含 preview 或 summary fallback。',
    };
  }
  if (dataset?.status === 'error') {
    return {
      type: 'error',
      message: 'Dataset 索引失败，当前保留 summary preview',
      description: `专家证据可能不完整。请重试索引或查看错误信息${dataset.error ? `：${dataset.error}` : '。'}`,
    };
  }
  return {
    type: 'warning',
    message: '当前展示的是大文件 summary preview',
    description: '已生成初步摘要，但 Events、DNS、Proxy、QUIC、HTTP/2、Sockets 等专家证据尚未由完整 Dataset 接管。系统将自动在后台构建 Dataset 索引。',
  };
}

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
          <Descriptions.Item label="代理事件">{view.proxyEvents.length}</Descriptions.Item>
          <Descriptions.Item label="请求级代理错误候选">{view.requestScopedErrors.length}</Descriptions.Item>
          <Descriptions.Item label="Resolution chains">{view.resolutionChains.length}</Descriptions.Item>
          <Descriptions.Item label="Request-scoped candidates">{view.requestScopedCandidateCount}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey={(row) => `${row.source}-${row.key}-${row.value}-${row.eventId ?? 'top'}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: '来源', dataIndex: 'source', width: 130 },
            { title: '配置字段', dataIndex: 'key', width: 260, ellipsis: true },
            { title: '值', dataIndex: 'value', render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
            { title: 'Event', dataIndex: 'eventId', width: 90, render: (value?: number) => value ?? '-' },
          ]}
          dataSource={view.proxyConfigs}
          locale={{ emptyText: '未发现 Dataset 代理配置快照' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.sourceId}-${row.firstEventId ?? ''}-${row.lastEventId ?? ''}`}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          columns={[
            { title: 'Source', dataIndex: 'sourceId', width: 90 },
            { title: 'Kinds', dataIndex: 'kinds', width: 190, render: (value: string[]) => value.join(' -> ') || '-' },
            { title: '代理', dataIndex: 'proxyServers', width: 240, ellipsis: true, render: (value: string[]) => value.join('；') || '-' },
            { title: 'PAC', dataIndex: 'pacUrls', width: 220, ellipsis: true, render: (value: string[]) => value.join('；') || '-' },
            { title: 'Errors', dataIndex: 'errors', width: 120, render: (value: Array<number | string>) => value.join(', ') || '-' },
            { title: 'Event range', key: 'range', width: 140, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
            { title: '摘要', dataIndex: 'summary', ellipsis: true },
          ]}
          dataSource={view.resolutionChains}
          locale={{ emptyText: '未发现 Dataset 代理解析链路' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sourceId}`}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 130 },
            { title: 'Event', dataIndex: 'eventId', width: 90 },
            { title: 'Source', dataIndex: 'sourceId', width: 90 },
            { title: 'Scope', dataIndex: 'requestScoped', width: 150, render: (value: boolean) => value ? <Tag color="green">request-scoped candidate</Tag> : <Tag color="orange">proxy fact</Tag> },
            { title: '代理', dataIndex: 'proxyServer', width: 220, ellipsis: true, render: (value?: string) => value || '-' },
            { title: '错误', dataIndex: 'error', width: 90, render: (value?: number | string) => value ?? '-' },
            { title: '摘要', dataIndex: 'summary', ellipsis: true },
            { title: 'Unresolved', dataIndex: 'unresolvedReason', ellipsis: true, render: (value?: string) => value || '-' },
          ]}
          dataSource={view.impactSummaries}
          locale={{ emptyText: '未发现 Dataset 代理 impact summary' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}`}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          columns={[
            { title: '类型', dataIndex: 'kind', width: 130 },
            { title: 'Event', dataIndex: 'eventId', width: 90 },
            { title: 'Source', dataIndex: 'sourceId', width: 90 },
            { title: '代理', dataIndex: 'proxyServer', width: 220, ellipsis: true, render: (value?: string) => value || '-' },
            { title: '错误', dataIndex: 'error', width: 90, render: (value?: number | string) => value ?? '-' },
            { title: '摘要', dataIndex: 'summary', ellipsis: true },
          ]}
          dataSource={view.proxyEvents}
          locale={{ emptyText: '未发现 Dataset 代理事件 trace' }}
        />
        {view.requestScopedErrors.length > 0 && (
          <Table
            size="small"
            rowKey={(row) => `${row.eventId}-${row.error}`}
            pagination={{ pageSize: 6, showSizeChanger: false }}
            columns={[
              { title: 'URL', dataIndex: 'url', ellipsis: true, render: (value?: string) => value || '-' },
              { title: '代理', dataIndex: 'proxyServer', width: 220, ellipsis: true, render: (value?: string) => value || '-' },
              { title: '错误', dataIndex: 'error', width: 90 },
              { title: 'Event', dataIndex: 'eventId', width: 90 },
              { title: '说明', dataIndex: 'reason', ellipsis: true },
            ]}
            dataSource={view.requestScopedErrors}
          />
        )}
        <Descriptions column={1} size="small">
          <Descriptions.Item label="PAC URL">{view.pacUrls.length > 0 ? view.pacUrls.join('；') : '未发现'}</Descriptions.Item>
          <Descriptions.Item label="代理服务器">{view.proxyServers.length > 0 ? view.proxyServers.join('；') : '未发现'}</Descriptions.Item>
          <Descriptions.Item label="Bypass 规则">{view.bypassRules.length > 0 ? view.bypassRules.join('；') : '未发现'}</Descriptions.Item>
        </Descriptions>
      </Space>
    </Card>
  );
};

const DatasetQuicStateCard: React.FC<{ analysisId: string }> = ({ analysisId }) => {
  const [view, setView] = useState<QuicStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogQuicStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) {
    return <Alert type="warning" showIcon message="Dataset QUIC State 读取失败" description={error} />;
  }
  if (!view) {
    return <Alert type="info" showIcon message="正在读取 Dataset QUIC State 视图" />;
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

  return (
    <Card title="QUIC State" bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="QUIC State 展示 QUIC / HTTP3 session 与错误线索"
          description="QUIC / HTTP3 使用状态是协议事实，不能单独作为失败或慢请求根因；有 error 时需要结合 raw event、目标 host、网络环境、代理/VPN 和协议回退情况判断。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.errors.length > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="QUIC/HTTP3 事件">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="QUIC 事件">{view.quicEventCount}</Descriptions.Item>
          <Descriptions.Item label="HTTP3 事件">{view.http3EventCount}</Descriptions.Item>
          <Descriptions.Item label="错误事件">{view.errors.length}</Descriptions.Item>
          <Descriptions.Item label="Handshake">{view.stateEvents.filter(item => item.kind === 'handshake').length}</Descriptions.Item>
          <Descriptions.Item label="Version negotiation">{view.stateEvents.filter(item => item.kind === 'version-negotiation').length}</Descriptions.Item>
          <Descriptions.Item label="Migration">{view.stateEvents.filter(item => item.kind === 'migration').length}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Source ID', dataIndex: 'sourceId', width: 110 },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Errors', dataIndex: 'errorCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Handshake', dataIndex: 'handshakeEventCount', width: 110 },
            { title: 'Version', dataIndex: 'versionNegotiationEventCount', width: 100 },
            { title: 'Migration', dataIndex: 'migrationEventCount', width: 100 },
            { title: 'Hosts', dataIndex: 'hosts', render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Peer addresses', dataIndex: 'peerAddresses', render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Versions', dataIndex: 'versions', render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Event range', key: 'range', width: 140, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
            { title: 'Byte range', key: 'bytes', width: 150, render: (_, row) => `${row.firstByteStart ?? '-'} - ${row.lastByteEnd ?? '-'}` },
          ]}
          dataSource={view.sessions}
          locale={{ emptyText: '未发现 Dataset QUIC / HTTP3 session' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.sourceId}-${row.kind}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 170 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 110 },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            { title: 'Version', dataIndex: 'version', width: 120, render: (value?: string) => value || '-' },
            { title: 'Peer', dataIndex: 'peerAddress', width: 180, render: (value?: string) => value || '-' },
          ]}
          dataSource={view.stateEvents}
          locale={{ emptyText: '未发现 QUIC handshake / version negotiation / migration trace' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.sourceId}-${row.error}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 110 },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            { title: 'Error', dataIndex: 'error', width: 170, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            { title: 'Details', dataIndex: 'details', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.errors}
          locale={{ emptyText: '未发现 Dataset QUIC / HTTP3 error' }}
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

const DatasetHttp2StateCard: React.FC<{ analysisId: string }> = ({ analysisId }) => {
  const [view, setView] = useState<Http2StateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogHttp2StateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) {
    return <Alert type="warning" showIcon message="Dataset HTTP/2 State 读取失败" description={error} />;
  }
  if (!view) {
    return <Alert type="info" showIcon message="正在读取 Dataset HTTP/2 State 视图" />;
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

  return (
    <Card title="HTTP/2 State" bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="HTTP/2 State 展示 session、stream 与协议错误线索"
          description="HTTP/2 使用状态是协议事实，不能单独作为请求失败或慢请求根因；GOAWAY、RST_STREAM、error 需要结合 raw event、ALPN、代理兼容性和协议回退判断。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.errors.length > 0 || view.goawayCount > 0 || view.rstStreamCount > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="HTTP/2 事件">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="GOAWAY">{view.goawayCount}</Descriptions.Item>
          <Descriptions.Item label="RST_STREAM">{view.rstStreamCount}</Descriptions.Item>
          <Descriptions.Item label="WINDOW_UPDATE">{view.windowUpdateCount}</Descriptions.Item>
          <Descriptions.Item label="Sessions">{view.sessions.length}</Descriptions.Item>
          <Descriptions.Item label="Streams">{view.streams.length}</Descriptions.Item>
          <Descriptions.Item label="Source links">{view.sourceLinks.length}</Descriptions.Item>
          <Descriptions.Item label="Impact summaries">{view.impactSummaries.length}</Descriptions.Item>
          <Descriptions.Item label="Request-scoped candidates">{view.requestScopedCandidateCount}</Descriptions.Item>
          <Descriptions.Item label="Unlinked streams">{view.unlinkedStreamCount}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Session Source ID', dataIndex: 'sourceId', width: 140 },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Streams', dataIndex: 'streamCount', width: 90 },
            { title: 'GOAWAY', dataIndex: 'goawayCount', width: 90 },
            { title: 'RST', dataIndex: 'rstStreamCount', width: 90 },
            { title: 'Window', dataIndex: 'windowUpdateCount', width: 90 },
            { title: 'Errors', dataIndex: 'errorCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Hosts', dataIndex: 'hosts', render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Protocols', dataIndex: 'protocols', render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Event range', key: 'range', width: 140, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
            { title: 'Byte range', key: 'bytes', width: 150, render: (_, row) => `${row.firstByteStart ?? '-'} - ${row.lastByteEnd ?? '-'}` },
          ]}
          dataSource={view.sessions}
          locale={{ emptyText: '未发现 Dataset HTTP/2 session' }}
        />
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Stream Source ID', dataIndex: 'sourceId', width: 140 },
            { title: 'Session Source ID', dataIndex: 'sessionSourceId', width: 150, render: (value?: number) => value ?? '-' },
            { title: 'Stream ID', dataIndex: 'streamId', width: 100, render: (value?: number) => value ?? '-' },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Errors', dataIndex: 'errorCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Hosts', dataIndex: 'hosts', render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Event range', key: 'range', width: 140, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
            { title: 'Byte range', key: 'bytes', width: 150, render: (_, row) => `${row.firstByteStart ?? '-'} - ${row.lastByteEnd ?? '-'}` },
          ]}
          dataSource={view.streams}
          locale={{ emptyText: '未发现 Dataset HTTP/2 stream' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sessionSourceId ?? ''}-${row.streamSourceId ?? ''}-${row.streamId ?? ''}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 120 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Session', dataIndex: 'sessionSourceId', width: 110, render: (value?: number) => value ?? '-' },
            { title: 'Stream Source', dataIndex: 'streamSourceId', width: 130, render: (value?: number) => value ?? '-' },
            { title: 'Stream ID', dataIndex: 'streamId', width: 100, render: (value?: number) => value ?? '-' },
            { title: 'Scope', dataIndex: 'requestScoped', width: 150, render: (value: boolean) => value ? <Tag color="green">request-scoped candidate</Tag> : <Tag color="orange">protocol fact</Tag> },
            { title: 'Summary', dataIndex: 'summary', ellipsis: true },
            { title: 'Unresolved', dataIndex: 'unresolvedReason', ellipsis: true, render: (value?: string) => value || '-' },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.impactSummaries}
          locale={{ emptyText: '未发现 HTTP/2 impact summary' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.sourceId}-${row.streamId ?? ''}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 110 },
            { title: 'Session', dataIndex: 'sessionSourceId', width: 110, render: (value?: number) => value ?? '-' },
            { title: 'Stream', dataIndex: 'streamId', width: 90, render: (value?: number) => value ?? '-' },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            { title: 'Error', dataIndex: 'error', width: 150, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            { title: 'Details', dataIndex: 'details', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.errors}
          locale={{ emptyText: '未发现 Dataset HTTP/2 error' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.fromSourceId}-${row.toSourceId}-${row.kind}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 150 },
            { title: 'From', dataIndex: 'fromSourceId', width: 100 },
            { title: 'To', dataIndex: 'toSourceId', width: 100 },
            { title: 'Event', dataIndex: 'eventId', width: 90 },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
          ]}
          dataSource={view.sourceLinks}
          locale={{ emptyText: '未发现 HTTP/2 显式 source link' }}
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

const DatasetSocketsStateCard: React.FC<{ analysisId: string }> = ({ analysisId }) => {
  const [view, setView] = useState<SocketsStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogSocketsStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) {
    return <Alert type="warning" showIcon message="Dataset Sockets State 读取失败" description={error} />;
  }
  if (!view) {
    return <Alert type="info" showIcon message="正在读取 Dataset Sockets State 视图" />;
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

  return (
    <Card title="Sockets State" bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="Sockets State 展示 connect / tls / pool / error 线索"
          description="Socket / TLS 事件是连接层事实，不能单独把 peer address、connect error 或候选 IP 当成请求根因；需要结合 source chain、DNS、代理和协议回退判断。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.errors.length > 0 || view.stallCount > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Socket/TCP/TLS 事件">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="Connect">{view.connectCount}</Descriptions.Item>
          <Descriptions.Item label="TLS">{view.tlsCount}</Descriptions.Item>
          <Descriptions.Item label="Stall/Timeout">{view.stallCount}</Descriptions.Item>
          <Descriptions.Item label="Socket Pools">{view.socketPoolCount}</Descriptions.Item>
          <Descriptions.Item label="Errors">{view.errors.length}</Descriptions.Item>
          <Descriptions.Item label="Source links">{view.sourceLinks.length}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Source ID', dataIndex: 'sourceId', width: 110 },
            { title: 'Source Type', dataIndex: 'sourceTypeName', width: 140 },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Connect', dataIndex: 'connectCount', width: 90 },
            { title: 'TLS', dataIndex: 'tlsCount', width: 80 },
            { title: 'Stall', dataIndex: 'stallCount', width: 80 },
            { title: 'Errors', dataIndex: 'errorCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Peer addresses', dataIndex: 'peerAddresses', render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Socket pools', dataIndex: 'socketPools', render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Event range', key: 'range', width: 140, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
            { title: 'Byte range', key: 'bytes', width: 150, render: (_, row) => `${row.firstByteStart ?? '-'} - ${row.lastByteEnd ?? '-'}` },
          ]}
          dataSource={view.sockets}
          locale={{ emptyText: '未发现 Dataset socket / tcp / tls 状态' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.sourceId}-${row.error ?? ''}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 110 },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            { title: 'Error', dataIndex: 'error', width: 150, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            { title: 'Peer', dataIndex: 'peerAddress', width: 160, ellipsis: true },
            { title: 'Details', dataIndex: 'details', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.errors}
          locale={{ emptyText: '未发现 Dataset socket connect / tls error' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.fromSourceId}-${row.toSourceId}-${row.kind}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 160 },
            { title: 'From', dataIndex: 'fromSourceId', width: 100 },
            { title: 'To', dataIndex: 'toSourceId', width: 100 },
            { title: 'Event', dataIndex: 'eventId', width: 90 },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
          ]}
          dataSource={view.sourceLinks}
          locale={{ emptyText: '未发现 Socket 显式 source link' }}
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
              ? '当前展示的是解析摘要字段；可在本页手动启动 Dataset 索引。索引完成后，Events/Data Loaded/DNS/Proxy/QUIC/HTTP/2/Sockets/Endpoint Evidence 会切换到 Dataset 查询协议。'
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
      dataset?.status === 'ready' && dataset.analysisId
        ? (
          <DatasetSourceChainViewer
            analysisId={dataset.analysisId}
            onNavigateToSource={(sourceId) => onNavigateToSource(sourceId)}
          />
        )
        : (
          <SourceChainViewer
            events={events}
            urlRequests={urlRequests}
            onNavigateToSource={(sourceId) => onNavigateToSource(sourceId)}
          />
        )
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
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetQuicStateCard analysisId={dataset.analysisId} />
        ) : (
          <StateGapCard
            title="QUIC State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示摘要中的 QUIC/HTTP3 事件；索引完成后会展示 QUIC session、版本、peer、error 和 raw event 跳转。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetHttp2StateCard analysisId={dataset.analysisId} />
        ) : (
          <StateGapCard
            title="HTTP/2 State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示摘要中的 HTTP/2 事件；索引完成后会展示 session、stream、GOAWAY、RST_STREAM、WINDOW_UPDATE 和 raw event 跳转。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetSocketsStateCard analysisId={dataset.analysisId} />
        ) : (
          <StateGapCard
            title="Sockets State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示摘要中的连接/IP 线索；索引完成后会展示 socket pool、connect、tls、stall、peer address 和 raw event 跳转。"
          />
        )}
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
        (() => {
          const status = datasetStatusDescription(dataset);
          return (
            <Alert
              type={status.type}
              showIcon
              style={{ marginBottom: 12 }}
              message={status.message}
              description={status.description}
            />
          );
        })()
      )}
      <ExpertSegmentNav activeKey={activeKey} onChange={onSubTabChange} />
      {contentByKey[activeKey]}
    </div>
  );
};

export default ExpertAnalysisTab;
