import type { FC } from 'react';
import { Row, Col } from 'antd';
import {
  FileTextOutlined,
  LinkOutlined,
  SafetyOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { AnalysisResult } from '../../parsers/netlog/parser';
import { formatDuration } from '../../parsers/netlog/parser';
import { SummaryCard } from '../../components/shared/SummaryCard';

interface SummaryCardsProps {
  result: AnalysisResult;
  onNavigate?: (tab: string, search?: string) => void;
}

const SummaryCards: FC<SummaryCardsProps> = ({ result, onNavigate }) => {
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
      valueColor: undefined,
      icon: <FileTextOutlined />,
      bgGradient: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.08))',
    },
    {
      title: 'URL 请求',
      value: result.urlRequests.length,
      suffix: `完成: ${completedCount} / 失败: ${failedReqs}`,
      color: '#22d3ee',
      valueColor: failedReqs > 0 ? '#f87171' : undefined,
      icon: <LinkOutlined />,
      bgGradient: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(14, 165, 233, 0.08))',
      onClick: () => onNavigate?.('events', 'URL_REQUEST'),
    },
    {
      title: proxyLabel,
      value: proxyValue,
      suffix: pi.proxyType || '直连模式',
      color: proxyColor,
      valueColor: pi.isVPN ? '#f87171' : pi.hasProxy ? '#fbbf24' : undefined,
      icon: proxyIcon,
      bgGradient: `linear-gradient(135deg, ${proxyColor}20, ${proxyColor}10)`,
    },
    {
      title: '错误',
      value: result.errors.length,
      suffix: result.errors.length > 0 ? '需要关注' : '无错误',
      color: result.errors.length > 0 ? '#f87171' : '#34d399',
      valueColor: result.errors.length > 0 ? '#f87171' : undefined,
      icon: <WarningOutlined />,
      bgGradient: result.errors.length > 0
        ? 'linear-gradient(135deg, rgba(248, 113, 113, 0.12), rgba(251, 146, 60, 0.08))'
        : 'linear-gradient(135deg, rgba(52, 211, 153, 0.12), rgba(34, 211, 238, 0.08))',
      onClick: result.errors.length > 0 ? () => onNavigate?.('events', 'net_error') : undefined,
    },
    {
      title: '平均耗时',
      value: formatDuration(avgDuration),
      suffix: `慢请求(>3s): ${result.slowRequests.length}`,
      color: '#a78bfa',
      valueColor: result.slowRequests.length > 0 ? '#fb923c' : undefined,
      icon: <ClockCircleOutlined />,
      bgGradient: 'linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(192, 132, 252, 0.08))',
    },
    {
      title: '峰值并发',
      value: result.peakConcurrency,
      suffix: `跨度: ${formatDuration(totalDuration)}`,
      color: '#fb923c',
      valueColor: undefined,
      icon: <RiseOutlined />,
      bgGradient: 'linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(248, 113, 113, 0.08))',
    },
  ];

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 4 }}>
      {cards.map((card, i) => (
        <Col xs={12} sm={8} md={8} lg={4} key={i}>
          <SummaryCard
            title={card.title}
            value={card.value}
            suffix={card.suffix}
            color={card.color}
            valueColor={card.valueColor}
            icon={card.icon}
            bgGradient={card.bgGradient}
            onClick={card.onClick}
          />
        </Col>
      ))}
    </Row>
  );
};

export default SummaryCards;
