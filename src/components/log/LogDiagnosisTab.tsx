import React, { useMemo } from 'react';
import { Card, Tag, Badge, Collapse } from 'antd';
import {
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { LogAnalysisResult, LogEntry } from '../../logParser';
import { getErrorDiagnosis } from '../../logConstants';
import { CHART_COLORS } from '../../constants/chartColors';

interface LogDiagnosisTabProps {
  result: LogAnalysisResult;
}

interface DiagnosisItem {
  category: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  entries: LogEntry[];
  suggestion: string;
}

function generateDiagnosis(result: LogAnalysisResult): DiagnosisItem[] {
  const { entries, stats } = result;
  const items: DiagnosisItem[] = [];

  // 1. 总体状态评估
  if (stats.successRate < 80) {
    items.push({
      category: '总体状态',
      severity: 'error',
      title: `成功率过低（${stats.successRate}%）`,
      description: `共 ${stats.total} 个请求，失败 ${stats.error} 个，成功率仅 ${stats.successRate}%`,
      entries: entries.filter(e => e.status === 'Error'),
      suggestion: '建议优先排查高频失败接口，检查服务端可用性和网络连通性',
    });
  } else if (stats.successRate < 95) {
    items.push({
      category: '总体状态',
      severity: 'warning',
      title: `成功率需关注（${stats.successRate}%）`,
      description: `共 ${stats.total} 个请求，失败 ${stats.error} 个`,
      entries: entries.filter(e => e.status === 'Error'),
      suggestion: '建议关注失败请求的分布特征，是否存在特定接口或时段的集中失败',
    });
  }

  // 2. 按错误码聚类
  const errorByCode = new Map<number, LogEntry[]>();
  for (const e of entries) {
    if (e.status === 'Error' && e.statusCode !== undefined) {
      const list = errorByCode.get(e.statusCode) || [];
      list.push(e);
      errorByCode.set(e.statusCode, list);
    }
  }
  for (const [code, list] of errorByCode.entries()) {
    if (list.length >= 3) {
      const diagnosis = getErrorDiagnosis(code, list[0].domain);
      items.push({
        category: '错误聚类',
        severity: code >= 500 ? 'error' : 'warning',
        title: `HTTP ${code} 错误集中出现（${list.length} 次）`,
        description: diagnosis?.description || `状态码 ${code} 出现 ${list.length} 次`,
        entries: list.slice(0, 10),
        suggestion: diagnosis?.suggestion || '建议检查该状态码对应的服务端逻辑或客户端请求参数',
      });
    }
  }

  // 3. 按域名聚类失败
  const errorByDomain = new Map<string, LogEntry[]>();
  for (const e of entries) {
    if (e.status === 'Error') {
      const list = errorByDomain.get(e.domain) || [];
      list.push(e);
      errorByDomain.set(e.domain, list);
    }
  }
  for (const [domain, list] of errorByDomain.entries()) {
    if (list.length >= 5) {
      const codes = [...new Set(list.map(e => e.statusCode).filter(Boolean))].join('、') || '未知';
      items.push({
        category: '域名异常',
        severity: 'error',
        title: `${domain} 失败请求集中（${list.length} 次）`,
        description: `涉及状态码：${codes}`,
        entries: list.slice(0, 10),
        suggestion: '建议检查该域名的服务端健康状态、DNS 解析和网络连通性',
      });
    }
  }

  // 4. 慢请求检测（> 3s）
  const slowEntries = entries.filter(e => e.duration > 3000);
  if (slowEntries.length > 0) {
    items.push({
      category: '性能异常',
      severity: 'warning',
      title: `慢请求检测（${slowEntries.length} 个 > 3s）`,
      description: `最慢请求耗时 ${Math.max(...slowEntries.map(e => e.duration))}ms`,
      entries: slowEntries.slice(0, 10),
      suggestion: '建议优化接口响应时间，检查数据库查询、外部依赖调用和缓存策略',
    });
  }

  // 5. 无错误时给出正面结论
  if (items.length === 0) {
    items.push({
      category: '总体状态',
      severity: 'info',
      title: '日志分析正常',
      description: `共 ${stats.total} 个请求，全部成功，无异常错误和慢请求`,
      entries: [],
      suggestion: '当前日志未发现问题，建议持续监控',
    });
  }

  return items;
}

const severityConfig = {
  error: { color: CHART_COLORS.semantic.error, icon: <CloseCircleOutlined />, label: '异常' },
  warning: { color: CHART_COLORS.semantic.warning, icon: <WarningOutlined />, label: '警告' },
  info: { color: CHART_COLORS.semantic.info, icon: <InfoCircleOutlined />, label: '正常' },
};

const LogDiagnosisTab: React.FC<LogDiagnosisTabProps> = ({ result }) => {
  const diagnoses = useMemo(() => generateDiagnosis(result), [result]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {diagnoses.map((diag, i) => {
        const cfg = severityConfig[diag.severity];
        return (
          <Card
            key={i}
            style={{
              background: 'var(--bg-elevated)',
              borderColor: `${cfg.color}30`,
              borderLeft: `3px solid ${cfg.color}`,
            }}
            bodyStyle={{ padding: '14px 18px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ color: cfg.color, fontSize: 16 }}>{cfg.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                {diag.title}
              </span>
              <Tag color={cfg.color} style={{ fontSize: 11 }}>{cfg.label}</Tag>
              <Tag style={{ fontSize: 11, background: 'var(--bg-surface)', border: 'none', color: 'var(--text-muted)' }}>
                {diag.category}
              </Tag>
            </div>

            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
              {diag.description}
            </div>

            {diag.entries.length > 0 && (
              <Collapse
                ghost
                bordered={false}
                style={{ background: 'transparent' }}
              >
                <Collapse.Panel
                  header={
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      查看相关请求（{diag.entries.length} 条）
                    </span>
                  }
                  key={`diag-${i}`}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {diag.entries.map((e, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 10px',
                          background: 'var(--bg-surface)',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <Badge color={e.status === 'Error' ? '#ff4d4f' : '#52c41a'} />
                        <Tag style={{ fontSize: 11, margin: 0 }}>{e.method}</Tag>
                        <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.friendlyName || e.url}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {e.statusCode}
                        </span>
                        <span style={{ color: e.duration > 3000 ? '#fa8c16' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {e.duration}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </Collapse.Panel>
              </Collapse>
            )}

            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                background: 'rgba(74, 158, 255, 0.05)',
                borderRadius: 8,
                border: '1px solid rgba(74, 158, 255, 0.12)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 12,
                color: '#4a9eff',
                lineHeight: 1.5,
              }}
            >
              <ThunderboltOutlined style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{diag.suggestion}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

export default LogDiagnosisTab;
