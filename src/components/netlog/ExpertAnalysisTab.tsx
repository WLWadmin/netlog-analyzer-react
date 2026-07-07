import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Space, Table, Tag, Tooltip, Typography } from 'antd';
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
import './netlogNavigation.css';
import type { DataLoadedView, DnsStateView, ProxyStateView, QuicStateView, Http2StateView, SocketsStateView, CacheStateView, AltSvcStateView, StreamPoolStateView, ReportingStateView, TimelineStateView, ModulesStateView, PrerenderStateView, NetlogRawEvidenceMetadataValueView } from '../../workers/netlogDatasetViews';
import { getNetlogDataLoadedInWorker, getNetlogDnsStateInWorker, getNetlogEventDetailInWorker, getNetlogProxyStateInWorker, getNetlogQuicStateInWorker, getNetlogHttp2StateInWorker, getNetlogSocketsStateInWorker, getNetlogCacheStateInWorker, getNetlogAltSvcStateInWorker, getNetlogStreamPoolStateInWorker, getNetlogReportingStateInWorker, getNetlogTimelineStateInWorker, getNetlogModulesStateInWorker, getNetlogPrerenderStateInWorker, getNetlogRawEvidenceMetadataInWorker } from '../../workers/workerClient';

interface ExpertAnalysisTabProps {
  result: AnalysisResult;
  events: ParsedEvent[];
  urlRequests: URLRequest[];
  activeSubTab?: string;
  onSubTabChange: (key: string) => void;
  onNavigateToSource: (sourceId: number | string) => void;
  onNavigateToSourceChain: (sourceId: number | string) => void;
  diagnosisSummary?: DiagnosisSummary;
  diagnosisLoading?: boolean;
  dataset?: NetlogDatasetState;
  canStartDatasetIndexing?: boolean;
  onStartDatasetIndexing?: () => void;
}

interface SourceNavigationProps {
  onNavigateToSource: (sourceId: number | string) => void;
  onNavigateToSourceChain: (sourceId: number | string) => void;
}

const EXPERT_TABS = ['data-loaded', 'events', 'source-chain', 'timeline', 'security', 'network-state', 'performance', 'baseline', 'report'];

const formatMb = (value?: number) => {
  if (!value) return '0 MB';
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const EmptyCell = () => <span className="netlog-muted-dash">-</span>;

const CompactIpList: React.FC<{ value: string[] }> = ({ value }) => {
  if (value.length === 0) return <EmptyCell />;
  return (
    <div className="netlog-ip-list">
      {value.map(ip => (
        <span key={ip} className="netlog-ip-pill">{ip}</span>
      ))}
    </div>
  );
};

const ClampedText: React.FC<{ value?: string; className?: string }> = ({ value, className }) => {
  if (!value) return <EmptyCell />;
  return (
    <Tooltip title={value}>
      <span className={className ? `netlog-clamped-text ${className}` : 'netlog-clamped-text'}>{value}</span>
    </Tooltip>
  );
};

const SourceJump: React.FC<{
  sourceId?: number;
  onNavigateToSource: (sourceId: number | string) => void;
}> = ({ sourceId, onNavigateToSource }) => {
  if (sourceId === undefined) return <>-</>;
  return (
    <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onNavigateToSource(sourceId)}>
      source#{sourceId}
    </Button>
  );
};

const SourceChainJump: React.FC<{
  sourceId?: number;
  onNavigateToSourceChain: (sourceId: number | string) => void;
}> = ({ sourceId, onNavigateToSourceChain }) => {
  if (sourceId === undefined) return null;
  return (
    <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onNavigateToSourceChain(sourceId)}>
      chain#{sourceId}
    </Button>
  );
};

const SourceEvidenceLinks: React.FC<{ sourceId?: number } & SourceNavigationProps> = ({
  sourceId,
  onNavigateToSource,
  onNavigateToSourceChain,
}) => {
  if (sourceId === undefined) return <>-</>;
  return (
    <Space size={6}>
      <SourceJump sourceId={sourceId} onNavigateToSource={onNavigateToSource} />
      <SourceChainJump sourceId={sourceId} onNavigateToSourceChain={onNavigateToSourceChain} />
    </Space>
  );
};

type EvidenceTier = 'locating' | 'validation' | 'background';

const evidenceTierConfig: Record<EvidenceTier, { label: string; color: string; description: string }> = {
  locating: {
    label: '可定位问题',
    color: 'red',
    description: '优先看这类证据：它们通常带有错误码、失败请求、request/source 关联或可跳转原始事件。',
  },
  validation: {
    label: '只作验证',
    color: 'orange',
    description: '用于验证候选方向。它们不能单独定因，需要和失败请求、source chain 或错误码一起看。',
  },
  background: {
    label: '背景信息',
    color: 'blue',
    description: '用于理解文件规模、环境和覆盖率。它们通常不直接说明网络根因。',
  },
};

const EvidenceTierTag: React.FC<{ tier: EvidenceTier }> = ({ tier }) => {
  const config = evidenceTierConfig[tier];
  return (
    <Tooltip title={config.description}>
      <Tag color={config.color}>{config.label}</Tag>
    </Tooltip>
  );
};

const EvidenceSectionTitle: React.FC<{ title: string; tier: EvidenceTier }> = ({ title, tier }) => (
  <Space size={8} wrap>
    <span>{title}</span>
    <EvidenceTierTag tier={tier} />
  </Space>
);

