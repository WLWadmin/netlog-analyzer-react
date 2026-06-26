import React, { useMemo } from 'react';
import { Alert, Button, Card, Space, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  buildCipSipRowsText,
  buildIpListText,
  type CipSipEvidenceRow,
  type DnsAnswerEvidence,
  type DnsIpEvidenceSummary,
  type DnsServerEvidence,
  type IpEvidenceSource,
  type RequestImpact,
} from '../../diagnosis/ipEvidence';
import { copyText } from '../../utils/copyText';

interface DnsAndIpEvidencePanelProps {
  summary: DnsIpEvidenceSummary;
}

const SOURCE_LABEL: Record<IpEvidenceSource, string> = {
  'har.serverIPAddress': 'HAR serverIPAddress',
  'har.x-tt-cip': 'HAR x-tt-cip',
  'har.x-lsc-source-ip': 'HAR x-lsc-source-ip',
  'netlog.URLRequest.resolvedIp': 'NetLog resolvedIp',
  'netlog.URLRequest.remoteIp': 'NetLog remoteIp',
  'netlog.failedDomains.ips': 'NetLog failedDomains',
  'netlog.dnsRecords.ips': 'NetLog dnsRecords',
  'netlog.dnsServers': 'NetLog dnsServers',
  'netlog.params.ip_endpoint': 'NetLog ip_endpoint',
  'netlog.params.address': 'NetLog address',
  'netlog.params.peer_address': 'NetLog peer_address',
};

const IMPACT_LABEL: Record<RequestImpact, string> = {
  failed: '原始请求失败',
  slow: '原始请求耗时较长',
  dns: 'DNS 解析线索',
  normal: '普通请求',
};

function sourceTags(sources: IpEvidenceSource[]) {
  return (
    <Space size={4} wrap>
      {Array.from(new Set(sources)).map(source => (
        <Tag key={source}>{SOURCE_LABEL[source] || source}</Tag>
      ))}
    </Space>
  );
}

async function copyWithToast(text: string, label: string) {
  try {
    await copyText(text);
    message.success(`${label}已复制`);
  } catch {
    message.error(`${label}复制失败`);
  }
}

