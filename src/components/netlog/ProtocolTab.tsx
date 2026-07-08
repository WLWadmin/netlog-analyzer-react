import { useMemo } from 'react';
import { Card, Table, Tag } from 'antd';
import { ApiOutlined, SwapOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AnalysisResult } from '../../parsers/netlog/parser';
import { isHttp2Goaway, isHttp2GoawayRecv, isHttp2GoawaySend } from '../../parsers/netlog/constants';
import { HealthAssessmentCard, HealthAssessment } from '../../components/shared/HealthAssessmentCard';
import { CHART_COLORS } from '../../constants/chartColors';
import { formatNetlogWallTime } from '../../utils/netlogTime';

interface ProtocolTabProps {
  result: AnalysisResult;
}

// ============================================================
// Protocol Health Assessment
// ============================================================

function assessProtocolHealth(result: AnalysisResult): HealthAssessment {
  const findings: HealthAssessment['findings'] = [];
  const suggestions: string[] = [];
  let score = 100;

  const hasHttp2 = result.http2Events.length > 0;
  const hasQuic = result.quicEvents.length > 0;

  // HTTP/1 is implicit (not tracked as events, but if no H2/QUIC, it's H1)
  const hasH1 = !hasHttp2 && !hasQuic;

  if (hasH1) {
    findings.push({ icon: 'ℹ️', text: '未检测到 HTTP/2 或 QUIC 事件，所有请求使用 HTTP/1.1', severity: 'info' });
    score -= 5;
  }

  // ---- HTTP/2 Analysis ----
  if (hasHttp2) {
    const h2Sessions = new Set(result.http2Events.filter(e => e.source.typeName === 'HTTP2_SESSION').map(e => e.source.id));
    const h2Streams = new Set(result.http2Events.filter(e => e.source.typeName === 'HTTP2_STREAM').map(e => e.source.id));
    const h2Push = result.http2Events.filter(e => e.typeName.includes('PUSH') || e.typeName.includes('PUSHED'));

    // GOAWAY analysis
    const goawaySent = result.http2Events.filter(isHttp2GoawaySend);
    const goawayRecv = result.http2Events.filter(isHttp2GoawayRecv);

    if (h2Sessions.size > 0) {
      findings.push({ icon: '✅', text: `HTTP/2: ${h2Sessions.size} 个会话，${h2Streams.size} 个流`, severity: 'info' });
    }

    // Check GOAWAY events
    if (goawaySent.length > 0 || goawayRecv.length > 0) {
      const totalGoaway = goawaySent.length + goawayRecv.length;
      // Extract error codes from GOAWAY
      const getGoawayErrorCode = (e: any): string | null => {
        const code = e.params?.error_code ?? e.params?.status;
        if (code === undefined || code === null || code === '') return null;
        return String(code);
      };
      const goawayErrorCodes = [...new Set([
        ...goawaySent.map(getGoawayErrorCode),
        ...goawayRecv.map(getGoawayErrorCode),
      ].filter((code): code is string => Boolean(code)))];

      const errorCodeText = goawayErrorCodes.length > 0
        ? `错误码: ${goawayErrorCodes.join(', ')}`
        : '未记录明确错误码';

      findings.push({
        icon: '⚠️',
        text: `HTTP/2: 检测到 ${totalGoaway} 个 GOAWAY 帧（发送 ${goawaySent.length}，接收 ${goawayRecv.length}），${errorCodeText}`,
        severity: totalGoaway > 3 ? 'error' : 'warning',
      });
      score -= totalGoaway > 3 ? 25 : 15;

      // Analyze GOAWAY error codes
      for (const code of goawayErrorCodes) {
        const numCode = Number(code);
        if (numCode === 0) {
          suggestions.push('GOAWAY 错误码 0 (NO_ERROR)：正常关闭，可能是服务器重启或连接空闲超时');
        } else if (numCode === 1) {
          suggestions.push('GOAWAY 错误码 1 (PROTOCOL_ERROR)：协议错误，可能是代理/TLB 不支持 HTTP/2 导致');
          score -= 5;
        } else if (numCode === 2) {
          suggestions.push('GOAWAY 错误码 2 (INTERNAL_ERROR)：服务器内部错误，可能是服务端或 TLB 问题');
        } else if (numCode === 11) {
          suggestions.push('GOAWAY 错误码 11 (INTERNAL_ERROR)：HTTP/2 连接黑洞，常见于应用切后台休眠后恢复');
        } else {
          suggestions.push(`GOAWAY 错误码 ${code}，需进一步排查`);
        }
      }
      suggestions.push('如果频繁出现 GOAWAY，尝试在 chrome://flags 中禁用 HTTP/2 强制走 HTTP/1.1 对比测试');
    } else {
      findings.push({ icon: '✅', text: 'HTTP/2: 未检测到 GOAWAY 帧，连接状态正常', severity: 'info' });
    }

    // Check HTTP/2 push
    if (h2Push.length > 0) {
      findings.push({ icon: 'ℹ️', text: `HTTP/2: 检测到 ${h2Push.length} 个 Server Push 事件`, severity: 'info' });
    }

    // Check HTTP/2 stream errors
    const streamErrors = result.http2Events.filter(e =>
      e.typeName.includes('STREAM_ERROR') || e.typeName.includes('STREAM_CANCEL') ||
      e.params.error_code || (e.params.net_error && e.params.net_error !== 0)
    ).filter(e => e.source.typeName === 'HTTP2_STREAM');

    if (streamErrors.length > 5) {
      findings.push({
        icon: '⚠️',
        text: `HTTP/2: ${streamErrors.length} 个流级别错误/取消，可能存在连接不稳定或代理干扰`,
        severity: 'warning',
      });
      score -= 10;
    }
  }

  // ---- QUIC Analysis ----
  if (hasQuic) {
    const quicSessions = new Set(result.quicEvents.map(e => e.source.id));
    const quicErrors = result.quicEvents.filter(e => e.params.error_code || e.params.net_error);
    const quicVersions: Record<string, number> = {};
    for (const evt of result.quicEvents) {
      if (evt.params.version) quicVersions[evt.params.version] = (quicVersions[evt.params.version] || 0) + 1;
    }

    findings.push({ icon: '✅', text: `QUIC: ${quicSessions.size} 个会话，${result.quicEvents.length} 个事件`, severity: 'info' });

    // QUIC version
    const versionEntries = Object.entries(quicVersions);
    if (versionEntries.length > 0) {
      const hasV1 = versionEntries.some(([v]) => v.includes('1') || v.includes('Q046') || v.includes('Q050'));
      if (hasV1) {
        findings.push({ icon: '✅', text: `QUIC 版本: ${versionEntries.map(([v, c]) => `${v}(${c})`).join(', ')}`, severity: 'info' });
      }
    }

    // QUIC errors
    if (quicErrors.length > 0) {
      const quicErrorCodes = [...new Set(quicErrors.map(e => String(e.params.error_code || e.params.net_error)))];
      findings.push({
        icon: quicErrors.length > 10 ? '🚨' : '⚠️',
        text: `QUIC: ${quicErrors.length} 个错误，错误码: ${quicErrorCodes.slice(0, 5).join(', ')}${quicErrorCodes.length > 5 ? '...' : ''}`,
        severity: quicErrors.length > 10 ? 'error' : 'warning',
      });
      score -= quicErrors.length > 10 ? 25 : 15;

      // Analyze QUIC error patterns
      if (quicErrorCodes.some(c => c.includes('356') || c.includes('QUIC_PROTOCOL_ERROR'))) {
        suggestions.push('QUIC_PROTOCOL_ERROR (-356)：大多数是网络波动造成，少数是内网 UDP Flood 防护导致');
        suggestions.push('在 chrome://flags 中禁用 QUIC 后对比测试，如果问题解决则确认与 QUIC/UDP 有关');
      }
      if (quicErrorCodes.some(c => c.includes('355') || c.includes('QUIC_HANDSHAKE_FAILED'))) {
        suggestions.push('QUIC_HANDSHAKE_FAILED (-355)：握手失败，可能是防火墙阻止 UDP 443 或网络中间设备不支持 QUIC');
      }
      suggestions.push('联系 IT 排查防火墙是否阻止了 UDP 端口 443（QUIC 使用 UDP）');
      suggestions.push('检查是否有 UDP Flood 防护策略影响了 QUIC 连接');
    } else {
      findings.push({ icon: '✅', text: 'QUIC: 未检测到协议错误，连接状态正常', severity: 'info' });
    }

    // Check QUIC vs TCP performance comparison
    const quicRequestTimings = result.urlRequests
      .filter(r => r.events.some(e => e.source.typeName.includes('QUIC')))
      .map(r => r.duration || 0)
      .filter(d => d > 0);
    const tcpRequestTimings = result.urlRequests
      .filter(r => !r.events.some(e => e.source.typeName.includes('QUIC')) && r.duration)
      .map(r => r.duration || 0)
      .filter(d => d > 0);

    if (quicRequestTimings.length > 5 && tcpRequestTimings.length > 5) {
      const avgQuic = quicRequestTimings.reduce((a, b) => a + b, 0) / quicRequestTimings.length;
      const avgTcp = tcpRequestTimings.reduce((a, b) => a + b, 0) / tcpRequestTimings.length;
      if (avgQuic > avgTcp * 1.5) {
        findings.push({
          icon: '⚠️',
          text: `QUIC 平均耗时 ${avgQuic.toFixed(0)}ms 明显高于 TCP 平均耗时 ${avgTcp.toFixed(0)}ms，QUIC 在当前网络环境下表现不佳`,
          severity: 'warning',
        });
        score -= 10;
        suggestions.push('QUIC 在当前网络环境下表现不佳，建议在 chrome://flags 中禁用 QUIC');
      } else if (avgQuic < avgTcp * 0.7) {
        findings.push({
          icon: '✅',
          text: `QUIC 平均耗时 ${avgQuic.toFixed(0)}ms 明显优于 TCP 平均耗时 ${avgTcp.toFixed(0)}ms，QUIC 加速效果显著`,
          severity: 'info',
        });
      }
    }
  }

  // ---- Proxy impact on protocols ----
  if (result.proxyInfo.hasProxy || result.proxyInfo.isVPN) {
    findings.push({
      icon: '⚠️',
      text: `检测到代理/VPN 环境（${result.proxyInfo.proxyType || '未知'}），代理可能对 HTTP/2 和 QUIC 支持不佳，导致协议降级或连接异常`,
      severity: 'warning',
    });
    score -= 10;
    suggestions.push('代理对 HTTP/2 支持不佳是常见问题，可尝试强制走 HTTP/1.1 对比测试');
    if (hasQuic) {
      suggestions.push('代理通常不支持 QUIC，会导致 QUIC 连接失败并回退到 TCP');
    }
  }

  // ---- Cross-protocol error correlation ----
  const hasConnReset = result.connectionFailures.some(f => {
    const code = typeof f.error === 'number' ? f.error : parseInt(String(f.error), 10);
    return code === -101 || code === -102 || code === -103;
  });
  if (hasConnReset && (hasHttp2 || hasQuic)) {
    findings.push({
      icon: '⚠️',
      text: '检测到连接重置/拒绝错误同时存在 HTTP/2 或 QUIC 事件，可能是防火墙对新协议不兼容',
      severity: 'warning',
    });
    score -= 5;
    suggestions.push('防火墙可能对 HTTP/2 或 QUIC 不兼容，建议联系 IT 排查防火墙协议支持');
  }

  // Determine overall status
  let status: HealthAssessment['status'] = 'healthy';
  if (score < 50) status = 'critical';
  else if (score < 80) status = 'warning';

  const summaryMap: Record<string, string> = {
    healthy: '协议状态良好，HTTP/2 和 QUIC 连接正常',
    warning: '协议层面存在部分问题，建议关注并排查',
    critical: '协议层面存在严重问题，需要立即排查处理',
  };

  return {
    status,
    score: Math.max(0, score),
    summary: summaryMap[status],
    findings,
    suggestions,
  };
}

