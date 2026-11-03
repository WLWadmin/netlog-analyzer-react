import { Row, Col } from 'antd';
import {
  FileTextOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';
import { HarAnalysisResult, formatBytes, formatHarTime, getHarResponseStatus, HAR_SLOW_THRESHOLD_MS } from '../../harParser';
import { SummaryCard } from '../shared/SummaryCard';
import { getHarSpanCoveredRequestCount, getHarKnownDurationMs } from '../../diagnosis/shared/harTimingCompleteness';

interface HarSummaryCardsProps {
  result: HarAnalysisResult;
  onFilterFailed?: () => void;
  onFilterSlow?: () => void;
  onFilterAll?: () => void; // 新增
}

const HarSummaryCards: React.FC<HarSummaryCardsProps> = ({ result, onFilterFailed, onFilterSlow, onFilterAll }) => {
  const spanCount = getHarSpanCoveredRequestCount(result.entries);
  const knownSizeCount = result.entries.filter(entry => Number.isFinite(entry.size) && entry.size >= 0).length;
  const outcomeCount = result.entries.filter(entry => getHarResponseStatus(entry) !== undefined || entry.isFailed).length;
  const durationCount = result.entries.filter(entry => getHarKnownDurationMs(entry) !== undefined).length;
  const spanLabel = spanCount === 0 ? '无可用请求起止时间'
    : spanCount === result.entries.length ? '已记录请求的起止跨度' : '已知请求子集跨度';
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
      value: outcomeCount > 0 ? result.failedCount : '无可用数据',
      suffix: `${result.failedCount > 0 ? '点击筛选失败请求 ›' : outcomeCount > 0 ? '已知结果中未记录失败' : '请求结果未知'} · 覆盖 ${outcomeCount}/${result.entries.length}`,
      color: '#f87171',
      valueColor: result.failedCount > 0 ? '#f87171' : undefined,
      icon: <CloseCircleOutlined />,
      bg: 'linear-gradient(135deg, rgba(248, 113, 113, 0.12), rgba(251, 146, 60, 0.08))',
      onClick: result.failedCount > 0 ? onFilterFailed : undefined,
    },
    {
      title: '慢请求',
      value: durationCount > 0 ? result.slowCount : '无可用数据',
      suffix: `耗时 ≥${HAR_SLOW_THRESHOLD_MS}ms${result.slowCount > 0 ? ' · 点击筛选 ›' : ''} · 覆盖 ${durationCount}/${result.entries.length}`,
      color: result.slowCount > 0 ? '#fb923c' : '#34d399',
      valueColor: result.slowCount > 0 ? '#fb923c' : undefined,
      icon: <ClockCircleOutlined />,
      bg: 'linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(248, 113, 113, 0.08))',
      onClick: result.slowCount > 0 ? onFilterSlow : undefined,
    },
    {
      title: '总传输大小',
      value: knownSizeCount > 0 ? formatBytes(result.totalSize) : '无可用数据',
      suffix: `已知大小合计 · 覆盖 ${knownSizeCount}/${result.entries.length}`,
      color: '#22d3ee',
      valueColor: undefined, // 中性指标
      icon: <CloudDownloadOutlined />,
      bg: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(14, 165, 233, 0.08))',
      onClick: undefined,
    },
    {
      title: '请求时间跨度',
      value: spanCount > 0 ? formatHarTime(result.totalTime) : '无可用数据',
      suffix: `${spanLabel} · 覆盖 ${spanCount}/${result.entries.length}`,
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
        <Col key={i} flex="1 1 140px" style={{ minWidth: 140 }}>
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
