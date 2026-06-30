import React from 'react';
import { Card } from 'antd';
import { AnimatedNumber } from './AnimatedNumber';

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
        background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.86))',
        border: `1px solid ${onClick ? `${color}55` : 'rgba(148,163,184,0.24)'}`,
        borderRadius: 18,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
        boxShadow: '0 14px 34px rgba(15,23,42,0.06)',
      }}
      styles={{ body: { padding: 0 } }}
      hoverable
    >
      <div style={{ padding: '16px 16px 15px', position: 'relative', minHeight: 126 }}>
        {/* 渐变背景 */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: bgGradient,
            opacity: 0.62,
            pointerEvents: 'none',
            borderRadius: 18,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 80% 10%, rgba(255,255,255,0.72), transparent 32%)',
            pointerEvents: 'none',
          }}
        />
        {/* 图标 + 标题行 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${color}22, rgba(255,255,255,0.74))`,
              border: `1px solid ${color}35`,
              color,
              fontSize: 15,
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
              fontSize: 11,
              color: 'var(--text-secondary)',
              fontWeight: 700,
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
            fontSize: 30,
            fontWeight: 850,
            color: valueColor || 'var(--text-primary)',
            lineHeight: 1.2,
            position: 'relative',
            zIndex: 1,
            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            letterSpacing: -0.8,
          }}
        >
          {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        </div>
        {/* 辅助说明 */}
        {suffix && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginTop: 8,
              position: 'relative',
              zIndex: 1,
              lineHeight: 1.45,
              fontWeight: 500,
            }}
          >
            {suffix}
          </div>
        )}
      </div>
    </Card>
  );
};
