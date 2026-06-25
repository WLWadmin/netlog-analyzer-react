import { useMemo } from 'react';
import { Card, Table, Tag, Alert } from 'antd';
import { SafetyCertificateOutlined, BarChartOutlined, LockOutlined, GlobalOutlined, WarningOutlined, BulbOutlined } from '@ant-design/icons';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { AnalysisResult, SslIssue } from '../../parsers/netlog/parser';
import { getNetErrorDescription } from '../../parsers/netlog/constants';
import { SLOW_SSL_MS, VERY_SLOW_SSL_MS, TOP_PREVIEW_COUNT } from '../../constants/analysisThresholds';
import { HealthAssessmentCard, HealthAssessment } from '../../components/shared/HealthAssessmentCard';
import { StatusTag } from '../../components/shared/StatusTag';

// 版本颜色
const TLS_VERSION_UNKNOWN = '未记录版本';

const VERSION_COLORS: Record<string, string> = {
  'TLS 1.3': '#34d399',
  'TLS 1.2': '#4a9eff',
  'TLS 1.1': '#fbbf24',
  'TLS 1.0': '#f87171',
  [TLS_VERSION_UNKNOWN]: '#94a3b8',
};

function normalizeTlsVersion(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;

  const value = String(raw).trim();
  if (!value || value === '-' || value.toLowerCase() === 'unknown') return null;

  const compact = value.toUpperCase().replace(/\s+/g, '');

  if (compact.includes('TLS1.3') || compact.includes('TLSV1.3')) return 'TLS 1.3';
  if (compact.includes('TLS1.2') || compact.includes('TLSV1.2')) return 'TLS 1.2';
  if (compact.includes('TLS1.1') || compact.includes('TLSV1.1')) return 'TLS 1.1';
  if (compact.includes('TLS1.0') || compact.includes('TLSV1.0')) return 'TLS 1.0';

  return null;
}

function getTlsVersionFromParams(params: any): string | null {
  return (
    normalizeTlsVersion(params?.version) ||
    normalizeTlsVersion(params?.tls_version) ||
    normalizeTlsVersion(params?.ssl_version) ||
    normalizeTlsVersion(params?.protocol) ||
    normalizeTlsVersion(params?.encrypted_protocol)
  );
}

interface SSLTabProps {
  result: AnalysisResult;
}

// ============================================================
// SSL/TLS Health Assessment
// ============================================================

function getSslIssueLabel(category: SslIssue['category']): string {
  switch (category) {
    case 'cert': return '证书错误';
    case 'timeout': return '握手/连接超时';
    case 'protocol': return '协议/密码套件错误';
    case 'connection': return '连接错误';
    default: return '其他错误';
  }
}

function getSslIssueHint(issue: SslIssue): string {
  const code = Number(issue.error);
  if (issue.category === 'timeout') return '连接超时通常不是证书问题，建议排查代理/VPN/防火墙、目标服务可达性和 TLS 握手响应耗时';
  if (issue.category === 'connection') return '连接层错误通常与网络链路、代理、端口可达性或服务端连接处理有关';
  if (issue.category === 'protocol') return 'TLS 协议错误通常与协议版本、ALPN、密码套件或中间设备 TLS Inspection 有关';
  if (code === -202) return '证书颁发机构不受信任 — 可能是防火墙 MITM 替换证书';
  if (code === -200) return '证书域名不匹配 — 可能是未登录 Wi-Fi 认证页面或防火墙替换证书';
  if (code === -201) return '证书已过期 — 检查系统时间是否正确';
  return '';
}

