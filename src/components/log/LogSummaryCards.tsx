import React from 'react';
import {
  GlobalOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PercentageOutlined,
} from '@ant-design/icons';
import type { LogStats } from '../../logParser';

interface LogSummaryCardsProps {
  stats: LogStats;
  onFilterError?: () => void;
}

const LogSummaryCards: React.FC<LogSummaryCardsProps> = ({ stats, onFilterError }) => {
  const getSuccessRateColor = (rate: number) => {
    if (rate >= 95) return '#52c41a';
    if (rate >= 80) return '#fa8c16';
    return '#ff4d4f';
  };

  const successRateColor = getSuccessRateColor(stats.successRate);

  const cards = [
    {
      title: '总请求数',
      value: stats.total,
      icon: <GlobalOutlined />,
      color: '#1890ff',
      bgColor: 'rgba(24, 144, 255, 0.06)',
      borderColor: 'rgba(24, 144, 255, 0.15)',
      hoverBorder: 'rgba(24, 144, 255, 0.35)',
    },
    {
      title: '成功',
      value: stats.success,
      icon: <CheckCircleOutlined />,
      color: '#52c41a',
      bgColor: 'rgba(82, 196, 26, 0.06)',
      borderColor: 'rgba(82, 196, 26, 0.15)',
      hoverBorder: 'rgba(82, 196, 26, 0.35)',
    },
    {
      title: '失败',
      value: stats.error,
      icon: <CloseCircleOutlined />,
      color: '#ff4d4f',
      bgColor: 'rgba(255, 77, 79, 0.06)',
      borderColor: 'rgba(255, 77, 79, 0.15)',
      hoverBorder: 'rgba(255, 77, 79, 0.35)',
      clickable: true,
    },
    {
      title: '成功率',
      value: `${stats.successRate}%`,
      icon: <PercentageOutlined />,
      color: successRateColor,
      bgColor: `${successRateColor}0f`,
      borderColor: `${successRateColor}26`,
      hoverBorder: `${successRateColor}59`,
    },
  ];

  return (
    <div className="log-summary-cards">
      {cards.map((card) => (
        <div
          key={card.title}
          className={`log-summary-card${card.clickable ? ' log-summary-card--clickable' : ''}`}
          style={{
            '--card-color': card.color,
            '--card-bg': card.bgColor,
            '--card-border': card.borderColor,
            '--card-hover-border': card.hoverBorder,
            '--card-value-color': card.color,
          } as React.CSSProperties}
          onClick={() => {
            if (card.clickable && onFilterError) {
              onFilterError();
            }
          }}
        >
          <div className="log-summary-card-icon">
            {card.icon}
          </div>
          <div className="log-summary-card-info">
            <div className="log-summary-card-title">{card.title}</div>
            <div className="log-summary-card-value">{card.value}</div>
          </div>
        </div>
      ))}

      <style>{`
        .log-summary-cards {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
        }
        .log-summary-card {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 18px 20px;
          background: var(--bg-surface);
          border: 1px solid var(--card-border);
          border-radius: 14px;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: default;
        }
        .log-summary-card:hover {
          border-color: var(--card-hover-border);
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        .log-summary-card--clickable {
          cursor: pointer;
        }
        .log-summary-card--clickable:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0,0,0,0.08);
        }
        .log-summary-card--clickable:active {
          transform: translateY(0);
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }
        .log-summary-card-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          background: var(--card-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          color: var(--card-color);
          flex-shrink: 0;
          transition: transform 0.2s ease;
        }
        .log-summary-card--clickable:hover .log-summary-card-icon {
          transform: scale(1.05);
        }
        .log-summary-card-info {
          min-width: 0;
        }
        .log-summary-card-title {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 4px;
          line-height: 1.3;
        }
        .log-summary-card-value {
          font-size: 26px;
          font-weight: 700;
          color: var(--card-value-color);
          line-height: 1.2;
          font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
          letter-spacing: -0.5px;
        }
        @media (max-width: 768px) {
          .log-summary-cards {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </div>
  );
};

export default LogSummaryCards;
