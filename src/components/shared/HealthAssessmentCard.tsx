import React from 'react';
import { Card, Tag } from 'antd';

// ============================================================
// 类型定义
// ============================================================

/** 单条健康发现项 */
export interface HealthFinding {
  /** 图标（如 ✅、⚠️、🚨、ℹ️） */
  icon: string;
  /** 发现描述文字 */
  text: string;
  /** 严重程度 */
  severity: 'info' | 'warning' | 'error';
}

/** 健康评估结果 */
export interface HealthAssessment {
  /** 综合状态 */
  status: 'healthy' | 'warning' | 'critical';
  /** 综合评分（0-100） */
  score: number;
  /** 概要描述 */
  summary: string;
  /** 详细发现列表 */
  findings: HealthFinding[];
  /** 排查建议列表 */
  suggestions: string[];
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 根据 status 获取对应的颜色值
 */
function getStatusColor(status: HealthAssessment['status']): string {
  switch (status) {
    case 'healthy': return '#34d399';
    case 'warning': return '#fbbf24';
    case 'critical': return '#f87171';
  }
}

/**
 * 根据 status 获取对应的中文状态文字
 */
function getStatusText(status: HealthAssessment['status']): string {
  switch (status) {
    case 'healthy': return '正常';
    case 'warning': return '需关注';
    case 'critical': return '异常';
  }
}

/**
 * 根据 status 获取对应的背景色（rgba 格式，低透明度）
 */
function getStatusBg(status: HealthAssessment['status']): string {
  switch (status) {
    case 'healthy': return 'rgba(52, 211, 153, 0.08)';
    case 'warning': return 'rgba(251, 191, 36, 0.08)';
    case 'critical': return 'rgba(248, 113, 113, 0.08)';
  }
}

/**
 * 根据 finding 的 severity 获取对应的边框颜色
 */
function getFindingBorderColor(severity: HealthFinding['severity']): string {
  switch (severity) {
    case 'error': return 'rgba(248, 113, 113, 0.2)';
    case 'warning': return 'rgba(251, 191, 36, 0.2)';
    case 'info': return 'rgba(52, 211, 153, 0.15)';
  }
}

// ============================================================
// HealthAssessmentCard 组件
// ============================================================

export interface HealthAssessmentCardProps {
  /** 卡片标题，如 "SSL/TLS 健康评估" 或 "协议健康评估" */
  title: string;
  /** 健康评估结果数据 */
  assessment: HealthAssessment;
}

/**
 * 健康评估卡片组件
 * - 标题行包含标题 + 综合评分数字 + 状态标签
 * - summary 概要文字
 * - findings 列表（带 severity 边框色）
 * - suggestions 列表（蓝色信息框）
 *
 * 用于 SSLTab 和 ProtocolTab 中的健康评估展示
 */
export const HealthAssessmentCard: React.FC<HealthAssessmentCardProps> = ({
  title,
  assessment,
}) => {
  const { status, score, summary, findings, suggestions } = assessment;
  const statusColor = getStatusColor(status);
  const statusText = getStatusText(status);
  const statusBg = getStatusBg(status);

  return (
    <Card
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{title}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>综合评分</span>
            <span style={{
              fontSize: 20,
              fontWeight: 700,
              color: statusColor,
              background: statusBg,
              padding: '2px 12px',
              borderRadius: 12,
            }}>
              {score}
            </span>
            <Tag color={statusColor} style={{ fontWeight: 600 }}>{statusText}</Tag>
          </div>
        </div>
      }
      style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
    >
      {/* 概要描述 */}
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
        {summary}
      </div>

      {/* 发现列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: suggestions.length > 0 ? 16 : 0 }}>
        {findings.map((f, i) => (
          <div
            key={i}
            style={{
              padding: '10px 14px',
              background: 'var(--bg-surface)',
              borderRadius: 8,
              border: `1px solid ${getFindingBorderColor(f.severity)}`,
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
            }}
          >
            {f.text}
          </div>
        ))}
      </div>

      {/* 排查建议 */}
      {suggestions.length > 0 && (
        <div style={{
          padding: '12px 14px',
          background: 'rgba(74, 158, 255, 0.06)',
          borderRadius: 8,
          border: '1px solid rgba(74, 158, 255, 0.15)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#4a9eff', marginBottom: 8 }}>
            🔧 定因排查建议
          </div>
          {suggestions.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginBottom: i < suggestions.length - 1 ? 6 : 0,
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: '#4a9eff', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
