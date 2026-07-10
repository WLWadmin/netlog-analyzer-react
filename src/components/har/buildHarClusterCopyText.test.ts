import type { HarIssueCluster } from '../../diagnosis/shared/harIssueClusters';
import { buildHarClusterCopyText } from './buildHarClusterCopyText';

describe('buildHarClusterCopyText', () => {
  it('copies cluster handoff summary without sensitive URL query/body/header values', () => {
    const cluster: HarIssueCluster = {
      id: 'c1',
      category: 'ttfb',
      evidenceLevel: 'timing-signal',
      severity: 'warning',
      title: '2 个请求集中慢在服务端响应阶段',
      userFacingSummary: 'summary',
      affectedRequestCount: 2,
      affectedDomainCount: 1,
      affectedRequestIds: [0, 1],
      representativeRequestIds: [0],
      maxDurationMs: 2000,
      evidence: [
        { label: '代表请求', value: 'https://example.com/api?token=SECRET_QUERY', source: 'har', requestIds: [0] },
        { label: 'Header', value: 'Authorization=SECRET_AUTH', source: 'har' },
      ],
      roleHints: ['backend'],
      requiresNetLog: false,
      groupingReason: '按 domain 和 timing 聚合',
    };

    const text = buildHarClusterCopyText(cluster);

    expect(text).toContain('HAR 问题摘要');
    expect(text).toContain('request #1');
    expect(text).not.toContain('SECRET_QUERY');
    expect(text).not.toContain('SECRET_AUTH');
  });
});
