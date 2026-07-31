import React, { useCallback, useMemo, useState } from 'react';
import { Button, Card, Collapse, Tag, message } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type {
  DiagnosisCoverage,
  FinalConclusion,
  FinalConclusionKind,
  FinalDiagnosisSummary,
  MissingInfoItem,
  RootCauseCluster,
} from '../../diagnosis/shared';
import DiagnosisCoveragePanel from './DiagnosisCoveragePanel';
import IncidentEpisodeList from './IncidentEpisodeList';
import NoviceTroubleshootingFlow from './NoviceTroubleshootingFlow';

interface FinalDiagnosisPanelProps {
  finalSummary?: FinalDiagnosisSummary;
  onShowExpertDetails?: () => void;
  hideReferenceConclusions?: boolean;
  title?: string;
  modeLabelOverride?: string;
  expertButtonText?: string;
  evidenceButton?: {
    text: string;
    onClick: () => void;
  };
  coverage?: DiagnosisCoverage;
  onOpenHarRequests?: (requestIds: number[]) => void;
  onOpenNetlogEvidence?: (sourceIds: number[], eventIds: string[]) => void;
  onOpenUnexplained?: (requestIds: number[], sourceIds: number[]) => void;
}

const kindConfig: Record<FinalConclusionKind, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  confirmed: {
    label: '已确认',
    color: '#dc2626',
    bg: 'rgba(239, 68, 68, 0.08)',
    icon: <CheckCircleOutlined />,
  },
  'highly-likely': {
    label: '高度疑似',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.08)',
    icon: <ExclamationCircleOutlined />,
  },
  'symptom-only': {
    label: '仅现象',
    color: '#3b82f6',
    bg: 'rgba(59, 130, 246, 0.08)',
    icon: <InfoCircleOutlined />,
  },
  'needs-more-data': {
    label: '需要补充采集',
    color: 'var(--text-secondary)',
    bg: 'rgba(107, 114, 128, 0.08)',
    icon: <WarningOutlined />,
  },
};

const modeLabelMap: Record<FinalDiagnosisSummary['mode'], string> = {
  har: 'HAR 现象诊断',
  netlog: 'NetLog 网络栈诊断',
  combined: 'HAR + NetLog 联合诊断',
};

const categoryLabelMap: Record<string, string> = {
  dns: 'DNS',
  proxy: '代理 / VPN',
  tls: 'TLS / 证书',
  connect: '连接',
  protocol: '协议',
  server: '服务端',
  client: '客户端',
  performance: '性能',
  cache: '缓存',
  compression: '压缩',
  security: '安全',
  cors: 'CORS',
  redirect: '重定向',
  'network-change': '网络变更',
  'browser-queue': '浏览器队列',
  quality: '采集质量',
  unknown: '未知',
};

function copyText(text: string) {
  if (!navigator.clipboard) {
    message.warning('当前浏览器不支持自动复制，请手动选择文本复制');
    return;
  }
  navigator.clipboard.writeText(text)
    .then(() => message.success('已复制给 IT / 客服的信息'))
    .catch(() => message.error('复制失败，请手动复制'));
}