const ProtocolTab: React.FC<ProtocolTabProps> = ({ result }) => {
  const hasHttp2 = result.http2Events.length > 0;
  const hasQuic = result.quicEvents.length > 0;
  const health = useMemo(() => assessProtocolHealth(result), [result]);

  const h2Sessions = new Set(result.http2Events.filter(e => e.source.typeName === 'HTTP2_SESSION').map(e => e.source.id));
  const h2Streams = new Set(result.http2Events.filter(e => e.source.typeName === 'HTTP2_STREAM').map(e => e.source.id));
  const h2Errors = result.http2Events.filter(isHttp2Goaway);

  const quicSessions = new Set(result.quicEvents.map(e => e.source.id));
  const quicErrors = result.quicEvents.filter(e => e.params.error_code || e.params.net_error);
  const quicVersions: Record<string, number> = {};
  for (const evt of result.quicEvents) {
    if (evt.params.version) quicVersions[evt.params.version] = (quicVersions[evt.params.version] || 0) + 1;
  }

  const eventTypeColumns = [
    { title: '事件类型', dataIndex: 'name', key: 'name', render: (n: string) => <Tag color="blue">{n}</Tag> },
    { title: '数量', dataIndex: 'count', key: 'count' },
  ];

  const h2TypeData = useMemo(() =>
    Object.entries(
      result.http2Events.reduce((acc, e) => {
        acc[e.typeName] = (acc[e.typeName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  , [result.http2Events]);

  const quicTypeData = useMemo(() =>
    Object.entries(
      result.quicEvents.reduce((acc, e) => {
        acc[e.typeName] = (acc[e.typeName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  , [result.quicEvents]);

  // GOAWAY detail data
  const goawayEvents = result.http2Events.filter(isHttp2Goaway);
  const goawayColumns = [
    { title: '方向', dataIndex: 'direction', key: 'direction', width: 80, render: (d: string) => <Tag color={d === '发送' ? 'orange' : 'red'}>{d}</Tag> },
    { title: '错误码', dataIndex: 'errorCode', key: 'errorCode', width: 100, render: (c: string) => <code>{c}</code> },
    { title: 'Last Stream ID', dataIndex: 'lastStreamId', key: 'lastStreamId', width: 120 },
    { title: '时间', dataIndex: 'time', key: 'time', width: 190 },
  ];
  const goawayData = useMemo(() =>
    goawayEvents.map((e, index) => {
      const getGoawayErrorCode = (ev: any): string | null => {
        const code = ev.params?.error_code ?? ev.params?.status;
        if (code === undefined || code === null || code === '') return null;
        return String(code);
      };
      return {
        id: `${e.source.id}-${e.typeName}-${e.phaseName}-${e.time}-${index}`,
        direction: isHttp2GoawaySend(e) ? '发送' : '接收',
        errorCode: getGoawayErrorCode(e) || '-',
        lastStreamId: String(e.params.last_stream_id || '-'),
        time: formatNetlogWallTime(e.time, result.timeTickOffset),
      };
    })
  , [goawayEvents, result.timeTickOffset]);

  // QUIC error detail data
  const quicErrorColumns = [
    { title: '错误码', dataIndex: 'errorCode', key: 'errorCode', width: 120, render: (c: string) => <Tag color="red">{c}</Tag> },
    { title: '来源', dataIndex: 'source', key: 'source', width: 200 },
    { title: '时间', dataIndex: 'time', key: 'time', width: 190 },
  ];
  const quicErrorData = useMemo(() =>
    quicErrors.slice(0, 50).map((e, index) => ({
      id: `${e.source.id}-${e.typeName}-${e.phaseName}-${e.time}-${index}`,
      errorCode: String(e.params.error_code || e.params.net_error),
      source: e.source.typeName,
      time: formatNetlogWallTime(e.time, result.timeTickOffset),
    }))
  , [quicErrors, result.timeTickOffset]);

  if (!hasHttp2 && !hasQuic) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px' }}>
        <ApiOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>未检测到HTTP/2或QUIC协议事件</div>
        <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>当前日志中所有请求使用HTTP/1.1协议</div>
      </div>
    );
  }

  return (
    <>
      {/* Protocol Health Assessment */}
      <HealthAssessmentCard title="协议健康评估" assessment={health} />

      {/* HTTP/2 Analysis */}
      {hasHttp2 && (
        <Card title={<span><ApiOutlined /> HTTP/2 分析</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: '会话数', value: h2Sessions.size, color: 'var(--text-primary)' },
              { label: '流数量', value: h2Streams.size, color: 'var(--text-primary)' },
              { label: '事件总数', value: result.http2Events.length, color: 'var(--text-primary)' },
              { label: 'GOAWAY', value: h2Errors.length, color: h2Errors.length > 0 ? CHART_COLORS.semantic.error : CHART_COLORS.semantic.success },
            ].map(s => (
              <div key={s.label} style={{ padding: 14, background: 'var(--bg-surface)', borderRadius: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* GOAWAY detail table */}
          {goawayData.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, color: '#f87171', marginBottom: 8 }}>GOAWAY 帧详情</h4>
              <Table dataSource={goawayData} columns={goawayColumns} rowKey="id" pagination={false} size="small" scroll={{ y: 200 }} />
            </div>
          )}

          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>HTTP/2 事件类型分布</h4>
          <Table dataSource={h2TypeData} columns={eventTypeColumns} rowKey="name" pagination={false} size="small" scroll={{ y: 300 }} />
        </Card>
      )}

      {/* QUIC Analysis */}
      {hasQuic && (
        <Card title={<span><ApiOutlined /> QUIC 分析</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: '会话数', value: quicSessions.size, color: 'var(--text-primary)' },
              { label: '事件总数', value: result.quicEvents.length, color: 'var(--text-primary)' },
              { label: '错误', value: quicErrors.length, color: quicErrors.length > 0 ? CHART_COLORS.semantic.error : CHART_COLORS.semantic.success },
            ].map(s => (
              <div key={s.label} style={{ padding: 14, background: 'var(--bg-surface)', borderRadius: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {Object.keys(quicVersions).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>QUIC 版本</h4>
              {Object.entries(quicVersions).map(([ver, count]) => (
                <Tag key={ver} color="cyan">{ver}: {count}</Tag>
              ))}
            </div>
          )}

          {/* QUIC error detail table */}
          {quicErrorData.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, color: '#f87171', marginBottom: 8 }}>QUIC 错误详情（前 50 条）</h4>
              <Table dataSource={quicErrorData} columns={quicErrorColumns} rowKey="id" pagination={false} size="small" scroll={{ y: 200 }} />
            </div>
          )}

          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>QUIC 事件类型分布</h4>
          <Table dataSource={quicTypeData} columns={eventTypeColumns} rowKey="name" pagination={false} size="small" scroll={{ y: 300 }} />
        </Card>
      )}
      {/* QUIC vs TCP Performance Comparison */}
      {(() => {
        const quicReqs = result.urlRequests.filter(r => r.events.some(e => e.source.typeName.includes('QUIC')) && r.duration);
        const tcpReqs = result.urlRequests.filter(r => !r.events.some(e => e.source.typeName.includes('QUIC')) && r.duration);

        if (quicReqs.length < 5 || tcpReqs.length < 5) {
          return (
            <Card title={<span><SwapOutlined /> QUIC vs TCP 性能对比</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                QUIC 请求 {quicReqs.length} 个 / TCP 请求 {tcpReqs.length} 个，数据不足（至少各需要 5 个请求）无法进行对比
              </div>
            </Card>
          );
        }

        const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const p90 = (arr: number[]) => {
          const sorted = [...arr].sort((a, b) => a - b);
          return sorted[Math.floor(sorted.length * 0.9)];
        };

        const quicDurations = quicReqs.map(r => r.duration!);
        const tcpDurations = tcpReqs.map(r => r.duration!);

        const quicConnectPhases = quicReqs
          .map(r => r.timeline.connect?.duration || 0)
          .filter(d => d > 0);
        const tcpConnectPhases = tcpReqs
          .map(r => r.timeline.connect?.duration || 0)
          .filter(d => d > 0);

        const quicErrorRate = quicReqs.length > 0
          ? (quicReqs.filter(r => r.events.some(e => e.params.net_error || e.params.error_code)).length / quicReqs.length) * 100
          : 0;
        const tcpErrorRate = tcpReqs.length > 0
          ? (tcpReqs.filter(r => r.events.some(e => e.params.net_error || e.params.error_code)).length / tcpReqs.length) * 100
          : 0;

        const chartData = [
          {
            name: '平均耗时',
            QUIC: parseFloat(avg(quicDurations).toFixed(1)),
            TCP: parseFloat(avg(tcpDurations).toFixed(1)),
          },
          {
            name: 'P90 耗时',
            QUIC: parseFloat(p90(quicDurations).toFixed(1)),
            TCP: parseFloat(p90(tcpDurations).toFixed(1)),
          },
          {
            name: '错误率',
            QUIC: parseFloat(quicErrorRate.toFixed(2)),
            TCP: parseFloat(tcpErrorRate.toFixed(2)),
          },
          {
            name: '连接建立时间',
            QUIC: quicConnectPhases.length > 0 ? parseFloat(avg(quicConnectPhases).toFixed(1)) : 0,
            TCP: tcpConnectPhases.length > 0 ? parseFloat(avg(tcpConnectPhases).toFixed(1)) : 0,
          },
        ];

        return (
          <Card title={<span><SwapOutlined /> QUIC vs TCP 性能对比</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Bar dataKey="QUIC" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                <Bar dataKey="TCP" fill="#4a9eff" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        );
      })()}
    </>
  );
};

export default ProtocolTab;
