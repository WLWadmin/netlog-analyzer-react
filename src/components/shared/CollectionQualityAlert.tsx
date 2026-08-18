import React from 'react';
import { Alert, Tag } from 'antd';
import {
  WarningOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { CollectionQuality } from '../../diagnosis/shared/types';

interface CollectionQualityAlertProps {
  quality: CollectionQuality;
}

const CollectionQualityAlert: React.FC<CollectionQualityAlertProps> = ({ quality }) => {
  const hasWarnings = quality.issues.some(i => i.severity === 'warning');
  const hasInfo = quality.issues.some(i => i.severity === 'info');

  if (!hasWarnings && !hasInfo) {
    return (
      <Alert
        message="采集质量良好"
        description="当前文件数据完整，诊断结果可信度高。"
        type="success"
        showIcon
        icon={<CheckCircleOutlined />}
        style={{ marginBottom: 16, borderRadius: 8 }}
      />
    );
  }

  const warningCount = quality.issues.filter(i => i.severity === 'warning').length;
  const infoCount = quality.issues.filter(i => i.severity === 'info').length;

  return (
    <Alert
      message={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>
            {hasWarnings
              ? '采集质量存在警告，诊断结果可能不完整'
              : '采集质量提示，部分诊断可能受限'}
          </span>
          {warningCount > 0 && (
            <Tag color="warning" style={{ fontSize: 11 }}>
              {warningCount} 个警告
            </Tag>
          )}
          {infoCount > 0 && (
            <Tag color="default" style={{ fontSize: 11 }}>
              {infoCount} 个提示
            </Tag>
          )}
        </div>
      }
      description={
        <div style={{ marginTop: 8 }}>
          {quality.issues.map((issue, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              {issue.severity === 'warning' ? (
                <WarningOutlined style={{ color: '#f59e0b', marginTop: 2, flexShrink: 0 }} />
              ) : (
                <InfoCircleOutlined style={{ color: '#3b82f6', marginTop: 2, flexShrink: 0 }} />
              )}
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>{issue.message}</strong>
                {issue.detail && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                    {issue.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
          {quality.recommendations && quality.recommendations.length > 0 && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(59, 130, 246, 0.06)', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                <FileTextOutlined style={{ marginRight: 4 }} />
                建议
              </div>
              {quality.recommendations.map((rec, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  • {rec}
                </div>
              ))}
            </div>
          )}
          {quality.missingFields && quality.missingFields.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              <ExclamationCircleOutlined style={{ marginRight: 4 }} />
              缺失字段：{quality.missingFields.join('、')}
            </div>
          )}
        </div>
      }
      type={hasWarnings ? 'warning' : 'info'}
      showIcon
      style={{ marginBottom: 16, borderRadius: 8 }}
    />
  );
};

export default CollectionQualityAlert;
