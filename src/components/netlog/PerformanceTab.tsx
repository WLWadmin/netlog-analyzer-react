import { useState, useMemo } from 'react';
import { Card, Table, Tag, Modal, Descriptions, Row, Col, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ThunderboltOutlined,
  BarChartOutlined,
  AreaChartOutlined,
  ClockCircleOutlined,
  GlobalOutlined,
  ApiOutlined,
  RiseOutlined,
  FallOutlined,
} from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, LineChart, Line, ZAxis } from 'recharts';
import { AnalysisResult, URLRequest, formatDuration, percentile, truncateUrl } from '../../parsers/netlog/parser';
import { SLOW_REQUEST_MS, TOP_PREVIEW_COUNT, TOP_WATERFALL_COUNT } from '../../constants/analysisThresholds';
import { CHART_COLORS } from '../../constants/chartColors';
import { StatusTag } from '../../components/shared/StatusTag';
import { useNavigation } from '../../contexts/NavigationContext';

interface PerformanceTabProps {
  result: AnalysisResult;
}

const PHASE_NAMES: Record<string, string> = {
  dns: 'DNS 解析',
  connect: 'TCP 连接',
  ssl: 'SSL 握手',
  send: '发送请求',
  wait: '等待响应',
  download: '下载内容',
};

const PHASE_COLORS: Record<string, string> = CHART_COLORS.phases;

