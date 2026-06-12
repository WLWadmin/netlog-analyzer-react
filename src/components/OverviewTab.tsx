import { useState, useMemo } from 'react';
import { Card, Table, Tag, Alert, Descriptions, Modal, Button, List } from 'antd';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AnalysisResult, formatDuration, truncateUrl } from '../parser';
import { IssueSummaryList } from './shared/IssueDisplay';

// 协议颜色映射
const PROTOCOL_COLORS = ['#4a9eff', '#22d3ee', '#34d399', '#a78bfa', '#fb923c', '#f87171', '#fbbf24'];

interface OverviewTabProps {
  result: AnalysisResult;
}

// Group errors by description and count occurrences
function groupErrors(errors: { code: number | string; desc: string; time: number }[]) {
  const map = new Map<string, { desc: string; code: number | string; count: number; times: number[] }>();
  for (const e of errors) {
    const key = `${e.code}|${e.desc}`;
    if (map.has(key)) {
      const item = map.get(key)!;
      item.count++;
      item.times.push(e.time);
    } else {
      map.set(key, { desc: e.desc, code: e.code, count: 1, times: [e.time] });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// Modal for showing all errors of a domain
const ErrorDetailModal: React.FC<{
  open: boolean;
  onClose: () => void;
  domain: string;
  errors: { code: number | string; desc: string; time: number }[];
}> = ({ open, onClose, domain, errors }) => {
  const grouped = useMemo(() => groupErrors(errors), [errors]);
  return (
    <Modal
      title={<span style={{ color: 'var(--text-primary)' }}>🐛 {domain} — 错误详情</span>}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose} type="primary" style={{ background: '#4a9eff', borderColor: '#4a9eff' }}>
          关闭
        </Button>,
      ]}
      width={600}
      style={{ top: 80 }}
      className="netlog-modal-dark"
    >
      <List
        dataSource={grouped}
        renderItem={(item) => (
          <List.Item style={{ borderBottom: '1px solid var(--border-color)', padding: '12px 0' }}>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <Tag color="orange">{item.code}</Tag>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14 }}>{item.desc}</span>
                <Tag color="red" style={{ marginLeft: 'auto' }}>× {item.count}</Tag>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                首次出现: {item.times[0]?.toFixed(0) || '-'}ms · 末次出现: {item.times[item.times.length - 1]?.toFixed(0) || '-'}ms
              </div>
            </div>
          </List.Item>
        )}
      />
      <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 12, textAlign: 'right' }}>
        共 {errors.length} 条错误记录，{grouped.length} 种错误类型
      </div>
    </Modal>
  );
};

// Error description cell component with "more" button
const ErrorDescCell: React.FC<{
  errors: { code: number | string; desc: string; time: number }[];
  domain: string;
}> = ({ errors, domain }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const grouped = useMemo(() => groupErrors(errors), [errors]);

  if (grouped.length === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>无错误</span>;
  }

  return (
    <>
      <div style={{ fontSize: 13 }}>
        {grouped.slice(0, 2).map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-primary)' }}>{item.desc}</span>
            <Tag color="red">× {item.count}</Tag>
          </div>
        ))}
        {grouped.length > 2 && (
          <Button
            type="link"
            size="small"
            onClick={() => setModalOpen(true)}
            style={{ padding: 0, color: '#4a9eff', fontSize: 13 }}
          >
            +{grouped.length - 2} 更多
          </Button>
        )}
      </div>
      <ErrorDetailModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        domain={domain}
        errors={errors}
      />
    </>
  );
};

