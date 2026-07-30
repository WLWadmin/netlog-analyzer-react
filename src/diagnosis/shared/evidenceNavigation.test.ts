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

  it('保持 combined 请求证据默认回到 HAR 的既有合同', () => {
    const targets = buildEvidenceNavigationTargets(makeCard({
      source: 'combined',
      relatedRequestIds: [7],
    }));

    expect(targets.find(target => target.kind === 'requests')?.intent.fileType).toBe('har');
  });

  it('combined 原始字段默认回 HAR，originalSource 明确时服从证据来源', () => {
    const ambiguous = buildEvidenceNavigationTargets(makeCard({
      source: 'combined',
      evidence: [{ label: '字段', value: '值', source: 'derived', fieldPath: 'traceEvents.7' }],
    }));
    const explicit = buildEvidenceNavigationTargets(makeCard({
      source: 'combined',
      evidence: [{
        label: '字段',
        value: '值',
        source: 'netlog',
        originalSource: 'netlog',
        fieldPath: 'events.7',
      }],
    }));

    expect(ambiguous.find(target => target.kind === 'raw-evidence')?.intent.fileType).toBe('har');
    expect(explicit.find(target => target.kind === 'raw-evidence')?.intent.fileType).toBe('netlog');
  });
});
