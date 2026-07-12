import React, { useMemo } from 'react';
import { Collapse } from 'antd';
import type { HarAnalysisResult } from '../../harParser';
import { diagnoseHar } from '../../harDiagnosis';
import { buildHarIssueClusters, type HarIssueCluster } from '../../diagnosis/shared/harIssueClusters';
import { buildFinalDiagnosisSummary, buildHarDiagnosisSummary, buildHarObservations, calculateHarDiagnosisCoverage } from '../../diagnosis/shared';
import { useNavigation } from '../../contexts/NavigationContext';
import HarSummaryDiagnosis from './HarSummaryDiagnosis';
import HarIssueClusterList from './HarIssueClusterList';
import FinalDiagnosisPanel from '../shared/FinalDiagnosisPanel';

interface HarNoviceDiagnosisOverviewProps {
  result: HarAnalysisResult;
  onOpenRequests?: () => void;
}

const HarNoviceDiagnosisOverview: React.FC<HarNoviceDiagnosisOverviewProps> = ({ result, onOpenRequests }) => {
  const clusters = useMemo(() => buildHarIssueClusters(result.entries), [result.entries]);
  const observations = useMemo(() => buildHarObservations(result.entries), [result.entries]);
  const coverage = useMemo(() => calculateHarDiagnosisCoverage(result.entries, observations), [result.entries, observations]);
  const harDiagnosis = useMemo(() => diagnoseHar(result), [result]);
  const finalSummary = useMemo(() => buildFinalDiagnosisSummary(buildHarDiagnosisSummary(result, harDiagnosis), 'har'), [result, harDiagnosis]);
  const { navigateTo } = useNavigation();

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

  const openFinalRequests = (requestIds: number[]) => {
    onOpenRequests?.();
    navigateTo({
      tab: 'requests',
      fileType: 'har',
      source: 'har-final-diagnosis',
      reason: '最终诊断主事件',
      filters: { requestIds, requestId: requestIds[0] },
      highlight: { requestIds },
      scrollTo: requestIds[0] !== undefined ? { type: 'request', id: requestIds[0] } : undefined,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FinalDiagnosisPanel
        finalSummary={finalSummary}
        coverage={coverage}
        hideReferenceConclusions
        title="HAR 第一屏诊断"
        modeLabelOverride="HAR 请求现象"
        expertButtonText="查看详细分析"
        onShowExpertDetails={() => {
          const target = document.querySelector('[data-har-expert-diagnosis]');
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onOpenHarRequests={openFinalRequests}
        onOpenUnexplained={requestIds => openFinalRequests(requestIds)}
      />

      <Collapse
        ghost
        data-har-expert-diagnosis
        items={[
          {
            key: 'expert',
            label: '查看详细分析',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={{ marginBottom: 10, color: 'var(--text-primary)', fontWeight: 700 }}>问题组列表</div>
                  <HarIssueClusterList clusters={clusters.slice(0, 5)} onOpenCluster={openCluster} />
                </div>
                <HarSummaryDiagnosis result={result} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
};

export default HarNoviceDiagnosisOverview;