const OverviewTab: React.FC<OverviewTabProps> = ({ result }) => {
  const pi = result.proxyInfo;

  // Protocol distribution
  const protocolData = Object.entries(result.protocols)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Top slow requests
  const topRequests = result.urlRequests
    .filter(q => q.duration)
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 20);

  const requestColumns = [
    { title: 'URL', dataIndex: 'url', key: 'url', render: (url: string) => <span title={url}>{truncateUrl(url, 50)}</span> },
    { title: '方法', dataIndex: 'method', key: 'method', render: (m: string) => <Tag color="blue">{m}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string, r: any) => getStatusTag(s, r.statusCode) },
    { title: '耗时', dataIndex: 'duration', key: 'duration', render: (d: number) => (
      <span style={{ fontWeight: 600, color: d > 3000 ? '#f87171' : d > 1000 ? '#fbbf24' : '#34d399' }}>{formatDuration(d)}</span>
    )},
  ];

  // Failed domains
  const failedDomainColumns = [
    { title: '域名', dataIndex: 'domain', key: 'domain', render: (d: string) => <strong>{d}</strong> },
    { title: '解析 IP', dataIndex: 'resolvedIp', key: 'resolvedIp', render: (ip: string | null) =>
      ip ? <Tag color="cyan">{ip}</Tag> : <span style={{ color: 'var(--text-muted)' }}>未解析</span>
    },
    { title: 'Remote IP', dataIndex: 'remoteIp', key: 'remoteIp', render: (ip: string | null) =>
      ip ? <Tag color="geekblue">{ip}</Tag> : <span style={{ color: 'var(--text-muted)' }}>未解析</span>
    },
    { title: '错误次数', dataIndex: 'count', key: 'count', render: (c: number) => <Tag color="red">{c}</Tag> },
    { title: '错误码', dataIndex: 'errorCodes', key: 'errorCodes', render: (codes: any[]) =>
      codes.map(c => <Tag color="orange" key={c}>{c}</Tag>)
    },
    { title: '错误描述', dataIndex: 'errors', key: 'errors', render: (errors: any[], record: any) => (
      <ErrorDescCell errors={errors} domain={record.domain} />
    )},
  ];

  return (
    <>
      {/* Proxy/VPN Detection */}
      <Card title="🌐 代理 / VPN 环境检测" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
        {pi.isVPN || pi.hasProxy || result.proxyEvents.length > 0 ? (
          <>
            <div style={{ marginBottom: 12 }}>
              {pi.isVPN ? (
                <Tag color="red">🚨 检测到 VPN</Tag>
              ) : pi.hasProxy ? (
                <Tag color="orange">⚠️ 使用了代理</Tag>
              ) : (
                <Tag color="blue">ℹ️ 代理事件</Tag>
              )}
              <span style={{ color: 'var(--text-secondary)', marginLeft: 12 }}>代理模式: <strong style={{ color: 'var(--text-primary)' }}>{pi.proxyType || '未知'}</strong></span>
            </div>
            {pi.proxyList.length > 0 && (
              <>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>代理服务器列表</div>
                <div style={{ marginBottom: 12 }}>
                  {pi.proxyList.map(p => <Tag color="cyan" key={p}>{p}</Tag>)}
                </div>
              </>
            )}
            {pi.pacUrl && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>PAC 脚本地址:</span>
                <div style={{ fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: 13, color: '#fbbf24', marginTop: 4 }}>{pi.pacUrl}</div>
              </div>
            )}
            {pi.vpnHints.length > 0 && (
              <>
                <div style={{ fontSize: 13, color: '#f87171', marginBottom: 8, fontWeight: 600 }}>VPN 检测线索</div>
                {pi.vpnHints.map((h, i) => (
                  <Alert
                    key={i}
                    message={<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{h}</span>}
                    type="error"
                    style={{ marginBottom: 8, background: 'var(--bg-surface)', borderColor: '#f87171' }}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          <Alert
            message={<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>未检测到代理或 VPN</span>}
            description={<span style={{ color: 'var(--text-secondary)' }}>当前网络环境为直连模式，未配置代理服务器。</span>}
            type="success"
            style={{ background: 'var(--bg-surface)', borderColor: '#34d399' }}
          />
        )}
      </Card>

      {/* Failed Domains */}
      {result.failedDomains.length > 0 && (
        <Card title="❌ 网络报错域名与 IP 列表" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <Table
            dataSource={result.failedDomains}
            columns={failedDomainColumns}
            rowKey="domain"
            pagination={false}
            size="small"
            scroll={{ x: 'max-content', y: 400 }}
            sticky={{ offsetHeader: 0 }}
          />
        </Card>
      )}

      {/* Top Slow Requests */}
      {topRequests.length > 0 && (
        <Card title="🐌 耗时最长的请求 (Top 20)" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <Table dataSource={topRequests} columns={requestColumns} rowKey="id" pagination={false} size="small" scroll={{ x: 'max-content', y: 400 }} sticky={{ offsetHeader: 0 }} />
        </Card>
      )}

      {/* Protocol Distribution */}
      {protocolData.length > 0 && (
        <Card title="📡 协议分布" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <ResponsiveContainer width="100%" height={Math.max(200, protocolData.length * 40)}>
            <BarChart data={protocolData} layout="vertical" margin={{ left: 20, right: 40 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={100} tick={{ fill: 'var(--text-secondary)', fontSize: 13 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}
                labelStyle={{ color: 'var(--text-primary)' }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [`${value}`, '请求数']}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={24}>
                {protocolData.map((_, index) => (
                  <Cell key={index} fill={PROTOCOL_COLORS[index % PROTOCOL_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* DNS Records */}
      {Object.keys(result.hosts).length > 0 && (
        <Card title="🌐 DNS 解析记录" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <Descriptions column={2} size="small">
            {Object.entries(result.hosts).map(([host, ip]) => (
              <Descriptions.Item key={host} label={host}>
                <Tag color="cyan">{ip}</Tag>
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      )}

      {/* Issue Summary — 放在最底部 */}
      {(result.errors.length > 0 || result.warnings.length > 0) && (
        <Card title="⚠️ 问题摘要" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <IssueSummaryList errors={result.errors} warnings={result.warnings} />
        </Card>
      )}
    </>
  );
};

function getStatusTag(status: string, code?: number) {
  if (status === 'error') return <Tag color="red">失败</Tag>;
  if (!code) return <Tag color="blue">{status || '-'}</Tag>;
  if (code >= 200 && code < 300) return <Tag color="green">{code}</Tag>;
  if (code >= 300 && code < 400) return <Tag color="blue">{code}</Tag>;
  if (code >= 400 && code < 500) return <Tag color="orange">{code}</Tag>;
  if (code >= 500) return <Tag color="red">{code}</Tag>;
  return <Tag color="blue">{code}</Tag>;
}

export default OverviewTab;
