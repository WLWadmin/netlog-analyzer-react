import React, { useMemo, useState } from 'react';
import { Card, Tag, Badge, Table, Progress, Collapse, Tooltip, Row, Col } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  MedicineBoxOutlined,
  GlobalOutlined,
  ApiOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SafetyOutlined,
  CompressOutlined,
  CloudOutlined,
  LinkOutlined,
  DesktopOutlined,
  WifiOutlined,
  ThunderboltOutlined,
  QuestionCircleOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { HarAnalysisResult, formatBytes, formatHarTime, categoryStyle, statusStyle } from '../../harParser';
import { diagnoseHar, type HarDiagnosisResult, type TopRequest, type NetworkPhaseStatus, type DiagnosisStatus } from '../../harDiagnosis';
import { HealthAssessmentCard } from '../shared/HealthAssessmentCard';
import { CHART_COLORS } from '../../constants/chartColors';
import { buildHarDiagnosisSummary } from '../../diagnosis/shared';
import DiagnosisPanel from '../shared/DiagnosisPanel';

interface HarSummaryDiagnosisProps {
  result: HarAnalysisResult;
}

// ========== 工具函数 ==========

function statusToColor(status: DiagnosisStatus): string {
  switch (status) {
    case 'healthy': return CHART_COLORS.semantic.success;
    case 'warning': return CHART_COLORS.semantic.warning;
    case 'critical': return CHART_COLORS.semantic.error;
  }
}

function statusToText(status: DiagnosisStatus): string {
  switch (status) {
    case 'healthy': return '正常';
    case 'warning': return '偏高';
    case 'critical': return '严重';
  }
}

function attributionIcon(type: string): React.ReactNode {
  switch (type) {
    case 'client': return <DesktopOutlined />;
    case 'network': return <WifiOutlined />;
    case 'server': return <ApiOutlined />;
    case 'cdn': return <CloudOutlined />;
    case 'dns': return <GlobalOutlined />;
    default: return <QuestionCircleOutlined />;
  }
}

function attributionColor(type: string): string {
  switch (type) {
    case 'client': return '#0ea5e9';
    case 'network': return '#fbbf24';
    case 'server': return '#f87171';
    case 'cdn': return '#a78bfa';
    case 'dns': return '#22d3ee';
    default: return '#8892a4';
  }
}

// ========== 子组件 ==========

/** 模块标题 */
const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; extra?: React.ReactNode }> = ({ icon, title, extra }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
      <span style={{ color: 'var(--accent-blue)', fontSize: 16 }}>{icon}</span>
      {title}
    </div>
    {extra}
  </div>
);

