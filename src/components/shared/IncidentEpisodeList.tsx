import React from 'react';
import { Button, Card, Tag } from 'antd';
import { ArrowRightOutlined, BranchesOutlined, ClockCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { FinalDiagnosisSummary, RootCauseCluster } from '../../diagnosis/shared';

interface IncidentEpisodeListProps {
  finalSummary?: FinalDiagnosisSummary;
  maxSecondary?: number;
  onOpenHarRequests?: (requestIds: number[]) => void;
  onOpenNetlogEvidence?: (sourceIds: number[], eventIds: string[]) => void;
}

const scopeLabel: Record<string, string> = {
  global: '全局',
  'single-domain': '单域名',
  'multi-domain': '多域名',
  'single-request': '单请求',
  'server-side': '服务端侧',
  'https-only': 'HTTPS 专属',
  unknown: '未知范围',
};

function extractRequestIds(cluster: RootCauseCluster): number[] {
  return Array.from(new Set(cluster.cards.flatMap(card => card.relatedRequestIds || []).concat(cluster.keyEvidence.flatMap(item => item.requestIds || []))));
}

function extractSourceIds(cluster: RootCauseCluster): number[] {
  return Array.from(new Set(cluster.cards.flatMap(card => card.relatedSourceIds || [])));
}

function extractEventIds(cluster: RootCauseCluster): string[] {
  return Array.from(new Set(cluster.cards.flatMap(card => card.relatedEventIds || []).concat(cluster.keyEvidence.flatMap(item => item.eventIds || []))));
}

function inferScope(cluster: RootCauseCluster): string {
  const cardScope = cluster.cards[0]?.scope?.type;
  if (cardScope && cardScope !== 'unknown') return cardScope;
  if (/影响范围：([^。]+)/.test(cluster.summary)) return RegExp.$1;
  if (cluster.affectedDomainCount > 1) return 'multi-domain';
  if (cluster.affectedRequestCount <= 1) return 'single-request';
  return 'single-domain';
}

const IncidentEpisodeList: React.FC<IncidentEpisodeListProps> = ({
  finalSummary,
  maxSecondary = 4,
  onOpenHarRequests,
  onOpenNetlogEvidence,
}) => {
  const clusters = finalSummary?.rootCauseClusters || [];
  if (!finalSummary || clusters.length === 0) return null;
  const [primary, ...secondary] = clusters;
  const requestIds = extractRequestIds(primary);
  const sourceIds = extractSourceIds(primary);
  const eventIds = extractEventIds(primary);
  const scope = inferScope(primary);
  const requestButtonLabel = finalSummary.mode === 'netlog' ? '查看 NetLog 请求' : '查看 HAR 请求';

  return (
    <Card
      size="small"
      title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BranchesOutlined /> 重点线索（供 IT / 研发核验）</span>}
      style={{
        borderRadius: 18,
        borderColor: 'rgba(14,165,233,0.24)',
        background: 'linear-gradient(145deg, rgba(240,249,255,0.95), rgba(255,255,255,0.84))',
      }}
      styles={{ body: { padding: 16 } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <Tag color={primary.kind === 'confirmed' ? 'red' : primary.kind === 'highly-likely' ? 'orange' : 'blue'}>{primary.kind}</Tag>
            <Tag>{scopeLabel[scope] || scope}</Tag>
            <Tag>{primary.affectedRequestCount} 请求</Tag>
            <Tag>{primary.affectedDomainCount} 域名</Tag>
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.35 }}>{primary.title}</div>
          <div style={{ marginTop: 8, color: 'var(--text-secondary)', lineHeight: 1.75 }}>{primary.summary}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {primary.keyEvidence.slice(0, 3).map((item, index) => (
            <div key={`${item.label}-${index}`} style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(255,255,255,0.72)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55, wordBreak: 'break-word' }}>{item.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="small" icon={<ArrowRightOutlined />} disabled={!requestIds.length || !onOpenHarRequests} onClick={() => onOpenHarRequests?.(requestIds)}>
            {requestButtonLabel}
          </Button>
          <Button size="small" icon={<SafetyCertificateOutlined />} disabled={(!sourceIds.length && !eventIds.length) || !onOpenNetlogEvidence} onClick={() => onOpenNetlogEvidence?.(sourceIds, eventIds)}>
            查看 NetLog 证据
          </Button>
        </div>

        {secondary.length > 0 && (
          <div style={{ marginTop: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
              <ClockCircleOutlined /> 次要 episode
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {secondary.slice(0, maxSecondary).map(item => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, padding: 10, borderRadius: 12, background: 'rgba(255,255,255,0.62)', border: '1px solid rgba(148,163,184,0.18)' }}>
                  <span style={{ minWidth: 0, color: 'var(--text-secondary)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.summary}</span>
                  <Tag>{item.affectedRequestCount} 请求</Tag>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default IncidentEpisodeList;
