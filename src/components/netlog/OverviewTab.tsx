import { useState, useMemo } from 'react';
import { Card, Table, Tag, Alert, Button, Modal, Descriptions, List, Tooltip as AntTooltip } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  RiseOutlined,
  SwapOutlined,
  ArrowRightOutlined,
  BugOutlined,
  FieldTimeOutlined,
  LockOutlined,
  GlobalOutlined,
  ClockCircleOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AnalysisResult, formatDuration, truncateUrl } from '../../parsers/netlog/parser';
import { SLOW_REQUEST_MS, MODERATE_REQUEST_MS, TOP_REQUESTS_COUNT } from '../../constants/analysisThresholds';
import { CHART_COLORS } from '../../constants/chartColors';
import { useNavigation } from '../../contexts/NavigationContext';
import { StatusTag } from '../../components/shared/StatusTag';
import { IssueSummaryList } from '../../components/shared/IssueDisplay';

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
      title={<span style={{ color: 'var(--text-primary)' }}><BugOutlined /> {domain} — 错误详情</span>}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose} type="primary">
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
  const { navigateTo } = useNavigation();

  // 关键结论：自动提取 Top 发现
  const keyFindings = useMemo(() => {
    const findings: { severity: 'error' | 'warning' | 'info'; icon: React.ReactNode; title: string; description: string; navigateTab: string; navigateFilters?: { keyword?: string } }[] = [];

    // 1. 错误率
    const errorCount = result.urlRequests.filter(r => r.status === 'error' || r.error).length;
    const totalReqs = result.urlRequests.length;
    if (errorCount > 0 && totalReqs > 0) {
      const ratePct = Math.round((errorCount / totalReqs) * 100);
      if (ratePct > 10) {
        findings.push({
          severity: 'error',
          icon: <CloseCircleOutlined />,
          title: `高错误率（${ratePct}%）`,
          description: `共 ${errorCount} 个错误 / ${totalReqs} 个总请求`,
          navigateTab: 'diagnosis',
          navigateFilters: { keyword: 'error' },
        });
      } else {
        findings.push({
          severity: 'warning',
          icon: <WarningOutlined />,
          title: `存在 ${errorCount} 个请求错误`,
          description: `错误率 ${ratePct}%，建议查看诊断详情`,
          navigateTab: 'diagnosis',
          navigateFilters: { keyword: 'error' },
        });
      }
    }

    // 2. 慢请求
    const slowCount = result.urlRequests.filter(r => (r.duration || 0) > SLOW_REQUEST_MS).length;
    if (slowCount > 0) {
      findings.push({
        severity: 'warning',
        icon: <FieldTimeOutlined />,
        title: `${slowCount} 个请求耗时超过 3s`,
        description: '建议查看性能分析和慢请求详情',
        navigateTab: 'performance',
      });
    }

    // 3. 失败域名
    if (result.failedDomains.length > 0) {
      findings.push({
        severity: 'error',
        icon: <BugOutlined />,
        title: `${result.failedDomains.length} 个域名存在错误`,
        description: result.failedDomains.map(d => d.domain).join('、'),
        navigateTab: 'ssl-protocol',
        navigateFilters: { keyword: result.failedDomains[0]?.domain },
      });
    }

    // 4. 代理 / VPN
    if (pi.isVPN) {
      findings.push({
        severity: 'warning',
        icon: <SwapOutlined />,
        title: '检测到 VPN',
        description: 'VPN 可能影响网络延迟和连接稳定性',
        navigateTab: 'overview',
      });
    }

    // 5. SSL 问题
    const sslErrors = result.urlRequests.filter(r => {
      const sslInfo = r.timeline?.ssl;
      return sslInfo && sslInfo.duration > 0 && (r.error || r.status === 'error');
    }).length;
    if (sslErrors > 0) {
      findings.push({
        severity: 'error',
        icon: <LockOutlined />,
        title: `${sslErrors} 个 SSL 相关错误`,
        description: '建议查看安全与协议 tab 的详细分析',
        navigateTab: 'ssl-protocol',
        navigateFilters: { keyword: 'ssl' },
      });
    }

    if (findings.length === 0) {
      findings.push({
        severity: 'info',
        icon: <CheckCircleOutlined />,
        title: '未发现明显问题',
        description: '所有指标正常，无需特别关注',
        navigateTab: 'overview',
      });
    }

    return findings;
  }, [result, pi]);

  const severityColor = { error: CHART_COLORS.semantic.error, warning: CHART_COLORS.semantic.warning, info: CHART_COLORS.semantic.success };
  const severityBg = { error: 'rgba(248,113,113,0.06)', warning: 'rgba(251,191,36,0.06)', info: 'rgba(52,211,153,0.06)' };

  // Protocol distribution
  const protocolData = Object.entries(result.protocols)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Top slow requests
  const topRequests = result.urlRequests
    .filter(q => q.duration)
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, TOP_REQUESTS_COUNT);

  const requestColumns: any[] = [
    { title: 'URL', dataIndex: 'url', key: 'url', render: (url: string) => (
      <AntTooltip title={url} placement="topLeft">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{truncateUrl(url, 50)}</span>
      </AntTooltip>
    )},
    { title: '方法', dataIndex: 'method', key: 'method', width: 80, render: (m: string) => <Tag color="blue" style={{ fontSize: 11, border: 'none' }}>{m}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, align: 'center', render: (s: string, r: any) => <StatusTag status={s as any} statusCode={r.statusCode}>{s === 'error' ? '失败' : r.statusCode || s || '-'}</StatusTag> },
    { title: '耗时', dataIndex: 'duration', key: 'duration', width: 100, align: 'right', render: (d: number) => (
      <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: d > SLOW_REQUEST_MS ? CHART_COLORS.semantic.error : d > MODERATE_REQUEST_MS ? CHART_COLORS.semantic.warning : CHART_COLORS.semantic.success }}>{formatDuration(d)}</span>
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
      {/* 关键结论置顶摘要 */}
      <Card
        title={<span><RiseOutlined style={{ color: 'var(--accent-blue)' }} /> 关键结论与建议</span>}
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {keyFindings.map((finding, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                background: severityBg[finding.severity],
                borderRadius: 10,
                borderLeft: `3px solid ${severityColor[finding.severity]}`,
              }}
            >
              <span style={{ color: severityColor[finding.severity], fontSize: 16 }}>{finding.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{finding.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{finding.description}</div>
              </div>
              {finding.navigateTab !== 'overview' && (
                <Button
                  size="small"
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  onClick={() => navigateTo({ tab: finding.navigateTab, filters: finding.navigateFilters || {} })}
                  style={{
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 13,
                    boxShadow: '0 2px 6px rgba(14, 165, 233, 0.2)',
                  }}
                >
                  查看详情
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Proxy/VPN Detection */}
      <Card title={<span><GlobalOutlined /> 代理 / VPN 环境检测</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
        {pi.isVPN || pi.hasProxy || result.proxyEvents.length > 0 ? (
          <>
            <div style={{ marginBottom: 12 }}>
              {pi.isVPN ? (
                <StatusTag status="error">检测到 VPN</StatusTag>
              ) : pi.hasProxy ? (
                <StatusTag status="warning">使用了代理</StatusTag>
              ) : (
                <StatusTag status="info">代理事件</StatusTag>
              )}
              <span style={{ color: 'var(--text-secondary)', marginLeft: 12 }}>代理模式: <strong style={{ color: 'var(--text-primary)' }}>{pi.proxyType || '未知'}</strong></span>
            </div>
            {pi.proxyList.length > 0 && (
              <>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>代理服务器列表</div>
                <div style={{ marginBottom: 12 }}>
                  {pi.proxyList.map(p => <Tag color="cyan" key={p} style={{ fontSize: 11, border: 'none' }}>{p}</Tag>)}
                </div>
              </>
            )}
            {pi.pacUrl && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>PAC 脚本地址:</span>
                <div style={{ fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: 13, color: CHART_COLORS.semantic.warning, marginTop: 4 }}>{pi.pacUrl}</div>
              </div>
            )}
            {pi.vpnHints.length > 0 && (
              <>
                <div style={{ fontSize: 13, color: CHART_COLORS.semantic.error, marginBottom: 8, fontWeight: 600 }}>VPN 检测线索</div>
                {pi.vpnHints.map((h, i) => (
                  <Alert
                    key={i}
                    message={<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{h}</span>}
                    type="error"
                    style={{ marginBottom: 8, background: 'var(--bg-surface)', borderRadius: 12 }}
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
            style={{ background: 'var(--bg-surface)', borderRadius: 12 }}
          />
        )}
      </Card>

      {/* Failed Domains */}
      {result.failedDomains.length > 0 && (
        <Card title={<span><CloseCircleOutlined /> 网络报错域名与 IP 列表</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
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
        <Card
          title={
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClockCircleOutlined /> 耗时最长的请求 (Top {TOP_REQUESTS_COUNT})
              <Tag color="blue" style={{ fontSize: 11, marginBottom: 0 }}>Top {TOP_REQUESTS_COUNT} 预览</Tag>
            </span>
          }
          extra={
            result.urlRequests.filter(q => q.duration).length > TOP_REQUESTS_COUNT && (
              <Button size="small" type="link" onClick={() => navigateTo({ tab: 'performance' })}>
                查看全部 {result.urlRequests.filter(q => q.duration).length} 条
              </Button>
            )
          }
          style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        >
          <Table dataSource={topRequests} columns={requestColumns} rowKey="id" pagination={false} size="small" scroll={{ x: 'max-content', y: 400 }} sticky={{ offsetHeader: 0 }} />
        </Card>
      )}

      {/* Protocol Distribution */}
      {protocolData.length > 0 && (
        <Card title={<span><ApiOutlined /> 协议分布</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <ResponsiveContainer width="100%" height={Math.max(200, protocolData.length * 40)}>
            <BarChart data={protocolData} layout="vertical" margin={{ left: 20, right: 40 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={100} tick={{ fill: 'var(--text-secondary)', fontSize: 13 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [`${value}`, '请求数']}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={24}>
                {protocolData.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS.primary[index % CHART_COLORS.primary.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* DNS 信息 */}
      {((result.dnsServers?.length || 0) > 0 || (result.dnsRecords?.length || 0) > 0 || Object.keys(result.hosts || {}).length > 0) && (
        <Card
          title={<span><GlobalOutlined /> DNS 信息</span>}
          style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        >
          {/* DNS Server IP */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              DNS Server IP
            </div>

            {(() => {
              const dnsServers = result.dnsServers || [];
              const visibleDnsServers = dnsServers.slice(0, 6);
              const hasTooManyDnsServers = dnsServers.length > 6;

              return visibleDnsServers.length > 0 ? (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {visibleDnsServers.map(ip => (
                      <Tag key={ip} color="geekblue" style={{ fontFamily: 'var(--font-mono)' }}>
                        {ip}
                      </Tag>
                    ))}
                  </div>

                  {hasTooManyDnsServers && (
                    <Alert
                      type="warning"
                      showIcon
                      message="检测到异常数量的 DNS Server IP"
                      description="正常设备通常不会配置大量 DNS 服务器。当前结果可能混入了域名解析 IP 或 CDN IP，建议优先查看下方“域名解析 IP”。"
                      style={{ marginTop: 8 }}
                    />
                  )}
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  当前 NetLog 未检测到明确的 DNS Server IP。NetLog 中的解析结果已在下方“域名解析 IP”中展示。
                </div>
              );
            })()}
          </div>

          {/* DNS Resolved IP */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              域名解析 IP
            </div>

            {(() => {
              const dnsRecords = result.dnsRecords || [];
              const visibleDnsRecords = dnsRecords.slice(0, 20);

              return visibleDnsRecords.length > 0 ? (
                <>
                  <Descriptions column={1} size="small">
                    {visibleDnsRecords.map(record => {
                      const visibleIps = record.ips.slice(0, 5);
                      const hiddenCount = record.ips.length - visibleIps.length;

                      return (
                        <Descriptions.Item key={record.host} label={record.host}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {visibleIps.map(ip => (
                              <Tag
                                key={ip}
                                color={ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1' ? 'red' : 'cyan'}
                                style={{ fontFamily: 'var(--font-mono)' }}
                              >
                                {ip}
                              </Tag>
                            ))}

                            {hiddenCount > 0 && (
                              <Tag color="default">+{hiddenCount} 个</Tag>
                            )}

                            <Tag color="default">{record.source}</Tag>
                          </div>
                        </Descriptions.Item>
                      );
                    })}
                  </Descriptions>

                  {dnsRecords.length > visibleDnsRecords.length && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                      仅展示前 {visibleDnsRecords.length} 个域名解析结果，更多请在事件列表中筛选 DNS / HOST_RESOLVER。
                    </div>
                  )}
                </>
              ) : Object.keys(result.hosts || {}).length > 0 ? (
                <Descriptions column={1} size="small">
                  {Object.entries(result.hosts || {}).slice(0, 20).map(([host, ip]) => (
                    <Descriptions.Item key={host} label={host}>
                      <Tag color="cyan" style={{ fontFamily: 'var(--font-mono)' }}>
                        {ip}
                      </Tag>
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  当前 NetLog 未检测到明确的域名解析 IP。
                </div>
              );
            })()}
          </div>
        </Card>
      )}

      {/* DNS 异常检测 */}
      {result.dnsRecords?.some(record => record.ips.some(ip => ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1')) && (
        <Alert
          type="warning"
          showIcon
          message="检测到疑似异常 DNS 解析结果"
          description="部分域名被解析到 127.0.0.1、0.0.0.0 或 ::1，可能存在 hosts 劫持、DNS 劫持或本地代理接管。"
          style={{ marginBottom: 16, borderRadius: 12 }}
        />
      )}

      {/* Issue Summary — 放在最底部 */}
      {(result.errors.length > 0 || result.warnings.length > 0) && (
        <Card title={<span><WarningOutlined /> 问题摘要</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <IssueSummaryList errors={result.errors} warnings={result.warnings} />
        </Card>
      )}
    </>
  );
};

export default OverviewTab;
