import React, { useState } from 'react';
import { Button, Modal, message, Typography } from 'antd';
import { ExportOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import type { DiagnosisSummary } from '../../diagnosis/shared/types';
import { generateMaskedReport } from '../../diagnosis/shared/maskedExport';

const { Paragraph } = Typography;

interface ExportSummaryButtonProps {
  summary: DiagnosisSummary;
}

const ExportSummaryButton: React.FC<ExportSummaryButtonProps> = ({ summary }) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [reportText, setReportText] = useState('');

  const handleGenerate = () => {
    const report = generateMaskedReport(summary.cards);
    setReportText(report);
    setModalVisible(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      message.success('脱敏报告已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动选择复制');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([reportText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `network-diagnosis-report-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('报告已下载');
  };

  return (
    <>
      <Button
        icon={<ExportOutlined />}
        onClick={handleGenerate}
        style={{ fontSize: 13 }}
      >
        生成协作摘要
      </Button>

      <Modal
        title="专家协作摘要（已脱敏）"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        width={720}
        footer={[
          <Button key="close" onClick={() => setModalVisible(false)}>
            关闭
          </Button>,
          <Button
            key="copy"
            icon={<CopyOutlined />}
            onClick={handleCopy}
          >
            复制报告
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
          >
            下载 Markdown
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 12, fontSize: 12, color: '#6b7280' }}>
          以下报告已自动脱敏：Cookie、Authorization、Token、URL 敏感参数、可能包含个人信息的 Header。
          分享前仍建议人工复核。
        </div>
        <Paragraph>
          <pre
            style={{
              maxHeight: 480,
              overflow: 'auto',
              background: '#1e293b',
              color: '#e2e8f0',
              padding: 16,
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {reportText}
          </pre>
        </Paragraph>
      </Modal>
    </>
  );
};

export default ExportSummaryButton;