function buildCopyText(finalSummary: FinalDiagnosisSummary, troubleshootingRecordText: string): string {
  const lines: string[] = [
    `诊断模式：${modeLabelMap[finalSummary.mode]}`,
    `摘要：${finalSummary.executiveSummary}`,
    `数据质量：${statusText(finalSummary.status)}`,
    '',
    '最终结论：',
    ...finalSummary.headline.map((item, index) => [
      `${index + 1}. ${item.userFacingSummary}`,
      `   原因：${item.reason}`,
      `   影响：${item.impact}`,
      `   置信度：${item.confidenceText}`,
      item.primaryAction ? `   下一步：${item.primaryAction.title} - ${item.primaryAction.detail}` : undefined,
    ].filter(Boolean).join('\n')),
    '',
    '用户已尝试：',
    troubleshootingRecordText,
  ];

  if (finalSummary.missingInfo.length > 0) {
    lines.push('', '还缺什么信息：');
    finalSummary.missingInfo.slice(0, 5).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}：${item.recommendation}`);
    });
  }

  if (finalSummary.rootCauseClusters.length > 0) {
    lines.push('', '主事件：');
    finalSummary.rootCauseClusters.slice(0, 3).forEach((cluster, index) => {
      lines.push(`${index + 1}. ${cluster.summary}`);
      lines.push(`   影响：${cluster.affectedRequestCount} 个请求 / ${cluster.affectedDomainCount} 个域名`);
      cluster.keyEvidence.slice(0, 3).forEach(item => lines.push(`   证据：${item.label}=${item.value}`));
    });
  }

  return lines.join('\n');
}

const FinalDiagnosisPanel: React.FC<FinalDiagnosisPanelProps> = ({
  finalSummary,
  onShowExpertDetails,
  hideReferenceConclusions = false,
  title,
  modeLabelOverride,
  expertButtonText,
  evidenceButton,
  coverage,
  onOpenHarRequests,
  onOpenNetlogEvidence,
  onOpenUnexplained,
}) => {
  const [expandedConclusionIds, setExpandedConclusionIds] = useState<string[]>([]);
  const [troubleshootingRecordText, setTroubleshootingRecordText] = useState('尚未执行恢复操作。');

  const copyableText = useMemo(
    () => finalSummary ? buildCopyText(finalSummary, troubleshootingRecordText) : '',
    [finalSummary, troubleshootingRecordText]
  );
  const handleRecordTextChange = useCallback((text: string) => setTroubleshootingRecordText(text), []);
  const handleShowExpertDetails = () => {
    if (!onShowExpertDetails) {
      message.info('完整报告入口暂不可用，请查看当前页面下方诊断详情');
      return;
    }
    onShowExpertDetails();
    message.success('已展开完整诊断报告');
  };

  if (!finalSummary) return null;

  return (
    <Card
      className="final-diagnosis-panel"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--bg-elevated)',
        borderColor: 'rgba(14,165,233,0.20)',
        borderRadius: 12,
        marginBottom: 16,
        boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
      }}
      styles={{ body: { padding: 22, position: 'relative' } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <Tag style={{ border: 'none', background: 'rgba(14, 165, 233, 0.12)', color: '#0284c7', fontWeight: 600 }}>
              {modeLabelOverride || '已完成网络检查'}
            </Tag>
            <Tag style={{ border: 'none', background: statusBg(finalSummary.status), color: statusColor(finalSummary.status), fontWeight: 600 }}>
              {noviceStatusText(finalSummary.status)}
            </Tag>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.28, letterSpacing: 0 }}>
            {title || '网络问题处理'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 760, lineHeight: 1.7 }}>
            先按下面的一个步骤尝试恢复；完成后选择实际结果，产品会继续告诉你下一步。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Button size="small" style={{ borderRadius: 999 }} icon={<FileTextOutlined />} onClick={() => copyText(copyableText)}>
            复制给 IT / 客服
          </Button>
        </div>
      </div>

      <NoviceTroubleshootingFlow finalSummary={finalSummary} onRecordTextChange={handleRecordTextChange} />

      <Collapse
        ghost
        bordered={false}
        style={{ marginTop: 14, background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border-color)' }}
        items={[
          {
            key: 'evidence',
            label: <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>IT / 研发信息（小白无需查看）</span>,
            children: (
              <div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {evidenceButton && (
                    <Button size="small" icon={<ThunderboltOutlined />} onClick={evidenceButton.onClick}>
                      {evidenceButton.text}
                    </Button>
                  )}
                  {onShowExpertDetails && (
                    <Button size="small" icon={<EyeOutlined />} onClick={handleShowExpertDetails}>
                      {expertButtonText || '查看完整报告'}
                    </Button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                  <IncidentEpisodeList
                    finalSummary={finalSummary}
                    onOpenHarRequests={onOpenHarRequests}
                    onOpenNetlogEvidence={onOpenNetlogEvidence}
                  />
                  <DiagnosisCoveragePanel
                    coverage={coverage}
                    onOpenUnexplained={onOpenUnexplained}
                  />
                </div>
              </div>
            ),
          },
          ...(finalSummary.missingInfo.length > 0 ? [{
            key: 'missing',
            label: <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>需要继续协查时再补充的信息</span>,
            children: <MissingInfoPanel items={finalSummary.missingInfo} />,
          }] : []),
        ]}
      />

      {!hideReferenceConclusions && (
        <ReferenceConclusionContent
          finalSummary={finalSummary}
          expandedConclusionIds={expandedConclusionIds}
          setExpandedConclusionIds={setExpandedConclusionIds}
        />
      )}
    </Card>
  );
};

export const FinalDiagnosisReferencePanel: React.FC<{ finalSummary?: FinalDiagnosisSummary }> = ({ finalSummary }) => {
  const [expandedConclusionIds, setExpandedConclusionIds] = useState<string[]>([]);

  if (!finalSummary || finalSummary.headline.length === 0) return null;

  return (
    <Card
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)', marginBottom: 16 }}
      styles={{ body: { padding: 18 } }}
    >
      <ReferenceConclusionContent
        finalSummary={finalSummary}
        expandedConclusionIds={expandedConclusionIds}
        setExpandedConclusionIds={setExpandedConclusionIds}
        compact
      />
    </Card>
  );
};

const ReferenceConclusionContent: React.FC<{
  finalSummary: FinalDiagnosisSummary;
  expandedConclusionIds: string[];
  setExpandedConclusionIds: React.Dispatch<React.SetStateAction<string[]>>;
  compact?: boolean;
}> = ({ finalSummary, expandedConclusionIds, setExpandedConclusionIds, compact = false }) => (
  <>
    <div style={{ marginTop: compact ? 0 : 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      <InfoCircleOutlined style={{ color: '#0284c7' }} />
      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>关键结论（定位参考）</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>用于说明判断依据，优先按最终诊断摘要中的行动清单操作</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {finalSummary.headline.map(conclusion => (
        <ConclusionCard
          key={conclusion.id}
          conclusion={conclusion}
          expanded={expandedConclusionIds.includes(conclusion.id)}
          onToggle={() => {
            setExpandedConclusionIds(prev =>
              prev.includes(conclusion.id)
                ? prev.filter(id => id !== conclusion.id)
                : [...prev, conclusion.id]
            );
          }}
        />
      ))}
    </div>

    {finalSummary.rootCauseClusters.length > 0 && (
      <RootCauseClusterPanel clusters={finalSummary.rootCauseClusters.slice(0, 6)} />
    )}
  </>
);

function statusText(status: FinalDiagnosisSummary['status']): string {
  if (status === 'has-conclusion') return '已有可执行结论';
  if (status === 'limited-conclusion') return '有限结论';
  return '证据不足';
}

function noviceStatusText(status: FinalDiagnosisSummary['status']): string {
  if (status === 'has-conclusion') return '可以开始处理';
  if (status === 'limited-conclusion') return '先按步骤验证';
  return '先补充信息';
}

function statusColor(status: FinalDiagnosisSummary['status']): string {
  if (status === 'has-conclusion') return '#059669';
  if (status === 'limited-conclusion') return '#d97706';
  return '#6b7280';
}

function statusBg(status: FinalDiagnosisSummary['status']): string {
  if (status === 'has-conclusion') return 'rgba(16, 185, 129, 0.12)';
  if (status === 'limited-conclusion') return 'rgba(245, 158, 11, 0.12)';
  return 'rgba(107, 114, 128, 0.12)';
}

const ConclusionCard: React.FC<{
  conclusion: FinalConclusion;
  expanded: boolean;
  onToggle: () => void;
}> = ({ conclusion, expanded, onToggle }) => {
  const config = kindConfig[conclusion.kind];
  return (
    <div
      className="final-diagnosis-conclusion-card"
      style={{
        border: `1px solid ${config.color}33`,
        background: config.bg,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ color: config.color, fontSize: 18, marginTop: 2 }}>{config.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <Tag style={{ border: 'none', background: `${config.color}18`, color: config.color, fontWeight: 700 }}>
                {config.label}
              </Tag>
              <Tag className="final-diagnosis-soft-tag" style={{ border: 'none', background: 'rgba(255,255,255,0.55)', color: 'var(--text-secondary)' }}>
                {categoryLabelMap[conclusion.category] || conclusion.category}
              </Tag>
              <Tag className="final-diagnosis-soft-tag" style={{ border: 'none', background: 'rgba(255,255,255,0.55)', color: 'var(--text-secondary)' }}>
                置信度 {conclusion.confidenceText}
              </Tag>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.45 }}>
              {conclusion.userFacingSummary}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text-primary)' }}>问题是什么：</strong>{conclusion.problem}
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text-primary)' }}>影响范围：</strong>{conclusion.impact}
            </div>
            {conclusion.primaryAction && (
              <div
                className="final-diagnosis-primary-action"
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  background: 'rgba(255, 255, 255, 0.55)',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.5)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ThunderboltOutlined style={{ color: '#f59e0b' }} />
                  下一步先做：{conclusion.primaryAction.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
                  {conclusion.primaryAction.detail}
                </div>
              </div>
            )}
          </div>
          <Button size="small" type="link" onClick={onToggle}>
            {expanded ? '收起证据' : '查看证据'}
          </Button>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border-color)', padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              为什么这么判断
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {conclusion.keyEvidence.length > 0 ? conclusion.keyEvidence.map((evidence, index) => (
                <div key={`${evidence.label}-${index}`} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{index + 1}. {evidence.label}：</strong>
                  {evidence.value}
                  {evidence.detail && <span style={{ color: 'var(--text-muted)' }}>（{evidence.detail}）</span>}
                </div>
              )) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>当前结论未提供可展示的关键证据，请查看完整诊断报告。</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MissingInfoPanel: React.FC<{ items: MissingInfoItem[] }> = ({ items }) => {
  if (items.length === 0) {
    return (
      <div className="final-diagnosis-ok-panel" style={{ border: '1px solid rgba(16,185,129,0.22)', borderRadius: 18, padding: 16, background: 'rgba(236,253,245,0.46)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)' }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 30, height: 30, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(16,185,129,0.14)', color: '#059669' }}>
            <CheckCircleOutlined />
          </span>
          暂无明显缺失信息
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          当前结论可基于已有文件继续排查；仅在按行动清单验证后仍无法确认时，再考虑补充同一次复现的 HAR + NetLog。
        </div>
      </div>
    );
  }

  return (
    <div className="final-diagnosis-missing-panel" style={{ border: '1px solid rgba(245, 158, 11, 0.24)', borderRadius: 18, padding: 16, background: 'linear-gradient(180deg, rgba(255,251,235,0.76), rgba(255,247,237,0.58))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)' }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(245,158,11,0.16)', color: '#d97706' }}>
          <ClockCircleOutlined />
        </span>
        还缺什么信息
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.slice(0, 4).map((item, index) => (
          <div key={item.id} className="final-diagnosis-missing-item" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, padding: '10px 11px', borderRadius: 12, background: 'rgba(255,255,255,0.62)', border: '1px solid rgba(245,158,11,0.14)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{index + 1}. {item.title}：</strong>
            {item.reason}
            <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
              建议：{item.recommendation}
            </div>
            {item.detailGroups && item.detailGroups.length > 0 && (
              <Collapse
                className="final-diagnosis-detail-collapse"
                ghost
                bordered={false}
                style={{ marginTop: 6, background: 'rgba(255,255,255,0.45)', borderRadius: 8 }}
              >
                <Collapse.Panel
                  key={`${item.id}-details`}
                  header={<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>展开常规信息收集步骤</span>}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {item.detailGroups.map(group => (
                      <div key={group.title}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                          {group.title}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {group.items.map((detail, detailIndex) => (
                            <div key={`${group.title}-${detailIndex}`} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                              {detailIndex + 1}. <InlineCodeText text={detail} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Collapse.Panel>
              </Collapse>
            )}
            {item.sensitivity && item.sensitivity !== 'low' && (
              <Tag style={{ marginTop: 4, border: 'none', background: 'rgba(245, 158, 11, 0.15)', color: '#b45309' }}>
                涉及敏感信息，按需选择
              </Tag>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const InlineCodeText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={`${part}-${index}`} style={{ background: 'rgba(15,23,42,0.08)', borderRadius: 4, padding: '1px 4px', color: '#0f766e' }}>
              {part.slice(1, -1)}
            </code>
          );
        }
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <a
              key={`${part}-${index}`}
              href={linkMatch[2]}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#0284c7', fontWeight: 600 }}
            >
              {linkMatch[1]}
            </a>
          );
        }
        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </>
  );
};

const RootCauseClusterPanel: React.FC<{ clusters: RootCauseCluster[] }> = ({ clusters }) => {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 10 }}>
        更多线索 / 根因簇
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {clusters.map(cluster => {
          const config = kindConfig[cluster.kind];
          return (
            <div
              key={cluster.id}
              style={{
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${config.color}22`,
                background: 'var(--bg-surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <Tag style={{ border: 'none', background: `${config.color}14`, color: config.color }}>
                  {kindConfig[cluster.kind].label}
                </Tag>
                <Tag style={{ border: 'none', background: 'rgba(107, 114, 128, 0.1)', color: 'var(--text-secondary)' }}>
                  {cluster.cards.length} 项
                </Tag>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {cluster.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {cluster.summary}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FinalDiagnosisPanel;
