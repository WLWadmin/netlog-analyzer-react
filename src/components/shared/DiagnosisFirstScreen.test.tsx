import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { DiagnosisCoverage, FinalDiagnosisSummary } from '../../diagnosis/shared';
import DiagnosisCoveragePanel from './DiagnosisCoveragePanel';
import IncidentEpisodeList from './IncidentEpisodeList';

jest.mock('antd', () => {
  const React = require('react');
  return {
    Card: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) => <section><h3>{title}</h3>{children}</section>,
    Progress: ({ percent, format }: { percent: number; format?: () => React.ReactNode }) => <div>{format ? format() : `${percent}%`}</div>,
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  };
});

jest.mock('@ant-design/icons', () => {
  const React = require('react');
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

function finalSummary(): FinalDiagnosisSummary {
  return {
    mode: 'combined',
    status: 'has-conclusion',
    executiveSummary: 'DNS 解析失败是当前最值得先看的一组事件。',
    headline: [],
    rootCauseClusters: [{
      id: 'episode-dns-1',
      category: 'dns',
      title: 'dns 类故障事件',
      kind: 'highly-likely',
      summary: '在 1000ms 至 5200ms，1 个域名出现 DNS 解析失败，影响 2 个请求。影响范围：单域名影响。',
      cards: [{
        id: 'dns-card',
        source: 'combined',
        category: 'dns',
        severity: 'critical',
        confidence: 'high',
        title: 'DNS 失败',
        conclusion: 'api.example.test DNS 失败',
        scope: { type: 'single-domain', summary: '2 请求', affectedRequestCount: 2, affectedDomainCount: 1 },
        evidence: [{ label: '错误码', value: '-105', source: 'netlog', requestIds: [1, 2], sourceIds: [10] }],
        actions: [],
        relatedRequestIds: [1, 2],
        relatedSourceIds: [10],
      }],
      keyEvidence: [{ label: '错误码', value: '-105', source: 'netlog', requestIds: [1, 2] }],
      actions: [],
      affectedRequestCount: 2,
      affectedDomainCount: 1,
      confidence: 'high',
      score: 100,
    }],
    actionPlan: [],
    missingInfo: [],
    expertCards: [{
      id: 'dns-card',
      source: 'combined',
      category: 'dns',
      severity: 'critical',
      confidence: 'high',
      title: 'DNS 失败',
      conclusion: 'api.example.test DNS 失败',
      scope: { type: 'single-domain', summary: '2 请求', affectedRequestCount: 2, affectedDomainCount: 1 },
      evidence: [{ label: '错误码', value: '-105', source: 'netlog', requestIds: [1, 2] }],
      actions: [],
      relatedRequestIds: [1, 2],
    }],
  };
}

const coverage: DiagnosisCoverage = {
  totalAbnormalObjects: 2,
  explained: 1,
  partiallyExplained: 1,
  unexplained: 0,
  excluded: 0,
  coverageRate: 1,
  denominatorMayBeIncomplete: false,
  unexplainedRequestIds: [],
  unexplainedSourceIds: [],
  reasons: [],
};

describe('Diagnosis first screen components', () => {
  it('renders object-level diagnosis coverage', () => {
    render(<DiagnosisCoveragePanel coverage={coverage} />);

    expect(screen.getByText('覆盖率')).toBeInTheDocument();
    expect(screen.getByText(/已解释/)).toBeInTheDocument();
  });

  it('renders primary episode and evidence navigation buttons', () => {
    render(<IncidentEpisodeList finalSummary={finalSummary()} onOpenHarRequests={jest.fn()} onOpenNetlogEvidence={jest.fn()} />);

    expect(screen.getByText('当前最值得先看')).toBeInTheDocument();
    expect(screen.getByText('dns 类故障事件')).toBeInTheDocument();
    expect(screen.getByText(/查看 HAR 请求/)).toBeEnabled();
    expect(screen.getByText(/查看 NetLog 证据/)).toBeEnabled();
  });
});