// 提取为独立组件，避免每次渲染重复计算 phaseChartData
const PhaseChart: React.FC<{ phaseStats: Record<string, number[]> }> = ({ phaseStats }) => {
  const phaseChartData = useMemo(() => {
    return Object.entries(phaseStats)
      .filter(([, vals]) => vals.length > 0)
      .map(([phase, vals]) => ({
        name: PHASE_NAMES[phase],
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
        fill: PHASE_COLORS[phase],
      }));
  }, [phaseStats]);

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, phaseChartData.length * 40)}>
      <BarChart data={phaseChartData} layout="vertical" margin={{ left: 20, right: 80 }}>
        <XAxis type="number" hide />
        <YAxis dataKey="name" type="category" width={100} tick={{ fill: 'var(--text-secondary)', fontSize: 13 }} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => [formatDuration(Number(value) || 0), '平均耗时']}
        />
        <Bar dataKey="avg" radius={[0, 4, 4, 0]} barSize={24}>
          {phaseChartData.map((entry, index) => (
            <Cell key={index} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

interface HostPerf {
  host: string;
  count: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p90Duration: number;
  errorCount: number;
  errorRate: number;
  slowCount: number;
}

interface ApiPerf {
  path: string;
  host: string;
  count: number;
  avgDuration: number;
  maxDuration: number;
  errorCount: number;
  errorRate: number;
  slowCount: number;
}

interface BottleneckRank {
  phase: string;
  phaseLabel: string;
  affectedRequests: number;
  avgDuration: number;
  maxDuration: number;
  totalDuration: number;
  color: string;
}

const PerformanceTab: React.FC<PerformanceTabProps> = ({ result }) => {
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const { navigateTo } = useNavigation();
  const completedReqs = result.urlRequests.filter(q => q.duration);

  // Single-pass: collect durations, phase stats, and waterfall range
  const { phaseStats, stats } = useMemo(() => {
    const durs: number[] = [];
    const pStats: Record<string, number[]> = { dns: [], connect: [], ssl: [], send: [], wait: [], download: [] };
    let minD = Infinity;
    let maxD = 0;
    let totalD = 0;

    for (const req of completedReqs) {
      const d = req.duration!;
      durs.push(d);
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
      totalD += d;

      for (const [phase, info] of Object.entries(req.timeline)) {
        if (info) pStats[phase].push(info.duration);
      }
    }

    return {
      phaseStats: pStats,
      stats: {
        min: minD,
        avg: totalD / durs.length,
        p50: percentile(durs, 0.5),
        p90: percentile(durs, 0.9),
        p99: percentile(durs, 0.99),
        max: maxD,
      },
    };
  }, [completedReqs]);

  // ===== 新增：Host 维度聚合 =====
  const hostPerf = useMemo<HostPerf[]>(() => {
    const map = new Map<string, URLRequest[]>();
    for (const req of completedReqs) {
      try {
        const host = new URL(req.url).host;
        const list = map.get(host) || [];
        list.push(req);
        map.set(host, list);
      } catch { /* ignore */ }
    }
    return Array.from(map.entries()).map(([host, list]) => {
      const ds = list.map(r => r.duration || 0).sort((a, b) => a - b);
      const errorCount = list.filter(r => r.status === 'error' || r.error).length;
      return {
        host,
        count: list.length,
        avgDuration: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length),
        minDuration: ds[0] || 0,
        maxDuration: ds[ds.length - 1] || 0,
        p90Duration: percentile(ds, 0.9),
        errorCount,
        errorRate: Math.round((errorCount / list.length) * 100),
        slowCount: list.filter(r => (r.duration || 0) > SLOW_REQUEST_MS).length,
      };
    }).sort((a, b) => b.avgDuration - a.avgDuration);
  }, [completedReqs]);

  // ===== 新增：API 维度聚合 =====
  const apiPerf = useMemo<ApiPerf[]>(() => {
    const map = new Map<string, { reqs: URLRequest[]; host: string }>();
    for (const req of completedReqs) {
      try {
        const url = new URL(req.url);
        const key = `${req.method} ${url.pathname}`;
        const existing = map.get(key);
        if (existing) {
          existing.reqs.push(req);
        } else {
          map.set(key, { reqs: [req], host: url.host });
        }
      } catch { /* ignore */ }
    }
    return Array.from(map.entries()).map(([path, { reqs, host }]) => {
      const ds = reqs.map(r => r.duration || 0).sort((a, b) => a - b);
      const errorCount = reqs.filter(r => r.status === 'error' || r.error).length;
      return {
        path,
        host,
        count: reqs.length,
        avgDuration: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length),
        maxDuration: ds[ds.length - 1] || 0,
        errorCount,
        errorRate: Math.round((errorCount / reqs.length) * 100),
        slowCount: reqs.filter(r => (r.duration || 0) > SLOW_REQUEST_MS).length,
      };
    }).sort((a, b) => b.avgDuration - a.avgDuration);
  }, [completedReqs]);

  // ===== 新增：瓶颈归因排名 =====
  const bottleneckRank = useMemo<BottleneckRank[]>(() => {
    const ranks: BottleneckRank[] = [];
    const phaseKeys = ['dns', 'connect', 'ssl', 'send', 'wait', 'download'] as const;
    for (const phase of phaseKeys) {
      const vals = phaseStats[phase];
      if (!vals || vals.length === 0) continue;
      const sorted = [...vals].sort((a, b) => a - b);
      const affected = completedReqs.filter(req => {
        const info = req.timeline[phase];
        return info && info.duration > 0;
      }).length;
      ranks.push({
        phase,
        phaseLabel: PHASE_NAMES[phase],
        affectedRequests: affected,
        avgDuration: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
        maxDuration: sorted[sorted.length - 1],
        totalDuration: sorted.reduce((a, b) => a + b, 0),
        color: PHASE_COLORS[phase],
      });
    }
    return ranks.sort((a, b) => b.totalDuration - a.totalDuration);
  }, [phaseStats, completedReqs]);

  // ===== 新增：成功 vs 失败耗时对比 =====
  const successFailCompare = useMemo(() => {
    const success = completedReqs.filter(r => !r.error && r.status !== 'error');
    const failed = completedReqs.filter(r => r.error || r.status === 'error');
    const successDurations = success.map(r => r.duration || 0).sort((a, b) => a - b);
    const failedDurations = failed.map(r => r.duration || 0).sort((a, b) => a - b);
    return {
      success: {
        count: success.length,
        avg: successDurations.length > 0 ? Math.round(successDurations.reduce((a, b) => a + b, 0) / successDurations.length) : 0,
        p90: percentile(successDurations, 0.9),
        max: successDurations[successDurations.length - 1] || 0,
      },
      failed: {
        count: failed.length,
        avg: failedDurations.length > 0 ? Math.round(failedDurations.reduce((a, b) => a + b, 0) / failedDurations.length) : 0,
        p90: percentile(failedDurations, 0.9),
        max: failedDurations[failedDurations.length - 1] || 0,
      },
    };
  }, [completedReqs]);

  // ===== 请求耗时时间线：散点数据 & 吞吐量数据 =====
  const { scatterData, throughputData } = useMemo(() => {
    // 散点数据：成功 / 失败分组
    const successPts: { startTime: number; duration: number }[] = [];
    const failedPts: { startTime: number; duration: number }[] = [];
    for (const req of completedReqs) {
      const pt = { startTime: req.startTime, duration: req.duration || 0 };
      if (req.error || req.status === 'error') {
        failedPts.push(pt);
      } else {
        successPts.push(pt);
      }
    }

    // 吞吐量：按 1 秒桶聚合
    const bucketMap = new Map<number, number>();
    for (const req of completedReqs) {
      const bucket = Math.floor(req.startTime / 1000);
      bucketMap.set(bucket, (bucketMap.get(bucket) || 0) + 1);
    }
    const throughput = Array.from(bucketMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([sec, count]) => ({
        time: sec * 1000,
        rps: count,
      }));

    return { scatterData: { successPts, failedPts }, throughputData: throughput };
  }, [completedReqs]);

  // Waterfall chart data: top 30 requests by duration
  const waterfallReqs = [...completedReqs]
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, TOP_WATERFALL_COUNT);
  let wfMinStart = Infinity;
  let wfMaxEnd = 0;
  for (const req of waterfallReqs) {
    if (req.startTime < wfMinStart) wfMinStart = req.startTime;
    const end = req.endTime || req.startTime;
    if (end > wfMaxEnd) wfMaxEnd = end;
  }
  const wfRange = wfMaxEnd - wfMinStart || 1;

  const hostColumns: ColumnsType<HostPerf> = [
    { title: '域名', dataIndex: 'host', key: 'host', ellipsis: true },
    { title: '请求数', dataIndex: 'count', key: 'count', width: 80, align: 'right' },
    { title: '平均耗时', dataIndex: 'avgDuration', key: 'avgDuration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v)}</span> },
    { title: 'P90', dataIndex: 'p90Duration', key: 'p90Duration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v)}</span> },
    { title: '最大', dataIndex: 'maxDuration', key: 'maxDuration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v)}</span> },
    { title: '慢请求', dataIndex: 'slowCount', key: 'slowCount', width: 80, align: 'right', render: (v: number) => v > 0 ? <Tag color="warning" style={{ fontSize: 11 }}>{v}</Tag> : <span style={{ color: 'var(--text-muted)' }}>-</span> },
    { title: '失败率', dataIndex: 'errorRate', key: 'errorRate', width: 90, align: 'right', render: (v: number) => <Tag color={v > 10 ? 'error' : v > 0 ? 'warning' : 'success'} style={{ fontSize: 11 }}>{v}%</Tag> },
  ];

  const apiColumns: ColumnsType<ApiPerf> = [
    { title: '接口', dataIndex: 'path', key: 'path', ellipsis: true },
    { title: '域名', dataIndex: 'host', key: 'host', width: 180, ellipsis: true },
    { title: '请求数', dataIndex: 'count', key: 'count', width: 80, align: 'right' },
    { title: '平均耗时', dataIndex: 'avgDuration', key: 'avgDuration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v)}</span> },
    { title: '最大耗时', dataIndex: 'maxDuration', key: 'maxDuration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v)}</span> },
    { title: '慢请求', dataIndex: 'slowCount', key: 'slowCount', width: 80, align: 'right', render: (v: number) => v > 0 ? <Tag color="warning" style={{ fontSize: 11 }}>{v}</Tag> : <span style={{ color: 'var(--text-muted)' }}>-</span> },
    { title: '失败率', dataIndex: 'errorRate', key: 'errorRate', width: 90, align: 'right', render: (v: number) => <Tag color={v > 10 ? 'error' : v > 0 ? 'warning' : 'success'} style={{ fontSize: 11 }}>{v}%</Tag> },
  ];

  const bottleneckColumns: ColumnsType<BottleneckRank> = [
    { title: '阶段', dataIndex: 'phaseLabel', key: 'phase', width: 100, render: (v: string, r: BottleneckRank) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
        <span>{v}</span>
      </div>
    )},
    { title: '影响请求数', dataIndex: 'affectedRequests', key: 'affected', width: 110, align: 'right', render: (v: number, r: BottleneckRank) => (
      <span>{v} / {completedReqs.length} ({((v / completedReqs.length) * 100).toFixed(0)}%)</span>
    )},
    { title: '平均耗时', dataIndex: 'avgDuration', key: 'avg', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v)}</span> },
    { title: '最大耗时', dataIndex: 'maxDuration', key: 'max', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v)}</span> },
    { title: '总耗时', dataIndex: 'totalDuration', key: 'total', width: 110, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatDuration(v)}</span> },
  ];

  const slowColumns = [
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      width: 320,
      ellipsis: true,
      render: (url: string, record: any) => (
        <span
          style={{ cursor: 'pointer', color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
          onClick={() => setSelectedReq(record)}
          title={`${url}\n点击查看各阶段耗时详情`}
        >
          {truncateUrl(url, 55)}
        </span>
      ),
    },
    {
      title: '总耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 90,
      align: 'right',
      render: (d: number) => <span style={{ color: '#f87171', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatDuration(d)}</span>,
    },
    {
      title: '各阶段耗时分解',
      dataIndex: 'timeline',
      key: 'timeline',
      width: 280,
      render: (timeline: any, record: any) => {
        const total = record.duration || 1;
        const phases = Object.entries(timeline).filter(([, info]: [string, any]) => info);
        if (phases.length === 0) return <span style={{ color: 'var(--text-muted)' }}>无阶段数据</span>;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {phases.map(([phase, info]: [string, any]) => {
              const pct = (info.duration / total) * 100;
              return (
                <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 48, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {PHASE_NAMES[phase]}
                  </span>
                  <div style={{ flex: 1, height: 6, background: 'var(--bg-base)', borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
                    <div
                      style={{
                        width: `${Math.min(100, pct)}%`,
                        height: '100%',
                        background: PHASE_COLORS[phase],
                        borderRadius: 3,
                        minWidth: pct > 0 ? 2 : 0,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', width: 60, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatDuration(info.duration)} ({pct.toFixed(0)}%)
                  </span>
                </div>
              );
            })}
          </div>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      align: 'center',
      render: (s: string, r: any) => (
        <StatusTag status={s as any} statusCode={r.statusCode}>{s === 'error' || r.error ? '失败' : r.statusCode || 'OK'}</StatusTag>
      ),
    },
  ];

  return (
    <>
      <Card title={<span><BarChartOutlined /> 请求耗时统计</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 20 }}>
          {[
            { label: '最小值', value: formatDuration(stats.min) },
            { label: '平均值', value: formatDuration(stats.avg) },
            { label: 'P50', value: formatDuration(stats.p50) },
            { label: 'P90', value: formatDuration(stats.p90) },
            { label: 'P99', value: formatDuration(stats.p99) },
            { label: '最大值', value: formatDuration(stats.max) },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center', padding: 14, background: 'var(--bg-surface)', borderRadius: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.label === '最大值' ? CHART_COLORS.semantic.error : s.label === '平均值' ? CHART_COLORS.semantic.warning : CHART_COLORS.semantic.info, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace" }}>{s.value}</div>
            </div>
          ))}
        </div>

        <h4 style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-secondary)' }}>各阶段平均耗时</h4>
        <PhaseChart phaseStats={phaseStats} />
      </Card>

      {/* ===== 新增：成功 vs 失败耗时对比 ===== */}
      <Card
        title={<span><RiseOutlined /> 成功 vs 失败 耗时对比</span>}
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <Row gutter={[16, 16]}>
          <Col flex="1 1 200px">
            <div style={{ textAlign: 'center', padding: '16px 12px', background: 'var(--bg-surface)', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: CHART_COLORS.semantic.success, marginBottom: 6 }}>
                <RiseOutlined /> 成功请求
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: CHART_COLORS.semantic.success, fontFamily: 'var(--font-mono)' }}>
                {successFailCompare.success.count}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>请求数</div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(successFailCompare.success.avg)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>平均</div></div>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(successFailCompare.success.p90)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>P90</div></div>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(successFailCompare.success.max)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>最大</div></div>
              </div>
            </div>
          </Col>
          <Col flex="1 1 200px">
            <div style={{ textAlign: 'center', padding: '16px 12px', background: 'var(--bg-surface)', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: CHART_COLORS.semantic.error, marginBottom: 6 }}>
                <FallOutlined /> 失败请求
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: CHART_COLORS.semantic.error, fontFamily: 'var(--font-mono)' }}>
                {successFailCompare.failed.count}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>请求数</div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(successFailCompare.failed.avg)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>平均</div></div>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(successFailCompare.failed.p90)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>P90</div></div>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(successFailCompare.failed.max)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>最大</div></div>
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      {/* ===== 请求耗时时间线 ===== */}
      <Card
        title={<span><AreaChartOutlined /> 请求耗时时间线</span>}
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        {/* 散点图：每个请求的耗时随时间变化 */}
        <h4 style={{ marginBottom: 8, fontSize: 14, color: 'var(--text-secondary)' }}>请求耗时分布（按时间）</h4>
        <ResponsiveContainer width="100%" height={250}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
            <XAxis
              dataKey="startTime"
              type="number"
              name="开始时间"
              tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}s`}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              label={{ value: '请求开始时间 (ms)', position: 'insideBottom', offset: -2, style: { fill: 'var(--text-muted)', fontSize: 12 } }}
            />
            <YAxis
              dataKey="duration"
              type="number"
              name="耗时"
              tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}s`}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              label={{ value: '耗时 (ms)', angle: -90, position: 'insideLeft', offset: 10, style: { fill: 'var(--text-muted)', fontSize: 12 } }}
            />
            <ZAxis range={[20, 20]} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => {
                if (name === '开始时间') return [`${Number(value).toFixed(0)} ms`, name];
                return [formatDuration(Number(value) || 0), name];
              }}
            />
            <Scatter name="成功请求" data={scatterData.successPts} fill="#34d399" />
            <Scatter name="失败请求" data={scatterData.failedPts} fill="#f87171" />
          </ScatterChart>
        </ResponsiveContainer>

        {/* 图例 */}
        <div style={{ display: 'flex', gap: 16, marginTop: 8, marginBottom: 20, justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#34d399' }} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>成功请求</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#f87171' }} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>失败请求</span>
          </div>
        </div>

        {/* 吞吐量折线图：每秒请求数 */}
        <h4 style={{ marginBottom: 8, fontSize: 14, color: 'var(--text-secondary)' }}>吞吐量（每秒请求数）</h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={throughputData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
            <XAxis
              dataKey="time"
              type="number"
              name="时间"
              tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}s`}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              label={{ value: '时间 (ms)', position: 'insideBottom', offset: -2, style: { fill: 'var(--text-muted)', fontSize: 12 } }}
            />
            <YAxis
              dataKey="rps"
              type="number"
              name="RPS"
              allowDecimals={false}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              label={{ value: '请求/秒', angle: -90, position: 'insideLeft', offset: 10, style: { fill: 'var(--text-muted)', fontSize: 12 } }}
            />
            <Tooltip
              contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => {
                if (name === 'RPS') return [`${value} req/s`, name];
                return [value, name];
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              labelFormatter={(label: any) => `时间: ${Number(label).toFixed(0)} ms`}
            />
            <Line
              type="monotone"
              dataKey="rps"
              name="RPS"
              stroke={CHART_COLORS.semantic.info}
              strokeWidth={2}
              dot={{ r: 3, fill: CHART_COLORS.semantic.info }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ===== 新增：瓶颈归因排名 ===== */}
      <Card
        title={<span><ThunderboltOutlined /> 瓶颈归因排名（按总耗时）</span>}
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <Table
          columns={bottleneckColumns}
          dataSource={bottleneckRank}
          rowKey="phase"
          size="small"
          pagination={false}
          scroll={{ x: 600 }}
        />
      </Card>

      {/* ===== 新增：域名性能 Top ===== */}
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GlobalOutlined /> 域名性能 Top {Math.min(hostPerf.length, TOP_PREVIEW_COUNT)}
            <Tag color="blue" style={{ fontSize: 11, marginBottom: 0 }}>Top {TOP_PREVIEW_COUNT} 预览</Tag>
          </span>
        }
        extra={
          hostPerf.length > TOP_PREVIEW_COUNT && (
            <Button size="small" type="link" onClick={() => navigateTo({ tab: 'events' })}>
              查看全部 {hostPerf.length} 条
            </Button>
          )
        }
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <Table
          columns={hostColumns}
          dataSource={hostPerf.slice(0, TOP_PREVIEW_COUNT)}
          rowKey="host"
          size="small"
          pagination={false}
          scroll={{ x: 600 }}
        />
      </Card>

      {/* ===== 新增：接口性能 Top ===== */}
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ApiOutlined /> 接口性能 Top {Math.min(apiPerf.length, TOP_PREVIEW_COUNT)}
            <Tag color="blue" style={{ fontSize: 11, marginBottom: 0 }}>Top {TOP_PREVIEW_COUNT} 预览</Tag>
          </span>
        }
        extra={
          apiPerf.length > TOP_PREVIEW_COUNT && (
            <Button size="small" type="link" onClick={() => navigateTo({ tab: 'events' })}>
              查看全部 {apiPerf.length} 条
            </Button>
          )
        }
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <Table
          columns={apiColumns}
          dataSource={apiPerf.slice(0, TOP_PREVIEW_COUNT)}
          rowKey="path"
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
        />
      </Card>

      {/* Waterfall Chart */}
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AreaChartOutlined /> 请求耗时瀑布图 (Top {TOP_WATERFALL_COUNT})
            <Tag color="blue" style={{ fontSize: 11, marginBottom: 0 }}>Top {TOP_WATERFALL_COUNT} 预览</Tag>
          </span>
        }
        extra={
          completedReqs.length > TOP_WATERFALL_COUNT && (
            <Button size="small" type="link" onClick={() => navigateTo({ tab: 'events' })}>
              查看全部 {completedReqs.length} 条
            </Button>
          )
        }
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <div style={{ overflowX: 'auto' }}>
          {waterfallReqs.map((req, i) => {
            const left = ((req.startTime - wfMinStart) / wfRange) * 100;
            const width = ((req.duration || 0) / wfRange) * 100;
            return (
              <div
                key={req.id}
                className="waterfall-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 28,
                  marginBottom: 4,
                  cursor: 'pointer',
                  borderRadius: 4,
                  transition: 'background 0.15s ease',
                }}
                onClick={() => setSelectedReq(req)}
              >
                <div
                  style={{
                    width: 200,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    paddingRight: 8,
                    flexShrink: 0,
                  }}
                  title={req.url}
                >
                  {truncateUrl(req.url, 28)}
                </div>
                <div style={{ flex: 1, position: 'relative', height: 20, background: 'var(--bg-base)', borderRadius: 4 }}>
                  {/* Total duration bar */}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      width: `${Math.max(0.5, width)}%`,
                      height: '100%',
                      background: 'rgba(74, 158, 255, 0.15)',
                      borderRadius: 4,
                      border: '1px solid rgba(74, 158, 255, 0.3)',
                    }}
                  />
                  {/* Phase breakdown */}
                  {Object.entries(req.timeline).map(([phase, info]) => {
                    if (!info) return null;
                    const pLeft = ((info.start - wfMinStart) / wfRange) * 100;
                    const pWidth = ((info.end - info.start) / wfRange) * 100;
                    return (
                      <div
                        key={phase}
                        style={{
                          position: 'absolute',
                          left: `${pLeft}%`,
                          width: `${Math.max(0.3, pWidth)}%`,
                          height: '100%',
                          background: PHASE_COLORS[phase],
                          borderRadius: 2,
                          minWidth: 2,
                        }}
                        title={`${PHASE_NAMES[phase]}: ${formatDuration(info.duration)}`}
                      />
                    );
                  })}
                </div>
                <div style={{ width: 70, textAlign: 'right', fontSize: 12, color: 'var(--text-primary)', paddingLeft: 8, flexShrink: 0 }}>
                  {formatDuration(req.duration || 0)}
                </div>
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          {Object.entries(PHASE_NAMES).map(([key, name]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, background: PHASE_COLORS[key], borderRadius: 2 }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{name}</span>
            </div>
          ))}
        </div>
      </Card>

      {result.slowRequests.length > 0 && (
        <Card title={<span><ClockCircleOutlined /> 慢请求详情 (&gt;3s)</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <Table dataSource={result.slowRequests} columns={slowColumns as any} rowKey="id" pagination={false} size="small" scroll={{ x: 800, y: 400 }} />
        </Card>
      )}

      {/* Detail Modal */}
      <Modal
        title="请求各阶段耗时详情"
        open={!!selectedReq}
        onCancel={() => setSelectedReq(null)}
        footer={null}
        width={700}
        styles={{ body: { background: 'var(--bg-surface)' }, header: { background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-color)' } }}
      >
        {selectedReq && (
          <div>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="URL">
                <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{selectedReq.url}</span>
              </Descriptions.Item>
              <Descriptions.Item label="方法">
                <Tag color="blue">{selectedReq.method}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="总耗时">
                <span style={{ color: '#f87171', fontWeight: 600 }}>{formatDuration(selectedReq.duration || 0)}</span>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <StatusTag status={selectedReq.status} statusCode={selectedReq.statusCode}>
                  {selectedReq.status === 'error' ? '失败' : (selectedReq.statusCode || 'OK')}
                </StatusTag>
              </Descriptions.Item>
            </Descriptions>

            <h4 style={{ color: 'var(--text-primary)', marginBottom: 12, fontSize: 14 }}>各阶段耗时分解</h4>
            {Object.entries(selectedReq.timeline).map(([phase, info]: [string, any]) => {
              if (!info) return null;
              const total = selectedReq.duration || 1;
              const pct = (info.duration / total) * 100;
              return (
                <div key={phase} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{PHASE_NAMES[phase]}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
                      {formatDuration(info.duration)} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--bg-base)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, pct)}%`,
                        background: PHASE_COLORS[phase],
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Timeline visualization */}
            <div style={{ marginTop: 20, padding: 12, background: 'var(--bg-base)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>时间线视图</div>
              <div style={{ position: 'relative', height: 32, background: 'var(--bg-surface)', borderRadius: 4 }}>
                {Object.entries(selectedReq.timeline).map(([phase, info]: [string, any]) => {
                  if (!info) return null;
                  const reqStart = selectedReq.startTime;
                  const reqEnd = selectedReq.endTime || reqStart + (selectedReq.duration || 0);
                  const range = reqEnd - reqStart || 1;
                  const left = ((info.start - reqStart) / range) * 100;
                  const width = ((info.end - info.start) / range) * 100;
                  return (
                    <div
                      key={phase}
                      style={{
                        position: 'absolute',
                        left: `${left}%`,
                        width: `${Math.max(1, width)}%`,
                        height: '100%',
                        background: PHASE_COLORS[phase],
                        borderRadius: 2,
                        minWidth: 4,
                      }}
                      title={`${PHASE_NAMES[phase]}: ${formatDuration(info.duration)}`}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--text-disabled)' }}>
                <span>0ms</span>
                <span>{formatDuration(selectedReq.duration || 0)}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default PerformanceTab;
