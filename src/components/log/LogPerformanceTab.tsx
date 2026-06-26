import React, { useMemo } from 'react';
import { Card, Tag, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DashboardOutlined,
  GlobalOutlined,
  ApiOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { LogAnalysisResult, LogEntry } from '../../logParser';
import { SLOW_REQUEST_MS, MODERATE_REQUEST_MS, TOP_PREVIEW_COUNT, TOP_REQUESTS_COUNT } from '../../constants/analysisThresholds';
import MetricCard from '../shared/MetricCard';

interface LogPerformanceTabProps {
  result: LogAnalysisResult;
}

interface DomainPerf {
  domain: string;
  count: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p90Duration: number;
  errorCount: number;
  errorRate: number;
}

interface ApiPerf {
  path: string;
  domain: string;
  count: number;
  avgDuration: number;
  maxDuration: number;
  errorCount: number;
  errorRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((sorted.length - 1) * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function calculatePerformance(result: LogAnalysisResult) {
  const { entries } = result;
  const durations = entries.map(e => e.duration).sort((a, b) => a - b);

  const overall = {
    min: durations[0] || 0,
    avg: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    p50: percentile(durations, 0.5),
    p90: percentile(durations, 0.9),
    p99: percentile(durations, 0.99),
    max: durations[durations.length - 1] || 0,
  };

  // 按域名聚合
  const domainMap = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const list = domainMap.get(e.domain) || [];
    list.push(e);
    domainMap.set(e.domain, list);
  }
  const domainPerf: DomainPerf[] = Array.from(domainMap.entries()).map(([domain, list]) => {
    const ds = list.map(e => e.duration).sort((a, b) => a - b);
    const errorCount = list.filter(e => e.status === 'Error').length;
    return {
      domain,
      count: list.length,
      avgDuration: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length),
      minDuration: ds[0] || 0,
      maxDuration: ds[ds.length - 1] || 0,
      p90Duration: percentile(ds, 0.9),
      errorCount,
      errorRate: Math.round((errorCount / list.length) * 100),
    };
  }).sort((a, b) => b.avgDuration - a.avgDuration);

  // 按接口路径聚合
  const apiMap = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const key = `${e.domain}${e.path}`;
    const list = apiMap.get(key) || [];
    list.push(e);
    apiMap.set(key, list);
  }
  const apiPerf: ApiPerf[] = Array.from(apiMap.entries()).map(([path, list]) => {
    const ds = list.map(e => e.duration).sort((a, b) => a - b);
    const errorCount = list.filter(e => e.status === 'Error').length;
    return {
      path,
      domain: list[0].domain,
      count: list.length,
      avgDuration: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length),
      maxDuration: ds[ds.length - 1] || 0,
      errorCount,
      errorRate: Math.round((errorCount / list.length) * 100),
    };
  }).sort((a, b) => b.avgDuration - a.avgDuration);

  // 慢请求 Top
  const slowEntries = entries.filter(e => e.duration > MODERATE_REQUEST_MS).sort((a, b) => b.duration - a.duration).slice(0, TOP_REQUESTS_COUNT);

  return { overall, domainPerf, apiPerf, slowEntries };
}