function assessSSLHealth(result: AnalysisResult): HealthAssessment {
  const findings: HealthAssessment['findings'] = [];
  const suggestions: string[] = [];
  let score = 100;

  const versions: Record<string, number> = {};
  const ciphers: Record<string, number> = {};
  const sslHosts: Record<string, { events: any[]; errors: any[]; version: string; cipher: string; handshakeDuration?: number }> = {};

  for (const evt of result.sslEvents) {
    const ver = getTlsVersionFromParams(evt.params);
    if (ver) {
      versions[ver] = (versions[ver] || 0) + 1;
    }

    const cipher = evt.params.cipher_suite || evt.params.cipher || 'unknown';
    if (cipher !== 'unknown') ciphers[cipher] = (ciphers[cipher] || 0) + 1;

    const host = evt.params.host || evt.params.server_info || 'unknown';
    if (!sslHosts[host]) sslHosts[host] = { events: [], errors: [], version: '', cipher: '' };
    sslHosts[host].events.push(evt);
    const normalizedHostVer = getTlsVersionFromParams(evt.params);
    if (normalizedHostVer) {
      sslHosts[host].version = normalizedHostVer;
    }
    if (evt.params.cipher_suite || evt.params.cipher) {
      sslHosts[host].cipher = evt.params.cipher_suite || evt.params.cipher;
    }
    if (evt.params.net_error || evt.params.error_code) {
      sslHosts[host].errors.push(evt.params.net_error || evt.params.error_code);
    }
  }

  // 1. Check TLS version distribution
  const totalSsl = result.sslEvents.length;
  const tls13Count = versions['TLS 1.3'] || 0;
  const tls12Count = versions['TLS 1.2'] || 0;
  const tls11Count = versions['TLS 1.1'] || 0;
  const tls10Count = versions['TLS 1.0'] || 0;
  const tls13Ratio = totalSsl > 0 ? tls13Count / totalSsl : 0;
  const tls12Ratio = totalSsl > 0 ? tls12Count / totalSsl : 0;
  const oldTlsCount = tls11Count + tls10Count;

  if (tls13Ratio > 0.5) {
    findings.push({ icon: '✅', text: `TLS 1.3 占比 ${((tls13Ratio) * 100).toFixed(0)}%，协议版本优秀`, severity: 'info' });
  } else if (tls12Ratio > 0.5) {
    findings.push({ icon: 'ℹ️', text: `TLS 1.2 占比 ${((tls12Ratio) * 100).toFixed(0)}%，协议版本正常（建议升级到 TLS 1.3）`, severity: 'info' });
    score -= 5;
  }

  if (oldTlsCount > 0) {
    const oldHosts = Object.values(sslHosts).filter(h => h.version.includes('1.0') || h.version.includes('1.1'));
    findings.push({
      icon: '⚠️',
      text: `检测到 ${oldTlsCount} 次旧版 TLS 连接（TLS 1.0/1.1），涉及 ${oldHosts.length} 个主机。旧版协议存在安全风险，可能被防火墙降级`,
      severity: 'warning',
    });
    score -= 20;
    suggestions.push('联系服务端运维升级 TLS 版本至 1.2+，旧版 TLS 1.0/1.1 已不安全');
    suggestions.push('排查防火墙是否强制降级了 TLS 版本');
  }

  // 2. Check SSL/TLS issues by category
  const certErrorCount = result.certIssues.length;
  const sslIssueCount = result.sslIssues?.length || 0;

  if (certErrorCount > 0) {
    const failedHosts = [...new Set(result.certIssues.map(ci => ci.host))];
    const errorCodes = [...new Set(result.certIssues.map(ci => ci.error))];
    findings.push({
      icon: '🚨',
      text: `${certErrorCount} 个证书错误，涉及 ${failedHosts.length} 个主机，错误码: ${errorCodes.join(', ')}`,
      severity: 'error',
    });
    score -= 30;

    // Analyze specific cert error patterns
    for (const code of errorCodes) {
      const numCode = typeof code === 'number' ? code : parseInt(String(code), 10);
      if (numCode === -202) {
        suggestions.push('ERR_CERT_AUTHORITY_INVALID (-202)：极大概率是防火墙/审计系统 MITM 替换证书，需联系 IT 排查');
      } else if (numCode === -200) {
        suggestions.push('ERR_CERT_COMMON_NAME_INVALID (-200)：可能是未登录 Wi-Fi 认证页面，或防火墙替换证书');
      } else if (numCode === -201) {
        suggestions.push('ERR_CERT_DATE_INVALID (-201)：证书过期，检查系统时间是否正确');
      } else {
        suggestions.push(`证书错误码 ${code}，需进一步排查`);
      }
    }
  }

  const nonCertIssues = (result.sslIssues || []).filter(issue => issue.category !== 'cert');
  if (nonCertIssues.length > 0) {
    const issuesByCategory = nonCertIssues.reduce<Record<SslIssue['category'], number>>((acc, issue) => {
      acc[issue.category] = (acc[issue.category] || 0) + 1;
      return acc;
    }, {} as Record<SslIssue['category'], number>);
    const issueSummary = Object.entries(issuesByCategory)
      .map(([category, count]) => `${getSslIssueLabel(category as SslIssue['category'])} ${count} 个`)
      .join('、');
    findings.push({
      icon: '⚠️',
      text: `${nonCertIssues.length} 个 SSL/TLS 非证书错误：${issueSummary}`,
      severity: 'warning',
    });
    score -= Math.min(20, nonCertIssues.length * 5);
    if (issuesByCategory.timeout) suggestions.push('检测到 SSL/TLS 握手超时：优先排查代理/VPN/防火墙、目标服务连通性和服务端握手响应');
    if (issuesByCategory.protocol) suggestions.push('检测到 SSL/TLS 协议错误：检查 TLS 版本、ALPN、密码套件及中间设备 TLS Inspection 配置');
    if (issuesByCategory.connection) suggestions.push('检测到 SSL/TLS 连接错误：检查网络链路、端口可达性、代理隧道和服务端连接限制');
  }

  if (sslIssueCount === 0) {
    findings.push({ icon: '✅', text: '所有 SSL/TLS 握手均成功完成，无证书或协议错误', severity: 'info' });
  }

  // 3. Check SSL handshake duration (from timeline)
  const sslTimings = result.urlRequests
    .filter(r => r.timeline.ssl && r.timeline.ssl.duration > 0)
    .map(r => r.timeline.ssl!.duration);

  if (sslTimings.length > 0) {
    let totalSslDuration = 0;
    let maxSsl = 0;
    let verySlowSslCount = 0;
    for (const timing of sslTimings) {
      totalSslDuration += timing;
      if (timing > maxSsl) maxSsl = timing;
      if (timing > VERY_SLOW_SSL_MS) verySlowSslCount++;
    }
    const avgSsl = totalSslDuration / sslTimings.length;

    if (avgSsl < 100) {
      findings.push({ icon: '✅', text: `SSL 握手平均耗时 ${avgSsl.toFixed(0)}ms，表现优秀`, severity: 'info' });
    } else if (avgSsl < 300) {
      findings.push({ icon: 'ℹ️', text: `SSL 握手平均耗时 ${avgSsl.toFixed(0)}ms，表现正常`, severity: 'info' });
      score -= 3;
    } else {
      findings.push({
        icon: '⚠️',
        text: `SSL 握手平均耗时 ${avgSsl.toFixed(0)}ms（最大 ${maxSsl.toFixed(0)}ms），偏慢。可能原因：防火墙 SSL 解密、证书链过长、OCSP 响应慢`,
        severity: 'warning',
      });
      score -= 15;
      suggestions.push('SSL 握手偏慢，排查防火墙是否有 SSL 解密/HTTPS Inspection 功能');
      suggestions.push('检查证书链是否过长，考虑启用 OCSP Stapling');
    }

    if (verySlowSslCount > 0) {
      findings.push({
        icon: '⚠️',
        text: `${verySlowSslCount} 个请求 SSL 握手超过 1s，严重影响加载速度`,
        severity: 'warning',
      });
      score -= 10;
    }
  }

  // 4. Check cipher suite diversity and security
  const cipherEntries = Object.entries(ciphers).sort((a, b) => b[1] - a[1]);
  if (cipherEntries.length > 0) {
    const weakCiphers = cipherEntries.filter(([name]) =>
      name.includes('RC4') || name.includes('DES') || name.includes('3DES') ||
      name.includes('NULL') || name.includes('EXPORT') || name.includes('anon')
    );
    if (weakCiphers.length > 0) {
      findings.push({
        icon: '🚨',
        text: `检测到 ${weakCiphers.length} 种弱密码套件：${weakCiphers.map(([n]) => n).join(', ')}`,
        severity: 'error',
      });
      score -= 25;
      suggestions.push('存在弱密码套件，存在安全风险，建议升级服务器密码套件配置');
    } else {
      findings.push({ icon: '✅', text: `使用 ${cipherEntries.length} 种密码套件，未检测到弱密码套件`, severity: 'info' });
    }
  }

  // 5. Check if proxy might be interfering with SSL
  if (result.proxyInfo.hasProxy || result.proxyInfo.isVPN) {
    findings.push({
      icon: '⚠️',
      text: `检测到代理/VPN 环境（${result.proxyInfo.proxyType || '未知'}），代理可能导致 SSL 握手异常或证书替换`,
      severity: 'warning',
    });
    score -= 10;
    suggestions.push('代理/VPN 可能干扰 SSL 握手，尝试关闭代理后对比测试');
  }

  // Determine overall status
  let status: HealthAssessment['status'] = 'healthy';
  if (score < 50) status = 'critical';
  else if (score < 80) status = 'warning';

  const summaryMap: Record<string, string> = {
    healthy: 'SSL/TLS 状态良好，协议版本和证书均正常',
    warning: 'SSL/TLS 存在部分问题，建议关注并排查',
    critical: 'SSL/TLS 存在严重问题，需要立即排查处理',
  };

  return {
    status,
    score: Math.max(0, score),
    summary: summaryMap[status],
    findings,
    suggestions,
  };
}

