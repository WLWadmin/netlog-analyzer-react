import React from 'react';
import { Card, Progress, Tag } from 'antd';
import { CheckCircleOutlined, FieldTimeOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { DiagnosisCoverage } from '../../diagnosis/shared';

interface DiagnosisCoveragePanelProps {
  coverage?: DiagnosisCoverage;
  onOpenUnexplained?: (requestIds: number[], sourceIds: number[]) => void;
}

const metricStyle: React.CSSProperties = {
  border: '1px solid rgba(148,163,184,0.22)',
  borderRadius: 14,
  padding: 12,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(248,250,252,0.62))',
};

const DiagnosisCoveragePanel: React.FC<DiagnosisCoveragePanelProps> = ({ coverage: data, onOpenUnexplained }) => {
  if (!data) return null;
  const percent = Math.round(data.coverageRate * 100);
  const canOpenUnexplained = data.unexplainedRequestIds.length > 0 || data.unexplainedSourceIds.length > 0;

  return (
    <Card
      size="small"
      title={<span style={{ fontWeight: 850 }}>覆盖率</span>}
      style={{ borderRadius: 16, borderColor: 'rgba(148,163,184,0.22)', background: 'rgba(255,255,255,0.72)' }}
      styles={{ body: { padding: 14 } }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 0.8fr) minmax(0, 1.2fr)', gap: 14, alignItems: 'center' }}>
        <Progress
          type="circle"
          percent={percent}
          size={92}
          strokeColor={percent >= 80 ? '#16a34a' : percent >= 50 ? '#f59e0b' : '#ef4444'}
          format={() => `${percent}%`}
        />
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={metricStyle}>
            <CheckCircleOutlined style={{ color: '#16a34a', marginRight: 6 }} />
            已解释：<strong>{data.explained}</strong>
          </div>
          <div style={metricStyle}>
            <FieldTimeOutlined style={{ color: '#f59e0b', marginRight: 6 }} />
            部分解释：<strong>{data.partiallyExplained}</strong>
          </div>
          <button
            type="button"
            disabled={!canOpenUnexplained || !onOpenUnexplained}
            onClick={() => onOpenUnexplained?.(data.unexplainedRequestIds, data.unexplainedSourceIds)}
            style={{
              ...metricStyle,
              textAlign: 'left',
              cursor: canOpenUnexplained && onOpenUnexplained ? 'pointer' : 'default',
              color: 'inherit',
            }}
          >
            <QuestionCircleOutlined style={{ color: '#64748b', marginRight: 6 }} />
            未解释：<strong>{data.unexplained}</strong>
          </button>
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {data.denominatorMayBeIncomplete && <Tag color="orange">分母可能不完整</Tag>}
        {data.reasons.slice(0, 2).map(item => <Tag key={item.reason}>{item.reason}</Tag>)}
        {data.totalAbnormalObjects === 0 && <Tag color="green">当前采集未发现明确问题</Tag>}
      </div>
    </Card>
  );
};

export default DiagnosisCoveragePanel;
