import React from 'react';

interface ToolbarProps {
  children: React.ReactNode;
  extra?: React.ReactNode;
  style?: React.CSSProperties;
}

const Toolbar: React.FC<ToolbarProps> = ({ children, extra, style }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
      minWidth: 0,
      ...style,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
      {children}
    </div>
    {extra && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        {extra}
      </div>
    )}
  </div>
);

export default Toolbar;
