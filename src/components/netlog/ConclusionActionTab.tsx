import React, { useMemo } from 'react';
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import { ApiOutlined, ArrowRightOutlined, FileSearchOutlined, GlobalOutlined, RadarChartOutlined, ReadOutlined } from '@ant-design/icons';
import type { HarAnalysisResult } from '../../harParser';
import type { AnalysisResult, ParsedEvent } from '../../parsers/netlog/parser';
import { useNetlogDiagnosisSummary } from '../../hooks/useNetlogDiagnosisSummary';
import FinalDiagnosisPanel from '../shared/FinalDiagnosisPanel';
import DiagnosisPanel from '../shared/DiagnosisPanel';
import UploadZone from './UploadZone';
import NetlogMetricExplainPanel from './NetlogMetricExplainPanel';
import { buildNetlogObservations, calculateNetlogDiagnosisCoverage } from '../../diagnosis/shared';
import { useNavigation } from '../../contexts/NavigationContext';

interface ConclusionActionTabProps {
  result: AnalysisResult;
  events: ParsedEvent[];
  harResult: HarAnalysisResult | null;
  onUploadMissingFile?: (
    data: unknown,
    isTextLog?: boolean,
    repairInfo?: HarAnalysisResult['repairInfo'],
    fileTypeHint?: 'netlog' | 'har' | 'log'
  ) => void;
  onNavigate: (tab: string, subTab?: string) => void;
}

