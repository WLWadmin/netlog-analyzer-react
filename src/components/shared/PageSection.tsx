import React from 'react';

interface PageSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const PageSection: React.FC<PageSectionProps> = ({ title, description, extra, children, style }) => (
  <section
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minWidth: 0,
      ...style,
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.5 }}>
          {title}
        </div>
        {description && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {description}
          </div>
        )}
      </div>
      {extra && <div style={{ flexShrink: 0 }}>{extra}</div>}
    </div>
    <div style={{ minWidth: 0 }}>{children}</div>
  </section>
);

export default PageSection;
