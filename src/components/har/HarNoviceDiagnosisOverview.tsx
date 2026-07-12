import React, { useMemo } from 'react';
import { Button, Collapse, Tag } from 'antd';
import { ArrowRightOutlined, CopyOutlined, ExperimentOutlined, TeamOutlined } from '@ant-design/icons';
import type { HarAnalysisResult } from '../../harParser';
import { buildHarNoviceDiagnosis } from '../../diagnosis/shared/harNoviceDiagnosis';
import { buildHarIssueClusters, getHarEvidenceLevelLabel, getHarRoleLabel, type HarIssueCluster } from '../../diagnosis/shared/harIssueClusters';
import { useNavigation } from '../../contexts/NavigationContext';
import { copyText } from '../../utils/copyText';
import HarSummaryDiagnosis from './HarSummaryDiagnosis';
import HarIssueClusterList from './HarIssueClusterList';
import { buildHarClusterCopyText } from './buildHarClusterCopyText';

interface HarNoviceDiagnosisOverviewProps {
  result: HarAnalysisResult;
  onOpenRequests?: () => void;
}

function evidenceTone(level: string): { color: string; bg: string } {
  if (level === 'explicit-observation') return { color: '#b91c1c', bg: '#fee2e2' };
  if (level === 'timing-signal') return { color: '#c2410c', bg: '#ffedd5' };
  if (level === 'heuristic') return { color: '#0e7490', bg: '#cffafe' };
  return { color: '#475569', bg: '#e2e8f0' };
}

const HarNoviceDiagnosisOverview: React.FC<HarNoviceDiagnosisOverviewProps> = ({ result, onOpenRequests }) => {
  const clusters = useMemo(() => buildHarIssueClusters(result.entries), [result.entries]);
  const diagnosis = useMemo(() => buildHarNoviceDiagnosis(result), [result]);
  const { navigateTo } = useNavigation();
  const tone = evidenceTone(diagnosis.evidenceLevel);

  const openCluster = (cluster: HarIssueCluster) => {
    onOpenRequests?.();
    navigateTo({
      tab: 'requests',
      fileType: 'har',
      source: 'har-novice-diagnosis',
      reason: cluster.title,
      filters: { requestIds: cluster.affectedRequestIds, requestId: cluster.representativeRequestIds[0] },
      highlight: { requestIds: cluster.affectedRequestIds },
      scrollTo: cluster.representativeRequestIds[0] !== undefined ? { type: 'request', id: cluster.representativeRequestIds[0] } : undefined,
    });
  };

  const primary = diagnosis.primaryCluster;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        .har-novice-primary { grid-template-columns: minmax(0, 1fr) auto; }
        .har-novice-support { grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr); }
        @media (max-width: 760px) {
          .har-novice-primary, .har-novice-support { grid-template-columns: minmax(0, 1fr); }
          .har-novice-primary-actions { justify-content: flex-start !important; }
        }
      `}</style>
      <div
        className="har-novice-primary"
        style={{
          border: `1px solid ${tone.color}33`,
          background: `linear-gradient(135deg, ${tone.bg}, var(--bg-surface) 48%)`,
          borderRadius: 16,
          padding: 18,
          display: 'grid',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <Tag style={{ color: tone.color, background: '#fff', border: `1px solid ${tone.color}40`, fontWeight: 700 }}>
              当前最值得先看
            </Tag>
            <Tag>{getHarEvidenceLevelLabel(diagnosis.evidenceLevel)}</Tag>
            {primary?.requiresNetLog && <Tag color="blue">建议补充 NetLog</Tag>}
          </div>
          <h3 style={{ margin: '0 0 8px', fontSize: 20, color: 'var(--text-primary)' }}>{diagnosis.headline}</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{diagnosis.summary}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, fontSize: 13 }}>
            <span style={{ padding: '6px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.65)', color: 'var(--text-secondary)' }}>
              影响范围：{diagnosis.impact}
            </span>
            <span style={{ padding: '6px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.65)', color: 'var(--text-secondary)' }}>
              建议先看：{diagnosis.handoffRoles.map(item => getHarRoleLabel(item.role)).join(' / ')}
            </span>
          </div>
        </div>
        <div className="har-novice-primary-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {primary && <Button icon={<CopyOutlined />} onClick={() => copyText(buildHarClusterCopyText(primary))}>复制排查摘要</Button>}
          {primary && <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => openCluster(primary)}>查看相关请求</Button>}
        </div>
      </div>

      <div className="har-novice-support" style={{ display: 'grid', gap: 14 }}>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 14, padding: 14, background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--text-primary)', fontWeight: 700 }}>
            <ExperimentOutlined /> 现在先做
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {diagnosis.immediateActions.map((action, index) => (
              <div key={`${action.role}-${action.title}`} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-base)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)' }}>{index + 1}</span>
                <span><strong style={{ color: 'var(--text-primary)' }}>{action.title}</strong>：{action.detail}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 14, padding: 14, background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--text-primary)', fontWeight: 700 }}>
            <TeamOutlined /> 找谁继续看
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {diagnosis.handoffRoles.map(item => (
              <div key={item.role} style={{ fontSize: 13, lineHeight: 1.6 }}>
                <Tag>{getHarRoleLabel(item.role)}</Tag>
                <span style={{ color: 'var(--text-secondary)' }}>{item.reason}</span>
              </div>
            ))}
          </div>
          {diagnosis.evidenceGap && (
            <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>{diagnosis.evidenceGap}</div>
          )}
        </div>
      </div>

      <div>
        <div style={{ marginBottom: 10, color: 'var(--text-primary)', fontWeight: 700 }}>问题组列表</div>
        <HarIssueClusterList clusters={clusters.slice(0, 5)} onOpenCluster={openCluster} />
      </div>

      <Collapse
        ghost
        items={[
          {
            key: 'expert',
            label: '查看详细分析',
            children: <HarSummaryDiagnosis result={result} />,
          },
        ]}
      />
    </div>
  );
};

export default HarNoviceDiagnosisOverview;
