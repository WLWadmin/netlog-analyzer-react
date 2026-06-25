import { useEffect, useState } from 'react';
import { Card, Spin } from 'antd';
import { MedicineBoxOutlined } from '@ant-design/icons';
import { queryDiagnosisSummaryInWorker } from '../../workers/workerClient';
import type { DiagnosisSummary } from '../../diagnosis/shared/types';
import DiagnosisPanel from '../shared/DiagnosisPanel';

interface DiagnosisTabProps {
  analysisId: string;
}

const DiagnosisTab: React.FC<DiagnosisTabProps> = ({ analysisId }) => {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<DiagnosisSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await queryDiagnosisSummaryInWorker({ analysisId } as any);
        if (cancelled) return;
        setSummary(res.summary);
      } catch {
        if (cancelled) return;
        setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [analysisId]);

  return (
    <Card
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
      bodyStyle={{ padding: 16 }}
      title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><MedicineBoxOutlined /> 定因诊断</span>}
    >
      {loading && !summary ? (
        <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><Spin /></div>
      ) : summary ? (
        <DiagnosisPanel summary={summary} />
      ) : (
        <div style={{ color: 'var(--text-muted)' }}>暂无诊断结果。</div>
      )}
      {summary?.quality && summary.quality.issues.length > 0 && (
        <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>
          采集质量提示：{summary.quality.issues[0].message}
        </div>
      )}
    </Card>
  );
};

export default DiagnosisTab;
