import React from 'react';
import { Alert } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { CHART_COLORS } from '../../constants/chartColors';

interface AnalysisDisclaimerProps {
  /** 自定义标题，默认"郑重说明" */
  title?: string;
  /** 自定义说明内容 */
  description?: string;
  /** 变体样式：'netlog' | 'har' | 'log' */
  variant?: 'netlog' | 'har' | 'log';
}

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  netlog: '本工具解析内容仅供参考，具体原因需人工二次确认或自行尝试「定因诊断」中的建议操作。分析结果可能因日志版本、浏览器差异等因素存在偏差，请结合实际情况综合判断。',
  har: '数据来自浏览器 DevTools → Network 导出的 .har 文件，解析结果仅供参考。Size 优先取传输大小（_transferSize），关键字段依赖响应头是否存在，请结合实际链路综合判断。',
  log: '本工具解析内容仅供参考，具体原因需人工二次确认或自行尝试建议操作。分析结果可能因日志版本、格式差异等因素存在偏差，请结合实际情况综合判断。',
};

export const AnalysisDisclaimer: React.FC<AnalysisDisclaimerProps> = ({
  title = '郑重说明',
  description,
  variant = 'netlog',
}) => {
  const desc = description || DEFAULT_DESCRIPTIONS[variant];

  return (
    <Alert
      message={
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
          <WarningOutlined style={{ marginRight: 6, color: CHART_COLORS.semantic.warning }} />
          {title}
        </span>
      }
      description={
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {desc}
        </span>
      }
      type="warning"
      showIcon={false}
      style={{
        background: 'rgba(251, 191, 36, 0.06)',
        border: '1px solid rgba(251, 191, 36, 0.2)',
        borderRadius: 12,
        marginBottom: 16,
      }}
    />
  );
};

export default AnalysisDisclaimer;
