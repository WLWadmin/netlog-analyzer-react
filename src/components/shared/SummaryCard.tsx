import React from 'react';
import { Card } from 'antd';

// ============================================================
// 类型定义
// ============================================================

export interface SummaryCardProps {
  /** 卡片标题 */
  title: string;
  /** 主要数值，支持任意 React 节点 */
  value: React.ReactNode;
  /** 辅助说明文字 */
  suffix?: string;
  /** 图标容器色（语义色，始终保留） */
  color: string;
  /** 数值色：undefined=中性(text-primary), 语义色=强调 */
  valueColor?: string;
  /** 图标 */
  icon: React.ReactNode;
  /** 渐变背景 */
  bgGradient: string;
  /** 点击回调（传入时卡片显示 pointer 光标和彩色边框） */
  onClick?: () => void;
}

// ============================================================
// SummaryCard 组件
// ============================================================

export const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  value,
  suffix,
  color,
  valueColor,
  icon,
  bgGradient,
  onClick,
}) => {
  return (
    <Card
      onClick={onClick}
      style={{
        background: 'var(--bg-elevated)',
        border: onClick ? `1px solid ${color}` : '1px solid var(--border-color)',
        borderRadius: 14,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
      }}
      styles={{ body: { padding: 0 } }}
      hoverable
    >
      <div style={{ padding: '18px 16px', position: 'relative' }}>
        {/* 渐变背景 */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: bgGradient,
            opacity: 0.45,
            pointerEvents: 'none',
            borderRadius: 14,
          }}
        />
        {/* 图标 + 标题行 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `${color}18`,
              border: `1px solid ${color}25`,
              color,
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'transform 0.2s ease',
            }}
          >
            {icon}
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              lineHeight: 1.3,
            }}
          >
            {title}
          </span>
        </div>
        {/* 数值 — 双色调 */}
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: valueColor || 'var(--text-primary)',
            lineHeight: 1.2,
            position: 'relative',
            zIndex: 1,
            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            letterSpacing: -0.5,
          }}
        >
          {value}
        </div>
        {/* 辅助说明 */}
        {suffix && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginTop: 8,
              position: 'relative',
              zIndex: 1,
              lineHeight: 1.4,
            }}
          >
            {suffix}
          </div>
        )}
      </div>
    </Card>
  );
};
