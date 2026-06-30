import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Popover, Space, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined, GlobalOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  buildIpLookupConclusions,
  buildCipSipRowsText,
  buildIpListText,
  compareCipSipCarriersInRow,
  collectRowLookupIps,
  formatIpLocation,
  getCarrierDisplayName,
  type CipSipEvidenceRow,
  type DnsAnswerEvidence,
  type DnsIpEvidenceSummary,
  type DnsServerEvidence,
  type IpLookupResult,
  type IpRoutingConclusion,
  type RequestImpact,
} from '../../diagnosis/ipEvidence';
import { copyText } from '../../utils/copyText';
import { useIpLookupController } from './useIpLookupController';

interface DnsAndIpEvidencePanelProps {
  summary: DnsIpEvidenceSummary;
}

interface LookupTableRow {
  ip: string;
  result: IpLookupResult;
  roles: string[];
  hosts: string[];
  impacts: string[];
  risk: string;
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

function lookupRiskText(result: IpLookupResult, roles: string[], hasCrossCarrierContext: boolean): string {
  if (result.status !== 'success') return '查询失败';
  const isChina = result.country === '中国' || result.country === 'China' || result.country === 'CN';
  if ((roles.includes('SIP') || roles.includes('DNS answer')) && !isChina) return '跨境线索';
  if (hasCrossCarrierContext) return '跨运营商线索';
  if (roles.includes('CIP') && roles.includes('SIP')) return '需结合运营商对照';
  return '暂无明显风险';
}

function buildLookupRows(
  summary: DnsIpEvidenceSummary,
  lookupMap: Map<string, IpLookupResult>,
  manualIps: Set<string>
): LookupTableRow[] {
  const hostByIp = new Map<string, Set<string>>();
  const roleByIp = new Map<string, Set<string>>();
  const impactByIp = new Map<string, Set<string>>();
  const crossCarrierIps = new Set<string>();

  const addContext = (ip: string, role: string, host: string, impact: string) => {
    if (!hostByIp.has(ip)) hostByIp.set(ip, new Set());
    if (!roleByIp.has(ip)) roleByIp.set(ip, new Set());
    if (!impactByIp.has(ip)) impactByIp.set(ip, new Set());
    hostByIp.get(ip)!.add(host);
    roleByIp.get(ip)!.add(role);
    impactByIp.get(ip)!.add(impact);
  };

  for (const row of summary.cipSipRows) {
    row.cipIps.forEach(ip => addContext(ip, 'CIP', row.host, IMPACT_LABEL[row.impact] || row.impact));
    row.sipIps.forEach(ip => addContext(ip, 'SIP', row.host, IMPACT_LABEL[row.impact] || row.impact));
    const comparison = compareCipSipCarriersInRow(row, lookupMap);
    if (comparison.hasMismatch) {
      row.cipIps.forEach(ip => crossCarrierIps.add(ip));
      row.sipIps.forEach(ip => crossCarrierIps.add(ip));
    }
  }
  for (const answer of summary.dnsAnswers) {
    answer.ips.forEach(ip => addContext(ip, 'DNS answer', answer.host, 'DNS 解析线索'));
  }
  for (const ip of manualIps) {
    addContext(ip, '手动查询', '自助查询', '手动查询');
  }

  return Array.from(lookupMap.values()).map(result => {
    const roles = Array.from(roleByIp.get(result.ip) || (result.self ? ['当前出口'] : []));
    return {
      ip: result.ip || '当前出口',
      result,
      roles,
      hosts: Array.from(hostByIp.get(result.ip) || []),
      impacts: Array.from(impactByIp.get(result.ip) || []),
      risk: lookupRiskText(result, roles, crossCarrierIps.has(result.ip)),
    };
  });
}

function renderLimitedText(items: string[], emptyText = '-') {
  if (!items.length) return <Typography.Text type="secondary">{emptyText}</Typography.Text>;
  const visible = items.slice(0, 3);
  const hidden = items.length - visible.length;
  return (
    <Typography.Text type="secondary" ellipsis={{ tooltip: items.join('、') }}>
      {visible.join('、')}{hidden > 0 ? ` +${hidden}` : ''}
    </Typography.Text>
  );
}

function renderLookupResultCards(rows: LookupTableRow[]) {
  if (rows.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
      {rows.map(row => {
        const carrier = row.result.status === 'success' ? getCarrierDisplayName(row.result) : row.result.message || '查询失败';
        const location = row.result.status === 'success'
          ? [row.result.country, row.result.regionName, row.result.city].filter(Boolean).join(' / ') || '未知归属'
          : row.result.message || '查询失败';
        const rawCarrier = [row.result.isp, row.result.org, row.result.as].filter(Boolean).join(' / ');
        return (
          <div
            key={`${row.ip}-${row.roles.join(',')}`}
            style={{
              padding: 14,
              borderRadius: 14,
              border: '1px solid var(--border-color)',
              background: 'linear-gradient(180deg, var(--bg-elevated), var(--bg-surface))',
              boxShadow: '0 8px 18px rgba(15,23,42,0.06)',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <Typography.Text style={{ fontFamily: "'SF Mono', monospace", fontWeight: 800 }}>
                  {row.ip}
                </Typography.Text>
                <div style={{ marginTop: 6 }}>
                  <Space size={4} wrap>
                    {row.roles.length ? row.roles.map(role => <Tag key={role} style={{ marginInlineEnd: 0 }}>{role}</Tag>) : <Tag>未知角色</Tag>}
                  </Space>
                </div>
              </div>
              <Tag color={row.risk.includes('跨境') || row.risk.includes('跨运营商') ? 'orange' : row.risk.includes('失败') ? 'red' : 'blue'} style={{ margin: 0 }}>
                {row.risk}
              </Tag>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', rowGap: 7, columnGap: 10 }}>
              <Typography.Text type="secondary">归属地</Typography.Text>
              <Typography.Text>{location}</Typography.Text>
              <Typography.Text type="secondary">运营商</Typography.Text>
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong>{carrier}</Typography.Text>
                {rawCarrier && (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }} ellipsis={{ tooltip: rawCarrier }}>
                    {rawCarrier}
                  </Typography.Text>
                )}
              </div>
              <Typography.Text type="secondary">关联域名</Typography.Text>
              {renderLimitedText(row.hosts)}
              <Typography.Text type="secondary">关联问题</Typography.Text>
              {renderLimitedText(row.impacts)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderLookupConclusions(conclusions: IpRoutingConclusion[]) {
  if (conclusions.length === 0) return null;
  return (
    <div style={{ padding: 14, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
        定位参考（基于 DNS 与 IP 查询）
      </Typography.Text>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {conclusions.map(item => (
          <Alert
            key={`${item.title}-${item.detail}`}
            type={item.level === 'critical' ? 'error' : item.level === 'warning' ? 'warning' : 'info'}
            showIcon
            message={item.title}
            description={
              <Space direction="vertical" size={4}>
                <Typography.Text>{item.detail}</Typography.Text>
                <Typography.Text type="secondary">下一步：{item.nextAction}</Typography.Text>
              </Space>
            }
          />
        ))}
      </Space>
    </div>
  );
}

const DnsAndIpEvidencePanel: React.FC<DnsAndIpEvidencePanelProps> = ({ summary }) => {
  const [manualIpInput, setManualIpInput] = useState('');
  const lookupResultRef = useRef<HTMLDivElement | null>(null);
  const dnsServerEmptyText = '未解析到 DNS server 配置。部分 NetLog 导出不包含 DNS 配置字段，或当前解析器未识别该 Chrome 版本字段。';
  const dnsAnswerEmptyText = summary.dnsEventCount && summary.dnsEventCount > 0
    ? '检测到 DNS/HOST_RESOLVER 事件，但未能从事件参数中解析出域名和 IP。建议查看原始证据并反馈相关 params 字段。'
    : '未解析到 DNS answer。请在原始证据中搜索 HOST_RESOLVER、DNS_TRANSACTION、address_list、endpoint_results，确认文件是否包含解析结果。';
  const scrollToLookupResults = useCallback(() => {
    window.setTimeout(() => {
      lookupResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, []);

  const {
    lookupMap,
    manualLookupIps,
    activeLookupRowId,
    bulkLookupLoading,
    manualLookupLoading,
    selfLookup,
    selfLookupLoading,
    queryIps,
    queryManualIps,
    querySelfIp,
  } = useIpLookupController({
    manualIpInput,
    notify: message,
    scrollToLookupResults,
  });
  const lookupConclusions = useMemo(() => buildIpLookupConclusions(summary, lookupMap), [summary, lookupMap]);
  const lookupRows = useMemo(() => buildLookupRows(summary, lookupMap, manualLookupIps), [summary, lookupMap, manualLookupIps]);

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
      title: 'CIP（客户端/出口线索）',
      dataIndex: 'cipIps',
      key: 'cipIps',
      width: 210,
      render: ipTags,
    },
    {
      title: 'SIP（服务端/连接目标）',
      dataIndex: 'sipIps',
      key: 'sipIps',
      width: 210,
      render: ipTags,
    },
    {
      title: '操作',
      key: 'copy',
      width: 310,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button
            size="small"
            icon={<GlobalOutlined />}
            loading={activeLookupRowId === row.id}
            onClick={() => queryIps(collectRowLookupIps(row), { mode: 'row', rowId: row.id })}
          >
            查询本行 IP
          </Button>
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
  ], [activeLookupRowId, queryIps]);

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
          message="默认只整理 HAR / NetLog 中记录的 DNS、CIP、SIP 证据；只有点击查询按钮时才会通过 Cloudflare Worker 代理查询公网 IP。"
          description="内网、loopback、保留地址不会外发。查询结果仅作为跨境、跨运营商或 DNS 调度定位线索，不能直接作为故障根因。"
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
            先看 DNS server 判断解析入口，再查询失败/慢请求的 CIP 或 SIP 归属。
            如果 SIP 归属海外，属于跨境调度或海外链路线索；如果 CIP 与 SIP 运营商不同，属于跨运营商访问线索，仍需结合 MTR / traceroute 确认。
          </Typography.Text>
        </div>

        <Space wrap>
          <Button
            type="primary"
            icon={<GlobalOutlined />}
            loading={bulkLookupLoading}
            onClick={() => queryIps(summary.cipSipRows.flatMap(row => collectRowLookupIps(row)), { mode: 'bulk' })}
          >
            查询当前页问题 IP
          </Button>
          <Button
            icon={<GlobalOutlined />}
            loading={selfLookupLoading}
            onClick={querySelfIp}
          >
            查询当前出口 IP
          </Button>
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

        <div
          style={{
            padding: 14,
            borderRadius: 14,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
          }}
        >
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            自助查询 IP
          </Typography.Text>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={manualIpInput}
              onChange={e => setManualIpInput(e.target.value)}
              onPressEnter={queryManualIps}
              placeholder="输入 IP，支持逗号 / 空格 / 换行分隔，例如 58.215.109.83, 223.5.5.5"
            />
            <Button icon={<GlobalOutlined />} loading={manualLookupLoading} onClick={queryManualIps}>
              查询
            </Button>
          </Space.Compact>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            仅查询公网 IP，内网 / loopback / 保留地址不会外发；结果会进入下方 IP 归属查询结果。
          </Typography.Text>
        </div>

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
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="DNS server 决定解析入口，DNS answer 是文件中记录到的解析结果。"
            description="若 DNS server 是海外公共 DNS，或 DNS answer 指向海外 IP，可能影响 CDN 就近调度；该结论只是定位线索，需结合 MTR / traceroute / 出口 IP 确认。"
          />
        </div>

        {selfLookup && (
          <Alert
            type={selfLookup.status === 'success' ? 'info' : 'warning'}
            showIcon
            message={selfLookup.status === 'success' ? `当前出口 IP：${selfLookup.ip}` : '当前出口 IP 查询失败'}
            description={selfLookup.status === 'success'
              ? `${formatIpLocation(selfLookup)}。这是当前浏览器访问 Worker 时的出口，只能作为本机对照；如果 HAR / NetLog 来自其他用户或其他时间，不能作为原始故障发生时的证据。`
              : selfLookup.message}
          />
        )}

        {renderLookupConclusions(lookupConclusions)}

        <div style={{ padding: 14, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
            2. 失败/慢请求 CIP/SIP 列表（同域名同 CIP/SIP 已去重，每组保留最长耗时前三个代表请求）
          </Typography.Text>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="来源说明"
            description="har.x-tt-cip / har.x-lsc-source-ip 更接近客户端出口或响应头线索；har.serverIPAddress、netlog.URLRequest.remoteIp、socket peer 更接近实际连接目标；netlog.URLRequest.resolvedIp 是解析或请求链路线索，不能简单等同于客户端公网 IP。"
          />
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

        {lookupRows.length > 0 && (
          <div ref={lookupResultRef} style={{ padding: 14, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', scrollMarginTop: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
              IP 归属查询结果
            </Typography.Text>
            {renderLookupResultCards(lookupRows)}
          </div>
        )}

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