const DnsAndIpEvidencePanel: React.FC<DnsAndIpEvidencePanelProps> = ({ summary }) => {
  const dnsServerColumns = useMemo<ColumnsType<DnsServerEvidence>>(() => [
    { title: 'DNS 服务器', dataIndex: 'ip', key: 'ip', width: 150 },
    { title: '类型', dataIndex: 'label', key: 'label', width: 160 },
    {
      title: '风险',
      dataIndex: 'risk',
      key: 'risk',
      width: 90,
      render: (risk: DnsServerEvidence['risk']) => (
        <Tag color={risk === 'medium' ? 'orange' : risk === 'low' ? 'blue' : 'default'}>{risk}</Tag>
      ),
    },
    { title: '说明', dataIndex: 'explanation', key: 'explanation' },
    { title: '建议', dataIndex: 'action', key: 'action' },
  ], []);

  const dnsAnswerColumns = useMemo<ColumnsType<DnsAnswerEvidence>>(() => [
    { title: '域名', dataIndex: 'host', key: 'host', ellipsis: true },
    {
      title: '解析 IP',
      dataIndex: 'ips',
      key: 'ips',
      render: (ips: string[]) => ips.join(', ') || '-',
    },
    { title: '来源', dataIndex: 'source', key: 'source', width: 130 },
    {
      title: '提示',
      key: 'hint',
      render: () => '复制解析 IP 查询地域/运营商；如与实际连接 IP 不一致，可能与 DNS 缓存、连接复用、代理或 CDN 调度有关。',
    },
  ], []);

  const cipSipColumns = useMemo<ColumnsType<CipSipEvidenceRow>>(() => [
    { title: '域名/URL', dataIndex: 'hostOrUrl', key: 'hostOrUrl', ellipsis: true },
    {
      title: '状态',
      key: 'impact',
      width: 150,
      render: (_, row) => (
        <Tag color={row.impact === 'failed' ? 'red' : row.impact === 'slow' ? 'orange' : 'blue'}>
          {IMPACT_LABEL[row.impact]}
        </Tag>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 100,
      render: (durationMs?: number) => durationMs === undefined ? '-' : `${Math.round(durationMs)}ms`,
    },
    {
      title: 'CIP / 客户端线索 IP',
      dataIndex: 'cipIps',
      key: 'cipIps',
      render: (ips: string[]) => ips.join(', ') || '-',
    },
    {
      title: 'CIP 来源字段',
      dataIndex: 'cipSources',
      key: 'cipSources',
      render: sourceTags,
    },
    {
      title: 'SIP / 目标服务 IP',
      dataIndex: 'sipIps',
      key: 'sipIps',
      render: (ips: string[]) => ips.join(', ') || '-',
    },
    {
      title: 'SIP 来源字段',
      dataIndex: 'sipSources',
      key: 'sipSources',
      render: sourceTags,
    },
    {
      title: '复制',
      key: 'copy',
      width: 90,
      render: (_, row) => (
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={() => copyWithToast([...row.cipIps, ...row.sipIps].join('\n'), '本行 IP')}
        >
          IP
        </Button>
      ),
    },
    {
      title: '查询提示',
      key: 'hint',
      render: () => '复制后粘贴到可访问的 IP 归属查询网站、企业 IP 库或发给网络团队确认运营商和地域。',
    },
  ], []);

  return (
    <Card
      title="DNS 与 CIP/SIP 定位证据"
      styles={{ body: { padding: 16 } }}
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)', marginBottom: 16 }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="本模块不会联网查询 IP 归属，只整理 HAR / NetLog 中记录的 DNS、CIP、SIP 证据。"
          description="“原始请求失败/耗时较长”来自上传的 HAR / NetLog 文件，不是点击本模块按钮造成。如需判断跨境/跨运营商，请复制 IP 到可访问的 IP 查询工具、企业 IP 库或发给网络团队确认运营商和地域。"
        />

        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={() => copyWithToast(buildIpListText(summary.copyableIps), '全部问题 IP')}>
            复制全部问题 IP
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => copyWithToast(buildIpListText(summary.copyableDnsServers), 'DNS 服务器')}>
            复制 DNS 服务器
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => copyWithToast(buildCipSipRowsText(summary.cipSipRows), '失败/慢请求 CIP/SIP')}>
            复制失败/慢请求 CIP/SIP
          </Button>
        </Space>

        <div>
          <Typography.Text strong>1. DNS 配置与解析结果</Typography.Text>
          <Table
            size="small"
            rowKey="ip"
            columns={dnsServerColumns}
            dataSource={summary.dnsServers}
            pagination={false}
            scroll={{ x: 960 }}
            locale={{ emptyText: '未在文件中发现 DNS server 记录' }}
            style={{ marginTop: 8, marginBottom: 12 }}
          />
          <Table
            size="small"
            rowKey={(row) => `${row.host}-${row.ips.join(',')}`}
            columns={dnsAnswerColumns}
            dataSource={summary.dnsAnswers}
            pagination={{ pageSize: 5, showSizeChanger: false }}
            scroll={{ x: 900 }}
            locale={{ emptyText: '未在文件中发现 DNS answer 记录' }}
          />
        </div>

        <div>
          <Typography.Text strong>2. 失败/慢请求 CIP/SIP 列表</Typography.Text>
          <Table
            size="small"
            rowKey="id"
            columns={cipSipColumns}
            dataSource={summary.cipSipRows}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 1280 }}
            locale={{ emptyText: '未发现失败或慢请求关联的 CIP/SIP 证据' }}
            style={{ marginTop: 8 }}
          />
        </div>

        <Alert
          type="warning"
          showIcon
          message="如何判断跨境 / 跨运营商"
          description="跨境判断：如果失败/慢请求的 SIP 或 DNS 解析 IP 查询结果为海外地区，说明存在跨境调度或海外链路线索。跨运营商判断：如果用户当前网络是中国移动，但失败/慢请求 SIP 查询结果属于中国电信/联通，说明存在跨运营商访问线索。仅凭 HAR / NetLog 不能确认链路故障，需补充 MTR / traceroute、客户端出口 IP 和复现时间。"
        />
        <Alert
          type="info"
          showIcon
          message="CIP/SIP 说明"
          description="CIP/SIP 的具体语义取决于原始字段。请以“来源字段”列为准：serverIPAddress/remoteIp 通常更接近实际连接目标，x-tt-cip/x-lsc-source-ip/resolvedIp 属于响应头或解析线索。"
        />
      </Space>
    </Card>
  );
};

export default DnsAndIpEvidencePanel;