const SSLTab: React.FC<SSLTabProps> = ({ result }) => {
  const health = useMemo(() => assessSSLHealth(result), [result]);

  const { versions, ciphers, unknownTlsVersionEventCount, hostData } = useMemo(() => {
    const versionsMap: Record<string, number> = {};
    const ciphersMap: Record<string, number> = {};
    const sslHosts: Record<string, { events: any[]; errors: any[] }> = {};
    let unknownCount = 0;

    for (const evt of result.sslEvents) {
      const ver = getTlsVersionFromParams(evt.params);

      if (ver) {
        versionsMap[ver] = (versionsMap[ver] || 0) + 1;
      } else {
        unknownCount += 1;
      }

      const cipher = evt.params.cipher_suite || evt.params.cipher || 'unknown';
      if (cipher !== 'unknown') ciphersMap[cipher] = (ciphersMap[cipher] || 0) + 1;

      const host = evt.params.host || evt.params.server_info || 'unknown';
      if (!sslHosts[host]) sslHosts[host] = { events: [], errors: [] };
      sslHosts[host].events.push(evt);
      if (evt.params.net_error || evt.params.error_code) {
        sslHosts[host].errors.push(evt.params.net_error || evt.params.error_code);
      }
    }

    const nextHostData = Object.entries(sslHosts).map(([host, info]) => {
      const last = info.events[info.events.length - 1];
      return {
        host,
        version: getTlsVersionFromParams(last.params) || '-',
        cipher: last.params.cipher_suite || last.params.cipher || '-',
        count: info.events.length,
        hasError: info.errors.length > 0,
      };
    }).sort((a, b) => {
      if (a.hasError !== b.hasError) return a.hasError ? -1 : 1;
      return b.count - a.count;
    });

    return {
      versions: versionsMap,
      ciphers: ciphersMap,
      unknownTlsVersionEventCount: unknownCount,
      hostData: nextHostData,
    };
  }, [result.sslEvents]);

  const hostColumns = [
    { title: '主机', dataIndex: 'host', key: 'host', ellipsis: true },
    { title: 'TLS 版本', dataIndex: 'version', key: 'version', width: 120, render: (v: string) => {
      const tlsColor = v === 'TLS 1.3' ? 'success' : v === 'TLS 1.2' ? 'processing' : v === 'TLS 1.1' ? 'warning' : 'error';
      return <Tag color={tlsColor}>{v}</Tag>;
    }},
    { title: '密码套件', dataIndex: 'cipher', key: 'cipher', width: 280, render: (c: string) => <code style={{ fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace" }}>{c}</code> },
    { title: '握手次数', dataIndex: 'count', key: 'count', width: 80 },
    { title: '状态', dataIndex: 'hasError', key: 'status', width: 80, render: (e: boolean) => <StatusTag status={e ? 'error' : 'success'}>{e ? '失败' : '成功'}</StatusTag> },
  ];

  const timingData = useMemo(() => {
    const sslTimings = result.urlRequests
      .filter(r => r.timeline.ssl && r.timeline.ssl.duration > 0)
      .map(r => ({ duration: r.timeline.ssl!.duration, host: r.url }));

    const buckets = [
      { label: '<50ms', min: 0, max: 50, color: '#34d399' },
      { label: '50-100ms', min: 50, max: 100, color: '#a3e635' },
      { label: '100-300ms', min: 100, max: 300, color: '#fbbf24' },
      { label: '300-1000ms', min: SLOW_SSL_MS, max: VERY_SLOW_SSL_MS, color: '#fb923c' },
      { label: '>1000ms', min: VERY_SLOW_SSL_MS, max: Infinity, color: '#f87171' },
    ];

    const chartData = buckets.map(b => ({
      name: b.label,
      count: sslTimings.filter(t => t.duration >= b.min && t.duration < b.max).length,
      fill: b.color,
    }));

    const durations = sslTimings.map(t => t.duration).sort((a, b) => a - b);
    const avgDuration = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
    const p90Index = Math.ceil(durations.length * 0.9) - 1;
    const p90Duration = durations[Math.min(Math.max(p90Index, 0), durations.length - 1)] || 0;
    const maxDuration = durations[durations.length - 1] || 0;

    return {
      sslTimings,
      chartData,
      avgDuration,
      p90Duration,
      maxDuration,
    };
  }, [result.urlRequests]);

  if (result.sslEvents.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px' }}>
        <SafetyCertificateOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>未检测到SSL/TLS事件</div>
        <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>NetLog中未包含SSL/TLS握手记录</div>
      </div>
    );
  }

  return (
    <>
      {/* SSL/TLS Health Assessment */}
      <HealthAssessmentCard title="SSL/TLS 健康评估" assessment={health} />

      {/* TLS Version Distribution */}
      <Card title={<span><BarChartOutlined /> TLS 版本分布</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
        {(() => {
          const versionChartData = Object.entries(versions).sort((a, b) => b[1] - a[1]).map(([ver, count]) => ({
            name: ver,
            value: count,
          }));
          return (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={versionChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => {
                    const color = (name ? VERSION_COLORS[name] : undefined) || '#94a3b8';
                    return <span style={{ color }}>{name || 'Unknown'} {((percent ?? 0) * 100).toFixed(0)}%</span>;
                  }}
                  labelLine={{ stroke: 'var(--text-muted)' }}
                >
                  {versionChartData.map((entry) => (
                    <Cell key={entry.name} fill={VERSION_COLORS[entry.name] || '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [`${value} 次`, '连接数']}
                />
                <Legend
                  formatter={(value) => <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          );
        })()}
        {unknownTlsVersionEventCount > 0 && (
          <Alert
            type="info"
            showIcon
            message="部分 SSL/TLS 事件未记录明确 TLS 版本"
            description={`有 ${unknownTlsVersionEventCount} 条 SSL/TLS 事件没有明确的 version / tls_version 字段，已不纳入 TLS 版本占比。`}
            style={{ marginTop: 12 }}
          />
        )}
      </Card>

      {/* Cipher Suite Distribution */}
      {Object.keys(ciphers).length > 0 && (
        <Card title={<span><LockOutlined /> 密码套件分布</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          {Object.entries(ciphers).sort((a, b) => b[1] - a[1]).slice(0, TOP_PREVIEW_COUNT).map(([cipher, count]) => {
            const isWeak = cipher.includes('RC4') || cipher.includes('DES') || cipher.includes('3DES') || cipher.includes('NULL');
            return (
              <div key={cipher} style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0' }}>
                <div style={{ flex: 1, fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", color: isWeak ? '#f87171' : 'var(--text-secondary)' }}>
                  {cipher}
                  {isWeak && <Tag color="red" style={{ marginLeft: 8, fontSize: 10 }}>弱</Tag>}
                </div>
                <div style={{ width: 40, textAlign: 'right', fontSize: 13 }}>{count}</div>
              </div>
            );
          })}
        </Card>
      )}

      {/* SSL Handshake Duration Distribution */}
      {timingData.sslTimings.length > 0 && (
          <Card title={<span><BarChartOutlined /> SSL 握手耗时分布</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={timingData.chartData} layout="vertical" margin={{ left: 70, right: 20, top: 5, bottom: 5 }}>
                <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} width={65} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [`${value} 个请求`, '数量']}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {timingData.chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
              <span>平均耗时: <strong style={{ color: 'var(--text-primary)' }}>{timingData.avgDuration.toFixed(0)}ms</strong></span>
              <span>P90: <strong style={{ color: 'var(--text-primary)' }}>{timingData.p90Duration.toFixed(0)}ms</strong></span>
              <span>最大耗时: <strong style={{ color: 'var(--text-primary)' }}>{timingData.maxDuration.toFixed(0)}ms</strong></span>
            </div>
          </Card>
      )}

      {/* SSL Connection Details by Host */}
      <Card title={<span><GlobalOutlined /> SSL 连接详情（按主机）</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
        <Table dataSource={hostData} columns={hostColumns} rowKey="host" pagination={false} size="small" scroll={{ y: 400 }} />
      </Card>

      {/* SSL/TLS Issues */}
      {(result.sslIssues?.length || 0) > 0 && (
        <Card title={<span><WarningOutlined /> SSL/TLS 问题详情</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          {result.sslIssues.map((issue, i) => {
            const evt = issue.event;
            const issuer = evt.params.issuer || evt.params.cert_issuer || '-';
            const errorHint = getSslIssueHint(issue);
            const tagColor = issue.category === 'cert' ? 'red' : issue.category === 'timeout' ? 'orange' : 'volcano';

            return (
              <Alert
                key={i}
                message={
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {issue.host} — {getSslIssueLabel(issue.category)}
                  </span>
                }
                description={
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <div>
                      错误码: <Tag color={tagColor}>{issue.error}</Tag>
                      <span style={{ marginLeft: 6 }}>{getNetErrorDescription(issue.error)}</span>
                    </div>
                    <div>事件: <code>{evt.typeName}</code></div>
                    {issue.category === 'cert' && issuer !== '-' && <div>证书颁发者: <code>{issuer}</code></div>}
                    {errorHint && (
                      <div style={{ marginTop: 4, padding: '6px 10px', background: 'rgba(251, 191, 36, 0.06)', borderRadius: 6, border: '1px solid rgba(251, 191, 36, 0.15)', fontSize: 12 }}>
                        <BulbOutlined /> {errorHint}
                      </div>
                    )}
                  </div>
                }
                type={issue.category === 'cert' ? 'error' : 'warning'}
                style={{ marginBottom: 8, background: 'var(--bg-surface)', borderRadius: 12 }}
              />
            );
          })}
        </Card>
      )}
    </>
  );
};

export default SSLTab;
