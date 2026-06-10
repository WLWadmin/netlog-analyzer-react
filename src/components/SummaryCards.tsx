import type { FC } from 'react';
import { Row, Col, Card } from 'antd';
import {
  FileTextOutlined,
  LinkOutlined,
  SafetyOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { AnalysisResult } from '../parser';
import { formatDuration } from '../parser';

interface SummaryCardsProps {
  result: AnalysisResult;
}

const SummaryCards: FC<SummaryCardsProps> = ({ result }) => {
  const completedCount = result.urlRequests.filter(q => q.endTime).length;
  const failedReqs = result.urlRequests.filter(q => q.status === 'error').length;
  const durations = result.urlRequests.filter(q => q.duration).map(q => q.duration!);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const totalDuration = result.timeRange.end - result.timeRange.start;

  const pi = result.proxyInfo;
  let proxyLabel = '代理';
  let proxyValue = '无';
  let proxyColor = '#34d399';
  let proxyIcon = <SafetyOutlined />;
  if (pi.isVPN) {
    proxyLabel = 'VPN';
    proxyValue = '已开启';
    proxyColor = '#f87171';
  } else if (pi.hasProxy) {
    proxyLabel = '代理';
    proxyValue = '已开启';
    proxyColor = '#fbbf24';
  }

  const cards = [
    {
      title: '总事件数',
      value: result.totalEvents.toLocaleString(),
      suffix: `来源: ${result.uniqueSources.toLocaleString()}`,
      color: '#0ea5e9',
      icon: <FileTextOutlined />,
      bgGradient: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.08))',
    },
    {
      title: 'URL 请求',
      value: result.urlRequests.length,
      suffix: `完成: ${completedCount} / 失败: ${failedReqs}`,
      color: '#22d3ee',
      icon: <LinkOutlined />,
      bgGradient: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(14, 165, 233, 0.08))',
    },
    {
      title: proxyLabel,
      value: proxyValue,
      suffix: pi.proxyType || '直连模式',
      color: proxyColor,
      icon: proxyIcon,
      bgGradient: `linear-gradient(135deg, ${proxyColor}20, ${proxyColor}10)`,
    },
    {
      title: '错误',
      value: result.errors.length,
      suffix: result.errors.length > 0 ? '需要关注' : '无错误',
      color: result.errors.length > 0 ? '#f87171' : '#34d399',
      icon: <WarningOutlined />,
      bgGradient: result.errors.length > 0
        ? 'linear-gradient(135deg, rgba(248, 113, 113, 0.12), rgba(251, 146, 60, 0.08))'
        : 'linear-gradient(135deg, rgba(52, 211, 153, 0.12), rgba(34, 211, 238, 0.08))',
    },
    {
      title: '平均耗时',
      value: formatDuration(avgDuration),
      suffix: `慢请求(>3s): ${result.slowRequests.length}`,
      color: '#a78bfa',
      icon: <ClockCircleOutlined />,
      bgGradient: 'linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(192, 132, 252, 0.08))',
    },
    {
      title: '峰值并发',
      value: result.peakConcurrency,
      suffix: `跨度: ${formatDuration(totalDuration)}`,
      color: '#fb923c',
      icon: <RiseOutlined />,
      bgGradient: 'linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(248, 113, 113, 0.08))',
    },
  ];

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 4 }}>
      {cards.map((card, i) => (
        <Col xs={12} sm={8} md={8} lg={4} key={i}>
          <Card
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              overflow: 'hidden',
              transition: 'all 0.3s ease',
              cursor: 'default',
            }}
            bodyStyle={{ padding: 0 }}
            hoverable
          >
            {/* Top accent bar */}
            <div
              style={{
                height: 3,
                background: card.color,
                opacity: 0.7,
              }}
            />
            <div style={{ padding: '16px 14px', position: 'relative' }}>
              {/* Background gradient */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: card.bgGradient,
                  opacity: 0.5,
                  pointerEvents: 'none',
                }}
              />
              {/* Icon + Title row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 10,
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <span
                  style={{
                    color: card.color,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {card.icon}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {card.title}
                </span>
              </div>
              {/* Value */}
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
              {/* Suffix */}
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginTop: 6,
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {card.suffix}
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
};

export default SummaryCards;