/** 网络阶段状态卡片 */
const PhaseCard: React.FC<{ phase: NetworkPhaseStatus }> = ({ phase }) => {
  const color = statusToColor(phase.status);
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--bg-surface)',
        borderRadius: 10,
        border: `1px solid ${phase.status === 'healthy' ? 'var(--border-color)' : color + '30'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{phase.label}</span>
        <Tag color={color} style={{ fontWeight: 600, fontSize: 12 }}>{statusToText(phase.status)}</Tag>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>平均 <strong style={{ color: 'var(--text-primary)' }}>{phase.avgMs}ms</strong></span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>P95 <strong style={{ color: 'var(--text-primary)' }}>{phase.p95Ms}ms</strong></span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>最大 <strong style={{ color: 'var(--text-primary)' }}>{phase.maxMs}ms</strong></span>
      </div>
      {phase.slowCount > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          慢请求 <strong style={{ color }}>{phase.slowCount}</strong> 个
          {phase.slowDomains.length > 0 && (
            <span> · 涉及域名 {phase.slowDomains.slice(0, 3).join('、')}{phase.slowDomains.length > 3 ? ' 等' : ''}</span>
          )}
        </div>
      )}
    </div>
  );
};

/** HTTP 状态分布条 */
const StatusBar: React.FC<{ diag: HarDiagnosisResult }> = ({ diag }) => {
  const { httpStatus } = diag;
  const total = httpStatus.total || 1;
  const segments = [
    { key: '2xx', count: httpStatus.count2xx, color: CHART_COLORS.semantic.success, label: '2xx' },
    { key: '3xx', count: httpStatus.count3xx, color: CHART_COLORS.phases.dns, label: '3xx' },
    { key: '4xx', count: httpStatus.count4xx, color: CHART_COLORS.semantic.warning, label: '4xx' },
    { key: '5xx', count: httpStatus.count5xx, color: CHART_COLORS.semantic.error, label: '5xx' },
    { key: '0', count: httpStatus.count0, color: '#fb7185', label: '失败(0)' },
  ].filter(s => s.count > 0);

  return (
    <div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        {segments.map(s => (
          <Tooltip key={s.key} title={`${s.label}: ${s.count} (${((s.count / total) * 100).toFixed(1)}%)`}>
            <div style={{ width: `${(s.count / total) * 100}%`, background: s.color, transition: 'width 0.3s' }} />
          </Tooltip>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {segments.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
            <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
            <strong style={{ color: 'var(--text-primary)' }}>{s.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

/** 慢请求分类横向条形图 */
const SlowBreakdownBars: React.FC<{ diag: HarDiagnosisResult }> = ({ diag }) => {
  const { slowBreakdown } = diag;
  const items = [
    { label: 'DNS 解析', count: slowBreakdown.dnsSlow, color: CHART_COLORS.phases.dns },
    { label: 'TCP 建连', count: slowBreakdown.connectSlow, color: CHART_COLORS.phases.connect },
    { label: 'TLS 握手', count: slowBreakdown.sslSlow, color: CHART_COLORS.phases.ssl },
    { label: 'TTFB', count: slowBreakdown.ttfbSlow, color: CHART_COLORS.phases.wait },
    { label: '下载', count: slowBreakdown.receiveSlow, color: CHART_COLORS.phases.download },
    { label: '排队', count: slowBreakdown.blockedSlow, color: CHART_COLORS.phases.send },
  ].filter(i => i.count > 0);

  const max = Math.max(...items.map(i => i.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 70, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>{item.label}</span>
          <div style={{ flex: 1, height: 18, background: 'var(--bg-base)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(item.count / max) * 100}%`, height: '100%', background: item.color, borderRadius: 4, transition: 'width 0.4s ease' }} />
          </div>
          <span style={{ width: 40, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right', flexShrink: 0 }}>{item.count}</span>
        </div>
      ))}
      {items.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>无慢请求</div>
      )}
    </div>
  );
};

/** Top 请求表格列定义 */
function useTopRequestColumns(): ColumnsType<TopRequest> {
  return [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, r) => (
        <Tooltip title={r.url}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent-blue)' }}>
            {name || '-'}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '域名',
      dataIndex: 'domain',
      key: 'domain',
      width: 180,
      ellipsis: true,
      render: (d: string) => <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 70,
      align: 'center',
      render: (s: number) => {
        const st = statusStyle(s);
        return <Tag style={{ color: st.color, background: st.bg, border: 'none', fontWeight: 600, fontSize: 12 }}>{s === 0 ? '失败' : s}</Tag>;
      },
    },
    {
      title: '耗时',
      dataIndex: 'time',
      key: 'time',
      width: 90,
      align: 'right',
      render: (t: number) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{formatHarTime(t)}</span>,
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 90,
      align: 'right',
      render: (s: number) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{formatBytes(s)}</span>,
    },
  ];
}

// ========== 主组件 ==========

