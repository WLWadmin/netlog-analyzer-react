import React, { useState, useMemo } from 'react';
import { Card, Tag, Button, Badge } from 'antd';
import {
  SafetyOutlined,
  GlobalOutlined,
  ApiOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
  LockOutlined,
  LinkOutlined,
  DesktopOutlined,
  WifiOutlined,
  CloudOutlined,
  CompressOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
  ArrowRightOutlined,
  CodeOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  UserOutlined,
  TeamOutlined,
  DatabaseOutlined,
  BranchesOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import type { DiagnosticCard as DiagnosticCardType, DiagnosticRole, DiagnosticAction } from '../../diagnosis/shared/types';
import type { TroubleshootingCommand } from '../../diagnosis/shared/commandLibrary';
import { useNavigation } from '../../contexts/NavigationContext';
import { getCommandsForCategory } from '../../diagnosis/shared/commandLibrary';
import { generateMaskedReport } from '../../diagnosis/shared/maskedExport';

interface DiagnosticCardProps {
  card: DiagnosticCardType;
  index?: number;
}

// ========== 类别图标映射 ==========
const categoryIconMap: Record<string, React.ReactNode> = {
  dns: <GlobalOutlined />,
  proxy: <LinkOutlined />,
  tls: <LockOutlined />,
  connect: <WifiOutlined />,
  protocol: <ApiOutlined />,
  server: <DatabaseOutlined />,
  client: <DesktopOutlined />,
  performance: <ClockCircleOutlined />,
  cache: <CloudOutlined />,
  compression: <CompressOutlined />,
  security: <SafetyOutlined />,
  cors: <FileTextOutlined />,
  redirect: <BranchesOutlined />,
  'network-change': <WifiOutlined />,
  'browser-queue': <DesktopOutlined />,
  quality: <InfoCircleOutlined />,
  unknown: <QuestionCircleOutlined />,
};

const categoryLabelMap: Record<string, string> = {
  dns: 'DNS',
  proxy: '代理',
  tls: 'TLS/证书',
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

// ========== 角色图标映射 ==========
const roleIconMap: Record<DiagnosticRole, React.ReactNode> = {
  user: <UserOutlined />,
  it: <TeamOutlined />,
  backend: <DatabaseOutlined />,
  frontend: <CodeOutlined />,
};

const roleLabelMap: Record<DiagnosticRole, string> = {
  user: '用户',
  it: 'IT',
  backend: '后端',
  frontend: '前端',
};

const roleColorMap: Record<DiagnosticRole, string> = {
  user: '#0ea5e9',
  it: '#8b5cf6',
  backend: '#f59e0b',
  frontend: '#10b981',
};

// ========== 严重程度样式 ==========
const severityConfig = {
  critical: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.3)', icon: <ExclamationCircleOutlined /> },
  warning: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.3)', icon: <WarningOutlined /> },
  info: { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.3)', icon: <InfoCircleOutlined /> },
};

const confidenceLabelMap = {
  high: '高置信度',
  medium: '中置信度',
  low: '低置信度',
};

const confidenceColorMap = {
  high: '#10b981',
  medium: '#f59e0b',
  low: '#6b7280',
};

