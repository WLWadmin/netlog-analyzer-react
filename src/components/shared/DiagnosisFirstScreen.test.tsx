import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DiagnosisCoverage, FinalDiagnosisSummary } from '../../diagnosis/shared';
import DiagnosisCoveragePanel from './DiagnosisCoveragePanel';
import IncidentEpisodeList from './IncidentEpisodeList';
import FinalDiagnosisPanel from './FinalDiagnosisPanel';

jest.mock('antd', () => {
  const React = require('react');
  const Collapse = ({ items, children }: { items?: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }>; children?: React.ReactNode }) => (
    <section>
      {items?.map(item => <div key={item.key}><h4>{item.label}</h4></div>)}
      {children}
    </section>
  );
  Collapse.Panel = ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) => <section><h4>{header}</h4>{children}</section>;
  return {
    Card: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) => <section><h3>{title}</h3>{children}</section>,
    Progress: ({ percent, format }: { percent: number; format?: () => React.ReactNode }) => <div>{format ? format() : `${percent}%`}</div>,
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
    Alert: ({ message, description }: { message?: React.ReactNode; description?: React.ReactNode }) => <div>{message}{description}</div>,
    Collapse,
    message: { warning: jest.fn(), success: jest.fn(), error: jest.fn(), info: jest.fn() },
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

    expect(screen.getByText('重点线索（供 IT / 研发核验）')).toBeInTheDocument();
    expect(screen.getByText('dns 类故障事件')).toBeInTheDocument();
    expect(screen.getByText(/查看 HAR 请求/)).toBeEnabled();
    expect(screen.getByText(/查看 NetLog 证据/)).toBeEnabled();
  });

  it('first guides the novice through one recovery action, then shows the matching owner', () => {
    const summary = finalSummary();
    summary.headline = [{
      id: 'final-dns',
      kind: 'highly-likely',
      source: 'combined',
      category: 'dns',
      title: 'DNS 解析失败',
      problem: '问题域名无法完成 DNS 解析。',
      reason: 'NetLog 记录到 DNS 错误码 -105。',
      impact: '影响 2 个请求。',
      confidence: 'high',
      confidenceText: '高',
      primaryAction: { id: 'switch-network', title: '切换网络验证 DNS', detail: '切到手机热点后重新访问。', priority: 1, sourceCardId: 'dns-card' },
      keyEvidence: [],
      missingInfo: [],
      relatedCardIds: ['dns-card'],
      score: 100,
      displayRank: 1,
      userFacingSummary: '高度疑似：DNS 解析失败',
    }];
    summary.actionPlan = [
      { role: 'user', title: '用户先做', priority: 1, actions: [{ id: 'switch-network', title: '切换网络验证 DNS', detail: '切到手机热点后重新访问。', priority: 1, sourceCardId: 'dns-card' }] },
      { role: 'it', title: 'IT / 网络管理员处理', priority: 2, actions: [{ id: 'dns-lookup', title: '查询域名解析结果', detail: '对比公司 DNS 与公共 DNS 返回。', priority: 1, sourceCardId: 'dns-card' }] },
    ];

    render(
      <FinalDiagnosisPanel
        finalSummary={summary}
        coverage={coverage}
        hideReferenceConclusions
        evidenceButton={{ text: '查看关键证据', onClick: jest.fn() }}
      />
    );

    expect(screen.getByText('网络问题处理')).toBeInTheDocument();
    expect(screen.getByText('你现在遇到的问题')).toBeInTheDocument();
    expect(screen.getByText('设备可能没有正确找到网站服务器')).toBeInTheDocument();
    expect(screen.getByText('先做这一件事')).toBeInTheDocument();
    expect(screen.getByText('切换网络验证 DNS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复正常了' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '还是有问题' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '变得更差' })).toBeEnabled();
    expect(screen.queryByText('高度疑似：DNS 解析失败')).not.toBeInTheDocument();
    expect(screen.queryByText('按角色操作')).not.toBeInTheDocument();
    expect(screen.queryByText('查看关键证据')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '恢复正常了' }));

    expect(screen.getByText('已恢复，可以沿这个方向处理')).toBeInTheDocument();
    expect(screen.getByText('现在怎么继续使用')).toBeInTheDocument();
    expect(screen.getByText('如何彻底解决')).toBeInTheDocument();
    expect(screen.getByText('建议交给 IT / 网络管理员 处理')).toBeInTheDocument();
    expect(screen.getByText(/查询域名解析结果/)).toBeInTheDocument();
    expect(screen.getByText('IT / 研发信息（小白无需查看）')).toBeInTheDocument();
  });

  it('requires restoring the original proxy setting before trying the next direction', () => {
    const summary = finalSummary();
    summary.headline = [{
      id: 'final-proxy',
      kind: 'needs-more-data',
      source: 'netlog',
      category: 'proxy',
      title: '代理待验证',
      problem: '当前存在代理配置。',
      reason: '记录到 fixed_servers。',
      impact: '可能影响访问。',
      confidence: 'medium',
      confidenceText: '中',
      keyEvidence: [],
      missingInfo: [],
      relatedCardIds: ['proxy-card'],
      score: 60,
      displayRank: 1,
      userFacingSummary: '代理可能影响访问',
    }];
    summary.expertCards.unshift({
      id: 'proxy-card',
      source: 'netlog',
      category: 'proxy',
      severity: 'info',
      confidence: 'high',
      title: '检测到代理',
      conclusion: '当前存在代理配置',
      scope: { type: 'global', summary: '全局' },
      evidence: [],
      actions: [],
    });
    summary.actionPlan = [{
      role: 'user',
      title: '用户先做',
      priority: 1,
      actions: [
        { id: 'proxy-off', title: '临时关闭代理/VPN后重试', detail: '临时关闭后重新访问。', priority: 1, sourceCardId: 'proxy-card' },
        { id: 'switch-network', title: '切换网络验证 DNS', detail: '切到手机热点后重新访问。', priority: 2, sourceCardId: 'dns-card' },
      ],
    }];

    render(<FinalDiagnosisPanel finalSummary={summary} hideReferenceConclusions />);
    fireEvent.click(screen.getByRole('button', { name: '还是有问题' }));

    expect(screen.getByText('这一步没有恢复，先还原设置')).toBeInTheDocument();
    expect(screen.getByText(/重新开启公司要求的代理或 VPN/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '已恢复原设置，继续定位' }));
    expect(screen.getByText('切换网络验证 DNS')).toBeInTheDocument();
  });

  it('hands server-side failures directly to backend without asking the novice to change settings', () => {
    const summary = finalSummary();
    summary.headline = [{
      id: 'final-server',
      kind: 'symptom-only',
      source: 'har',
      category: 'server',
      title: '服务端错误',
      problem: '服务端返回 500。',
      reason: 'HAR 记录到 HTTP 500。',
      impact: '接口不可用。',
      confidence: 'high',
      confidenceText: '高',
      keyEvidence: [],
      missingInfo: [],
      relatedCardIds: ['server-card'],
      score: 90,
      displayRank: 1,
      userFacingSummary: '服务端返回错误',
    }];
    summary.expertCards = [{
      id: 'server-card',
      source: 'har',
      category: 'server',
      severity: 'critical',
      confidence: 'high',
      title: 'HTTP 500',
      conclusion: '服务端返回错误',
      scope: { type: 'server-side', summary: '单接口' },
      evidence: [],
      actions: [],
    }];
    summary.actionPlan = [{
      role: 'backend',
      title: '后端处理',
      priority: 3,
      actions: [{ id: 'server-log', title: '查询服务端日志和耗时', detail: '按请求时间检查服务端日志。', priority: 1, sourceCardId: 'server-card' }],
    }];

    render(<FinalDiagnosisPanel finalSummary={summary} hideReferenceConclusions />);

    expect(screen.getByText('请求已经发出，但服务端返回错误或响应太慢')).toBeInTheDocument();
    expect(screen.getByText('用户侧暂时不用再改设置')).toBeInTheDocument();
    expect(screen.getByText(/后端：/)).toBeInTheDocument();
    expect(screen.queryByText('先做这一件事')).not.toBeInTheDocument();
  });

  it('uses theme variables instead of light-only backgrounds on the novice flow', () => {
    const summary = finalSummary();
    summary.headline = [{
      id: 'final-proxy-theme',
      kind: 'needs-more-data',
      source: 'netlog',
      category: 'proxy',
      title: '代理待验证',
      problem: '当前存在代理配置。',
      reason: '记录到 fixed_servers。',
      impact: '可能影响访问。',
      confidence: 'medium',
      confidenceText: '中',
      keyEvidence: [],
      missingInfo: [],
      relatedCardIds: ['proxy-card'],
      score: 60,
      displayRank: 1,
      userFacingSummary: '代理可能影响访问',
    }];
    summary.expertCards.unshift({
      id: 'proxy-card',
      source: 'netlog',
      category: 'proxy',
      severity: 'info',
      confidence: 'high',
      title: '检测到代理',
      conclusion: '当前存在代理配置',
      scope: { type: 'global', summary: '全局' },
      evidence: [],
      actions: [],
    });
    summary.actionPlan = [{
      role: 'user',
      title: '用户先做',
      priority: 1,
      actions: [{ id: 'proxy-off', title: '临时关闭代理/VPN后重试', detail: '临时关闭后重新访问。', priority: 1, sourceCardId: 'proxy-card' }],
    }];
    document.documentElement.setAttribute('data-theme', 'dark');

    const { container } = render(<FinalDiagnosisPanel finalSummary={summary} hideReferenceConclusions />);
    const themedNodes = Array.from(container.querySelectorAll('.novice-troubleshooting-flow [style]'));

    expect(themedNodes.length).toBeGreaterThan(0);
    themedNodes.forEach(node => {
      expect(node.getAttribute('style')).not.toMatch(/rgba\(255|rgba\(248|rgba\(236|rgba\(254/);
    });
    expect(container.querySelector('.novice-troubleshooting-problem')).toHaveStyle({ background: 'var(--bg-surface)' });
    expect(container.querySelector('.novice-troubleshooting-action')).toHaveStyle({ background: 'var(--bg-surface)' });

    document.documentElement.removeAttribute('data-theme');
  });
});
