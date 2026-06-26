import React from 'react';
import { Empty } from 'antd';

interface EmptyStateProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  style?: React.CSSProperties;
}

const EmptyState: React.FC<EmptyStateProps> = ({ title, description, extra, style }) => (
  <div style={{ padding: '32px 16px', textAlign: 'center', ...style }}>
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div>
          {title && <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{title}</div>}
          {description && (
            <div style={{ marginTop: title ? 6 : 0, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
              {description}
            </div>
          )}
        </div>
      }
    />
    {extra && <div style={{ marginTop: 12 }}>{extra}</div>}
  </div>
);

export default EmptyState;
