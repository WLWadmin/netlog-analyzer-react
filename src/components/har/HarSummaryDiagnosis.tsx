import { useMemo } from 'react';
import { Table, Tag, Empty, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HarAnalysisResult,
  HarRequestEntry,
  statusStyle,
  formatHarTime,
  HAR_SLOW_THRESHOLD_MS,
} from '../../harParser';
import CopyText from './CopyText';

interface HarSummaryDiagnosisProps {
  result: HarAnalysisResult;
}

interface Anomaly {
  type: 'failed' | 'slow' | 'server-timing';
  severity: 'error' | 'warning';
  entry: HarRequestEntry;
  detail: string;
}

// 判断 Server-Timing 是否异常（缓存未命中 / 源站耗时偏高）
function serverTimingAnomaly(entry: HarRequestEntry): string {
  for (const st of entry.serverTiming) {
    const tag = `${st.name} ${st.desc || ''}`.toLowerCase();
    if (tag.includes('miss')) return `CDN 缓存未命中：${st.name}${st.desc ? `(${st.desc})` : ''}`;
    if (st.dur !== undefined && st.dur >= 200) return `源站/阶段耗时偏高：${st.name}=${st.dur}ms`;
  }
  return '';
}

const sectionTitle = (text: string, extra?: React.ReactNode) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 10px' }}>
    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{text}</span>
    {extra}
  </div>
);

const HarSummaryDiagnosis: React.FC<HarSummaryDiagnosisProps> = ({ result }) => {
  const anomalies = useMemo<Anomaly[]>(() => {
    const list: Anomaly[] = [];
    for (const e of result.entries) {
      if (e.isFailed) {
        list.push({ type: 'failed', severity: 'error', entry: e, detail: `状态码 ${e.status === 0 ? '失败/未完成' : e.status}` });
      }
      if (e.isSlow) {
        list.push({ type: 'slow', severity: 'warning', entry: e, detail: `耗时 ${formatHarTime(e.time)}（≥${HAR_SLOW_THRESHOLD_MS}ms）` });
      }
      const stAnom = serverTimingAnomaly(e);
      if (stAnom) {
        list.push({ type: 'server-timing', severity: 'warning', entry: e, detail: stAnom });
      }
    }
    return list;
  }, [result.entries]);

  const typeLabel: Record<Anomaly['type'], string> = {
    failed: '失败请求',
    slow: '慢请求',
    'server-timing': 'Server-Timing 异常',
  };

  const anomalyColumns: ColumnsType<Anomaly> = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 150,
      render: (t: Anomaly['type'], r) => (
        <Tag color={r.severity === 'error' ? '#fb7185' : '#fbbf24'} style={{ color: '#fff' }}>
          {typeLabel[t]}
        </Tag>
      ),
    },
    {
      title: '请求',
      dataIndex: ['entry', 'name'],
      key: 'name',
      ellipsis: true,
      render: (_: any, r) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)' }} title={r.entry.url}>
          {r.entry.name}
        </span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_: any, r) => {
        const st = statusStyle(r.entry.status);
        return (
          <Tag style={{ color: st.color, background: st.bg, border: 'none', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {r.entry.status === 0 ? '失败' : r.entry.status}
          </Tag>
        );
      },
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      render: (d: string) => <span style={{ color: 'var(--text-secondary)' }}>{d}</span>,
    },
  ];

  const keyFieldColumns: ColumnsType<HarRequestEntry> = [
    {
      title: '请求',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (name: string, r) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)' }} title={r.url}>{name}</span>
      ),
    },
    {
      title: 'Remote Address',
      key: 'remoteAddress',
      width: 190,
      render: (_: any, r) => <CopyText text={r.remoteAddress} label="Remote Address" />,
    },
    {
      title: 'x-tt-logid',
      key: 'xTtLogid',
      width: 240,
      render: (_: any, r) => <CopyText text={r.xTtLogid} label="x-tt-logid" />,
    },
    {
      title: 'x-tt-cip',
      key: 'xTtCip',
      width: 170,
      render: (_: any, r) => <CopyText text={r.xTtCip} label="x-tt-cip" />,
    },
    {
      title: 'x-lsc-source-ip',
      key: 'xLscSourceIp',
      width: 170,
      render: (_: any, r) => <CopyText text={r.xLscSourceIp} label="x-lsc-source-ip" />,
    },
  ];

  // 仅展示含任一关键字段的请求，避免噪音；若都没有则展示全部
  const keyFieldRows = useMemo(() => {
    const withFields = result.entries.filter(
      e => (e.remoteAddress && e.remoteAddress !== '-') || e.xTtLogid || e.xTtCip || e.xLscSourceIp
    );
    return withFields.length ? withFields : result.entries;
  }, [result.entries]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 异常汇总 */}
      <div>
        {sectionTitle(
          '异常汇总',
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            失败 {result.failedCount} · 慢请求 {result.slowCount} · 共 {anomalies.length} 项
          </span>
        )}
        {anomalies.length ? (
          <Table<Anomaly>
            columns={anomalyColumns}
            dataSource={anomalies}
            rowKey={(r) => `${r.type}-${r.entry.id}`}
            size="small"
            pagination={{ defaultPageSize: 20, hideOnSinglePage: true }}
          />
        ) : (
          <Alert type="success" showIcon message="未发现失败请求、慢请求或 Server-Timing 异常" />
        )}
      </div>

      {/* 关键字段速查 */}
      <div>
        {sectionTitle(
          '关键字段速查',
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>支持一键复制 · 共 {keyFieldRows.length} 条</span>
        )}
        {keyFieldRows.length ? (
          <Table<HarRequestEntry>
            columns={keyFieldColumns}
            dataSource={keyFieldRows}
            rowKey="id"
            size="small"
            scroll={{ x: 980 }}
            pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
          />
        ) : (
          <Empty description="无可用关键字段" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
};

export default HarSummaryDiagnosis;