const LogPerformanceTab: React.FC<LogPerformanceTabProps> = ({ result }) => {
  const perf = useMemo(() => calculatePerformance(result), [result]);

  const metricCards = [
    { label: '最小', value: perf.overall.min, unit: 'ms', status: 'success' as const },
    { label: '平均', value: perf.overall.avg, unit: 'ms', status: 'info' as const },
    { label: 'P50', value: perf.overall.p50, unit: 'ms', status: 'default' as const },
    { label: 'P90', value: perf.overall.p90, unit: 'ms', status: 'warning' as const },
    { label: 'P99', value: perf.overall.p99, unit: 'ms', status: 'error' as const },
    { label: '最大', value: perf.overall.max, unit: 'ms', status: 'error' as const },
  ];

  const domainColumns: ColumnsType<DomainPerf> = [
    { title: '域名', dataIndex: 'domain', key: 'domain', ellipsis: true },
    { title: '请求数', dataIndex: 'count', key: 'count', width: 80, align: 'right' },
    { title: '平均耗时', dataIndex: 'avgDuration', key: 'avgDuration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}ms</span> },
    { title: 'P90', dataIndex: 'p90Duration', key: 'p90Duration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}ms</span> },
    { title: '最大', dataIndex: 'maxDuration', key: 'maxDuration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}ms</span> },
    { title: '失败率', dataIndex: 'errorRate', key: 'errorRate', width: 90, align: 'right', render: (v: number) => <Tag color={v > 10 ? 'error' : v > 0 ? 'warning' : 'success'} style={{ fontSize: 11 }}>{v}%</Tag> },
  ];

  const apiColumns: ColumnsType<ApiPerf> = [
    { title: '接口', dataIndex: 'path', key: 'path', ellipsis: true },
    { title: '域名', dataIndex: 'domain', key: 'domain', width: 160, ellipsis: true },
    { title: '请求数', dataIndex: 'count', key: 'count', width: 80, align: 'right' },
    { title: '平均耗时', dataIndex: 'avgDuration', key: 'avgDuration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}ms</span> },
    { title: '最大耗时', dataIndex: 'maxDuration', key: 'maxDuration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}ms</span> },
    { title: '失败率', dataIndex: 'errorRate', key: 'errorRate', width: 90, align: 'right', render: (v: number) => <Tag color={v > 10 ? 'error' : v > 0 ? 'warning' : 'success'} style={{ fontSize: 11 }}>{v}%</Tag> },
  ];

  const slowColumns: ColumnsType<LogEntry> = [
    { title: 'LogID', dataIndex: 'id', key: 'id', width: 120, render: (v: string) => <code style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{v}</code> },
    { title: '名称', dataIndex: 'friendlyName', key: 'name', ellipsis: true, render: (v: string, r) => v || r.url },
    { title: '域名', dataIndex: 'domain', key: 'domain', width: 160, ellipsis: true },
    { title: '方法', dataIndex: 'method', key: 'method', width: 70, align: 'center', render: (v: string) => <Tag style={{ fontSize: 11, margin: 0 }}>{v}</Tag> },
    { title: '状态码', dataIndex: 'statusCode', key: 'statusCode', width: 80, align: 'center', render: (v?: number) => v ? <Tag color={v >= 400 ? 'error' : 'success'} style={{ fontSize: 11 }}>{v}</Tag> : '-' },
    { title: '耗时', dataIndex: 'duration', key: 'duration', width: 100, align: 'right', render: (v: number) => <span style={{ fontFamily: 'var(--font-mono)', color: v > SLOW_REQUEST_MS ? '#ff4d4f' : v > MODERATE_REQUEST_MS ? '#fa8c16' : 'var(--text-primary)', fontWeight: 600 }}>{v}ms</span> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 总体耗时指标 */}
      <Card style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }} styles={{ body: { padding: '16px 20px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          <DashboardOutlined style={{ color: 'var(--accent-blue)' }} />
          日志耗时统计
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {metricCards.map(m => (
            <MetricCard key={m.label} label={m.label} value={m.value} unit={m.unit} status={m.status} />
          ))}
        </div>
      </Card>

      {/* 域名性能 */}
      <Card
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        styles={{ body: { padding: '16px 20px' } }}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
            <GlobalOutlined style={{ color: 'var(--accent-blue)' }} />
            域名耗时统计 Top {Math.min(perf.domainPerf.length, TOP_PREVIEW_COUNT)}
          </span>
        }
      >
        <Table
          columns={domainColumns}
          dataSource={perf.domainPerf.slice(0, TOP_PREVIEW_COUNT)}
          rowKey="domain"
          size="small"
          pagination={false}
          scroll={{ x: 600 }}
        />
      </Card>

      {/* 接口性能 */}
      <Card
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        styles={{ body: { padding: '16px 20px' } }}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
            <ApiOutlined style={{ color: 'var(--accent-blue)' }} />
            接口耗时统计 Top {Math.min(perf.apiPerf.length, TOP_PREVIEW_COUNT)}
          </span>
        }
      >
        <Table
          columns={apiColumns}
          dataSource={perf.apiPerf.slice(0, TOP_PREVIEW_COUNT)}
          rowKey="path"
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
        />
      </Card>

      {/* 慢请求 */}
      {perf.slowEntries.length > 0 && (
        <Card
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
          styles={{ body: { padding: '16px 20px' } }}
          title={
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
              <ThunderboltOutlined style={{ color: '#fa8c16' }} />
              慢请求 Top {Math.min(perf.slowEntries.length, TOP_REQUESTS_COUNT)}（{'>'} 1s）
            </span>
          }
        >
          <Table
            columns={slowColumns}
            dataSource={perf.slowEntries}
            rowKey="id"
            size="small"
            pagination={false}
            scroll={{ x: 600 }}
          />
        </Card>
      )}
    </div>
  );
};

export default LogPerformanceTab;
