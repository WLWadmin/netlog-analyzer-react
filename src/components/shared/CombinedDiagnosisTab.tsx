import React, { useMemo } from 'react';
import { Alert } from 'antd';
import type { HarAnalysisResult } from '../../harParser';
import type { AnalysisResult } from '../../parsers/netlog/parser';
import { buildCombinedDiagnosisSummary } from '../../diagnosis/shared/fromCombined';
import DiagnosisPanel from './DiagnosisPanel';
import UploadZone from '../netlog/UploadZone';

interface CombinedDiagnosisTabProps {
  harResult: HarAnalysisResult | null;
  netlogResult: AnalysisResult | null;
  onUploadMissingFile?: (
    data: unknown,
    isTextLog?: boolean,
    repairInfo?: HarAnalysisResult['repairInfo'],
    fileTypeHint?: 'netlog' | 'har' | 'log'
  ) => void;
}

const CombinedDiagnosisTab: React.FC<CombinedDiagnosisTabProps> = ({
  harResult,
  netlogResult,
  onUploadMissingFile,
}) => {
  const summary = useMemo(() => {
    if (!harResult || !netlogResult) return undefined;
    return buildCombinedDiagnosisSummary(harResult, netlogResult);
  }, [harResult, netlogResult]);

  // 缺 NetLog：一般不应出现在 NetLog 页，保留兜底
  if (!netlogResult) {
    return (
      <Alert
        type="warning"
        showIcon
        message="联合诊断需要先加载 NetLog"
        description="请先上传 NetLog 文件，再追加同次复现的 HAR 文件。"
        style={{ margin: 20 }}
      />
    );
  }

  // 缺 HAR：展示上传入口
  if (!harResult) {
    return (
      <div style={{ padding: 16 }}>
        <Alert
          type="info"
          showIcon
          message="上传 HAR 后启用联合诊断"
          description="当前已加载 NetLog。追加上传同一次问题复现导出的 HAR 文件后，系统会按 host / URL / 时间线对齐 HAR 请求与 NetLog 事件，生成「HAR 看到什么现象，NetLog 解释为什么」的联合诊断结果。"
          style={{ marginBottom: 16 }}
        />
        {onUploadMissingFile && (
          <UploadZone onFileLoaded={onUploadMissingFile} compact />
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Alert
        type="info"
        showIcon
        message="联合诊断说明"
        description="联合诊断会优先使用 URL/path 精确对齐，其次使用同 host 证据；只有同域名 NetLog 错误与 HAR timing 阶段吻合时才给出高置信结论。"
        style={{ marginBottom: 16 }}
      />
      <DiagnosisPanel summary={summary} />
    </div>
  );
};

export default CombinedDiagnosisTab;
