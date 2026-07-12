import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Segmented, Space, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { HarAnalysisResult } from '../../harParser';
import type { AnalysisResult } from '../../parsers/netlog/parser';
import { parseBaselineHarFile } from '../../diagnosis/shared/baselineHarUpload';
import {
  buildBaselineCompareSummary,
  buildCombinedDiagnosisSummary,
  buildFinalDiagnosisSummary,
  compareCombinedBaselines,
  compareNetlogBaselines,
  parseBaselineNetlogFile,
  type DiagnosisSummary,
  type DiagnosticCard,
} from '../../diagnosis/shared';
import DiagnosisPanel from './DiagnosisPanel';

const { Text } = Typography;
type CompareMode = 'har' | 'netlog' | 'combined';

interface BaselineCompareTabProps {
  currentNetlog?: AnalysisResult;
}

function cardsToSummary(cards: DiagnosticCard[], source: 'netlog' | 'combined'): DiagnosisSummary {
  return {
    cards,
    quality: { source, isDiagnosable: true, issues: [] },
    overallSeverity: cards.some(card => card.severity === 'critical')
      ? 'critical'
      : cards.some(card => card.severity === 'warning') ? 'warning' : 'info',
  };
}

const BaselineCompareTab: React.FC<BaselineCompareTabProps> = ({ currentNetlog: initialCurrentNetlog }) => {
  const [mode, setMode] = useState<CompareMode>(initialCurrentNetlog ? 'netlog' : 'har');
  const [baselineHar, setBaselineHar] = useState<HarAnalysisResult | null>(null);
  const [currentHar, setCurrentHar] = useState<HarAnalysisResult | null>(null);
  const [baselineNetlog, setBaselineNetlog] = useState<AnalysisResult | null>(null);
  const [currentNetlog, setCurrentNetlog] = useState<AnalysisResult | null>(initialCurrentNetlog || null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (initialCurrentNetlog) setCurrentNetlog(initialCurrentNetlog);
  }, [initialCurrentNetlog]);

  const setError = (key: string, error?: unknown) => {
    setErrors(current => ({
      ...current,
      [key]: error ? (error instanceof Error ? error.message : String(error)) : undefined,
    }));
  };

  const uploadHar = (key: string, setter: (value: HarAnalysisResult | null) => void) => (file: File) => {
    setError(key);
    void parseBaselineHarFile(file)
      .then(value => setter(value))
      .catch(error => {
        setter(null);
        setError(key, error);
      });
    return false;
  };

  const uploadNetlog = (key: string, setter: (value: AnalysisResult | null) => void) => (file: File) => {
    setError(key);
    void parseBaselineNetlogFile(file)
      .then(value => setter(value))
      .catch(error => {
        setter(null);
        setError(key, error);
      });
    return false;
  };

  const summary = useMemo(() => {
    if (mode === 'har') {
      return baselineHar && currentHar ? buildBaselineCompareSummary(baselineHar, currentHar) : undefined;
    }
    if (mode === 'netlog') {
      return baselineNetlog && currentNetlog
        ? cardsToSummary(compareNetlogBaselines(baselineNetlog, currentNetlog), 'netlog')
        : undefined;
    }
    if (!baselineHar || !currentHar || !baselineNetlog || !currentNetlog) return undefined;
    const baselineDiagnosis = buildCombinedDiagnosisSummary(baselineHar, baselineNetlog);
    const currentDiagnosis = buildCombinedDiagnosisSummary(currentHar, currentNetlog);
    const cards = compareCombinedBaselines(
      { har: baselineHar, netlog: baselineNetlog, finalSummary: buildFinalDiagnosisSummary(baselineDiagnosis, 'combined') },
      { har: currentHar, netlog: currentNetlog, finalSummary: buildFinalDiagnosisSummary(currentDiagnosis, 'combined') }
    );
    return cardsToSummary(cards, 'combined');
  }, [mode, baselineHar, currentHar, baselineNetlog, currentNetlog]);

  const uploadStatus = (key: string, text: string) => errors[key]
    ? <Text type="danger">{errors[key]}</Text>
    : <Text type="success">{text}</Text>;

  return (
    <div style={{ padding: 16 }}>
      <Alert
        type="info"
        showIcon
        message="正常/异常 A-B 对比"
        description="选择 HAR、NetLog 或联合模式，对比新增现象和退化线索。差异本身不是根因，所有结果都需要回到两侧证据确认。"
        style={{ marginBottom: 16 }}
      />

      <Segmented
        value={mode}
        onChange={value => setMode(value as CompareMode)}
        options={[
          { label: 'HAR 对比', value: 'har' },
          { label: 'NetLog 对比', value: 'netlog' },
          { label: 'HAR + NetLog', value: 'combined' },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Space size={[12, 12]} wrap style={{ marginBottom: 16 }}>
        {(mode === 'har' || mode === 'combined') && (
          <>
            <Upload accept=".har,.json" showUploadList={false} beforeUpload={uploadHar('baselineHar', setBaselineHar)}>
              <Button icon={<UploadOutlined />}>正常 HAR</Button>
            </Upload>
            {baselineHar && uploadStatus('baselineHar', `${baselineHar.totalRequests} 请求`)}
            {!baselineHar && errors.baselineHar && uploadStatus('baselineHar', '')}
            <Upload accept=".har,.json" showUploadList={false} beforeUpload={uploadHar('currentHar', setCurrentHar)}>
              <Button icon={<UploadOutlined />}>异常 HAR</Button>
            </Upload>
            {currentHar && uploadStatus('currentHar', `${currentHar.totalRequests} 请求`)}
            {!currentHar && errors.currentHar && uploadStatus('currentHar', '')}
          </>
        )}

        {(mode === 'netlog' || mode === 'combined') && (
          <>
            <Upload accept=".json" showUploadList={false} beforeUpload={uploadNetlog('baselineNetlog', setBaselineNetlog)}>
              <Button icon={<UploadOutlined />}>正常 NetLog</Button>
            </Upload>
            {baselineNetlog && uploadStatus('baselineNetlog', `${baselineNetlog.totalEvents} events`)}
            {!baselineNetlog && errors.baselineNetlog && uploadStatus('baselineNetlog', '')}
            <Upload accept=".json" showUploadList={false} beforeUpload={uploadNetlog('currentNetlog', setCurrentNetlog)}>
              <Button icon={<UploadOutlined />}>异常 NetLog</Button>
            </Upload>
            {currentNetlog && uploadStatus('currentNetlog', `${currentNetlog.totalEvents} events${initialCurrentNetlog === currentNetlog ? '（当前文件）' : ''}`)}
            {!currentNetlog && errors.currentNetlog && uploadStatus('currentNetlog', '')}
          </>
        )}
      </Space>

      {summary ? (
        <DiagnosisPanel summary={summary} />
      ) : (
        <Alert
          type="warning"
          message={mode === 'combined' ? '请补齐正常/异常两侧 HAR 与 NetLog' : '请同时提供正常样本和异常样本'}
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
};

export default BaselineCompareTab;
