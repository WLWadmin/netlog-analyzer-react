import React, { useMemo } from 'react';
import { Alert, Card, Collapse, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { HarAnalysisResult } from '../../harParser';
import type { AnalysisResult, FailedDomain, ParsedEvent } from '../../parsers/netlog/parser';
import { buildCombinedDiagnosisSummary, buildFinalDiagnosisSummary } from '../../diagnosis/shared';
import { extractDnsIpEvidenceFromNetlog } from '../../diagnosis/ipEvidence';
import DnsAndIpEvidencePanel from '../shared/DnsAndIpEvidencePanel';
import DiagnosisPanel from '../shared/DiagnosisPanel';
import FinalDiagnosisPanel from '../shared/FinalDiagnosisPanel';
import NetlogProxyEvidencePanel from './NetlogProxyEvidencePanel';
import UploadZone from './UploadZone';

interface EvidenceChainTabProps {
  result: AnalysisResult;
  events: ParsedEvent[];
  harResult: HarAnalysisResult | null;
  onUploadMissingFile?: (
    data: unknown,
    isTextLog?: boolean,
    repairInfo?: HarAnalysisResult['repairInfo'],
    fileTypeHint?: 'netlog' | 'har' | 'log'
  ) => void;
}

const FailedDomainEvidencePanel: React.FC<{ result: AnalysisResult }> = ({ result }) => {
  const rows = (result.failedDomains || []).slice(0, 20);
  const columns: ColumnsType<FailedDomain> = [
    { title: '域名', dataIndex: 'domain', key: 'domain', ellipsis: true },
    { title: '错误码', dataIndex: 'errorCodes', key: 'errorCodes', render: (codes?: number[]) => codes?.join(', ') || '-' },
    { title: '失败次数', dataIndex: 'count', key: 'count', width: 100 },
    { title: '解析 IP', dataIndex: 'ips', key: 'ips', ellipsis: true, render: (ips?: string[]) => ips?.slice(0, 5).join(', ') || '-' },
  ];

  return (
    <Card title="失败域名与错误码" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
      <Table
        size="small"
        rowKey="domain"
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 8, showSizeChanger: false }}
        locale={{ emptyText: '未识别到失败域名' }}
      />
    </Card>
  );
};

const CombinedEvidenceEntry: React.FC<{
  harResult: HarAnalysisResult | null;
  netlogResult: AnalysisResult;
  onUploadMissingFile?: EvidenceChainTabProps['onUploadMissingFile'];
}> = ({ harResult, netlogResult, onUploadMissingFile }) => {
  const summary = useMemo(() => {
    if (!harResult) return undefined;
    return buildCombinedDiagnosisSummary(harResult, netlogResult);
  }, [harResult, netlogResult]);
  const finalSummary = useMemo(
    () => summary ? buildFinalDiagnosisSummary(summary, 'combined') : undefined,
    [summary]
  );

  if (!harResult) {
    return (
      <Card title="HAR + NetLog 联合诊断入口" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
        <Alert
          type="info"
          showIcon
          message="可补充同次 HAR 增强诊断"
          description="HAR 能说明页面请求现象，NetLog 能解释浏览器网络栈证据。两者结合可提高定位质量。"
          style={{ marginBottom: 12 }}
        />
        {onUploadMissingFile && <UploadZone onFileLoaded={onUploadMissingFile} compact />}
      </Card>
    );
  }

  return (
    <Card title="HAR + NetLog 联合诊断入口" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
      {finalSummary && (
        <FinalDiagnosisPanel
          finalSummary={finalSummary}
          hideReferenceConclusions
        />
      )}
      {summary && (
        <Collapse style={{ marginTop: 12 }}>
          <Collapse.Panel header={`完整联合诊断报告（共 ${summary.cards.length} 项）`} key="combined-report">
            <DiagnosisPanel summary={summary} />
          </Collapse.Panel>
        </Collapse>
      )}
    </Card>
  );
};

const EvidenceChainTab: React.FC<EvidenceChainTabProps> = ({
  result,
  harResult,
  onUploadMissingFile,
}) => {
  const dnsIpEvidence = useMemo(() => extractDnsIpEvidenceFromNetlog(result), [result]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <NetlogProxyEvidencePanel result={result} />
      <FailedDomainEvidencePanel result={result} />
      <DnsAndIpEvidencePanel summary={dnsIpEvidence} />
      <CombinedEvidenceEntry
        harResult={harResult}
        netlogResult={result}
        onUploadMissingFile={onUploadMissingFile}
      />
    </div>
  );
};

export default EvidenceChainTab;
