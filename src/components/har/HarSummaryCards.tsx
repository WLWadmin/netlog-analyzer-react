import { Row, Col, Card } from 'antd';
import {
  LinkOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';
import { HarAnalysisResult, formatBytes, formatHarTime, HAR_SLOW_THRESHOLD_MS } from '../../harParser';

interface HarSummaryCardsProps {
  result: HarAnalysisResult;
}

const HarSummaryCards: React.FC<HarSummaryCardsProps> = ({ result }) => {
  const cards = [
    {
      title: '总请求数',
      value: result.totalRequests.toLocaleString(),
      suffix: `来源: ${result.creator || 'HAR'}`,
      color: '#0ea5e9',
      icon: <LinkOutlined />,
      bg: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.08))',
    },
    {
      title: '失败请求',
      value: result.failedCount,
      suffix: result.failedCount > 0 ? '状态码 ≥400 或 0' : '无失败',
      color: result.failedCount > 0 ? '#f87171' : '#34d399',
      icon: <CloseCircleOutlined />,
      bg: result.failedCount > 0
        ? 'linear-gradient(135deg, rgba(248, 113, 113, 0.12), rgba(251, 146, 60, 0.08))'
        : 'linear-gradient(135deg, rgba(52, 211, 153, 0.12), rgba(34, 211, 238, 0.08))',
    },
    {
      title: '慢请求',
      value: result.slowCount,
      suffix: `耗时 ≥${HAR_SLOW_THRESHOLD_MS}ms`,
      color: result.slowCount > 0 ? '#fb923c' : '#34d399',
      icon: <ClockCircleOutlined />,
      bg: 'linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(248, 113, 113, 0.08))',
    },
    {
      title: '总传输大小',
      value: formatBytes(result.totalSize),
      suffix: '所有请求合计',
      color: '#22d3ee',
      icon: <CloudDownloadOutlined />,
      bg: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(14, 165, 233, 0.08))',
    },
    {
      title: '总耗时',
      value: formatHarTime(result.totalTime),
      suffix: '首尾请求时间跨度',
      color: '#a78bfa',
      icon: <FieldTimeOutlined />,
      bg: 'linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(192, 132, 252, 0.08))',
    },
  ];

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 4 }}>
      {cards.map((card, i) => (
        <Col key={i} flex="1 1 180px" style={{ minWidth: 180 }}>
          <Card
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden' }}
            styles={{ body: { padding: 0 } }}
            hoverable
          >
            <div style={{ height: 3, background: card.color, opacity: 0.7 }} />
            <div style={{ padding: '16px 14px', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, background: card.bg, opacity: 0.5, pointerEvents: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, position: 'relative', zIndex: 1 }}>
                <span style={{ color: card.color, fontSize: 14, display: 'flex', alignItems: 'center' }}>{card.icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {card.title}
                </span>
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: card.color,
                  lineHeight: 1.2,
                  position: 'relative',
                  zIndex: 1,
                  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                }}
              >
                {card.value}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, position: 'relative', zIndex: 1 }}>
                {card.suffix}
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
};

export default HarSummaryCards;