const ConclusionActionTab: React.FC<ConclusionActionTabProps> = ({
  result,
  events,
  harResult,
  onUploadMissingFile,
  onNavigate,
}) => {
  const { loading, finalSummary } = useNetlogDiagnosisSummary(result, events);
  const { navigateTo } = useNavigation();
  const datasetComplete = !result.largeFileMode?.truncatedEventsPreview && result.largeFileMode?.reachedEventsEnd !== false;
  const observations = useMemo(() => buildNetlogObservations(result, { datasetComplete }), [result, datasetComplete]);
  const coverage = useMemo(
    () => calculateNetlogDiagnosisCoverage(result, observations, { datasetComplete }),
    [result, observations, datasetComplete]
  );
  const statusTone = finalSummary?.status === 'has-conclusion'
    ? { bg: 'rgba(34,197,94,0.18)', label: '已有可执行结论' }
    : finalSummary?.status === 'limited-conclusion'
      ? { bg: 'rgba(245,158,11,0.18)', label: '结论有限' }
      : { bg: 'rgba(148,163,184,0.18)', label: '证据不足' };
  const actionCards = [
    {
      title: '查看关键证据',
      desc: '代理、DNS、CIP/SIP、失败域名和联合证据',
      icon: <FileSearchOutlined />,
      color: '#0ea5e9',
      action: () => onNavigate('evidence'),
    },
    {
      title: '定位失败/慢请求',
      desc: '回到请求级列表查看 URL、错误码和耗时',
      icon: <GlobalOutlined />,
      color: '#f97316',
      action: () => onNavigate('requests'),
    },
    {
      title: '打开专家报告',
      desc: '事件列表、源链路、协议、性能和完整报告',
      icon: <ReadOutlined />,
      color: '#6366f1',
      action: () => onNavigate('expert', 'report'),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 18,
          border: '1px solid rgba(37,99,235,0.18)',
          background: 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,64,175,0.90) 58%, rgba(14,165,233,0.74))',
          boxShadow: '0 18px 48px rgba(15,23,42,0.18)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 18% 10%, rgba(56,189,248,0.28), transparent 28%), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: 'auto, 32px 32px, 32px 32px',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -120,
            top: -120,
            width: 260,
            height: 260,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.22)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', padding: 22, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Space size={8} wrap>
              <Tag style={{ border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.13)', color: '#e0f2fe', fontWeight: 800, margin: 0 }}>
                NetLog 诊断控制台
              </Tag>
              <Tag style={{ border: 'none', background: statusTone.bg, color: '#fff', fontWeight: 800, margin: 0 }}>
                {statusTone.label}
              </Tag>
            </Space>
            <div>
              <Typography.Title level={2} style={{ margin: 0, color: '#fff', letterSpacing: 0, lineHeight: 1.18 }}>
                结论先行，证据后置
              </Typography.Title>
              <Typography.Text style={{ display: 'block', marginTop: 10, color: 'rgba(226,232,240,0.88)', fontSize: 14, lineHeight: 1.8, maxWidth: 720 }}>
                先按行动清单处理，再进入证据链核对代理、DNS、连接、TLS、协议和请求层现象。这个页面只放最需要先看的内容。
              </Typography.Text>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 4 }}>
              <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)' }}>
                <Typography.Text style={{ color: 'rgba(226,232,240,0.72)', fontSize: 12 }}>URL 请求</Typography.Text>
                <div style={{ color: '#fff', fontSize: 24, fontWeight: 900, fontFamily: "'SF Mono', monospace" }}>{result.urlRequests.length}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)' }}>
                <Typography.Text style={{ color: 'rgba(226,232,240,0.72)', fontSize: 12 }}>错误事件</Typography.Text>
                <div style={{ color: result.errors.length > 0 ? '#fecaca' : '#bbf7d0', fontSize: 24, fontWeight: 900, fontFamily: "'SF Mono', monospace" }}>{result.errors.length}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)' }}>
                <Typography.Text style={{ color: 'rgba(226,232,240,0.72)', fontSize: 12 }}>代理 / VPN</Typography.Text>
                <div style={{ color: result.proxyInfo.hasProxy || result.proxyInfo.isVPN ? '#fde68a' : '#bfdbfe', fontSize: 24, fontWeight: 900 }}>
                  {result.proxyInfo.hasProxy || result.proxyInfo.isVPN ? '有' : '无'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {actionCards.map(card => (
              <button
                key={card.title}
                onClick={card.action}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  borderRadius: 12,
                  padding: '14px 14px',
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: '42px minmax(0, 1fr) 20px',
                  alignItems: 'center',
                  gap: 12,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
                }}
              >
                <span style={{ width: 42, height: 42, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${card.color}26`, color: '#fff', fontSize: 18 }}>
                  {card.icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 850, fontSize: 14 }}>{card.title}</span>
                  <span style={{ display: 'block', marginTop: 3, color: 'rgba(226,232,240,0.72)', fontSize: 12, lineHeight: 1.45 }}>{card.desc}</span>
                </span>
                <ArrowRightOutlined style={{ color: 'rgba(255,255,255,0.72)' }} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <DiagnosisPanel loading />
      ) : (
        <FinalDiagnosisPanel
          finalSummary={finalSummary}
          coverage={coverage}
          hideReferenceConclusions
          title="诊断结论与下一步"
          evidenceButton={{ text: '查看关键证据', onClick: () => onNavigate('evidence') }}
          expertButtonText="查看完整专家报告"
          onShowExpertDetails={() => onNavigate('expert', 'report')}
          onOpenHarRequests={requestIds => navigateTo({
            tab: 'requests',
            fileType: 'netlog',
            source: 'netlog-final-diagnosis',
            filters: { requestId: requestIds.length === 1 ? requestIds[0] : undefined },
            highlight: { requestIds },
          })}
          onOpenNetlogEvidence={(sourceIds, eventIds) => navigateTo({
            tab: 'events',
            fileType: 'netlog',
            evidenceSource: 'netlog',
            source: 'netlog-final-diagnosis',
            filters: { sourceId: sourceIds.length === 1 ? String(sourceIds[0]) : undefined },
            highlight: { sourceIds },
            scrollTo: eventIds[0] ? { type: 'event', id: eventIds[0] } : undefined,
          })}
          onOpenUnexplained={(requestIds, sourceIds) => {
            if (requestIds.length > 0) navigateTo({ tab: 'requests', fileType: 'netlog', highlight: { requestIds } });
            else if (sourceIds.length > 0) navigateTo({ tab: 'events', fileType: 'netlog', filters: { sourceId: sourceIds.length === 1 ? String(sourceIds[0]) : undefined }, highlight: { sourceIds } });
            else onNavigate('evidence');
          }}
        />
      )}

      <NetlogMetricExplainPanel result={result} />

      <Card
        className="netlog-combined-status-card"
        title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ApiOutlined /> HAR + NetLog 联合诊断状态</span>}
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,250,252,0.88))',
          borderColor: 'rgba(148,163,184,0.24)',
          borderRadius: 14,
          boxShadow: '0 10px 28px rgba(15,23,42,0.06)',
        }}
        styles={{ body: { padding: 18 } }}
      >
        {harResult ? (
          <Alert
            type="success"
            showIcon
            message="已加载同次 HAR，可查看联合诊断证据"
            description="HAR 能说明页面请求现象，NetLog 能解释浏览器网络栈证据。两者结合可提高定位质量。"
            action={<Button size="small" icon={<RadarChartOutlined />} onClick={() => onNavigate('evidence')}>查看联合证据</Button>}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Alert
              type="info"
              showIcon
              message="可补充同次 HAR 增强诊断"
              description="当前已加载 NetLog。追加上传同一次问题复现导出的 HAR 文件后，可把 HAR 请求现象和 NetLog 网络栈证据放在一起验证。"
            />
            {onUploadMissingFile && (
              <>
                <Typography.Text type="secondary">如果手头有同次 HAR，可在这里追加上传。</Typography.Text>
                <UploadZone onFileLoaded={onUploadMissingFile} compact />
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default ConclusionActionTab;
