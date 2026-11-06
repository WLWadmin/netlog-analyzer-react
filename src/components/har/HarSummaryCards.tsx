import { useMemo } from 'react';
import { Row, Col } from 'antd';
import {
  FileTextOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';
import { HarAnalysisResult, formatBytes, formatHarTime, getHarResponseStatus, getHarRecordedTransferSize, HAR_SLOW_THRESHOLD_MS } from '../../harParser';
import { SummaryCard } from '../shared/SummaryCard';
import { getHarSpanCoveredRequestCount, getHarKnownDurationMs } from '../../diagnosis/shared/harTimingCompleteness';

interface HarSummaryCardsProps {
  result: HarAnalysisResult;
  fileSize?: number;
  onFilterFailed?: () => void;
  onFilterSlow?: () => void;
  onFilterAll?: () => void; // 新增
}

const HarSummaryCards: React.FC<HarSummaryCardsProps> = ({ result, fileSize, onFilterFailed, onFilterSlow, onFilterAll }) => {
  const spanCount = getHarSpanCoveredRequestCount(result.entries);
  const partial = result.repairInfo?.repaired || result.qualityReport?.scope === 'partial';
  const coverageLabel = partial ? '已解析请求内覆盖' : '覆盖';
  const sizeSummary = useMemo(() => {
    let transferBytes = 0;
    let transferCount = 0;
    let resourceBytes = 0;
    let resourceCount = 0;
    let diskCacheCount = 0;
    let bodyCount = 0;
    let base64Count = 0;
    for (const entry of result.entries) {
      const transferSize = getHarRecordedTransferSize(entry);
      if (transferSize !== undefined) {
        transferBytes += transferSize;
        transferCount++;
      }
      const resourceSize = entry.sizeInfo?.resourceSize ?? entry.contentSize;
      if (Number.isFinite(resourceSize) && resourceSize >= 0) {
        resourceBytes += resourceSize;
        resourceCount++;
      }
      if (entry.cacheInfo?.source === 'disk') diskCacheCount++;
      if ((entry.responseBodyDescriptor?.originalLength ?? 0) > 0) {
        bodyCount++;
        if (entry.responseBodyDescriptor?.encoding === 'base64') base64Count++;
      }
    }
    return { transferBytes, transferCount, resourceBytes, resourceCount, diskCacheCount, bodyCount, base64Count };
  }, [result.entries]);
  const fileSizeLabel = fileSize !== undefined && Number.isFinite(fileSize) && fileSize >= 0
    ? formatBytes(fileSize) : '未记录';
  const outcomeCount = result.entries.filter(entry => getHarResponseStatus(entry) !== undefined || entry.isFailed).length;
  const durationCount = result.entries.filter(entry => getHarKnownDurationMs(entry) !== undefined).length;
  const spanLabel = spanCount === 0 ? '无可用请求起止时间'
    : spanCount === result.entries.length ? '已记录请求的起止跨度' : '已知请求子集跨度';
  const cards = [
    {
      title: partial ? '已解析请求数' : '总请求数',
      value: result.totalRequests.toLocaleString(),
      suffix: `HAR 文件 ${fileSizeLabel} · 来源: ${result.creator || 'HAR'}`,
      color: '#0ea5e9',
      valueColor: undefined, // 中性指标
      icon: <FileTextOutlined />,
      bg: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.08))',
      onClick: onFilterAll,
    },
    {
      title: '失败请求',
      value: outcomeCount > 0 ? result.failedCount : '无可用数据',
      suffix: `${result.failedCount > 0 ? '点击筛选失败请求 ›' : outcomeCount > 0 ? '已知结果中未记录失败' : '请求结果未知'} · ${coverageLabel} ${outcomeCount}/${result.entries.length}`,
      color: '#f87171',
      valueColor: result.failedCount > 0 ? '#f87171' : undefined,
      icon: <CloseCircleOutlined />,
      bg: 'linear-gradient(135deg, rgba(248, 113, 113, 0.12), rgba(251, 146, 60, 0.08))',
      onClick: result.failedCount > 0 ? onFilterFailed : undefined,
    },
    {
      title: '慢请求',
      value: durationCount > 0 ? result.slowCount : '无可用数据',
      suffix: `耗时 ≥${HAR_SLOW_THRESHOLD_MS}ms${result.slowCount > 0 ? ' · 点击筛选 ›' : ''} · ${coverageLabel} ${durationCount}/${result.entries.length}`,
      color: result.slowCount > 0 ? '#fb923c' : '#34d399',
      valueColor: result.slowCount > 0 ? '#fb923c' : undefined,
      icon: <ClockCircleOutlined />,
      bg: 'linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(248, 113, 113, 0.08))',
      onClick: result.slowCount > 0 ? onFilterSlow : undefined,
    },
    {
      title: partial ? '已解析传输大小合计' : '总传输大小',
      value: sizeSummary.transferCount > 0 ? formatBytes(sizeSummary.transferBytes) : '无可用数据',
      suffix: `已知大小合计 · ${coverageLabel} ${sizeSummary.transferCount}/${result.entries.length}`,
      color: '#22d3ee',
      valueColor: undefined, // 中性指标
      icon: <CloudDownloadOutlined />,
      bg: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(14, 165, 233, 0.08))',
      onClick: undefined,
    },
    {
      title: partial ? '已解析资源大小合计' : '资源总大小',
      value: sizeSummary.resourceCount > 0 ? formatBytes(sizeSummary.resourceBytes) : '无可用数据',
      suffix: `响应内容大小合计 · ${coverageLabel} ${sizeSummary.resourceCount}/${result.entries.length}`,
      color: '#22d3ee',
      valueColor: undefined,
      icon: <FileTextOutlined />,
      bg: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(14, 165, 233, 0.08))',
      onClick: undefined,
    },
    {
      title: '请求时间跨度',
      value: spanCount > 0 ? formatHarTime(result.totalTime) : '无可用数据',
      suffix: `${spanLabel} · ${coverageLabel} ${spanCount}/${result.entries.length}`,
      color: '#a78bfa',
      valueColor: undefined, // 中性指标
      icon: <FieldTimeOutlined />,
      bg: 'linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(192, 132, 252, 0.08))',
      onClick: undefined,
    },
  ];

  return (
    <>
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
      <p className="har-size-explanation">
        {partial && <>统计仅针对已解析请求，不代表原文件全部请求；HAR 文件大小仍为原始文件体积。 </>}
        传输大小仅统计明确记录的传输字节数，缺失时显示未知，不用正文或资源大小推算；资源大小是响应内容大小。HAR 文件还包含请求信息和响应正文，文件体积不等于网络下载量。
        {sizeSummary.diskCacheCount > 0 && (
          <> {sizeSummary.diskCacheCount === result.entries.length ? `已解析的 ${sizeSummary.diskCacheCount} 条请求均记录为磁盘缓存来源` : `已解析请求中，${sizeSummary.diskCacheCount} 条请求记录为磁盘缓存来源`}
            {sizeSummary.diskCacheCount === result.entries.length && sizeSummary.transferCount === result.entries.length && sizeSummary.transferBytes === 0
              ? '，传输大小均为 0 B。' : '；缓存请求的传输大小可能为 0 B。'}</>
        )}
        {sizeSummary.bodyCount > 0 && <> 已解析请求中包含 {sizeSummary.bodyCount} 条响应正文。</>}
        {sizeSummary.base64Count > 0 && <> 其中 {sizeSummary.base64Count} 条采用 Base64 编码，会增加保存体积。</>}
      </p>
    </>
  );
};

export default HarSummaryCards;
