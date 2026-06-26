import React from 'react';

interface MetricCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  status?: 'default' | 'success' | 'warning' | 'error' | 'info';
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}

const STATUS_COLORS = {
  default: 'var(--text-primary)',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#0ea5e9',
};

const MetricCard: React.FC<MetricCardProps> = ({ label, value, unit, status = 'default', icon, style }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 14px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-color)',
      borderRadius: 10,
      minWidth: 0,
      ...style,
    }}
  >
    {icon && (
      <div style={{ color: STATUS_COLORS[status], fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
        {icon}
      </div>
    )}
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
        <span
          style={{
            color: STATUS_COLORS[status],
            fontSize: 20,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.3,
          }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    </div>
  </div>
);

export default MetricCard;