const HarSummaryDiagnosis: React.FC<HarSummaryDiagnosisProps> = ({ result }) => {
  const diag = useMemo(() => diagnoseHar(result), [result]);
  const topColumns = useTopRequestColumns();
  const [expandedAttributions, setExpandedAttributions] = useState<string[]>([]);

  // 为 HealthAssessmentCard 构造数据
  const healthAssessment = useMemo(() => {
    const findings = diag.findings.map(text => {
      let severity: 'info' | 'warning' | 'error' = 'info';
      let icon: string = 'ℹ️';
      if (text.includes('异常') || text.includes('严重') || text.includes('错误')) {
        severity = 'error';
        icon = '🚨';
      } else if (text.includes('偏高') || text.includes('慢') || text.includes('未启用') || text.includes('重复')) {
        severity = 'warning';
        icon = '⚠️';
      } else {
        icon = '✅';
      }
      return { icon, text, severity };
    });

    return {
      status: diag.overallStatus,
      score: diag.healthScore,
      summary: diag.summary,
      findings,
      suggestions: diag.suggestions.map(s => `${s.title}：${s.detail}`),
    };
  }, [diag]);

  // 统一诊断模型
  const diagnosisSummary = useMemo(() => buildHarDiagnosisSummary(result, diag), [result, diag]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* 统一诊断卡片 */}
      <DiagnosisPanel summary={diagnosisSummary} />

      {/* 原始诊断视图（保留原有详细统计） */}
      <HealthAssessmentCard title="辅助健康评估（仅供参考）" assessment={healthAssessment} />

      {/* 2. 网络状态 */}
      <Card
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <SectionTitle icon={<WifiOutlined />} title="网络阶段状态" />
        <Row gutter={[12, 12]}>
          {diag.networkStatus.map(phase => (
            <Col key={phase.label} xs={24} sm={12} md={8}>
              <PhaseCard phase={phase} />
            </Col>
          ))}
        </Row>
      </Card>

      {/* 4. 请求异常分析 */}
      <Card
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <SectionTitle icon={<WarningOutlined />} title="请求异常分析" />
        <Row gutter={[24, 24]}>
          {/* HTTP 状态分布 */}
          <Col xs={24} md={12}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>HTTP 状态分布</div>
            <StatusBar diag={diag} />
          </Col>
          {/* 慢请求分类 */}
          <Col xs={24} md={12}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>慢请求分类（按阶段）</div>
            <SlowBreakdownBars diag={diag} />
          </Col>
        </Row>

        {/* 失败请求 Top */}
        {diag.failedRequests.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CloseCircleOutlined style={{ color: '#f87171' }} />
              失败请求 Top {Math.min(diag.failedRequests.length, 10)}
            </div>
            <Table
              columns={topColumns}
              dataSource={diag.failedRequests}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 600 }}
              style={{ background: 'var(--bg-surface)', borderRadius: 8 }}
            />
          </div>
        )}

        {/* 慢请求 Top */}
        {diag.slowRequests.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <ClockCircleOutlined style={{ color: '#fb923c' }} />
              慢请求 Top {Math.min(diag.slowRequests.length, 10)}
            </div>
            <Table
              columns={topColumns}
              dataSource={diag.slowRequests}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 600 }}
              style={{ background: 'var(--bg-surface)', borderRadius: 8 }}
            />
          </div>
        )}
      </Card>

      {/* 5. 域名 / IP 分析 */}
      <Card
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <SectionTitle icon={<GlobalOutlined />} title="域名与 IP 分析" />
        <Row gutter={[24, 24]}>
          {/* 域名统计 */}
          <Col xs={24} md={12}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
              域名分布 Top {Math.min(diag.domainStats.length, 8)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {diag.domainStats.slice(0, 8).map(d => (
                <div key={d.domain} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 24, textAlign: 'center', flexShrink: 0 }}>{d.count}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.domain}</span>
                  {d.failedCount > 0 && <Tag color="error" style={{ fontSize: 11 }}>{d.failedCount} 失败</Tag>}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{formatBytes(d.totalSize)}</span>
                </div>
              ))}
            </div>
          </Col>
          {/* IP 统计 */}
          <Col xs={24} md={12}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
              IP 分布 Top {Math.min(diag.ipStats.length, 8)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {diag.ipStats.slice(0, 8).map(ip => (
                <div key={ip.ip} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 6 }}>
                  <Tag
                    style={{
                      fontSize: 11,
                      border: 'none',
                      background: ip.type === 'private' ? '#fef08a20' : ip.type === 'loopback' ? '#e5e7eb' : '#dbeafe20',
                      color: ip.type === 'private' ? '#854d0e' : ip.type === 'loopback' ? '#374151' : '#1e40af',
                    }}
                  >
                    {ip.type === 'public' ? '公网' : ip.type === 'private' ? '内网' : ip.type === 'loopback' ? '本地' : ip.type === 'ipv6' ? 'IPv6' : '未知'}
                  </Tag>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ip.ip}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{ip.count} 次</span>
                  {ip.failedCount > 0 && <Tag color="error" style={{ fontSize: 11 }}>{ip.failedCount} 失败</Tag>}
                </div>
              ))}
            </div>
          </Col>
        </Row>

        {/* 重复请求 */}
        {diag.duplicateRequests.length > 0 && (
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(251, 191, 36, 0.06)', borderRadius: 8, border: '1px solid rgba(251, 191, 36, 0.2)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <LinkOutlined />
              重复请求检测
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {diag.duplicateRequests.slice(0, 5).map(d => (
                <div key={d.url} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={d.url}>{d.url}</span>
                  <span style={{ color: '#fbbf24', fontWeight: 600, flexShrink: 0, marginLeft: 12 }}>×{d.count} · 浪费 {formatBytes(d.totalWasted)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 6. 资源分析 */}
      <Card
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <SectionTitle icon={<ApiOutlined />} title="资源类型分析" />
        <Row gutter={[24, 24]}>
          <Col xs={24} md={12}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {diag.resourceStats.map(r => {
                const cs = categoryStyle(r.category);
                const maxCount = Math.max(...diag.resourceStats.map(x => x.count), 1);
                return (
                  <div key={r.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Tag style={{ color: cs.color, background: cs.bg, border: 'none', fontWeight: 600, fontSize: 12, width: 70, textAlign: 'center' }}>
                      {r.category.toUpperCase()}
                    </Tag>
                    <div style={{ flex: 1, height: 16, background: 'var(--bg-base)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(r.count / maxCount) * 100}%`, height: '100%', background: cs.color, borderRadius: 4, opacity: 0.7, transition: 'width 0.4s' }} />
                    </div>
                    <span style={{ width: 50, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{r.count}</span>
                    <span style={{ width: 70, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{formatBytes(r.totalSize)}</span>
                  </div>
                );
              })}
            </div>
          </Col>
          <Col xs={24} md={12}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>最大资源 Top 5</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {diag.largestResources.slice(0, 5).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: categoryStyle(r.category).color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.url}>{r.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{formatBytes(r.size)}</span>
                </div>
              ))}
            </div>
          </Col>
        </Row>
      </Card>

      {/* 7. 缓存与压缩 */}
      <Card
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <SectionTitle icon={<CompressOutlined />} title="缓存与压缩" />
        <Row gutter={[24, 24]}>
          <Col xs={24} md={12}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>缓存命中率</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Progress
                type="circle"
                percent={diag.cacheStats.cacheRate}
                size={80}
                strokeColor={diag.cacheStats.cacheRate > 50 ? CHART_COLORS.semantic.success : CHART_COLORS.semantic.warning}
                trailColor="var(--bg-base)"
                format={p => <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{p}%</span>}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>已缓存 <strong style={{ color: 'var(--text-primary)' }}>{diag.cacheStats.cachedCount}</strong> 个</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>未缓存 <strong style={{ color: 'var(--text-primary)' }}>{diag.cacheStats.uncachedCount}</strong> 个</span>
              </div>
            </div>
          </Col>
          <Col xs={24} md={12}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>压缩覆盖率</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Progress
                type="circle"
                percent={diag.compressionStats.compressionRate}
                size={80}
                strokeColor={diag.compressionStats.compressionRate > 50 ? CHART_COLORS.semantic.success : CHART_COLORS.semantic.warning}
                trailColor="var(--bg-base)"
                format={p => <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{p}%</span>}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>已压缩 <strong style={{ color: 'var(--text-primary)' }}>{diag.compressionStats.compressedCount}</strong> 个</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>未压缩 <strong style={{ color: 'var(--text-primary)' }}>{diag.compressionStats.uncompressedCount}</strong> 个</span>
              </div>
            </div>
          </Col>
        </Row>

        {/* 未压缩大资源 */}
        {diag.uncompressedLargeResources.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f87171', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <WarningOutlined />
              未压缩大资源 Top {Math.min(diag.uncompressedLargeResources.length, 5)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {diag.uncompressedLargeResources.slice(0, 5).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: categoryStyle(r.category).color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.url}>{r.name}</span>
                  <Tag color="warning" style={{ fontSize: 11 }}>{formatBytes(r.size)}</Tag>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 8. 安全与协议 */}
      <Card
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <SectionTitle icon={<SafetyOutlined />} title="安全与协议" />
        <Row gutter={[16, 16]}>
          <Col flex="1 1 140px">
            <div style={{ textAlign: 'center', padding: '14px 10px', background: 'var(--bg-surface)', borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: diag.securityStats.httpsCount === diag.totalRequests ? CHART_COLORS.semantic.success : CHART_COLORS.semantic.warning }}>
                {diag.securityStats.httpsCount}
                <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 4 }}>/{diag.totalRequests}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>HTTPS 请求</div>
            </div>
          </Col>
          <Col flex="1 1 140px">
            <div style={{ textAlign: 'center', padding: '14px 10px', background: 'var(--bg-surface)', borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: CHART_COLORS.phases.connect }}>{diag.securityStats.h2Count + diag.securityStats.h3Count}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>HTTP/2 + HTTP/3</div>
            </div>
          </Col>
          <Col flex="1 1 140px">
            <div style={{ textAlign: 'center', padding: '14px 10px', background: 'var(--bg-surface)', borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: diag.securityStats.mixedContentCount > 0 ? CHART_COLORS.semantic.error : CHART_COLORS.semantic.success }}>
                {diag.securityStats.mixedContentCount}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>混合内容</div>
            </div>
          </Col>
          <Col flex="1 1 140px">
            <div style={{ textAlign: 'center', padding: '14px 10px', background: 'var(--bg-surface)', borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: diag.securityStats.missingSecurityHeaders.length > 0 ? CHART_COLORS.semantic.warning : CHART_COLORS.semantic.success }}>
                {diag.securityStats.missingSecurityHeaders.length}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>缺失安全头</div>
            </div>
          </Col>
        </Row>
        {diag.securityStats.missingSecurityHeaders.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            缺失：{diag.securityStats.missingSecurityHeaders.join('、')}
          </div>
        )}
      </Card>

      {/* 9. 问题归因 */}
      {diag.attributions.length > 0 && (
        <Card
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
          bodyStyle={{ padding: '16px 20px' }}
        >
          <SectionTitle icon={<ThunderboltOutlined />} title="问题归因" />
          <Collapse
            ghost
            bordered={false}
            activeKey={expandedAttributions}
            onChange={keys => setExpandedAttributions(keys as string[])}
            style={{ background: 'transparent' }}
          >
            {diag.attributions.map((attr, i) => {
              const color = attributionColor(attr.type);
              const severityColor = statusToColor(attr.severity);
              return (
                <Collapse.Panel
                  key={`attr-${i}`}
                  header={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color, fontSize: 14 }}>{attributionIcon(attr.type)}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{attr.title}</span>
                      <Tag color={severityColor} style={{ fontSize: 11, marginLeft: 'auto' }}>
                        {attr.type.toUpperCase()} · P{attr.priority}
                      </Tag>
                    </div>
                  }
                  style={{
                    marginBottom: 8,
                    background: 'var(--bg-surface)',
                    borderRadius: 8,
                    border: `1px solid ${severityColor}20`,
                    padding: '4px 12px',
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, padding: '4px 0' }}>
                    <div style={{ marginBottom: 6 }}>{attr.description}</div>
                    {attr.evidence.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {attr.evidence.map((e, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            <ArrowRightOutlined style={{ color: 'var(--text-muted)', fontSize: 10 }} />
                            <span style={{ color: 'var(--text-muted)' }}>{e}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Collapse.Panel>
              );
            })}
          </Collapse>
        </Card>
      )}

      {/* 10. 修复建议 */}
      {diag.suggestions.length > 0 && (
        <Card
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
          bodyStyle={{ padding: '16px 20px' }}
        >
          <SectionTitle icon={<MedicineBoxOutlined />} title="修复建议" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {diag.suggestions.map((s, i) => {
              const color = s.priority === 0 ? '#f87171' : s.priority === 1 ? '#fbbf24' : '#4a9eff';
              return (
                <div
                  key={i}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--bg-surface)',
                    borderRadius: 8,
                    borderLeft: `3px solid ${color}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Badge color={color} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{s.title}</span>
                    <Tag color={color} style={{ fontSize: 11, marginLeft: 'auto' }}>P{s.priority}</Tag>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, paddingLeft: 16 }}>
                    {s.detail}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 无可归因问题时的兜底提示 */}
      {diag.attributions.length === 0 && diag.suggestions.length === 0 && (
        <Card
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
          bodyStyle={{ padding: '24px 20px', textAlign: 'center' }}
        >
          <CheckCircleOutlined style={{ fontSize: 32, color: CHART_COLORS.semantic.success, marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>未发现明显问题</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>所有指标均在正常范围内，网络状况良好</div>
        </Card>
      )}
    </div>
  );
};

export default HarSummaryDiagnosis;
