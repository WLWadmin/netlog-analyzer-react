import React, { useMemo } from 'react';
import { Alert, Button, Card, Popover, Space, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  buildCipSipRowsText,
  buildIpListText,
  type CipSipEvidenceRow,
  type DnsAnswerEvidence,
  type DnsIpEvidenceSummary,
  type DnsServerEvidence,
  type RequestImpact,
} from '../../diagnosis/ipEvidence';
import { copyText } from '../../utils/copyText';

interface DnsAndIpEvidencePanelProps {
  summary: DnsIpEvidenceSummary;
}

const IMPACT_LABEL: Record<RequestImpact, string> = {
  failed: '原始请求失败',
  slow: '原始请求耗时较长',
  dns: 'DNS 解析线索',
  normal: '普通请求',
};

async function copyWithToast(text: string, label: string) {
  try {
    await copyText(text);
    message.success(`${label}已复制`);
  } catch {
    message.error(`${label}复制失败`);
  }
}

function ipTags(ips: string[]) {
  if (!ips.length) return <Typography.Text type="secondary">-</Typography.Text>;
  return (
    <Space size={4} wrap>
      {ips.map(ip => (
        <Tag key={ip} style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", marginInlineEnd: 0 }}>
          {ip}
        </Tag>
      ))}
    </Space>
  );
}

