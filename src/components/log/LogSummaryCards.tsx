import React from 'react';
import { Col, Row } from 'antd';
import {
  GlobalOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PercentageOutlined,
} from '@ant-design/icons';
import type { LogStats } from '../../logParser';
import { SummaryCard } from '../shared/SummaryCard';

interface LogSummaryCardsProps {
  stats: LogStats;
  onFilterError?: () => void;
}

const LogSummaryCards: React.FC<LogSummaryCardsProps> = ({ stats, onFilterError }) => {
  const getSuccessRateColor = (rate: number) => {
    if (rate >= 95) return '#52c41a';
    if (rate >= 80) return '#fa8c16';
    return '#ff4d4f';
  };

  const successRateColor = getSuccessRateColor(stats.successRate);

  const cards = [
    {
      title: '已解析请求',
      value: stats.total,
      icon: <GlobalOutlined />,
      color: '#1890ff',
      bg: 'linear-gradient(135deg, rgba(24, 144, 255, 0.10), rgba(99, 102, 241, 0.05))',
    },
    {
      title: '成功',
      value: stats.success,
      icon: <CheckCircleOutlined />,
      color: '#52c41a',
      bg: 'linear-gradient(135deg, rgba(82, 196, 26, 0.10), rgba(22, 163, 74, 0.05))',
    },
    {
      title: '失败',
      value: stats.error,
      icon: <CloseCircleOutlined />,
      color: stats.error > 0 ? '#ff4d4f' : '#52c41a',
      bg: stats.error > 0
        ? 'linear-gradient(135deg, rgba(255, 77, 79, 0.10), rgba(251, 146, 60, 0.05))'
        : 'linear-gradient(135deg, rgba(82, 196, 26, 0.10), rgba(22, 163, 74, 0.05))',
      onClick: stats.error > 0 ? onFilterError : undefined,
    },
    {
      title: '成功率',
      value: `${stats.successRate}%`,
      icon: <PercentageOutlined />,
      color: successRateColor,
      bg: `linear-gradient(135deg, ${successRateColor}18, ${successRateColor}0a)`,
    },
  ];

  return (
    <Row gutter={[14, 14]}>
      {cards.map(card => (
        <Col key={card.title} xs={12} lg={6}>
          <SummaryCard
            title={card.title}
            value={card.value}
            color={card.color}
            valueColor={card.color}
            icon={card.icon}
            bgGradient={card.bg}
            onClick={card.onClick}
          />
        </Col>
      ))}
    </Row>
  );
};

export default LogSummaryCards;
