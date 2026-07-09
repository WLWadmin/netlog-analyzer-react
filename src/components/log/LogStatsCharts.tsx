import React from 'react';
import { Alert, Card, Tag, Progress } from 'antd';
import {
  PieChartOutlined,
  GlobalOutlined,
  ClockCircleOutlined,
  BarsOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import type { LogStats } from '../../logParser';

interface LogStatsChartsProps {
  stats: LogStats;
}

const LogStatsCharts: React.FC<LogStatsChartsProps> = ({ stats }) => {
  const errorColors = ['#ff4d4f', '#fa8c16', '#fadb14', '#52c41a', '#1890ff', '#722ed1'];
  const domainColors = ['#1890ff', '#52c41a', '#fa8c16', '#ff4d4f', '#722ed1', '#13c2c2'];

  return (
    <div className="log-stats-charts">
      <Alert
        className="log-stats-note"
        type="info"
        showIcon
        message="日志统计用于辅助阅读"
        description="这些图表帮助快速找到 logid / request id、URL、状态码、耗时和错误关键词分布，不直接生成服务端根因结论。"
      />
      {/* 错误类型分布 */}
      <Card
        title={
          <span className="log-chart-title">
            <PieChartOutlined style={{ color: '#ff4d4f' }} />
            错误类型分布
          </span>
        }
        className="log-chart-card"
      >
        {stats.errorTypes.length === 0 ? (
          <div className="log-chart-empty">
            <InboxOutlined style={{ fontSize: 32, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }} />
            暂无错误记录，一切正常
          </div>
        ) : (
          <div className="log-chart-list">
            {stats.errorTypes.map((type, index) => (
              <div key={type.code} className="log-chart-item">
                <div className="log-chart-item-header">
                  <Tag color={errorColors[index % errorColors.length]} className="log-chart-tag">
                    {type.code === 'Unknown' ? '未知错误' : isNaN(Number(type.code)) ? type.code : `HTTP ${type.code}`}
                  </Tag>
                  <span className="log-chart-count">{type.count} 次 ({type.percentage}%)</span>
                </div>
                <Progress
                  percent={type.percentage}
                  strokeColor={{ '0%': errorColors[index % errorColors.length], '100%': errorColors[index % errorColors.length] + 'cc' }}
                  railColor="var(--bg-base)"
                  showInfo={false}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 域名分布 */}
      <Card
        title={
          <span className="log-chart-title">
            <GlobalOutlined style={{ color: '#1890ff' }} />
            域名分布
          </span>
        }
        className="log-chart-card"
      >
        <div className="log-chart-list">
          {stats.domainDistribution.map((domain, index) => {
            const total = stats.total;
            const percentage = total > 0 ? Math.round((domain.count / total) * 100) : 0;
            return (
              <div key={domain.domain} className="log-chart-item">
                <div className="log-chart-item-header">
                  <span className="log-chart-domain-name">{domain.domain}</span>
                  <span className="log-chart-count">{domain.count} 次 ({percentage}%)</span>
                </div>
                <div className="log-chart-item-bar">
                  <Progress
                    percent={percentage}
                    strokeColor={{ '0%': domainColors[index % domainColors.length], '100%': domainColors[index % domainColors.length] + 'cc' }}
                    railColor="var(--bg-base)"
                    showInfo={false}
                    style={{ flex: 1 }}
                  />
                  <div className="log-chart-domain-badges">
                    {domain.success > 0 && (
                      <Tag color="success" className="log-chart-badge">✓ {domain.success}</Tag>
                    )}
                    {domain.error > 0 && (
                      <Tag color="error" className="log-chart-badge">✗ {domain.error}</Tag>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 耗时分布 */}
      <Card
        title={
          <span className="log-chart-title">
            <ClockCircleOutlined style={{ color: '#fa8c16' }} />
            耗时分布
          </span>
        }
        className="log-chart-card"
      >
        <div className="log-chart-list">
          {stats.durationDistribution.map((range) => {
            const total = stats.total;
            const percentage = total > 0 ? Math.round((range.count / total) * 100) : 0;
            return (
              <div key={range.range} className="log-chart-item">
                <div className="log-chart-item-header">
                  <span className="log-chart-range-label">{range.range}</span>
                  <span className="log-chart-count">{range.count} 次 ({percentage}%)</span>
                </div>
                <Progress
                  percent={percentage}
                  strokeColor={{ '0%': '#fa8c16', '100%': '#fa8c16cc' }}
                  railColor="var(--bg-base)"
                  showInfo={false}
                />
              </div>
            );
          })}
        </div>
      </Card>

      {/* 日志级别分布 */}
      <Card
        title={
          <span className="log-chart-title">
            <BarsOutlined style={{ color: '#722ed1' }} />
            日志级别分布
          </span>
        }
        className="log-chart-card"
      >
        <div className="log-chart-list">
          {stats.levelDistribution.map((level) => {
            const total = stats.total;
            const percentage = total > 0 ? Math.round((level.count / total) * 100) : 0;
            return (
              <div key={level.level} className="log-chart-item">
                <div className="log-chart-item-header">
                  <Tag
                    color={level.level === 'Info' ? 'blue' : level.level === 'Warn' ? 'orange' : level.level === 'Error' ? 'red' : 'green'}
                    className="log-chart-tag"
                  >
                    {level.level}
                  </Tag>
                  <span className="log-chart-count">{level.count} 次 ({percentage}%)</span>
                </div>
                <Progress
                  percent={percentage}
                  strokeColor={{ '0%': level.color, '100%': level.color + 'cc' }}
                  railColor="var(--bg-base)"
                  showInfo={false}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <style>{`
        .log-stats-charts {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
        }
        .log-stats-note {
          grid-column: 1 / -1;
        }
        .log-chart-card {
          background: var(--bg-surface) !important;
          border: 1px solid var(--border-color) !important;
          border-radius: 14px !important;
          transition: box-shadow 0.2s ease !important;
        }
        .log-chart-card:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.04) !important;
        }
        .log-chart-card .ant-card-head {
          border-bottom: 1px solid var(--border-color) !important;
          min-height: 44px !important;
          padding: 0 18px !important;
        }
        .log-chart-card .ant-card-body {
          padding: 14px 18px !important;
        }
        .log-chart-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .log-chart-empty {
          text-align: center;
          padding: 24px 0;
          color: var(--text-muted);
          font-size: 13px;
        }
        .log-chart-list .ant-progress-bg {
          border-radius: 6px !important;
        }
        .log-chart-list .ant-progress-inner {
          border-radius: 6px !important;
        }
        .log-chart-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .log-chart-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        .log-chart-tag {
          font-size: 12px !important;
          margin: 0 !important;
          border-radius: 6px !important;
        }
        .log-chart-count {
          font-size: 12px;
          color: var(--text-muted);
        }
        .log-chart-domain-name {
          font-size: 13px;
          color: var(--text-primary);
          font-weight: 500;
        }
        .log-chart-item-bar {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .log-chart-domain-badges {
          display: flex;
          gap: 4px;
          flex-shrink: 0;
        }
        .log-chart-badge {
          font-size: 10px !important;
          margin: 0 !important;
          padding: 0 5px !important;
          height: 18px !important;
          line-height: 18px !important;
          border-radius: 4px !important;
        }
        .log-chart-range-label {
          font-size: 13px;
          color: var(--text-primary);
        }
        @media (max-width: 1280px) {
          .log-stats-charts {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 768px) {
          .log-stats-charts {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default LogStatsCharts;