function getIpSegment(ip: string): string {
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.*` : 'IPv4';
  }

  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return parts.length > 0 ? `${parts.slice(0, 4).join(':')}::/64` : 'IPv6';
  }

  return '其他';
}

function groupIpsBySegment(ips: string[]) {
  const groups = new Map<string, string[]>();
  for (const ip of ips) {
    const segment = getIpSegment(ip);
    const next = groups.get(segment) || [];
    next.push(ip);
    groups.set(segment, next);
  }

  return Array.from(groups.entries())
    .map(([segment, groupIps]) => ({ segment, ips: groupIps }))
    .sort((a, b) => b.ips.length - a.ips.length || a.segment.localeCompare(b.segment));
}

function compactDnsAnswerIps(ips: string[]) {
  if (!ips.length) return <Typography.Text type="secondary">-</Typography.Text>;

  const previewIps = ips.slice(0, 3);
  const hiddenCount = Math.max(ips.length - previewIps.length, 0);
  const groups = groupIpsBySegment(ips);

  const content = (
    <div style={{ width: 420, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
      <div style={{ marginBottom: 10, color: 'var(--text-secondary)', fontSize: 12 }}>
        共 {ips.length} 个解析 IP，按网段归类展示
      </div>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {groups.map(group => (
          <div key={group.segment}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Typography.Text strong style={{ fontSize: 12 }}>{group.segment}</Typography.Text>
              <Tag style={{ margin: 0 }}>{group.ips.length} 个</Tag>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
              {group.ips.map(ip => (
                <span
                  key={ip}
                  style={{
                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    padding: '3px 7px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={ip}
                >
                  {ip}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Space>
    </div>
  );

  return (
    <Space size={6} wrap>
      {previewIps.map(ip => (
        <Tag
          key={ip}
          style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            marginInlineEnd: 0,
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.04)',
          }}
        >
          {ip}
        </Tag>
      ))}
      <Popover trigger="click" placement="bottomLeft" title="解析 IP 网段分布" content={content}>
        <Button size="small" type="link" style={{ padding: 0, height: 22 }}>
          共 {ips.length} 个{hiddenCount > 0 ? `，+${hiddenCount}` : ''}
        </Button>
      </Popover>
    </Space>
  );
}

function copyRowText(row: CipSipEvidenceRow): string {
  return [
    `域名: ${row.host}`,
    `CIP: ${row.cipIps.join(', ') || '-'}`,
    `SIP: ${row.sipIps.join(', ') || '-'}`,
    `代表请求: ${row.representativeRequests.map(req => `${req.url} (${req.durationMs ?? '-'}ms)`).join('；') || '-'}`,
  ].join('\n');
}

const DnsAndIpEvidencePanel: React.FC<DnsAndIpEvidencePanelProps> = ({ summary }) => {
  const dnsServerEmptyText = '未解析到 DNS server 配置。部分 NetLog 导出不包含 DNS 配置字段，或当前解析器未识别该 Chrome 版本字段。';
  const dnsAnswerEmptyText = summary.dnsEventCount && summary.dnsEventCount > 0
    ? '检测到 DNS/HOST_RESOLVER 事件，但未能从事件参数中解析出域名和 IP。建议查看原始证据并反馈相关 params 字段。'
    : '未解析到 DNS answer。请在原始证据中搜索 HOST_RESOLVER、DNS_TRANSACTION、address_list、endpoint_results，确认文件是否包含解析结果。';

  const dnsServerColumns = useMemo<ColumnsType<DnsServerEvidence>>(() => [
    {
      title: 'DNS 服务器',
      dataIndex: 'ip',
      key: 'ip',
      width: 160,
      render: (ip: string) => <Tag color="geekblue" style={{ fontFamily: "'SF Mono', monospace" }}>{ip}</Tag>,
    },
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
    { title: '说明', dataIndex: 'explanation', key: 'explanation', ellipsis: true },
    { title: '建议', dataIndex: 'action', key: 'action', ellipsis: true },
  ], []);

  const dnsAnswerColumns = useMemo<ColumnsType<DnsAnswerEvidence>>(() => [
    { title: '域名', dataIndex: 'host', key: 'host', ellipsis: true, width: 260 },
    {
      title: '解析 IP',
      dataIndex: 'ips',
      key: 'ips',
      render: compactDnsAnswerIps,
    },
    { title: '来源', dataIndex: 'source', key: 'source', width: 130 },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, row) => (
        <Button size="small" icon={<CopyOutlined />} onClick={() => copyWithToast(row.ips.join('\n'), '解析 IP')}>
          复制全部
        </Button>
      ),
    },
  ], []);

  const cipSipColumns = useMemo<ColumnsType<CipSipEvidenceRow>>(() => [
    { title: '域名', dataIndex: 'host', key: 'host', width: 220, ellipsis: true },
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
      title: '代表请求',
      dataIndex: 'representativeRequests',
      key: 'representativeRequests',
      width: 360,
      render: (requests: CipSipEvidenceRow['representativeRequests']) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          {requests.map((req, index) => (
            <Typography.Text
              key={`${req.url}-${index}`}
              type="secondary"
              ellipsis={{ tooltip: `${req.url} · ${req.durationMs ?? '-'}ms` }}
              style={{ maxWidth: 340, fontSize: 12 }}
            >
              {index + 1}. {req.url} · {req.durationMs === undefined ? '-' : `${Math.round(req.durationMs)}ms`}
            </Typography.Text>
          ))}
        </Space>
      ),
    },
    {
      title: '最长耗时',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 100,
      render: (durationMs?: number) => durationMs === undefined ? '-' : `${Math.round(durationMs)}ms`,
    },
    {
      title: 'CIP',
      dataIndex: 'cipIps',
      key: 'cipIps',
      width: 180,
      render: ipTags,
    },
    {
      title: 'SIP',
      dataIndex: 'sipIps',
      key: 'sipIps',
      width: 180,
      render: ipTags,
    },
    {
      title: '复制',
      key: 'copy',
      width: 230,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button size="small" onClick={() => copyWithToast(row.cipIps.join('\n'), 'CIP')}>
            CIP
          </Button>
          <Button size="small" onClick={() => copyWithToast(row.sipIps.join('\n'), 'SIP')}>
            SIP
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => copyWithToast(copyRowText(row), '本行证据')}>
            本行
          </Button>
        </Space>
      ),
    },
  ], []);

  return (
    <Card
      title="DNS 与 CIP/SIP 定位证据"
      styles={{ body: { padding: 20 } }}
      style={{
        background: 'linear-gradient(180deg, rgba(14,165,233,0.08), var(--bg-elevated) 92px)',
        borderColor: 'rgba(14,165,233,0.28)',
        boxShadow: '0 14px 34px rgba(15,23,42,0.10)',
        marginBottom: 16,
      }}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="本模块不会联网查询 IP 归属，只整理 HAR / NetLog 中记录的 DNS、CIP、SIP 证据。"
          description="“原始请求失败/耗时较长”来自上传的 HAR / NetLog 文件，不是点击本模块按钮造成。如需判断跨境/跨运营商，请复制 IP 到可访问的 IP 查询工具、企业 IP 库或发给网络团队确认运营商和地域。"
        />
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            border: '1px solid rgba(251, 191, 36, 0.35)',
            background: 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(14,165,233,0.10))',
          }}
        >
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            排查建议
          </Typography.Text>
          <Typography.Text>
            先复制 DNS server 判断解析入口，再复制失败/慢请求的 CIP 或 SIP 到 IP 查询工具、企业 IP 库或发给网络团队。
            如果 SIP 归属海外，属于跨境调度线索；如果 SIP 归属运营商与用户当前网络不同，属于跨运营商访问线索。
          </Typography.Text>
        </div>

        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={() => copyWithToast(buildIpListText(summary.copyableIps), '全部问题 IP')}>
            复制全部问题 IP
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => copyWithToast(buildIpListText(summary.copyableDnsServers), 'DNS 服务器')}>
            复制 DNS 服务器
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => copyWithToast(buildCipSipRowsText(summary.cipSipRows), '失败/慢请求 CIP/SIP')}>
            复制聚合列表
          </Button>
        </Space>

        <div style={{ padding: 14, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>1. DNS 配置与解析结果</Typography.Text>
          <Table
            size="small"
            rowKey="ip"
            columns={dnsServerColumns}
            dataSource={summary.dnsServers}
            pagination={false}
            scroll={{ x: 960 }}
            locale={{ emptyText: dnsServerEmptyText }}
            style={{ marginBottom: 14 }}
          />
          <Table
            size="small"
            rowKey={(row) => `${row.host}-${row.ips.join(',')}`}
            columns={dnsAnswerColumns}
            dataSource={summary.dnsAnswers}
            pagination={{ pageSize: 5, showSizeChanger: false }}
            scroll={{ x: 900 }}
            locale={{ emptyText: dnsAnswerEmptyText }}
          />
        </div>

        <div style={{ padding: 14, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
            2. 失败/慢请求 CIP/SIP 列表（同域名同 CIP/SIP 已去重，每组保留最长耗时前三个代表请求）
          </Typography.Text>
          <Table
            size="small"
            rowKey="id"
            columns={cipSipColumns}
            dataSource={summary.cipSipRows}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 1240 }}
            locale={{ emptyText: '未发现失败或慢请求关联的 CIP/SIP 证据' }}
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
          description="serverIPAddress/remoteIp/socket peer 通常更接近实际连接目标；x-tt-cip、x-lsc-source-ip、resolvedIp 属于客户端、响应头或解析线索。当前列表按域名和 CIP/SIP 聚合，用于降低重复请求噪音。"
        />
      </Space>
    </Card>
  );
};

export default DnsAndIpEvidencePanel;
