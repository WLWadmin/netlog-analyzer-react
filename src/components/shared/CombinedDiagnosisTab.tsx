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
    return (
      <Alert
        type="info"
        showIcon
        message="联合诊断需要同时上传 HAR 和 NetLog 文件"
        description="请在首页同时上传两种文件后，切换到「联合诊断」标签页查看跨源诊断结果。"
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