const DiagnosticCardComponent: React.FC<DiagnosticCardProps> = ({ card, index }) => {
  const [expandedEvidence, setExpandedEvidence] = useState(false);
  const [expandedActions, setExpandedActions] = useState(false);
  const { navigateTo } = useNavigation();

  const config = severityConfig[card.severity];
  const categoryIcon = categoryIconMap[card.category] || <QuestionCircleOutlined />;
  const categoryLabel = categoryLabelMap[card.category] || card.category;

  // 导出当前卡片脱敏摘要
  const handleExportCard = () => {
    const report = generateMaskedReport([card]);
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `诊断-${card.category}-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * 计算该卡片是否具备可导航能力
   * 优先级：navigationTarget > relatedRequestIds > relatedEventIds
   */
  const canNavigate = useMemo(() => {
    if (card.navigationTarget) return true;
    if (card.relatedRequestIds && card.relatedRequestIds.length > 0) return true;
    if (card.relatedEventIds && card.relatedEventIds.length > 0) return true;
    return false;
  }, [card.navigationTarget, card.relatedRequestIds, card.relatedEventIds]);

  /**
   * 构建最终的导航意图
   * 模式 B：优先使用 navigationTarget，否则用 relatedRequestIds / relatedEventIds 构造 fallback
   */
  const buildNavigationIntent = useMemo(() => {
    // 模式 A：已有完整 navigationTarget
    if (card.navigationTarget) {
      const { tab, keyword, errorCode, errorOnly, requestIds, eventIds } = card.navigationTarget;
      return {
        tab,
        filters: {
          ...(keyword && { keyword }),
          ...(errorCode && { errorCode }),
          ...(errorOnly && { errorOnly }),
          ...(requestIds?.length === 1 && { requestId: requestIds[0] }),
        },
        highlight: {
          ...(requestIds && { requestIds }),
          ...(eventIds && { sourceIds: eventIds.map(Number) }),
        },
      };
    }

    // 模式 B fallback：根据 source 类型和关联数据自动推断目标 tab
    if (card.source === 'har' && card.relatedRequestIds && card.relatedRequestIds.length > 0) {
      return {
        tab: 'requests',
        filters: {
          ...(card.relatedRequestIds.length === 1 && { requestId: card.relatedRequestIds[0] }),
        },
        highlight: { requestIds: card.relatedRequestIds },
      };
    }

    if (card.source === 'netlog' && card.relatedRequestIds && card.relatedRequestIds.length > 0) {
      return {
        tab: 'requests',
        filters: {
          ...(card.relatedRequestIds.length === 1 && { requestId: card.relatedRequestIds[0] }),
        },
        highlight: { requestIds: card.relatedRequestIds },
      };
    }

    if (card.source === 'netlog' && card.relatedEventIds && card.relatedEventIds.length > 0) {
      return {
        tab: 'events',
        filters: {
          ...(card.relatedEventIds.length === 1 && { sourceId: card.relatedEventIds[0] }),
        },
        highlight: { sourceIds: card.relatedEventIds.map(Number) },
      };
    }

    return null;
  }, [card]);

  const handleNavigate = () => {
    const intent = buildNavigationIntent;
    if (!intent) return;
    navigateTo({
      tab: intent.tab,
      filters: intent.filters,
      highlight: intent.highlight,
      source: '诊断卡片',
      reason: `查看「${card.title}」相关证据`,
    });
  };

  return (
    <Card
      style={{
        background: 'var(--bg-elevated)',
        borderColor: config.border,
        marginBottom: 12,
        borderRadius: 12,
        overflow: 'hidden',
      }}
      bodyStyle={{ padding: 0 }}
    >
      {/* 头部 */}
      <div
        style={{
          padding: '14px 18px',
          background: config.bg,
          borderBottom: `1px solid ${config.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: config.color, fontSize: 18 }}>{config.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              {index !== undefined ? `${index + 1}. ` : ''}{card.title}
            </span>
            <Tag
              style={{
                background: config.color + '15',
                color: config.color,
                border: `1px solid ${config.color}30`,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {card.severity === 'critical' ? '严重' : card.severity === 'warning' ? '警告' : '提示'}
            </Tag>
            <Tag
              style={{
                background: confidenceColorMap[card.confidence] + '15',
                color: confidenceColorMap[card.confidence],
                border: `1px solid ${confidenceColorMap[card.confidence]}30`,
                fontSize: 11,
              }}
            >
              {confidenceLabelMap[card.confidence]}
            </Tag>
            {card.mergedSources && card.mergedSources.length > 0 && (
              <Tag
                style={{
                  background: 'rgba(14, 165, 233, 0.1)',
                  color: '#0ea5e9',
                  border: '1px solid rgba(14, 165, 233, 0.25)',
                  fontSize: 11,
                }}
              >
                融合 {card.mergedSources.map(s => s === 'har' ? 'HAR' : 'NetLog').join(' + ')}
              </Tag>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{categoryIcon}</span>
            <span>{categoryLabel}</span>
            <span style={{ margin: '0 4px' }}>·</span>
            <span>{card.scope.summary}</span>
            {card.scope.affectedRequestCount !== undefined && (
              <>
                <span style={{ margin: '0 4px' }}>·</span>
                <span>{card.scope.affectedRequestCount} 个请求</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canNavigate && (
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={handleNavigate}
              style={{
                background: config.color + '15',
                borderColor: config.color + '40',
                color: config.color,
                fontSize: 12,
              }}
            >
              查看证据
            </Button>
          )}
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExportCard}
            style={{ fontSize: 12 }}
          >
            导出
          </Button>
        </div>
      </div>

      {/* 结论 */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--text-primary)' }}>诊断结论：</strong>
          {card.conclusion}
        </div>
        {card.confidenceFactors && card.confidenceFactors.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              置信度依据
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {card.confidenceFactors.map((factor, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <Tag
                    style={{
                      marginRight: 6,
                      fontSize: 10,
                      border: 'none',
                      background: factor.impact === 'positive' ? 'rgba(16, 185, 129, 0.12)' : factor.impact === 'negative' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(107, 114, 128, 0.12)',
                      color: factor.impact === 'positive' ? '#059669' : factor.impact === 'negative' ? '#dc2626' : '#6b7280',
                    }}
                  >
                    {factor.impact === 'positive' ? '+证据' : factor.impact === 'negative' ? '-限制' : '参考'}
                  </Tag>
                  <strong style={{ color: 'var(--text-secondary)' }}>{factor.label}：</strong>{factor.detail}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 证据链 */}
      {card.evidence.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div
            style={{
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              background: expandedEvidence ? 'var(--bg-surface)' : 'transparent',
            }}
            onClick={() => setExpandedEvidence(!expandedEvidence)}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileTextOutlined style={{ color: 'var(--accent-blue)' }} />
              证据链 ({card.evidence.length})
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {expandedEvidence ? '收起' : '展开'}
            </span>
          </div>
          {expandedEvidence && (
            <div style={{ padding: '0 18px 14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {card.evidence.map((ev, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '10px 14px',
                      background: 'var(--bg-surface)',
                      borderRadius: 8,
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Badge
                        count={i + 1}
                        style={{
                          backgroundColor: 'var(--accent-blue)',
                          fontSize: 11,
                          minWidth: 20,
                          height: 20,
                          lineHeight: '20px',
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                          {ev.label}
                          <Tag
                            style={{
                              marginLeft: 8,
                              fontSize: 10,
                              background: ev.source === 'har' ? '#dbeafe' : ev.source === 'netlog' ? '#ede9fe' : '#dcfce7',
                              color: ev.source === 'har' ? '#1e40af' : ev.source === 'netlog' ? '#6d28d9' : '#15803d',
                              border: 'none',
                            }}
                          >
                            {ev.source === 'har' ? 'HAR' : ev.source === 'netlog' ? 'NetLog' : '推导'}
                          </Tag>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, wordBreak: 'break-all' }}>
                          {ev.value}
                        </div>
                        {ev.detail && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                            {ev.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 可执行动作 */}
      {card.actions.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div
            style={{
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              background: expandedActions ? 'var(--bg-surface)' : 'transparent',
            }}
            onClick={() => setExpandedActions(!expandedActions)}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ThunderboltOutlined style={{ color: '#f59e0b' }} />
              可执行动作 ({card.actions.length})
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {expandedActions ? '收起' : '展开'}
            </span>
          </div>
          {expandedActions && (
            <div style={{ padding: '0 18px 14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {card.actions.map((action, i) => (
                  <ActionItem key={i} action={action} index={i} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 限制说明 */}
      {card.limitations && card.limitations.length > 0 && (
        <div style={{ padding: '10px 18px', background: 'rgba(107, 114, 128, 0.04)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <InfoCircleOutlined style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ lineHeight: 1.6 }}>
              <strong>限制说明：</strong>
              {card.limitations.map((lim, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ margin: '0 4px' }}>·</span>}
                  {lim}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {card.conflictNotes && card.conflictNotes.length > 0 && (
        <div style={{ padding: '10px 18px', background: 'rgba(245, 158, 11, 0.06)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <WarningOutlined style={{ marginTop: 2, color: '#f59e0b', flexShrink: 0 }} />
            <div style={{ lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text-secondary)' }}>证据冲突：</strong>
              {card.conflictNotes.map((note, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ margin: '0 4px' }}>·</span>}
                  {note}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 排查命令库 */}
      <CardCommandSection card={card} />
    </Card>
  );
};

// ========== 排查命令内嵌区块 ==========

const CardCommandSection: React.FC<{ card: DiagnosticCardType }> = ({ card }) => {
  const [expanded, setExpanded] = useState(false);
  const allCommands = useMemo(() => getCommandsForCategory(card.category), [card.category]);

  // 去重：如果卡片的 actions 中已包含某条命令（按 command 文本匹配），则不再重复展示
  const commands = useMemo(() => {
    const actionCommands = new Set(
      card.actions
        .filter(a => a.command)
        .map(a => a.command!.trim())
    );
    return allCommands.filter(cmd => !actionCommands.has(cmd.command.trim()));
  }, [allCommands, card.actions]);

  if (commands.length === 0) return null;

  return (
    <div style={{ borderBottom: '1px solid var(--border-color)' }}>
      <div
        style={{
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          background: expanded ? 'var(--bg-surface)' : 'transparent',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <CodeOutlined style={{ color: '#8b5cf6' }} />
          排查命令 ({commands.length})
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {expanded ? '收起' : '展开'}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: '0 18px 14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {commands.map((cmd) => (
              <CommandItem key={cmd.id} command={cmd} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const CommandItem: React.FC<{ command: TroubleshootingCommand }> = ({ command }) => {
  const platformLabel: Record<string, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    all: '全平台',
  };

  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--bg-surface)',
        borderRadius: 8,
        border: '1px solid var(--border-color)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {command.title}
        </span>
        <Tag
          style={{
            fontSize: 10,
            background: '#ede9fe',
            color: '#6d28d9',
            border: 'none',
          }}
        >
          {platformLabel[command.platform]}
        </Tag>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
        {command.description}
      </div>
      <div
        style={{
          padding: '8px 12px',
          background: '#1e293b',
          borderRadius: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <code style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>{command.command}</code>
        <Button
          size="small"
          type="text"
          icon={<CodeOutlined />}
          onClick={() => navigator.clipboard.writeText(command.command)}
          style={{ color: '#94a3b8', flexShrink: 0 }}
        >
          复制
        </Button>
      </div>
      {command.expectedResult && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          <CheckCircleOutlined style={{ color: '#10b981', marginRight: 4 }} />
          预期结果：{command.expectedResult}
        </div>
      )}
      {command.nextIfFailed && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          <ArrowRightOutlined style={{ color: '#f59e0b', marginRight: 4 }} />
          失败后续：{command.nextIfFailed}
        </div>
      )}
    </div>
  );
};

// ========== 动作项子组件 ==========

const ActionItem: React.FC<{ action: DiagnosticAction; index: number }> = ({ action, index }) => {
  const roleColor = roleColorMap[action.role];

  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--bg-surface)',
        borderRadius: 8,
        border: '1px solid var(--border-color)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Badge
          count={index + 1}
          style={{
            backgroundColor: roleColor,
            fontSize: 11,
            minWidth: 20,
            height: 20,
            lineHeight: '20px',
          }}
        />
        <Tag
          style={{
            background: roleColor + '15',
            color: roleColor,
            border: `1px solid ${roleColor}30`,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {roleIconMap[action.role]} {roleLabelMap[action.role]}
        </Tag>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{action.title}</span>
      </div>
      <div style={{ paddingLeft: 28, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {action.detail}
      </div>
      {action.command && (
        <div style={{ paddingLeft: 28, marginTop: 8 }}>
          <div
            style={{
              padding: '8px 12px',
              background: '#1e293b',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: '#e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <code style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>{action.command}</code>
            <Button
              size="small"
              type="text"
              icon={<CodeOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(action.command!);
              }}
              style={{ color: '#94a3b8', flexShrink: 0 }}
            >
              复制
            </Button>
          </div>
          {action.expectedResult && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              <CheckCircleOutlined style={{ color: '#10b981', marginRight: 4 }} />
              预期结果：{action.expectedResult}
            </div>
          )}
          {action.nextIfFailed && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              <ArrowRightOutlined style={{ color: '#f59e0b', marginRight: 4 }} />
              失败后续：{action.nextIfFailed}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DiagnosticCardComponent;
