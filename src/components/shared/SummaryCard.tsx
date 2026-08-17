import React from 'react';
import { Card } from 'antd';
import { AnimatedNumber } from './AnimatedNumber';
import './summaryCard.css';

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
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  const cardStyle = {
    '--summary-card-accent': color,
    '--summary-card-background': bgGradient,
    '--summary-card-value-color': valueColor || 'var(--text-primary)',
    '--summary-card-border': onClick
      ? `color-mix(in srgb, ${color} 42%, var(--workbench-border))`
      : `color-mix(in srgb, ${color} 24%, var(--workbench-border))`,
  } as React.CSSProperties;

  return (
    <Card
      className="summary-card"
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${title}，查看相关详情` : undefined}
      style={cardStyle}
      styles={{ body: { padding: 0 } }}
    >
      <div className="summary-card__body">
        <div className="summary-card__heading">
          <span className="summary-card-icon">
            {icon}
          </span>
          <span className="summary-card__title">{title}</span>
        </div>
        <div className="summary-card__value">
          {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        </div>
        {suffix && (
          <div className="summary-card__suffix">{suffix}</div>
        )}
      </div>
    </Card>
  );
};
