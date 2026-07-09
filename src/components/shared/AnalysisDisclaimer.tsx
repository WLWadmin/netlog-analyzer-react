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
  netlog: 'NetLog 是浏览器网络栈证据，可辅助判断 DNS、代理、连接、TLS、协议和请求失败线索。结论仍需结合复现环境、链路测试和人工确认。',
  har: 'HAR 主要说明请求现象、状态码、Headers 和 Timing，不能单独证明 DNS、TCP、TLS 或代理根因；需要同次 NetLog 或链路测试进一步验证。',
  log: 'Log 页面用于服务端关联字段提取和日志可阅读化，不基于日志文件单独判断浏览器网络根因。请结合 logid、request id、服务端状态和浏览器侧证据综合分析。',
};

export const AnalysisDisclaimer: React.FC<AnalysisDisclaimerProps> = ({
  title = '分析边界',
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
        borderRadius: 10,
        marginBottom: 16,
      }}
    />
  );
};

export default AnalysisDisclaimer;
