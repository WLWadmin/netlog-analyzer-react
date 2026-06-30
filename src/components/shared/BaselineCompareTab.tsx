import React, { useMemo, useState } from 'react';
import { Upload, Button, Alert, Typography, Space } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { HarAnalysisResult } from '../../harParser';
import { parseBaselineHarFile } from '../../diagnosis/shared/baselineHarUpload';
import { buildBaselineCompareSummary } from '../../diagnosis/shared/baselineComparator';
import DiagnosisPanel from './DiagnosisPanel';

const { Text } = Typography;

const BaselineCompareTab: React.FC = () => {
  const [baseline, setBaseline] = useState<HarAnalysisResult | null>(null);
  const [current, setCurrent] = useState<HarAnalysisResult | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);

  const handleUpload = (
    setter: (r: HarAnalysisResult | null) => void,
    setError: (message: string | null) => void
  ) => (file: File) => {
    setError(null);
    void parseBaselineHarFile(file)
      .then(result => {
        setter(result);
        setError(null);
      })
      .catch(err => {
        setter(null);
        setError(err instanceof Error ? err.message : 'HAR 解析失败');
      });
    return false; // 阻止自动上传
  };

  const summary = useMemo(() => {
    if (!baseline || !current) return undefined;
    return buildBaselineCompareSummary(baseline, current);
  }, [baseline, current]);

  return (
    <div style={{ padding: 16 }}>
      <Alert
        type="info"
        showIcon
        message="正常/异常 A-B 对比"
        description="上传一份正常环境 HAR 和一份异常环境 HAR，系统自动对比域名级别耗时差异，定位退化根因。"
        style={{ marginBottom: 16 }}
      />

      <Space style={{ marginBottom: 16 }}>
        <Upload
          accept=".har,.json"
          showUploadList={false}
          beforeUpload={handleUpload(setBaseline, setBaselineError)}
        >
          <Button icon={<UploadOutlined />}>
            上传正常样本（Baseline）
          </Button>
        </Upload>
        {baseline && <Text type="success">已加载 ({baseline.totalRequests} 请求)</Text>}
        {baselineError && <Text type="danger">Baseline 解析失败：{baselineError}</Text>}

        <Upload
          accept=".har,.json"
          showUploadList={false}
          beforeUpload={handleUpload(setCurrent, setCurrentError)}
        >
          <Button icon={<UploadOutlined />}>
            上传异常样本（Current）
          </Button>
        </Upload>
        {current && <Text type="warning">已加载 ({current.totalRequests} 请求)</Text>}
        {currentError && <Text type="danger">Current 解析失败：{currentError}</Text>}
      </Space>

      {summary ? (
        <DiagnosisPanel summary={summary} />
      ) : (
        <Alert
          type="warning"
          message="请同时上传正常样本和异常样本后查看对比结果"
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
};

export default BaselineCompareTab;
