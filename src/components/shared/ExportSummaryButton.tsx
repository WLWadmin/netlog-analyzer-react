import React from 'react';
import { Button } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import type { DiagnosisSummary } from '../../diagnosis/shared/types';
import { generateMaskedReport } from '../../diagnosis/shared/maskedExport';
import { useExportPreview } from './useExportPreview';

interface ExportSummaryButtonProps {
  summary: DiagnosisSummary;
}

const ExportSummaryButton: React.FC<ExportSummaryButtonProps> = ({ summary }) => {
  const { openExportPreview, exportPreview } = useExportPreview(summary);
  return (
    <>
      <Button icon={<ExportOutlined />} style={{ fontSize: 13 }} onClick={() => {
        openExportPreview({
          filename: `network-diagnosis-report-${new Date().toISOString().slice(0, 10)}.md`,
          mime: 'text/markdown;charset=utf-8',
          text: generateMaskedReport(summary.cards),
        });
      }}>生成协作摘要</Button>
      {exportPreview}
    </>
  );
};

export default ExportSummaryButton;