const ExpertEvidencePriorityGuide: React.FC<{
  activeKey: string;
  onJump: (key: string) => void;
}> = ({ activeKey, onJump }) => {
  const jumpButton = (key: string, label: string) => (
    <Button size="small" type={activeKey === key ? 'primary' : 'default'} onClick={() => onJump(key)}>
      {label}
    </Button>
  );

  return (
    <section className="expert-evidence-guide" aria-label="专家证据优先级">
      <div className="expert-evidence-guide__header">
        <div>
          <div className="expert-evidence-guide__eyebrow">Evidence Priority</div>
          <div className="expert-evidence-guide__title">先看能定位问题的证据，再看验证线索和背景指标</div>
        </div>
        <Typography.Text type="secondary" className="expert-evidence-guide__hint">
          指标多不代表都同等重要。能和失败请求、错误码、source chain 关联的证据优先级最高。
        </Typography.Text>
      </div>
      <div className="expert-evidence-guide__lanes">
        <div className="expert-evidence-guide__lane expert-evidence-guide__lane--locating">
          <EvidenceSectionTitle title="定位入口" tier="locating" />
          <ul className="expert-evidence-guide__items">
            <li>net_error / 失败 URL_REQUEST / 慢请求</li>
            <li>request-scoped DNS、Proxy、Socket、TLS、HTTP/2、QUIC 错误</li>
            <li>能跳 source chain 或 raw event 的证据</li>
          </ul>
          <Space size={8} wrap>
            {jumpButton('events', '看 Events')}
            {jumpButton('source-chain', '看 Source Chain')}
            {jumpButton('network-state', '看 State 错误')}
          </Space>
        </div>
        <div className="expert-evidence-guide__lane expert-evidence-guide__lane--validation">
          <EvidenceSectionTitle title="验证线索" tier="validation" />
          <ul className="expert-evidence-guide__items">
            <li>DNS answer、socket peer、x-request-ip</li>
            <li>DNS server / DoH candidate / Proxy config</li>
            <li>QUIC、HTTP/2、Alt-Svc、连接池状态</li>
          </ul>
          <Space size={8} wrap>
            {jumpButton('network-state', '看 Network State')}
            {jumpButton('security', '看协议/TLS')}
          </Space>
        </div>
        <div className="expert-evidence-guide__lane expert-evidence-guide__lane--background">
          <EvidenceSectionTitle title="背景指标" tier="background" />
          <ul className="expert-evidence-guide__items">
            <li>Data Loaded、事件总数、Source 数、时间范围</li>
            <li>Top event/source types 和 metadata 是否缺失</li>
            <li>Timeline、Performance 聚合统计、Reporting/NEL、Cache 概览</li>
          </ul>
          <Space size={8} wrap>
            {jumpButton('data-loaded', '看 Data Loaded')}
            {jumpButton('timeline', '看 Timeline')}
            {jumpButton('performance', '看 Performance')}
          </Space>
        </div>
      </div>
      <div className="expert-evidence-guide__workflow" aria-label="推荐排查顺序">
        <span className="expert-evidence-guide__step">1. 失败请求和错误码</span>
        <span className="expert-evidence-guide__arrow">→</span>
        <span className="expert-evidence-guide__step">2. Source Chain</span>
        <span className="expert-evidence-guide__arrow">→</span>
        <span className="expert-evidence-guide__step">3. request-scoped 状态错误</span>
        <span className="expert-evidence-guide__arrow">→</span>
        <span className="expert-evidence-guide__step">4. Raw Evidence 复核</span>
      </div>
    </section>
  );
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
      description: `Dataset 已完成索引${dataset.eventCount !== undefined ? `（${dataset.eventCount.toLocaleString()} 条事件）` : ''}，Events/Data Loaded/DNS/Proxy/QUIC/HTTP/2/Sockets/Cache/Alt-Svc/StreamPool/Reporting/Endpoint Evidence 可基于全量事件查询。注意：状态事实仍只是证据浏览，不等同于已确认根因。`,
    };
  }
  if (dataset?.status === 'importing') {
    return {
      type: 'info',
      message: 'Dataset 正在后台索引全量 NetLog 事件',
      description: dataset.phase
        ? `${dataset.phase}。索引完成后，Events/Data Loaded/DNS/Proxy/QUIC/HTTP/2/Sockets/Cache/Alt-Svc/StreamPool/Reporting/Endpoint Evidence 将切换到完整 Dataset。当前结果仍可能只包含 preview 或 summary fallback。`
        : '索引完成后，Events/Data Loaded/DNS/Proxy/QUIC/HTTP/2/Sockets/Cache/Alt-Svc/StreamPool/Reporting/Endpoint Evidence 将切换到完整 Dataset。当前结果仍可能只包含 preview 或 summary fallback。',
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
  const [rawOpen, setRawOpen] = useState(false);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawTitle, setRawTitle] = useState('');
  const [rawText, setRawText] = useState('');

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

  const openMetadata = async (key: NetlogRawEvidenceMetadataValueView['key']) => {
    setRawTitle(`${key} raw JSON`);
    setRawText('');
    setRawLoading(true);
    setRawOpen(true);
    try {
      const detail = await getNetlogRawEvidenceMetadataInWorker({ analysisId, key });
      setRawText(JSON.stringify(detail, null, 2));
    } catch (err) {
      setRawText(err instanceof Error ? err.message : String(err));
    } finally {
      setRawLoading(false);
    }
  };

  const metadataItems: Array<{ key: NetlogRawEvidenceMetadataValueView['key']; label: string; available: boolean }> = [
    { key: 'constants', label: 'constants', available: view.hasConstants },
    { key: 'polledData', label: 'polledData', available: view.hasPolledData },
    { key: 'systemInfo', label: 'systemInfo', available: view.hasSystemInfo },
    { key: 'clientInfo', label: 'clientInfo', available: view.hasClientInfo },
    { key: 'netLogInfo', label: 'netLogInfo', available: view.hasNetLogInfo },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message="Data Loaded 是背景信息"
        description="这里用于确认文件是否完整、metadata 是否存在、事件规模是否足够；它不直接说明网络根因。定位问题时请继续看失败请求、source chain 和 request-scoped 状态错误。"
      />
      <Descriptions column={2} size="small">
        <Descriptions.Item label="文件名">{view.fileName}</Descriptions.Item>
        <Descriptions.Item label="文件大小">{formatMb(view.fileSize)}</Descriptions.Item>
        <Descriptions.Item label="事件总数">{view.eventCount.toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="事件类型数">{view.eventTypeCount}</Descriptions.Item>
        <Descriptions.Item label="Source 类型数">{view.sourceTypeCount}</Descriptions.Item>
        {metadataItems.map(item => (
          <Descriptions.Item key={item.key} label={item.label}>
            <Space>
              <Tag color={item.available ? 'green' : 'default'}>{item.available ? '存在' : '缺失'}</Tag>
              {item.available && (
                <Button size="small" onClick={() => openMetadata(item.key)}>查看 raw</Button>
              )}
            </Space>
          </Descriptions.Item>
        ))}
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
      <Modal title={rawTitle} open={rawOpen} onCancel={() => setRawOpen(false)} footer={null} width={900}>
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {rawLoading ? '正在读取...' : rawText}
        </pre>
      </Modal>
    </div>
  );
};

const DatasetDnsStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
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
      ips: item.ips,
      aliases: item.aliases.join(', '),
      sourceId: item.sourceId,
      eventId: item.eventId,
    })),
    ...view.taskResults.map(item => ({
      key: `task-${item.eventId}-${item.host}`,
      source: 'DNS Task Result',
      host: item.host,
      ips: item.ips,
      aliases: item.aliases.join(', '),
      error: item.error,
      sourceId: item.sourceId,
      eventId: item.eventId,
    })),
  ];

  const ipv6Rows = view.ipv6ReachabilityChecks.map((item, index) => ({
    key: `ipv6-${item.eventId ?? item.sourceId ?? index}`,
    ...item,
  }));

  return (
    <Card title={<EvidenceSectionTitle title="DNS State" tier="validation" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="DNS State 先看 DNS task error，再看 DNS answer 和配置"
          description="DNS task error 且能关联失败请求时才接近定因；DNS answer、DNS server、DoH / Secure DNS 候选主要用于验证解析方向或说明环境，不能单独证明根因。如果 polledData、systemInfo、Host Resolver cache 或 DNS task 事件缺失，只表示当前文件无法还原完整 DNS 状态。"
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
            { title: 'Source', dataIndex: 'sourceId', width: 140, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Event', dataIndex: 'eventId', width: 90, render: (value?: number) => value ?? '-' },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => row.eventId !== undefined
                ? <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>
                : <Tag>无事件 trace</Tag>,
            },
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
            { title: 'Source', dataIndex: 'sourceId', width: 140, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Event', dataIndex: 'eventId', width: 90, render: (value?: number) => value ?? '-' },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => row.eventId !== undefined
                ? <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>
                : <Tag>无事件 trace</Tag>,
            },
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
            { title: 'IPs', dataIndex: 'ips', width: 260, render: (value: string[]) => <CompactIpList value={value} /> },
            { title: 'Aliases', dataIndex: 'aliases', width: 420, render: (value?: string) => <ClampedText value={value} /> },
            { title: 'Error', dataIndex: 'error', width: 80, render: (value?: number) => value ?? <EmptyCell /> },
            { title: 'Source', dataIndex: 'sourceId', width: 140, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'Source', dataIndex: 'sourceId', width: 140, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
        <Table
          size="small"
          rowKey="key"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'IPv6 available', dataIndex: 'available', width: 140, render: (value?: boolean) => value === undefined ? '-' : value ? <Tag color="green">true</Tag> : <Tag color="orange">false</Tag> },
            { title: 'Source', dataIndex: 'sourceId', width: 140, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
          dataSource={ipv6Rows}
          locale={{ emptyText: '未发现 Dataset IPv6 reachability 检查' }}
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

const DatasetProxyStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
  const [view, setView] = useState<ProxyStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

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
    <Card title={<EvidenceSectionTitle title="Proxy State" tier="validation" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="Proxy State 先看请求级代理错误，再看配置快照"
          description="proxy tunnel、bad proxy、fallback 等事件如果能关联失败请求，才适合作为定位证据。代理配置、PAC URL 或 bypass 规则是环境事实，不能单独作为请求失败或慢请求根因。"
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
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => row.eventId !== undefined
                ? <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>
                : <Tag>无事件 trace</Tag>,
            },
          ]}
          dataSource={view.proxyConfigs}
          locale={{ emptyText: '未发现 Dataset 代理配置快照' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.sourceId}-${row.firstEventId ?? ''}-${row.lastEventId ?? ''}`}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          columns={[
            { title: 'Source', dataIndex: 'sourceId', width: 110, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'Source', dataIndex: 'sourceId', width: 110, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Scope', dataIndex: 'requestScoped', width: 150, render: (value: boolean) => value ? <Tag color="green">request-scoped candidate</Tag> : <Tag color="orange">proxy fact</Tag> },
            { title: '代理', dataIndex: 'proxyServer', width: 220, ellipsis: true, render: (value?: string) => value || '-' },
            { title: '错误', dataIndex: 'error', width: 90, render: (value?: number | string) => value ?? '-' },
            { title: '摘要', dataIndex: 'summary', ellipsis: true },
            { title: 'Unresolved', dataIndex: 'unresolvedReason', ellipsis: true, render: (value?: string) => value || '-' },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
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
            { title: 'Source', dataIndex: 'sourceId', width: 110, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: '代理', dataIndex: 'proxyServer', width: 220, ellipsis: true, render: (value?: string) => value || '-' },
            { title: '错误', dataIndex: 'error', width: 90, render: (value?: number | string) => value ?? '-' },
            { title: '摘要', dataIndex: 'summary', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
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
              {
                title: '操作',
                key: 'action',
                width: 110,
                render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
              },
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
      <Modal title="Raw Event Detail" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detailLoading ? '正在读取...' : detailText}
        </pre>
      </Modal>
    </Card>
  );
};

const DatasetQuicStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
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
    <Card title={<EvidenceSectionTitle title="QUIC State" tier="validation" />} bordered={false}>
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
          <Descriptions.Item label="Impact summaries">{view.impactSummaries.length}</Descriptions.Item>
          <Descriptions.Item label="Request-scoped candidates">{view.requestScopedCandidateCount}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'Session', dataIndex: 'sessionSourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Scope', dataIndex: 'requestScoped', width: 150, render: (value: boolean) => value ? <Tag color="green">request-scoped candidate</Tag> : <Tag color="orange">protocol fact</Tag> },
            { title: 'Host', dataIndex: 'host', width: 180, ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Peer', dataIndex: 'peerAddress', width: 180, render: (value?: string) => value || '-' },
            { title: 'Version', dataIndex: 'version', width: 120, render: (value?: string) => value || '-' },
            { title: 'Error', dataIndex: 'error', width: 160, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
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
          locale={{ emptyText: '未发现 QUIC / HTTP3 impact summary' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.sourceId}-${row.kind}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 170 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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

const DatasetHttp2StateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
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
    <Card title={<EvidenceSectionTitle title="HTTP/2 State" tier="validation" />} bordered={false}>
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
            { title: 'Session Source ID', dataIndex: 'sourceId', width: 150, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'Stream Source ID', dataIndex: 'sourceId', width: 150, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Session Source ID', dataIndex: 'sessionSourceId', width: 150, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'Session', dataIndex: 'sessionSourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Stream Source', dataIndex: 'streamSourceId', width: 130, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Session', dataIndex: 'sessionSourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'From', dataIndex: 'fromSourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'To', dataIndex: 'toSourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Event', dataIndex: 'eventId', width: 90 },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
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

const DatasetSocketsStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
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
    <Card title={<EvidenceSectionTitle title="Sockets State" tier="validation" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="Sockets State 先看 request-scoped connect/TLS error，再看 peer address"
          description="connect error、TLS error、stall 如果能关联失败请求，才接近定位证据。socket peer 和候选 IP 只是连接目标线索，不能直接等同 SIP 或根因；需要结合 source chain、DNS、代理和协议回退判断。"
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
          <Descriptions.Item label="Impact summaries">{view.impactSummaries.length}</Descriptions.Item>
          <Descriptions.Item label="Request-scoped candidates">{view.requestScopedCandidateCount}</Descriptions.Item>
          <Descriptions.Item label="Probe attempted">{view.lazyParamsStats.probeAttemptedEvents}</Descriptions.Item>
          <Descriptions.Item label="Probe satisfied">{view.lazyParamsStats.probeSatisfiedEvents}</Descriptions.Item>
          <Descriptions.Item label="Params fallback">{view.lazyParamsStats.fallbackParamEvents}</Descriptions.Item>
          <Descriptions.Item label="Early reducer">{view.lazyParamsStats.earlyReducerEvents}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
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
            { title: 'Kind', dataIndex: 'kind', width: 130 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Scope', dataIndex: 'requestScoped', width: 128, render: (value: boolean) => value ? <Tag color="green">request-scoped candidate</Tag> : <Tag color="orange">socket fact</Tag> },
            { title: 'Peer', dataIndex: 'peerAddress', width: 96, render: (value?: string) => <ClampedText value={value} className="netlog-one-line" /> },
            { title: 'Pools', dataIndex: 'socketPools', width: 96, render: (value?: string[]) => <ClampedText value={value?.join('；')} className="netlog-one-line" /> },
            { title: 'Error', dataIndex: 'error', width: 88, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : <EmptyCell /> },
            { title: 'Summary', dataIndex: 'summary', width: 240, render: (value?: string) => <ClampedText value={value} /> },
            { title: 'Unresolved', dataIndex: 'unresolvedReason', width: 260, render: (value?: string) => <ClampedText value={value} /> },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.impactSummaries}
          locale={{ emptyText: '未发现 Socket impact summary' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.sourceId}-${row.error ?? ''}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            { title: 'Error', dataIndex: 'error', width: 88, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : <EmptyCell /> },
            { title: 'Peer', dataIndex: 'peerAddress', width: 120, render: (value?: string) => <ClampedText value={value} className="netlog-one-line" /> },
            { title: 'Details', dataIndex: 'details', width: 320, render: (value?: string) => <ClampedText value={value} /> },
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
            { title: 'From', dataIndex: 'fromSourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'To', dataIndex: 'toSourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Event', dataIndex: 'eventId', width: 90 },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
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

const DatasetCacheStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
  const [view, setView] = useState<CacheStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogCacheStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) {
    return <Alert type="warning" showIcon message="Dataset Cache State 读取失败" description={error} />;
  }
  if (!view) {
    return <Alert type="info" showIcon message="正在读取 Dataset Cache State 视图" />;
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
    <Card title={<EvidenceSectionTitle title="Cache State" tier="background" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="Cache State 展示浏览器缓存层操作"
          description="cache hit/miss、revalidation、doom 或 cache error 只是缓存层事实，不能单独证明请求失败根因；需要结合请求状态码、网络请求、代理、DNS 和服务端缓存头判断。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.errorCount > 0 || view.bypassCount > 0 || view.doomCount > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Cache 事件">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="Open/Create">{view.openCount} / {view.createCount}</Descriptions.Item>
          <Descriptions.Item label="Read/Write">{view.readCount} / {view.writeCount}</Descriptions.Item>
          <Descriptions.Item label="Doom/Bypass">{view.doomCount} / {view.bypassCount}</Descriptions.Item>
          <Descriptions.Item label="Revalidation">{view.validationCount}</Descriptions.Item>
          <Descriptions.Item label="Errors">{view.errorCount}</Descriptions.Item>
          <Descriptions.Item label="Impact candidates">{view.impactSummaries.length}</Descriptions.Item>
          <Descriptions.Item label="Request-scoped candidates">{view.requestScopedCandidateCount}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Source Type', dataIndex: 'sourceTypeName', width: 150 },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Operations', dataIndex: 'operationKinds', width: 180, render: (value: string[]) => value.join(', ') || '-' },
            { title: 'Errors', dataIndex: 'errorCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'URLs', dataIndex: 'urls', ellipsis: true, render: (value: string[]) => value.slice(0, 3).join('；') || '-' },
            { title: 'Cache keys', dataIndex: 'cacheKeys', ellipsis: true, render: (value: string[]) => value.slice(0, 3).join('；') || '-' },
            { title: 'Event range', key: 'range', width: 140, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
          ]}
          dataSource={view.entries}
          locale={{ emptyText: '未发现 Dataset HTTP/DISK/SIMPLE cache 状态' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sourceId}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 110 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Error', dataIndex: 'error', width: 130, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            { title: 'URL', dataIndex: 'url', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Cache key', dataIndex: 'cacheKey', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Summary', dataIndex: 'summary', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.impactSummaries}
          locale={{ emptyText: '未发现 Cache impact summary' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sourceId}-operation`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 110 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            { title: 'URL', dataIndex: 'url', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Error', dataIndex: 'error', width: 130, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.operations}
          locale={{ emptyText: '未发现 Cache operation' }}
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

const DatasetAltSvcStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
  const [view, setView] = useState<AltSvcStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogAltSvcStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) return <Alert type="warning" showIcon message="Dataset Alt-Svc State 读取失败" description={error} />;
  if (!view) return <Alert type="info" showIcon message="正在读取 Dataset Alt-Svc State 视图" />;

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
    <Card title={<EvidenceSectionTitle title="Alt-Svc State" tier="validation" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="Alt-Svc State 展示 HTTP/3 / 替代服务候选"
          description="Alt-Svc found/broken 是协议选择事实，不能单独证明 QUIC 或 HTTP/3 是根因；需要结合 QUIC、HTTP/2、代理和防火墙 UDP 443 支持判断。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.brokenCount > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Alt-Svc 事件">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="Found/Used">{view.foundCount} / {view.usedCount}</Descriptions.Item>
          <Descriptions.Item label="Broken/Cleared">{view.brokenCount} / {view.clearedCount}</Descriptions.Item>
          <Descriptions.Item label="Request-scoped candidates">{view.requestScopedCandidateCount}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="key"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Host', dataIndex: 'host', width: 180, render: (value?: string) => value || '-' },
            { title: 'Origin', dataIndex: 'origin', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Protocol', dataIndex: 'protocol', width: 110, render: (value?: string) => value || '-' },
            { title: 'Alternative', dataIndex: 'alternativeService', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Port', dataIndex: 'port', width: 90, render: (value?: number | string) => value ?? '-' },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Broken', dataIndex: 'brokenCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Event range', key: 'range', width: 140, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
          ]}
          dataSource={view.alternatives}
          locale={{ emptyText: '未发现 Dataset Alt-Svc 候选' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sourceId}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 110 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Host', dataIndex: 'host', width: 180, render: (value?: string) => value || '-' },
            { title: 'Protocol', dataIndex: 'protocol', width: 110, render: (value?: string) => value || '-' },
            { title: 'Error', dataIndex: 'error', width: 130, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            { title: 'Summary', dataIndex: 'summary', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.impactSummaries}
          locale={{ emptyText: '未发现 Alt-Svc impact summary' }}
        />
      </Space>
      <Modal title="Raw Event Detail" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detailLoading ? '正在读取...' : detailText}
        </pre>
      </Modal>
    </Card>
  );
};

const DatasetStreamPoolStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
  const [view, setView] = useState<StreamPoolStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogStreamPoolStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) return <Alert type="warning" showIcon message="Dataset StreamPool State 读取失败" description={error} />;
  if (!view) return <Alert type="info" showIcon message="正在读取 Dataset StreamPool State 视图" />;

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
    <Card title={<EvidenceSectionTitle title="StreamPool State" tier="validation" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="StreamPool State 展示连接池等待、复用和绑定线索"
          description="waiting/stalled 只是连接池事实，不能单独证明网络故障；需要结合 Sockets、Proxy、DNS、HTTP/2/QUIC 和请求 source chain 判断。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.stalledCount > 0 || view.errorCount > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Pool/Stream 事件">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="Waiting/Stalled">{view.waitCount} / {view.stalledCount}</Descriptions.Item>
          <Descriptions.Item label="Reused/Bound socket">{view.reusedSocketCount} / {view.boundSocketCount}</Descriptions.Item>
          <Descriptions.Item label="Connect jobs">{view.connectJobCount}</Descriptions.Item>
          <Descriptions.Item label="Errors">{view.errorCount}</Descriptions.Item>
          <Descriptions.Item label="Source links">{view.sourceLinks.length}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Source Type', dataIndex: 'sourceTypeName', width: 150 },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Wait', dataIndex: 'waitCount', width: 80 },
            { title: 'Stall', dataIndex: 'stalledCount', width: 80, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Reuse/Bound', key: 'reuse', width: 120, render: (_, row) => `${row.reusedSocketCount} / ${row.boundSocketCount}` },
            { title: 'Groups', dataIndex: 'groups', width: 120, render: (value: string[]) => <ClampedText value={value.slice(0, 3).join('；')} className="netlog-one-line" /> },
            { title: 'URLs', dataIndex: 'urls', width: 420, render: (value: string[]) => <ClampedText value={value.slice(0, 3).join('；')} /> },
          ]}
          dataSource={view.jobs}
          locale={{ emptyText: '未发现 Dataset HTTP stream / socket pool 状态' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sourceId}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 110 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Group', dataIndex: 'group', width: 150, render: (value?: string) => <ClampedText value={value} className="netlog-one-line" /> },
            { title: 'Error', dataIndex: 'error', width: 88, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : <EmptyCell /> },
            { title: 'Summary', dataIndex: 'summary', width: 320, render: (value?: string) => <ClampedText value={value} /> },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.impactSummaries}
          locale={{ emptyText: '未发现 StreamPool impact summary' }}
        />
      </Space>
      <Modal title="Raw Event Detail" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detailLoading ? '正在读取...' : detailText}
        </pre>
      </Modal>
    </Card>
  );
};

const DatasetReportingStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
  const [view, setView] = useState<ReportingStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogReportingStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) return <Alert type="warning" showIcon message="Dataset Reporting/NEL State 读取失败" description={error} />;
  if (!view) return <Alert type="info" showIcon message="正在读取 Dataset Reporting/NEL State 视图" />;

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
    <Card title={<EvidenceSectionTitle title="Reporting/NEL State" tier="background" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="Reporting/NEL State 展示浏览器网络错误上报机制"
          description="Reporting/NEL 是旁路上报机制。报告 queued、endpoint config 或 upload failure 不能单独证明业务请求失败，只能说明浏览器是否尝试记录或上报网络错误。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.failureCount > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Reporting/NEL 事件">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="Endpoints">{view.endpointCount}</Descriptions.Item>
          <Descriptions.Item label="Queued">{view.queuedCount}</Descriptions.Item>
          <Descriptions.Item label="Uploaded/Succeeded">{view.uploadCount} / {view.successCount}</Descriptions.Item>
          <Descriptions.Item label="Failures">{view.failureCount}</Descriptions.Item>
          <Descriptions.Item label="Cache events">{view.cacheCount}</Descriptions.Item>
          <Descriptions.Item label="Impact summaries">{view.impactSummaries.length}</Descriptions.Item>
          <Descriptions.Item label="Request-scoped candidates">{view.requestScopedCandidateCount}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="key"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Origin', dataIndex: 'origin', width: 220, render: (value?: string) => value || '-' },
            { title: 'Group', dataIndex: 'group', width: 120, render: (value?: string) => value || '-' },
            { title: 'Endpoint', dataIndex: 'url', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Priority', dataIndex: 'priority', width: 90, render: (value?: number | string) => value ?? '-' },
            { title: 'Weight', dataIndex: 'weight', width: 90, render: (value?: number | string) => value ?? '-' },
            { title: 'Uploads', dataIndex: 'uploadCount', width: 90 },
            { title: 'Failures', dataIndex: 'failureCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Event range', key: 'range', width: 140, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
          ]}
          dataSource={view.endpoints}
          locale={{ emptyText: '未发现 Dataset Reporting/NEL endpoint' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sourceId}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 140 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source ID', dataIndex: 'sourceId', width: 120, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Origin', dataIndex: 'origin', width: 220, render: (value?: string) => value || '-' },
            { title: 'Endpoint', dataIndex: 'endpointUrl', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Report type', dataIndex: 'reportType', width: 140, render: (value?: string) => value || '-' },
            { title: 'Error', dataIndex: 'error', width: 130, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            { title: 'Summary', dataIndex: 'summary', ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.impactSummaries}
          locale={{ emptyText: '未发现 Reporting/NEL impact summary' }}
        />
      </Space>
      <Modal title="Raw Event Detail" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detailLoading ? '正在读取...' : detailText}
        </pre>
      </Modal>
    </Card>
  );
};

const DatasetTimelineStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
  const [view, setView] = useState<TimelineStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogTimelineStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) return <Alert type="warning" showIcon message="Dataset Timeline State 读取失败" description={error} />;
  if (!view) return <Alert type="info" showIcon message="正在读取 Dataset Timeline State 视图" />;

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

  const errorBuckets = view.buckets
    .filter(bucket => bucket.errorCount > 0)
    .sort((a, b) => b.errorCount - a.errorCount || b.eventCount - a.eventCount)
    .slice(0, 20);

  return (
    <Card title={<EvidenceSectionTitle title="Timeline State" tier="background" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="info"
          showIcon
          message="Timeline State 展示全文件事件密度和错误密度"
          description="Timeline 用于快速定位问题集中发生的时间窗口和 source，不直接给出根因；确认根因仍要跳到 Events、Source Chain 和 Raw Event。"
        />
        {view.evidenceGaps.length > 0 && (
          <Alert type={view.notableEvents.length > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />
        )}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Time range">{view.timeRange.start} - {view.timeRange.end}</Descriptions.Item>
          <Descriptions.Item label="Duration">{view.timeRange.duration} ms</Descriptions.Item>
          <Descriptions.Item label="Bucket size">{view.bucketSizeMs} ms</Descriptions.Item>
          <Descriptions.Item label="Buckets">{view.buckets.length}</Descriptions.Item>
          <Descriptions.Item label="Error samples">{view.notableEvents.length}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="index"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: 'Bucket', dataIndex: 'index', width: 90 },
            { title: 'Start', dataIndex: 'start', width: 140 },
            { title: 'End', dataIndex: 'end', width: 140 },
            { title: 'Events', dataIndex: 'eventCount', width: 100 },
            { title: 'Errors', dataIndex: 'errorCount', width: 100, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
          ]}
          dataSource={errorBuckets.length > 0 ? errorBuckets : view.buckets.slice(0, 20)}
          locale={{ emptyText: '未发现 Timeline bucket' }}
        />
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: 'Source', dataIndex: 'sourceId', width: 150, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Source Type', dataIndex: 'sourceTypeName', width: 180 },
            { title: 'Events', dataIndex: 'eventCount', width: 100 },
            { title: 'Errors', dataIndex: 'errorCount', width: 100, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Event range', key: 'range', width: 150, render: (_, row) => `${row.firstEventId} - ${row.lastEventId}` },
            { title: 'Time range', key: 'time', render: (_, row) => `${row.firstTime} - ${row.lastTime}` },
          ]}
          dataSource={view.sourceActivity}
          locale={{ emptyText: '未发现 source activity' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.sourceId}`}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Time', dataIndex: 'time', width: 130 },
            { title: 'Source', dataIndex: 'sourceId', width: 150, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Type', dataIndex: 'typeName', ellipsis: true },
            { title: 'Source Type', dataIndex: 'sourceTypeName', width: 180 },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button>,
            },
          ]}
          dataSource={view.notableEvents}
          locale={{ emptyText: '未发现错误事件样例' }}
        />
      </Space>
      <Modal title="Raw Event Detail" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detailLoading ? '正在读取...' : detailText}
        </pre>
      </Modal>
    </Card>
  );
};

const DatasetModulesStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
  const [view, setView] = useState<ModulesStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogModulesStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) return <Alert type="warning" showIcon message="Dataset Modules State 读取失败" description={error} />;
  if (!view) return <Alert type="info" showIcon message="正在读取 Dataset Modules State 视图" />;

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
    <Card title={<EvidenceSectionTitle title="Modules State" tier="background" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert type="info" showIcon message="Modules State 展示浏览器内部模块/组件线索" description="Modules 通常是专家背景信息。除非出现 module/component failure，否则不应作为用户网络问题的主因。" />
        {view.evidenceGaps.length > 0 && <Alert type={view.errorCount > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Modules">{view.modules.length}</Descriptions.Item>
          <Descriptions.Item label="Events">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="Errors">{view.errorCount}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="key"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Name', dataIndex: 'name', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Category', dataIndex: 'category', width: 120 },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Errors', dataIndex: 'errorCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'Event range', key: 'range', width: 150, render: (_, row) => `${row.firstEventId ?? '-'} - ${row.lastEventId ?? '-'}` },
          ]}
          dataSource={view.modules}
          locale={{ emptyText: '未发现 Dataset Modules / Components 事件' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sourceId}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 130 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source', dataIndex: 'sourceId', width: 150, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Name', dataIndex: 'name', ellipsis: true, render: (value?: string) => value || '-' },
            { title: 'Error', dataIndex: 'error', width: 120, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            { title: 'Summary', dataIndex: 'summary', ellipsis: true },
            { title: '操作', key: 'action', width: 110, render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button> },
          ]}
          dataSource={view.events}
          locale={{ emptyText: '未发现 Modules event' }}
        />
      </Space>
      <Modal title="Raw Event Detail" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detailLoading ? '正在读取...' : detailText}
        </pre>
      </Modal>
    </Card>
  );
};

const DatasetPrerenderStateCard: React.FC<{ analysisId: string } & SourceNavigationProps> = ({ analysisId, onNavigateToSource, onNavigateToSourceChain }) => {
  const [view, setView] = useState<PrerenderStateView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailText, setDetailText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setError(undefined);
    getNetlogPrerenderStateInWorker({ analysisId })
      .then(next => { if (!cancelled) setView(next); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [analysisId]);

  if (error) return <Alert type="warning" showIcon message="Dataset Prerender State 读取失败" description={error} />;
  if (!view) return <Alert type="info" showIcon message="正在读取 Dataset Prerender State 视图" />;

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
    <Card title={<EvidenceSectionTitle title="Prerender State" tier="background" />} bordered={false}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert type="info" showIcon message="Prerender State 展示预渲染、预取、预连接和导航预测" description="这些是浏览器预测行为。只有当它们和真实失败请求、用户触发时间或 source chain 对上时，才应作为影响用户体验的候选线索。" />
        {view.evidenceGaps.length > 0 && <Alert type={view.errorCount > 0 ? 'warning' : 'info'} showIcon message="Evidence gaps" description={view.evidenceGaps.join('；')} />}
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Events">{view.eventCount}</Descriptions.Item>
          <Descriptions.Item label="Activities">{view.activities.length}</Descriptions.Item>
          <Descriptions.Item label="Prerender/Prefetch">{view.prerenderCount} / {view.prefetchCount}</Descriptions.Item>
          <Descriptions.Item label="Preconnect">{view.preconnectCount}</Descriptions.Item>
          <Descriptions.Item label="Prediction/Speculation">{view.predictionCount} / {view.speculationCount}</Descriptions.Item>
          <Descriptions.Item label="Errors">{view.errorCount}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="sourceId"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Source', dataIndex: 'sourceId', width: 150, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'Kind', dataIndex: 'kind', width: 120 },
            { title: 'Source Type', dataIndex: 'sourceTypeName', width: 180 },
            { title: 'Events', dataIndex: 'eventCount', width: 90 },
            { title: 'Errors', dataIndex: 'errorCount', width: 90, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag> },
            { title: 'URLs', dataIndex: 'urls', ellipsis: true, render: (value: string[]) => <ClampedText value={value.slice(0, 3).join('；')} /> },
          ]}
          dataSource={view.activities}
          locale={{ emptyText: '未发现 Dataset Prerender/Prefetch 活动' }}
        />
        <Table
          size="small"
          rowKey={(row) => `${row.eventId}-${row.kind}-${row.sourceId}`}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'Kind', dataIndex: 'kind', width: 120 },
            { title: 'Event ID', dataIndex: 'eventId', width: 100 },
            { title: 'Source', dataIndex: 'sourceId', width: 150, render: (value?: number) => <SourceEvidenceLinks sourceId={value} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} /> },
            { title: 'URL', dataIndex: 'url', ellipsis: true, render: (value?: string) => <ClampedText value={value} /> },
            { title: 'Error', dataIndex: 'error', width: 120, render: (value?: number | string) => value !== undefined ? <Tag color="red">{String(value)}</Tag> : '-' },
            { title: 'Summary', dataIndex: 'summary', ellipsis: true },
            { title: '操作', key: 'action', width: 110, render: (_, row) => <Button size="small" onClick={() => openEventDetail(row.eventId)}>查看事件</Button> },
          ]}
          dataSource={view.impactSummaries}
          locale={{ emptyText: '未发现 Prerender impact summary' }}
        />
      </Space>
      <Modal title="Raw Event Detail" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
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
  onNavigateToSourceChain,
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
        title={<EvidenceSectionTitle title="Data Loaded" tier="background" />}
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
    timeline: (
      dataset?.status === 'ready' && dataset.analysisId ? (
        <DatasetTimelineStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
      ) : (
        <StateGapCard
          title="Timeline State"
          dataset={dataset}
          description="Dataset 未就绪时只能使用请求列表和性能瀑布图；索引完成后会展示全局事件时间分布、错误密度 bucket、source activity 和 raw event 跳转。"
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
      <div className="netlog-network-state-panel">
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetDnsStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
        ) : (
          <StateGapCard
            title="DNS State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示 summary 中的 DNS 记录；索引完成后会展示 Host Resolver cache、DNS task results 和 IPv6 reachability。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetProxyStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
        ) : (
          <StateGapCard
            title="Proxy State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示诊断摘要中的代理/VPN 线索；索引完成后会展示代理配置、PAC URL、代理服务器和 bypass 规则。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetQuicStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
        ) : (
          <StateGapCard
            title="QUIC State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示摘要中的 QUIC/HTTP3 事件；索引完成后会展示 QUIC session、版本、peer、error 和 raw event 跳转。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetHttp2StateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
        ) : (
          <StateGapCard
            title="HTTP/2 State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示摘要中的 HTTP/2 事件；索引完成后会展示 session、stream、GOAWAY、RST_STREAM、WINDOW_UPDATE 和 raw event 跳转。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetSocketsStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
        ) : (
          <StateGapCard
            title="Sockets State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示摘要中的连接/IP 线索；索引完成后会展示 socket pool、connect、tls、stall、peer address 和 raw event 跳转。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetCacheStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
        ) : (
          <StateGapCard
            title="Cache State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示 summary 中的缓存事件数量；索引完成后会展示 cache open/read/write/doom、cache error、impact summary 和 raw event 跳转。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <DatasetAltSvcStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
        ) : (
          <StateGapCard
            title="Alt-Svc State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示摘要中的 QUIC/HTTP3 线索；索引完成后会展示 Alt-Svc found/broken、HTTP/3 候选和 raw event 跳转。"
          />
        )}
        {dataset?.status === 'ready' && dataset.analysisId ? (
          <>
            <DatasetStreamPoolStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
            <DatasetReportingStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
            <DatasetModulesStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
            <DatasetPrerenderStateCard analysisId={dataset.analysisId} onNavigateToSource={onNavigateToSource} onNavigateToSourceChain={onNavigateToSourceChain} />
          </>
        ) : (
          <StateGapCard
            title="StreamPool State"
            dataset={dataset}
            description="Dataset 未就绪时只能展示摘要中的连接层线索；索引完成后会展示 HTTP stream、socket pool waiting/stalled、连接复用、Reporting/NEL、Modules、Prerender 和 raw event 跳转。"
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
      <ExpertEvidencePriorityGuide activeKey={activeKey} onJump={onSubTabChange} />
      <div className="netlog-workbench-content">
        {contentByKey[activeKey]}
      </div>
    </div>
  );
};

export default ExpertAnalysisTab;
