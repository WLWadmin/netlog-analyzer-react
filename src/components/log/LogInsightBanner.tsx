import React from 'react';
import { Tag } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import type { LogInsight } from '../../logParser';

interface LogInsightBannerProps {
  insight: LogInsight;
}

const LogInsightBanner: React.FC<LogInsightBannerProps> = ({ insight }) => {
  const { summary, severity, suggestion, diagnosis } = insight;

  const config = {
    success: {
      icon: <CheckCircleOutlined />,
      color: '#52c41a',
      bgColor: 'rgba(82, 196, 26, 0.06)',
      borderColor: 'rgba(82, 196, 26, 0.2)',
      iconBg: 'rgba(82, 196, 26, 0.12)',
      tagColor: 'success',
    },
    warning: {
      icon: <ExclamationCircleOutlined />,
      color: '#fa8c16',
      bgColor: 'rgba(250, 140, 22, 0.06)',
      borderColor: 'rgba(250, 140, 22, 0.2)',
      iconBg: 'rgba(250, 140, 22, 0.12)',
      tagColor: 'warning',
    },
    error: {
      icon: <CloseCircleOutlined />,
      color: '#ff4d4f',
      bgColor: 'rgba(255, 77, 79, 0.06)',
      borderColor: 'rgba(255, 77, 79, 0.2)',
      iconBg: 'rgba(255, 77, 79, 0.12)',
      tagColor: 'error',
    },
  };

  const style = config[severity];

  const severityLabels: Record<string, string> = {
    success: '正常',
    warning: '警告',
    error: '异常',
  };

  return (
    <div className="log-insight-banner" data-severity={severity}>
      <div className="log-insight-icon" style={{ background: style.iconBg, color: style.color }}>
        {style.icon}
      </div>
      <div className="log-insight-content">
        <div className="log-insight-header">
          <span className="log-insight-summary">{summary}</span>
          <Tag color={style.tagColor as any} className="log-insight-tag">
            {severityLabels[severity]}
          </Tag>
        </div>

        {diagnosis && (
          <div className="log-insight-diagnosis">
            <InfoCircleOutlined style={{ color: style.color, flexShrink: 0 }} />
            <span>诊断：{diagnosis}</span>
          </div>
        )}

        <div className="log-insight-suggestion" style={{ color: style.color }}>
          <InfoCircleOutlined style={{ flexShrink: 0 }} />
          <span>建议：{suggestion}</span>
        </div>
      </div>

      <style>{`
        .log-insight-banner {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          background: ${style.bgColor};
          border: 1px solid ${style.borderColor};
          border-radius: 12px;
          padding: 18px 22px;
          transition: background 0.2s ease;
        }
        .log-insight-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          flex-shrink: 0;
        }
        .log-insight-content {
          flex: 1;
          min-width: 0;
        }
        .log-insight-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .log-insight-summary {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.5;
        }
        .log-insight-tag {
          font-size: 12px !important;
          margin: 0 !important;
          padding: 0 8px !important;
          height: 22px !important;
          line-height: 22px !important;
          border-radius: 6px !important;
        }
        .log-insight-diagnosis {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 8px;
          line-height: 1.7;
          display: flex;
          align-items: flex-start;
          gap: 6px;
        }
        .log-insight-suggestion {
          font-size: 13px;
          font-weight: 500;
          line-height: 1.7;
          display: flex;
          align-items: flex-start;
          gap: 6px;
        }
      `}</style>
    </div>
  );
};

export default LogInsightBanner;
