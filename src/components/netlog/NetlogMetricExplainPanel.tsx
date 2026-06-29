import React, { useMemo } from 'react';
import { Card, Tag, Typography } from 'antd';
import type { AnalysisResult } from '../../parsers/netlog/parser';

interface NetlogMetricExplainPanelProps {
  result: AnalysisResult;
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const MetricExplainItem: React.FC<{ title: string; value: string; detail: string; tone?: 'info' | 'warning' | 'danger' | 'success' }> = ({
  title,
  value,
  detail,
  tone = 'info',
}) => {
  const color = tone === 'danger' ? '#dc2626' : tone === 'warning' ? '#d97706' : tone === 'success' ? '#059669' : '#0284c7';
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: 16,
        borderRadius: 18,
        border: '1px solid rgba(148,163,184,0.22)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,250,252,0.86))',
        minHeight: 138,
        boxShadow: '0 14px 32px rgba(15,23,42,0.05)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -28,
          top: -28,
          width: 92,
          height: 92,
          borderRadius: '50%',
          background: `${color}14`,
        }}
      />
      <Typography.Text type="secondary" style={{ position: 'relative', fontSize: 12, fontWeight: 700, letterSpacing: 0.2 }}>{title}</Typography.Text>
      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <Tag style={{ position: 'relative', margin: 0, border: 'none', borderRadius: 999, color, background: `${color}14`, fontWeight: 850, fontSize: 13, padding: '3px 10px' }}>
          {value}
        </Tag>
      </div>
      <Typography.Text style={{ position: 'relative', fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
        {detail}
      </Typography.Text>
    </div>
  );
};

const NetlogMetricExplainPanel: React.FC<NetlogMetricExplainPanelProps> = ({ result }) => {
  const metrics = useMemo(() => {
    const failedRequests = result.urlRequests.filter(req => req.error || (req.statusCode && req.statusCode >= 400));
    const slowRequests = result.slowRequests.length > 0
      ? result.slowRequests
      : result.urlRequests.filter(req => (req.duration || 0) >= 1000);
    const failedHosts = new Set(failedRequests.map(req => hostFromUrl(req.url)));
    const successDurations = result.urlRequests
      .filter(req => !req.error && (!req.statusCode || req.statusCode < 400) && req.duration)
      .map(req => req.duration || 0);
    const failedDurations = failedRequests.filter(req => req.duration).map(req => req.duration || 0);

    return {
      failedRequests,
      slowRequests,
      failedHosts,
      successP90: percentile(successDurations, 0.9),
      failedP90: percentile(failedDurations, 0.9),
    };
  }, [result]);

  const hasProxy = result.proxyInfo.hasProxy || result.proxyInfo.isVPN;

  return (
    <Card
      title={<span style={{ fontWeight: 850 }}>核心指标解释</span>}
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.82))',
        borderColor: 'rgba(148,163,184,0.24)',
        borderRadius: 22,
        boxShadow: '0 18px 44px rgba(15,23,42,0.06)',
      }}
      styles={{ body: { padding: 18 } }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <MetricExplainItem
          title="请求情况"
          value={`${result.urlRequests.length} 个请求`}
          detail={`失败 ${metrics.failedRequests.length} 个，慢请求 ${metrics.slowRequests.length} 个。优先查看失败和慢请求。`}
          tone={metrics.failedRequests.length > 0 ? 'danger' : metrics.slowRequests.length > 0 ? 'warning' : 'success'}
        />
        <MetricExplainItem
          title="代理 / VPN"
          value={hasProxy ? '检测到' : '未识别'}
          detail={hasProxy
            ? `代理模式：${result.proxyInfo.proxyType || '未知'}。建议先做代理/直连对比。`
            : '未识别到明显代理配置。'}
          tone={hasProxy ? 'warning' : 'success'}
        />
        <MetricExplainItem
          title="错误集中度"
          value={`${metrics.failedHosts.size} 个域名`}
          detail={metrics.failedHosts.size > 0 ? '错误域名越集中，越适合优先排查该域名的 DNS、代理、连接和服务端状态。' : '未发现明显失败域名。'}
          tone={metrics.failedHosts.size > 0 ? 'warning' : 'success'}
        />
        <MetricExplainItem
          title="耗时差异"
          value={metrics.failedP90 ? `失败 P90 ${Math.round(metrics.failedP90)}ms` : '暂无失败耗时'}
          detail={metrics.successP90 ? `成功请求 P90 约 ${Math.round(metrics.successP90)}ms，用于对比失败/慢请求是否明显偏高。` : '成功请求样本不足，暂不能对比耗时基线。'}
          tone={metrics.failedP90 ? 'warning' : 'info'}
        />
        <MetricExplainItem
          title="峰值并发"
          value={`${result.peakConcurrency}`}
          detail="并发高时可能出现浏览器排队或资源竞争；需要结合请求瀑布确认。"
          tone={result.peakConcurrency > 12 ? 'warning' : 'info'}
        />
      </div>
    </Card>
  );
};

export default NetlogMetricExplainPanel;
