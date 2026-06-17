import { useState } from 'react';
import { Card, Table, Tag, Modal, Descriptions } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AnalysisResult, formatDuration, percentile, truncateUrl } from '../parser';

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

const PHASE_COLORS: Record<string, string> = {
  dns: '#a78bfa',
  connect: '#22d3ee',
  ssl: '#34d399',
  send: '#fbbf24',
  wait: '#4a9eff',
  download: '#fb923c',
};

const PerformanceTab: React.FC<PerformanceTabProps> = ({ result }) => {
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const completedReqs = result.urlRequests.filter(q => q.duration);

  if (completedReqs.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px' }}>
        <ThunderboltOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>没有可分析的性能数据</div>
        <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>上传包含已完成请求的NetLog文件后即可查看性能分析</div>
      </div>
    );
  }

  // Single-pass: collect durations, phase stats, and waterfall range
  const durations: number[] = [];
  const phaseStats: Record<string, number[]> = { dns: [], connect: [], ssl: [], send: [], wait: [], download: [] };
  let minDuration = Infinity;
  let maxDuration = 0;
  let totalDurationSum = 0;

  for (const req of completedReqs) {
    const d = req.duration!;
    durations.push(d);
    if (d < minDuration) minDuration = d;
    if (d > maxDuration) maxDuration = d;
    totalDurationSum += d;

    for (const [phase, info] of Object.entries(req.timeline)) {
      if (info) phaseStats[phase].push(info.duration);
    }
  }

  const stats = {
    min: minDuration,
    avg: totalDurationSum / durations.length,
    p50: percentile(durations, 0.5),
    p90: percentile(durations, 0.9),
    p99: percentile(durations, 0.99),
    max: maxDuration,
  };

  // Waterfall chart data: top 30 requests by duration
  const waterfallReqs = [...completedReqs]
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 30);
  let wfMinStart = Infinity;
  let wfMaxEnd = 0;
  for (const req of waterfallReqs) {
    if (req.startTime < wfMinStart) wfMinStart = req.startTime;
    const end = req.endTime || req.startTime;
    if (end > wfMaxEnd) wfMaxEnd = end;
  }
  const wfRange = wfMaxEnd - wfMinStart || 1;

  const slowColumns = [
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      width: 320,
      ellipsis: true,
      render: (url: string, record: any) => (
        <span
          style={{ cursor: 'pointer', color: '#5ba3f5', fontFamily: 'var(--font-mono)', fontSize: 12 }}
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
      render: (s: string, r: any) => {
        if (s === 'error' || r.error) return <Tag color="error" style={{ fontSize: 11, border: 'none' }}>失败</Tag>;
        if (r.statusCode >= 400) return <Tag color="warning" style={{ fontSize: 11, border: 'none' }}>{r.statusCode}</Tag>;
        return <Tag color="success" style={{ fontSize: 11, border: 'none' }}>{r.statusCode || 'OK'}</Tag>;
      },
    },
  ];

  return (
    <>
      <Card title="📈 请求耗时统计" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
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
              <div style={{ fontSize: 22, fontWeight: 700, color: s.label === '最大值' ? '#f87171' : s.label === '平均值' ? '#fb923c' : '#4a9eff', fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace" }}>{s.value}</div>
            </div>
          ))}
        </div>

        <h4 style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-secondary)' }}>各阶段平均耗时</h4>
        {(() => {
          const phaseChartData = Object.entries(phaseStats)
            .filter(([, vals]) => vals.length > 0)
            .map(([phase, vals]) => ({
              name: PHASE_NAMES[phase],
              avg: vals.reduce((a, b) => a + b, 0) / vals.length,
              fill: PHASE_COLORS[phase],
            }));
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
        })()}
      </Card>

      {/* Waterfall Chart */}
      <Card title="🌊 请求耗时瀑布图 (Top 30)" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
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
                      background: 'rgba(91, 163, 245, 0.15)',
                      borderRadius: 4,
                      border: '1px solid rgba(91, 163, 245, 0.3)',
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
        <Card title="🐌 慢请求详情 (>3s)" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
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
                {selectedReq.status === 'error' ? <Tag color="red">失败</Tag> : <Tag color="green">{selectedReq.statusCode || 'OK'}</Tag>}
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
