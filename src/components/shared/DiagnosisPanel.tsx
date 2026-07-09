import React, { useEffect, useState } from 'react';
import { Button, Empty, Spin } from 'antd';
import type { DiagnosisSummary } from '../../diagnosis/shared/types';
import DiagnosticCard from './DiagnosticCard';
import CollectionQualityAlert from './CollectionQualityAlert';
import ExportSummaryButton from './ExportSummaryButton';

interface DiagnosisPanelProps {
  summary?: DiagnosisSummary;
  loading?: boolean;
  showExport?: boolean;
  initialCardCount?: number;
  cardLoadStep?: number;
}

const DiagnosisPanel: React.FC<DiagnosisPanelProps> = ({
  summary,
  loading,
  showExport = true,
  initialCardCount,
  cardLoadStep,
}) => {
  const [visibleCardCount, setVisibleCardCount] = useState(initialCardCount ?? Number.POSITIVE_INFINITY);

  useEffect(() => {
    setVisibleCardCount(initialCardCount ?? Number.POSITIVE_INFINITY);
  }, [summary, initialCardCount]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 12, color: 'var(--text-muted)' }}>正在分析诊断...</div>
      </div>
    );
  }

  if (!summary || summary.cards.length === 0) {
    return (
      <Empty
        description="未检测到明显问题"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ marginTop: 40 }}
      />
    );
  }

  const criticalCount = summary.cards.filter(c => c.severity === 'critical').length;
  const warningCount = summary.cards.filter(c => c.severity === 'warning').length;
  const infoCount = summary.cards.filter(c => c.severity === 'info').length;
  const confidenceText = summary.combinedConfidence === 'high' ? '高' : summary.combinedConfidence === 'medium' ? '中' : '低';
  const confidenceColor = summary.combinedConfidence === 'high' ? '#10b981' : summary.combinedConfidence === 'medium' ? '#f59e0b' : 'var(--text-secondary)';
  const nextVisibleCount = Math.min(visibleCardCount, summary.cards.length);
  const visibleCards = summary.cards.slice(0, nextVisibleCount);
  const remainingCardCount = summary.cards.length - nextVisibleCount;
  const shouldBatchCards = initialCardCount !== undefined && cardLoadStep !== undefined && remainingCardCount > 0;

  return (
    <div style={{ padding: '16px 0' }}>
      {/* 采集质量提示 */}
      <CollectionQualityAlert quality={summary.quality} />

      {/* 诊断概览 + 导出按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {criticalCount > 0 && (
          <div
            style={{
              padding: '8px 16px',
              background: 'rgba(239, 68, 68, 0.08)',
              borderRadius: 8,
              border: '1px solid rgba(239, 68, 68, 0.2)',
            }}
          >
            <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 18 }}>{criticalCount}</span>
            <span style={{ color: '#ef4444', fontSize: 13, marginLeft: 4 }}>严重</span>
          </div>
        )}
        {warningCount > 0 && (
          <div
            style={{
              padding: '8px 16px',
              background: 'rgba(245, 158, 11, 0.08)',
              borderRadius: 8,
              border: '1px solid rgba(245, 158, 11, 0.2)',
            }}
          >
            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 18 }}>{warningCount}</span>
            <span style={{ color: '#f59e0b', fontSize: 13, marginLeft: 4 }}>警告</span>
          </div>
        )}
        {infoCount > 0 && (
          <div
            style={{
              padding: '8px 16px',
              background: 'rgba(59, 130, 246, 0.08)',
              borderRadius: 8,
              border: '1px solid rgba(59, 130, 246, 0.2)',
            }}
          >
            <span style={{ color: '#3b82f6', fontWeight: 700, fontSize: 18 }}>{infoCount}</span>
            <span style={{ color: '#3b82f6', fontSize: 13, marginLeft: 4 }}>提示</span>
          </div>
        )}
        {summary.healthScore !== undefined && (
          <div
            className="diagnosis-summary-chip diagnosis-summary-chip--health"
            style={{
              padding: '8px 16px',
              background: 'rgba(107, 114, 128, 0.06)',
              borderRadius: 8,
              border: '1px dashed rgba(107, 114, 128, 0.3)',
            }}
          >
            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: 18 }}>{summary.healthScore}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13, marginLeft: 4 }}>辅助健康分</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8 }}>（仅供参考，主诊断见上方卡片）</span>
          </div>
        )}
        {summary.combinedConfidence && (
          <div
            style={{
              padding: '8px 16px',
              background: `${confidenceColor}12`,
              borderRadius: 8,
              border: `1px solid ${confidenceColor}33`,
            }}
          >
            <span style={{ color: confidenceColor, fontWeight: 700, fontSize: 18 }}>{confidenceText}</span>
            <span style={{ color: confidenceColor, fontSize: 13, marginLeft: 4 }}>联合置信度</span>
          </div>
        )}
        </div>
        {showExport && summary.cards.length > 0 && (
          <ExportSummaryButton summary={summary} />
        )}
      </div>

      {/* 诊断卡片列表 */}
      <div>
        {visibleCards.map((card, index) => (
          <DiagnosticCard key={card.id} card={card} index={index} />
        ))}
        {shouldBatchCards && (
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <Button
              type="link"
              onClick={() => setVisibleCardCount(prev => Math.min(prev + cardLoadStep, summary.cards.length))}
              style={{ color: '#0ea5e9', fontSize: 13 }}
            >
              加载更多诊断卡片（剩余 {remainingCardCount} 张）
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiagnosisPanel;
