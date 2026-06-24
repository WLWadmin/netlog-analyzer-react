import React, { useMemo } from 'react';
import { Alert } from 'antd';
import type { HarAnalysisResult } from '../../harParser';
import type { AnalysisResult } from '../../parsers/netlog/parser';
import { buildCombinedDiagnosisSummary } from '../../diagnosis/shared/fromCombined';
import DiagnosisPanel from './DiagnosisPanel';

interface CombinedDiagnosisTabProps {
  harResult: HarAnalysisResult | null;
  netlogResult: AnalysisResult | null;
}

const CombinedDiagnosisTab: React.FC<CombinedDiagnosisTabProps> = ({ harResult, netlogResult }) => {
  const summary = useMemo(() => {
    if (!harResult || !netlogResult) return undefined;
    return buildCombinedDiagnosisSummary(harResult, netlogResult);
  }, [harResult, netlogResult]);

  if (!harResult || !netlogResult) {
    const missing = !harResult ? 'HAR' : 'NetLog';
    return (
      <Alert
        type="info"
        showIcon
        message={`联合诊断需要同时拥有 HAR 和 NetLog 数据`}
        description={`当前缺少 ${missing} 数据。请在下方追加上传 ${missing} 文件，或点击「重新上传」回到首页上传两种文件。`}
        style={{ margin: 20 }}
      />
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Alert
        type="info"
        showIcon
        message="联合诊断说明"
        description="联合诊断基于 host 粒度对齐 HAR 请求与 NetLog 事件，生成「HAR 看到慢，NetLog 解释为什么慢」的联合诊断卡片。"
        style={{ marginBottom: 16 }}
      />
      <DiagnosisPanel summary={summary} />
    </div>
  );
};

export default CombinedDiagnosisTab;
