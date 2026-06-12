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
  /** 主题色 */
  color: string;
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

/**
 * 单张摘要卡片组件
 * - 顶部 3px 彩色条
 * - 渐变背景
 * - 图标 + 标题行
 * - 大号等宽数字
 * - 辅助说明文字
 * - 支持 onClick 和 cursor 样式
 *
 * 用于 SummaryCards 和 HarSummaryCards 中的单张卡片展示
 */
export const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  value,
  suffix,
  color,
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
        borderRadius: 12,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
      }}
      styles={{ body: { padding: 0 } }}
      hoverable
    >
      {/* 顶部彩色条 */}
      <div
        style={{
          height: 3,
          background: color,
          opacity: 0.7,
        }}
      />
      <div style={{ padding: '16px 14px', position: 'relative' }}>
        {/* 渐变背景 */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: bgGradient,
            opacity: 0.5,
            pointerEvents: 'none',
          }}
        />
        {/* 图标 + 标题行 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <span
            style={{
              color: color,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {icon}
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {title}
          </span>
        </div>
        {/* 大号等宽数字 */}
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: color,
            lineHeight: 1.2,
            position: 'relative',
            zIndex: 1,
            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          }}
        >
          {value}
        </div>
        {/* 辅助说明文字 */}
        {suffix && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginTop: 6,
              position: 'relative',
              zIndex: 1,
            }}
          >
            {suffix}
          </div>
        )}
      </div>
    </Card>
  );
};
