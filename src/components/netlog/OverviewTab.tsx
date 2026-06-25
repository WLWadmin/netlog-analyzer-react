import { useMemo } from 'react';
import { Card, Col, Row, Table, Tag } from 'antd';
import { ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import type { NetlogSummary } from '../../workers/summaryTypes';
import { formatDuration } from '../../parsers/netlog/parser';

interface OverviewTabProps {
  summary: NetlogSummary;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ summary }) => {
  const totalDuration = useMemo(() => summary.timeRange.end - summary.timeRange.start, [summary]);

  const slowColumns = [
    { title: '方法', dataIndex: 'method', width: 80, render: (v: string) => <Tag style={{ margin: 0 }}>{v}</Tag> },
    { title: 'URL', dataIndex: 'url', ellipsis: true },
    { title: '耗时', dataIndex: 'duration', width: 110, render: (v?: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(v || 0)}</span> },
    { title: '协议', dataIndex: 'protocol', width: 90, render: (v?: string) => v ? <Tag style={{ margin: 0 }}>{v}</Tag> : '-' },
  ];

  const domainColumns = [
    { title: '域名', dataIndex: 'domain', ellipsis: true },
    { title: '失败次数', dataIndex: 'count', width: 100, render: (v: number) => <Tag color="red" style={{ margin: 0 }}>{v}</Tag> },
    { title: '错误码', dataIndex: 'errorCodes', width: 160, render: (v: number[]) => <span style={{ fontFamily: 'var(--font-mono)' }}>{v.slice(0, 6).join(', ')}</span> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>采集跨度</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
              <ClockCircleOutlined style={{ marginRight: 8 }} />
              {formatDuration(totalDuration)}
            </div>
            <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
              事件：{summary.totalEvents.toLocaleString()} · 请求：{summary.requestCount.toLocaleString()}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>代理/VPN</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
              {summary.proxyInfo.isVPN ? 'VPN 已开启' : summary.proxyInfo.hasProxy ? '代理已开启' : '直连'}
            </div>
            <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
              {summary.proxyInfo.proxyType || '未记录代理类型'}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>错误/告警</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
              <WarningOutlined style={{ marginRight: 8, color: summary.issueCounts.error > 0 ? '#ff4d4f' : '#52c41a' }} />
              {summary.issueCounts.error} 错误
            </div>
            <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
              warning：{summary.issueCounts.warning} · info：{summary.issueCounts.info}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
            title="慢请求 Top"
            bodyStyle={{ padding: 0 }}
          >
            <Table
              size="small"
              rowKey={(r) => String(r.id)}
              columns={slowColumns as any}
              dataSource={summary.slowRequestPreviews}
              pagination={false}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
            title="失败域名 Top"
            bodyStyle={{ padding: 0 }}
          >
            <Table
              size="small"
              rowKey={(r) => r.domain}
              columns={domainColumns as any}
              dataSource={summary.failedDomainPreviews}
              pagination={false}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default OverviewTab;

