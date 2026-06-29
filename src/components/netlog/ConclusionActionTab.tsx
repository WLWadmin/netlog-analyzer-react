import React from 'react';
import { Alert, Button, Card, Space, Typography } from 'antd';
import { FileSearchOutlined, GlobalOutlined, RadarChartOutlined, ReadOutlined } from '@ant-design/icons';
import type { HarAnalysisResult } from '../../harParser';
import type { AnalysisResult, ParsedEvent } from '../../parsers/netlog/parser';
import { useNetlogDiagnosisSummary } from '../../hooks/useNetlogDiagnosisSummary';
import FinalDiagnosisPanel from '../shared/FinalDiagnosisPanel';
import DiagnosisPanel from '../shared/DiagnosisPanel';
import UploadZone from './UploadZone';
import NetlogMetricExplainPanel from './NetlogMetricExplainPanel';

interface ConclusionActionTabProps {
  result: AnalysisResult;
  events: ParsedEvent[];
  harResult: HarAnalysisResult | null;
  onUploadMissingFile?: (
    data: unknown,
    isTextLog?: boolean,
    repairInfo?: HarAnalysisResult['repairInfo'],
    fileTypeHint?: 'netlog' | 'har' | 'log'
  ) => void;
  onNavigate: (tab: string, subTab?: string) => void;
}

const ConclusionActionTab: React.FC<ConclusionActionTabProps> = ({
  result,
  events,
  harResult,
  onUploadMissingFile,
  onNavigate,
}) => {
  const { loading, finalSummary } = useNetlogDiagnosisSummary(result, events);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {loading ? (
        <DiagnosisPanel loading />
      ) : (
        <FinalDiagnosisPanel
          finalSummary={finalSummary}
          hideReferenceConclusions
          onShowExpertDetails={() => onNavigate('expert', 'report')}
        />
      )}

      <Card
        title="下一步入口"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        styles={{ body: { padding: 16 } }}
      >
        <Space wrap>
          <Button type="primary" icon={<FileSearchOutlined />} onClick={() => onNavigate('evidence')}>
            查看关键证据
          </Button>
          <Button icon={<GlobalOutlined />} onClick={() => onNavigate('requests')}>
            查看失败/慢请求
          </Button>
          <Button icon={<ReadOutlined />} onClick={() => onNavigate('expert', 'report')}>
            查看完整专家报告
          </Button>
        </Space>
      </Card>

      <NetlogMetricExplainPanel result={result} />

      <Card
        title="HAR + NetLog 联合诊断状态"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        styles={{ body: { padding: 16 } }}
      >
        {harResult ? (
          <Alert
            type="success"
            showIcon
            message="已加载同次 HAR，可查看联合诊断证据"
            description="HAR 能说明页面请求现象，NetLog 能解释浏览器网络栈证据。两者结合可提高定位质量。"
            action={<Button size="small" icon={<RadarChartOutlined />} onClick={() => onNavigate('evidence')}>查看联合证据</Button>}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Alert
              type="info"
              showIcon
              message="可补充同次 HAR 增强诊断"
              description="当前已加载 NetLog。追加上传同一次问题复现导出的 HAR 文件后，可把 HAR 请求现象和 NetLog 网络栈证据放在一起验证。"
            />
            {onUploadMissingFile && (
              <>
                <Typography.Text type="secondary">如果手头有同次 HAR，可在这里追加上传。</Typography.Text>
                <UploadZone onFileLoaded={onUploadMissingFile} compact />
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default ConclusionActionTab;
