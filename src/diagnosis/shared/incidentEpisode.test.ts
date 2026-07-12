import type { DiagnosticCard, DiagnosticCategory, DiagnosticEvidence } from './types';
import { buildIncidentEpisodes } from './incidentEpisode';
import { buildIncidentNarrative } from './incidentNarrative';

function ev(label: string, value: string, startMs?: number, endMs?: number): DiagnosticEvidence {
  return {
    label,
    value,
    source: 'har',
    requestIds: [Number(value.match(/#(\d+)/)?.[1] || 1)],
    detail: startMs !== undefined ? `startMs=${startMs}; endMs=${endMs ?? startMs}` : undefined,
  };
}

function card(overrides: Partial<DiagnosticCard> & { id: string; category: DiagnosticCategory; startMs?: number; endMs?: number; domain?: string }): DiagnosticCard {
  const requestId = Number(overrides.id.match(/\d+/)?.[0] || 1);
  const base: DiagnosticCard = {
    id: overrides.id,
    source: 'combined',
    category: overrides.category,
    severity: 'critical',
    confidence: 'high',
    title: `${overrides.category} issue`,
    conclusion: `${overrides.domain || 'api.example.test'} failed`,
    scope: { type: 'single-domain', summary: '2 requests', affectedRequestCount: 2, affectedDomainCount: 1 },
    evidence: [ev('请求', `#${requestId} ${overrides.domain || 'api.example.test'}`, overrides.startMs, overrides.endMs)],
    actions: [],
    relatedRequestIds: [requestId],
  };
  return { ...base, ...overrides };
}

describe('incidentEpisode', () => {
  it('merges continuous failures into one episode', () => {
    const episodes = buildIncidentEpisodes([
      card({ id: 'dns-1', category: 'dns', startMs: 1000, endMs: 1200, domain: 'a.example.test' }),
      card({ id: 'dns-2', category: 'dns', startMs: 5000, endMs: 5200, domain: 'a.example.test' }),
    ]);

    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      category: 'dns',
      timeComparable: true,
      startMs: 1000,
      endMs: 5200,
      affectedRequestCount: 2,
    });
    expect(episodes[0].narrative).toContain('DNS 解析失败');
  });

  it('prefers structured card time ranges over evidence prose', () => {
    const first = card({ id: 'dns-1', category: 'dns', domain: 'a.example.test' });
    const second = card({ id: 'dns-2', category: 'dns', domain: 'a.example.test' });
    first.evidence[0].detail = undefined;
    second.evidence[0].detail = undefined;
    first.timeRange = { startMs: 1000, endMs: 1200, clock: 'epoch' };
    second.timeRange = { startMs: 5000, endMs: 5200, clock: 'epoch' };

    const episodes = buildIncidentEpisodes([first, second]);

    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ timeComparable: true, startMs: 1000, endMs: 5200 });
  });

  it('does not merge structured ranges from different clocks', () => {
    const epochCard = card({ id: 'dns-1', category: 'dns', domain: 'a.example.test' });
    const relativeCard = card({ id: 'dns-2', category: 'dns', domain: 'a.example.test' });
    epochCard.evidence[0].detail = undefined;
    relativeCard.evidence[0].detail = undefined;
    epochCard.timeRange = { startMs: 1_700_000_000_000, endMs: 1_700_000_000_200, clock: 'epoch' };
    relativeCard.timeRange = { startMs: 1000, endMs: 1200, clock: 'relative' };

    expect(buildIncidentEpisodes([epochCard, relativeCard])).toHaveLength(2);
  });

  it('does not merge distant failures beyond category window', () => {
    const episodes = buildIncidentEpisodes([
      card({ id: 'dns-1', category: 'dns', startMs: 1000, endMs: 1200 }),
      card({ id: 'dns-2', category: 'dns', startMs: 30000, endMs: 30200 }),
    ]);

    expect(episodes).toHaveLength(2);
  });

  it('detects recovered when success evidence appears after failures', () => {
    const episodes = buildIncidentEpisodes([
      {
        ...card({ id: 'connect-1', category: 'connect', startMs: 1000, endMs: 1400 }),
        evidence: [
          ev('失败请求', '#1 api.example.test', 1000, 1400),
          { label: '恢复成功', value: 'status=200 api.example.test', source: 'har', requestIds: [2], detail: 'startMs=1800; endMs=1900' },
        ],
        relatedRequestIds: [1, 2],
      },
    ]);

    expect(episodes[0].state).toBe('recovered');
    expect(episodes[0].recoveredAtMs).toBe(1800);
    expect(episodes[0].narrative).toContain('恢复成功');
  });

  it('does not promote one mild slow request into global episode', () => {
    const episodes = buildIncidentEpisodes([
      card({
        id: 'perf-1',
        category: 'performance',
        severity: 'info',
        confidence: 'low',
        startMs: 1000,
        endMs: 1200,
        scope: { type: 'single-request', summary: '1 request', affectedRequestCount: 1, affectedDomainCount: 1 },
      }),
    ]);

    expect(episodes).toHaveLength(0);
  });

  it('keeps network change and multiple category order stable', () => {
    const episodes = buildIncidentEpisodes([
      card({ id: 'tls-2', category: 'tls', startMs: 5000, endMs: 5200 }),
      card({ id: 'network-1', category: 'network-change', startMs: 1000, endMs: 1000, domain: 'network-change.example.test' }),
      card({ id: 'dns-3', category: 'dns', startMs: 3000, endMs: 3200 }),
    ]);

    expect(episodes.map(item => item.category)).toEqual(['network-change', 'dns', 'tls']);
  });

  it('does not invent duration when time is not comparable', () => {
    const episodes = buildIncidentEpisodes([
      card({ id: 'dns-1', category: 'dns', startMs: undefined, endMs: undefined }),
      card({ id: 'dns-2', category: 'dns', startMs: undefined, endMs: undefined }),
    ]);

    expect(episodes[0].timeComparable).toBe(false);
    expect(episodes[0].startMs).toBeUndefined();
    expect(episodes[0].narrative).toContain('无法判断持续时间');
  });

  it('builds standalone narrative from an episode', () => {
    const [episode] = buildIncidentEpisodes([
      card({ id: 'dns-1', category: 'dns', startMs: 1000, endMs: 1200 }),
    ]);

    expect(buildIncidentNarrative(episode)).toContain('在 1000ms 至 1200ms');
  });

  it('exposes impact scope, counter evidence and ranking reasons', () => {
    const episodes = buildIncidentEpisodes([
      {
        ...card({ id: 'server-1', category: 'server', startMs: 1000, endMs: 1200, domain: 'api.example.test' }),
        evidence: [
          ev('HTTP 500', '#1 api.example.test status=500', 1000, 1200),
          { label: '成功反证', value: '其他域 status=200', source: 'netlog', requestIds: [2], detail: 'startMs=1300; endMs=1400' },
        ],
        relatedRequestIds: [1, 2],
      },
    ], { requestImportancesByRequestId: new Map([[1, { level: 'high', score: 92, reasons: ['XHR/fetch 业务请求'] }]]) });

    expect(episodes[0].impactScope.type).toBe('server-side');
    expect(episodes[0].counterEvidenceSummary.join('\n')).toContain('不归为客户端全局网络问题');
    expect(episodes[0].rankingReasons.join('\n')).toContain('高重要性业务请求');
    expect(episodes[0].representativeRequestIds[0]).toBe(1);
  });
});
