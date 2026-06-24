import React from 'react';
import { Empty, Spin } from 'antd';
import type { DiagnosisSummary } from '../../diagnosis/shared/types';
import DiagnosticCard from './DiagnosticCard';
import CollectionQualityAlert from './CollectionQualityAlert';

interface DiagnosisPanelProps {
  summary?: DiagnosisSummary;
  loading?: boolean;
}

const DiagnosisPanel: React.FC<DiagnosisPanelProps> = ({ summary, loading }) => {
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin size="large" tip="正在分析诊断..." />
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

  return (
    <div style={{ padding: '16px 0' }}>
      {/* 采集质量提示 */}
      <CollectionQualityAlert quality={summary.quality} />

      {/* 诊断概览 */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
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
            style={{
              padding: '8px 16px',
              background: 'rgba(16, 185, 129, 0.08)',
              borderRadius: 8,
              border: '1px solid rgba(16, 185, 129, 0.2)',
            }}
          >
            <span style={{ color: '#10b981', fontWeight: 700, fontSize: 18 }}>{summary.healthScore}</span>
            <span style={{ color: '#10b981', fontSize: 13, marginLeft: 4 }}>健康分</span>
          </div>
        )}
      </div>

      {/* 诊断卡片列表 */}
      <div>
        {summary.cards.map((card, index) => (
          <DiagnosticCard key={card.id} card={card} index={index} />
        ))}
      </div>
    </div>
  );
};

export default DiagnosisPanel;
