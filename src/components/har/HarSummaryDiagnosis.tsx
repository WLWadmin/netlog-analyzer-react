import React from 'react';
import { HarAnalysisResult } from '../../harParser';

interface HarSummaryDiagnosisProps {
  result: HarAnalysisResult;
}

const HarSummaryDiagnosis: React.FC<HarSummaryDiagnosisProps> = ({ result }) => {
  // TODO: 后续补充汇总诊断模块
  void result;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* TODO: 后续补充汇总诊断模块 */}
    </div>
  );
};

export default HarSummaryDiagnosis;
