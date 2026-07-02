import { buildEvidenceNavigationTargets } from './evidenceNavigation';
import type { DiagnosticCard } from './types';

function makeCard(overrides: Partial<DiagnosticCard>): DiagnosticCard {
  return {
    id: 'card-1',
    source: 'netlog',
    category: 'connect',
    severity: 'warning',
    confidence: 'medium',
    title: '测试卡片',
    conclusion: '测试结论',
    scope: { type: 'single-request', summary: '影响 1 个请求' },
    evidence: [],
    actions: [],
    ...overrides,
  };
}

describe('evidenceNavigation', () => {
  it('使用 relatedSourceIds 跳转 NetLog source，不把 relatedEventIds 当 sourceId', () => {
    const withSourceIds = buildEvidenceNavigationTargets(makeCard({
      relatedSourceIds: [101],
      relatedEventIds: ['7'],
    }));

    expect(withSourceIds.find(target => target.kind === 'events')?.intent.filters).toEqual({ sourceId: '101' });
    expect(withSourceIds.find(target => target.kind === 'events')?.intent.highlight).toEqual({ sourceIds: [101] });

    const withOnlyEventIds = buildEvidenceNavigationTargets(makeCard({
      relatedEventIds: ['7'],
    }));

    expect(withOnlyEventIds.some(target => target.kind === 'events')).toBe(false);
  });
});
