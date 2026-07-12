import React from 'react';
import { Button, Tag } from 'antd';
import { ArrowRightOutlined, CopyOutlined } from '@ant-design/icons';
import { formatHarTime } from '../../harParser';
import { getHarEvidenceLevelLabel, getHarRoleLabel, type HarIssueCluster } from '../../diagnosis/shared/harIssueClusters';
import { copyText } from '../../utils/copyText';
import { buildHarClusterCopyText } from './buildHarClusterCopyText';

interface HarIssueClusterListProps {
  clusters: HarIssueCluster[];
  onOpenCluster: (cluster: HarIssueCluster) => void;
}

const severityColor = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#38bdf8',
};

const HarIssueClusterList: React.FC<HarIssueClusterListProps> = ({ clusters, onOpenCluster }) => {
  if (!clusters.length) {
    return (
      <div style={{ padding: 16, border: '1px solid var(--border-color)', borderRadius: 12, color: 'var(--text-muted)' }}>
        当前没有更多问题组。
      </div>
    );
  }

  return (
    <>
      <style>{`
        .har-issue-cluster-row {
          display: grid;
          grid-template-columns: minmax(220px, 1.5fr) 110px 120px 130px auto;
        }
        @media (max-width: 900px) {
          .har-issue-cluster-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
          .har-issue-cluster-title, .har-issue-cluster-actions { grid-column: 1 / -1; }
          .har-issue-cluster-actions { justify-content: flex-start !important; }
        }
        @media (max-width: 520px) {
          .har-issue-cluster-row { grid-template-columns: minmax(0, 1fr); }
          .har-issue-cluster-title, .har-issue-cluster-actions { grid-column: auto; }
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {clusters.map(cluster => (
          <div
            key={cluster.id}
            className="har-issue-cluster-row"
            style={{
              gap: 12,
              alignItems: 'center',
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)',
            }}
          >
          <div className="har-issue-cluster-title" style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: severityColor[cluster.severity], flexShrink: 0 }} />
              <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{cluster.title}</strong>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cluster.groupingReason}
            </div>
          </div>
          <Tag>{getHarEvidenceLevelLabel(cluster.evidenceLevel)}</Tag>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {cluster.affectedRequestCount} 请求 / {cluster.affectedDomainCount} 域名
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {cluster.maxDurationMs ? formatHarTime(cluster.maxDurationMs) : '-'} · {cluster.roleHints.map(getHarRoleLabel).join('/')}
          </span>
          <div className="har-issue-cluster-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(buildHarClusterCopyText(cluster))}>复制摘要</Button>
            <Button size="small" type="primary" icon={<ArrowRightOutlined />} onClick={() => onOpenCluster(cluster)}>查看请求</Button>
          </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default HarIssueClusterList;
