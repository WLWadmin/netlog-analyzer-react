import { Row, Col } from 'antd';
import {
  FileTextOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';
import { HarAnalysisResult, formatBytes, formatHarTime, HAR_SLOW_THRESHOLD_MS } from '../../harParser';
import { SummaryCard } from '../shared/SummaryCard';

interface HarSummaryCardsProps {
  result: HarAnalysisResult;
  onFilterFailed?: () => void;
  onFilterSlow?: () => void;
  onFilterAll?: () => void; // 新增
}

const HarSummaryCards: React.FC<HarSummaryCardsProps> = ({ result, onFilterFailed, onFilterSlow, onFilterAll }) => {
  const cards = [
    {
      title: '总请求数',
      value: result.totalRequests.toLocaleString(),
      suffix: `来源: ${result.creator || 'HAR'}`,
      color: '#0ea5e9',
      valueColor: undefined, // 中性指标
      icon: <FileTextOutlined />,
      bg: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.08))',
      onClick: onFilterAll,
    },
    {
      title: '失败请求',
      value: result.failedCount,
      suffix: result.failedCount > 0 ? '点击筛选失败请求 ›' : '无失败',
      color: '#f87171',
      valueColor: result.failedCount > 0 ? '#f87171' : undefined,
      icon: <CloseCircleOutlined />,
      bg: 'linear-gradient(135deg, rgba(248, 113, 113, 0.12), rgba(251, 146, 60, 0.08))',
      onClick: result.failedCount > 0 ? onFilterFailed : undefined,
    },
    {
      title: '慢请求',
      value: result.slowCount,
      suffix: result.slowCount > 0 ? `≥${HAR_SLOW_THRESHOLD_MS}ms · 点击筛选 ›` : `耗时 ≥${HAR_SLOW_THRESHOLD_MS}ms`,
      color: result.slowCount > 0 ? '#fb923c' : '#34d399',
      valueColor: result.slowCount > 0 ? '#fb923c' : undefined,
      icon: <ClockCircleOutlined />,
      bg: 'linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(248, 113, 113, 0.08))',
      onClick: result.slowCount > 0 ? onFilterSlow : undefined,
    },
    {
      title: '总传输大小',
      value: formatBytes(result.totalSize),
      suffix: '所有请求合计',
      color: '#22d3ee',
      valueColor: undefined, // 中性指标
      icon: <CloudDownloadOutlined />,
      bg: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(14, 165, 233, 0.08))',
      onClick: undefined,
    },
    {
      title: '总耗时',
      value: formatHarTime(result.totalTime),
      suffix: '首尾请求时间跨度',
      color: '#a78bfa',
      valueColor: undefined, // 中性指标
      icon: <FieldTimeOutlined />,
      bg: 'linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(192, 132, 252, 0.08))',
      onClick: undefined,
    },
  ];

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 4 }}>
      {cards.map((card, i) => (
        <Col key={i} flex="1 1 180px" style={{ minWidth: 180 }}>
          <SummaryCard
            title={card.title}
            value={card.value}
            suffix={card.suffix}
            color={card.color}
            valueColor={card.valueColor}
            icon={card.icon}
            bgGradient={card.bg}
            onClick={card.onClick}
          />
        </Col>
      ))}
    </Row>
  );
};

export default HarSummaryCards;
