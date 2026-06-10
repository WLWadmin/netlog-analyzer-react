import { useMemo } from 'react';
import { Card, Table, Tag, Empty } from 'antd';
import { AnalysisResult } from '../parser';

interface ProtocolTabProps {
  result: AnalysisResult;
}

// ============================================================
// Protocol Health Assessment
// ============================================================

interface ProtocolHealthResult {
  status: 'healthy' | 'warning' | 'critical';
  score: number;
  summary: string;
  findings: { icon: string; text: string; severity: 'info' | 'warning' | 'error' }[];
  suggestions: string[];
}

function assessProtocolHealth(result: AnalysisResult): ProtocolHealthResult {
  const findings: ProtocolHealthResult['findings'] = [];
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
    const goawaySent = result.http2Events.filter(e => e.type === 1202);
    const goawayRecv = result.http2Events.filter(e => e.type === 1203);

    if (h2Sessions.size > 0) {
      findings.push({ icon: '✅', text: `HTTP/2: ${h2Sessions.size} 个会话，${h2Streams.size} 个流`, severity: 'info' });
    }

    // Check GOAWAY events
    if (goawaySent.length > 0 || goawayRecv.length > 0) {
      const totalGoaway = goawaySent.length + goawayRecv.length;
      // Extract error codes from GOAWAY
      const goawayErrorCodes = [...new Set([
        ...goawaySent.map(e => e.params.error_code || e.params.status || 'unknown'),
        ...goawayRecv.map(e => e.params.error_code || e.params.status || 'unknown'),
      ])];

      findings.push({
        icon: '⚠️',
        text: `HTTP/2: 检测到 ${totalGoaway} 个 GOAWAY 帧（发送 ${goawaySent.length}，接收 ${goawayRecv.length}），错误码: ${goawayErrorCodes.join(', ')}`,
        severity: totalGoaway > 3 ? 'error' : 'warning',
      });
      score -= totalGoaway > 3 ? 25 : 15;

      // Analyze GOAWAY error codes
      for (const code of goawayErrorCodes) {
        if (code === 0) {
          suggestions.push('GOAWAY 错误码 0 (NO_ERROR)：正常关闭，可能是服务器重启或连接空闲超时');
        } else if (code === 1 || code === '1' || code === 0x1) {
          suggestions.push('GOAWAY 错误码 1 (PROTOCOL_ERROR)：协议错误，可能是代理/TLB 不支持 HTTP/2 导致');
          score -= 5;
        } else if (code === 2 || code === '2') {
          suggestions.push('GOAWAY 错误码 2 (INTERNAL_ERROR)：服务器内部错误，可能是服务端或 TLB 问题');
        } else if (code === 11 || code === '11') {
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
  let status: ProtocolHealthResult['status'] = 'healthy';
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

  if (!hasHttp2 && !hasQuic) {
    return <Empty description="未检测到 HTTP/2 或 QUIC 协议事件" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const h2Sessions = new Set(result.http2Events.filter(e => e.source.typeName === 'HTTP2_SESSION').map(e => e.source.id));
  const h2Streams = new Set(result.http2Events.filter(e => e.source.typeName === 'HTTP2_STREAM').map(e => e.source.id));
  const h2Errors = result.http2Events.filter(e => e.type === 1202 || e.type === 1203);

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

  const h2TypeData = Object.entries(
    result.http2Events.reduce((acc, e) => {
      acc[e.typeName] = (acc[e.typeName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const quicTypeData = Object.entries(
    result.quicEvents.reduce((acc, e) => {
      acc[e.typeName] = (acc[e.typeName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  // GOAWAY detail data
  const goawayEvents = result.http2Events.filter(e => e.type === 1202 || e.type === 1203);
  const goawayColumns = [
    { title: '方向', dataIndex: 'direction', key: 'direction', width: 80, render: (d: string) => <Tag color={d === '发送' ? 'orange' : 'red'}>{d}</Tag> },
    { title: '错误码', dataIndex: 'errorCode', key: 'errorCode', width: 100, render: (c: string) => <code>{c}</code> },
    { title: 'Last Stream ID', dataIndex: 'lastStreamId', key: 'lastStreamId', width: 120 },
    { title: '时间', dataIndex: 'time', key: 'time', width: 100 },
  ];
  const goawayData = goawayEvents.map(e => ({
    direction: e.type === 1202 ? '发送' : '接收',
    errorCode: String(e.params.error_code || e.params.status || '-'),
    lastStreamId: String(e.params.last_stream_id || '-'),
    time: e.time.toFixed(2) + 'ms',
  }));

  // QUIC error detail data
  const quicErrorColumns = [
    { title: '错误码', dataIndex: 'errorCode', key: 'errorCode', width: 120, render: (c: string) => <Tag color="red">{c}</Tag> },
    { title: '来源', dataIndex: 'source', key: 'source', width: 200 },
    { title: '时间', dataIndex: 'time', key: 'time', width: 100 },
  ];
  const quicErrorData = quicErrors.slice(0, 50).map(e => ({
    errorCode: String(e.params.error_code || e.params.net_error),
    source: e.source.typeName,
    time: e.time.toFixed(2) + 'ms',
  }));

  const statusColor = health.status === 'healthy' ? '#34d399' : health.status === 'warning' ? '#fbbf24' : '#f87171';
  const statusText = health.status === 'healthy' ? '正常' : health.status === 'warning' ? '需关注' : '异常';
  const statusBg = health.status === 'healthy' ? 'rgba(52, 211, 153, 0.08)' : health.status === 'warning' ? 'rgba(251, 191, 36, 0.08)' : 'rgba(248, 113, 113, 0.08)';

  return (
    <>
      {/* Protocol Health Assessment */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🩺 协议健康评估</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>综合评分</span>
              <span style={{
                fontSize: 20, fontWeight: 700, color: statusColor,
                background: statusBg, padding: '2px 12px', borderRadius: 12,
              }}>
                {health.score}
              </span>
              <Tag color={statusColor} style={{ fontWeight: 600 }}>{statusText}</Tag>
            </div>
          </div>
        }
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
          {health.summary}
        </div>

        {/* Findings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: health.suggestions.length > 0 ? 16 : 0 }}>
          {health.findings.map((f, i) => (
            <div
              key={i}
              style={{
                padding: '10px 14px',
                background: 'var(--bg-surface)',
                borderRadius: 8,
                border: `1px solid ${f.severity === 'error' ? 'rgba(248, 113, 113, 0.2)' : f.severity === 'warning' ? 'rgba(251, 191, 36, 0.2)' : 'rgba(52, 211, 153, 0.15)'}`,
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
              }}
            >
              {f.text}
            </div>
          ))}
        </div>

        {/* Suggestions */}
        {health.suggestions.length > 0 && (
          <div style={{
            padding: '12px 14px',
            background: 'rgba(74, 158, 255, 0.06)',
            borderRadius: 8,
            border: '1px solid rgba(74, 158, 255, 0.15)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4a9eff', marginBottom: 8 }}>
              🔧 定因排查建议
            </div>
            {health.suggestions.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: i < health.suggestions.length - 1 ? 6 : 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <span style={{ color: '#4a9eff', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* HTTP/2 Analysis */}
      {hasHttp2 && (
        <Card title="📡 HTTP/2 分析" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: '会话数', value: h2Sessions.size, color: '#4a9eff' },
              { label: '流数量', value: h2Streams.size, color: '#22d3ee' },
              { label: '事件总数', value: result.http2Events.length, color: '#a78bfa' },
              { label: 'GOAWAY', value: h2Errors.length, color: h2Errors.length > 0 ? '#f87171' : '#34d399' },
            ].map(s => (
              <div key={s.label} style={{ padding: 12, background: 'var(--bg-surface)', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* GOAWAY detail table */}
          {goawayData.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, color: '#f87171', marginBottom: 8 }}>GOAWAY 帧详情</h4>
              <Table dataSource={goawayData} columns={goawayColumns} rowKey={(r) => `${r.direction}-${r.time}`} pagination={false} size="small" scroll={{ y: 200 }} />
            </div>
          )}

          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>HTTP/2 事件类型分布</h4>
          <Table dataSource={h2TypeData} columns={eventTypeColumns} rowKey="name" pagination={false} size="small" scroll={{ y: 300 }} />
        </Card>
      )}

      {/* QUIC Analysis */}
      {hasQuic && (
        <Card title="📡 QUIC 分析" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: '会话数', value: quicSessions.size, color: '#4a9eff' },
              { label: '事件总数', value: result.quicEvents.length, color: '#22d3ee' },
              { label: '错误', value: quicErrors.length, color: quicErrors.length > 0 ? '#f87171' : '#34d399' },
            ].map(s => (
              <div key={s.label} style={{ padding: 12, background: 'var(--bg-surface)', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
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
              <Table dataSource={quicErrorData} columns={quicErrorColumns} rowKey={(r) => `${r.errorCode}-${r.time}`} pagination={false} size="small" scroll={{ y: 200 }} />
            </div>
          )}

          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>QUIC 事件类型分布</h4>
          <Table dataSource={quicTypeData} columns={eventTypeColumns} rowKey="name" pagination={false} size="small" scroll={{ y: 300 }} />
        </Card>
      )}
    </>
  );
};

export default ProtocolTab;
