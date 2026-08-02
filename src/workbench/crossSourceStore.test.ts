import type { TraceRequestFacts } from '../parsers/trace/types';
import { CrossSourceStore } from './crossSourceStore';

function traceRequest(index: number): TraceRequestFacts {
  return {
    id: `trace-request-${index}`,
    requestId: `request-${index}`,
    navigationKey: 'navigation-1',
    redirectIndex: index - 1,
    url: { origin: 'https://api.example.test', pathname: `/resource-${index}` },
    method: 'GET',
    result: 'success',
    resultConfidence: 'high',
    timing: { trace: { startUs: index * 1_000_000 } },
    initiatorEvidenceIds: [],
    evidenceIds: [`trace:event:${index}`],
    limitations: [],
    dataEventCount: 0,
  };
}

function harFile(): File {
  return new File([JSON.stringify({
    log: {
      creator: { name: 'synthetic' },
      pages: [{
        id: 'navigation-1',
        startedDateTime: '2026-08-02T00:00:00.000Z',
        pageTimings: {},
      }],
      entries: [1, 2].map(index => ({
        pageref: 'navigation-1',
        startedDateTime: `2026-08-02T00:00:0${index}.000Z`,
        time: 100,
        request: {
          method: 'GET',
          url: `https://api.example.test/resource-${index}?token=<REDACTED>`,
          headers: [],
          queryString: [{ name: 'token', value: '<REDACTED>' }],
        },
        response: {
          status: 200,
          statusText: 'OK',
          headers: [],
          content: { size: 0, mimeType: 'application/json' },
        },
        timings: {
          blocked: 0, dns: 0, connect: 0, ssl: 0,
          send: 1, wait: 98, receive: 1,
        },
      })),
    },
  })], 'synthetic.har', { type: 'application/json' });
}

function netlogFile(): File {
  return new File([JSON.stringify({
    constants: {
      timeTickOffset: 1_775_260_800_000,
      logEventTypes: { URL_REQUEST_START_JOB: 111 },
      logSourceType: { URL_REQUEST: 1 },
    },
    events: [1, 2].map(index => ({
      time: String(index * 1000),
      type: 111,
      phase: 0,
      source: { id: index, type: 1 },
      params: {
        url: `https://api.example.test/resource-${index}?secret=<REDACTED>`,
        method: 'GET',
      },
    })),
  })], 'synthetic.json', { type: 'application/json' });
}

describe('CrossSourceStore lifecycle', () => {
  it('adds, replaces and removes sources while revoking dependent graph state', async () => {
    const store = new CrossSourceStore(
      'trace:1',
      [traceRequest(1), traceRequest(2)],
      1_000,
    );
    await store.addSource('har', harFile());
    await store.addSource('netlog', netlogFile());

    expect(store.getSources()).toHaveLength(3);
    expect(store.getAlignments().map(item => item.confidence)).toEqual([
      'high',
      'high',
    ]);
    expect(store.getCorrelations(100).candidates.some(candidate => (
      candidate.confidence === 'high'
    ))).toBe(true);
    const graphBefore = store.getEvidenceGraph(100);
    expect(graphBefore.edges.length).toBeGreaterThan(0);
    expect(store.getEvidenceGraph(4).edges.length).toBeGreaterThan(0);
    expect(store.getEvidenceGraph(100, 'cpu-profile:unrelated')).toEqual({
      nodes: [],
      edges: [],
      limitations: ['所选跨源实体当前不可用，可能已随来源移除或替换撤销。'],
      totalMatched: 0,
    });
    expect(store.getEvidenceGraph(100, undefined, {
      startUs: 50_000_000,
      endUs: 60_000_000,
    })).toMatchObject({ nodes: [], edges: [], totalMatched: 0 });
    const selected = store.getCorrelations(100).entities.find(entity => (
      entity.sourceId.startsWith('trace:')
    ))!;
    const localGraph = store.getEvidenceGraph(100, selected.entityId);
    expect(localGraph.nodes.length).toBeLessThan(graphBefore.nodes.length);
    expect(localGraph.edges.length).toBeGreaterThan(0);

    const har = store.getSources().find(source => source.kind === 'har')!;
    const replacement = await store.addSource('har', harFile(), har.sourceId);
    expect(replacement.operation).toBe('replaced');
    expect(replacement.revokedFindingCount).toBe(0);
    expect(store.getSources().filter(source => source.kind === 'har')).toHaveLength(1);

    const netlog = store.getSources().find(source => source.kind === 'netlog')!;
    const removed = store.removeSource(netlog.sourceId);
    expect(removed.revokedEdgeCount).toBeGreaterThan(0);
    expect(store.getSources().map(source => source.kind)).toEqual(['har', 'trace']);
    expect(store.getEvidenceGraph(100).edges.every(edge => (
      !edge.edgeId.includes(netlog.sourceId)
    ))).toBe(true);
  });

  it('preserves stable sources when parsing a replacement fails', async () => {
    const store = new CrossSourceStore('trace:1', [traceRequest(1)], 1_000);
    await store.addSource('har', harFile());
    const stable = store.getSources();
    const har = stable.find(source => source.kind === 'har')!;

    await expect(store.addSource(
      'har',
      new File(['{"unknown":true}'], 'invalid.json'),
      har.sourceId,
    )).rejects.toThrow();
    expect(store.getSources()).toEqual(stable);
  });

  it('includes requests whose duration overlaps the closed graph range', async () => {
    const request = traceRequest(1);
    request.timing.trace.endUs = 2_000_000;
    const store = new CrossSourceStore('trace:1', [request], 1_000);
    await store.addSource('har', harFile());

    expect(store.getCorrelations(100).entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: 'trace:request:0',
        duration: { value: 1_000_000, unit: 'us' },
      }),
      expect.objectContaining({
        sourceId: expect.stringMatching(/^har:/),
        duration: { value: 100_000, unit: 'us' },
      }),
    ]));
    expect(store.getEvidenceGraph(100, undefined, {
      startUs: 1_500_000,
      endUs: 1_500_000,
    }).nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: 'trace:request:0' }),
    ]));
    expect(store.getEvidenceGraph(100, undefined, {
      startUs: 2_000_001,
      endUs: 2_000_001,
    })).toMatchObject({ nodes: [], edges: [], totalMatched: 0 });
  });

  it('links only eligible request correlations to overlapping Trace evidence as candidates', async () => {
    const store = new CrossSourceStore(
      'trace:1',
      [traceRequest(1), traceRequest(2)],
      1_000,
      [{
        entityId: 'trace:timeline:task',
        kind: 'symptom',
        label: 'Long task',
        trackId: 'main',
        startUs: 1_000_000,
        durationUs: 100_000,
        evidenceIds: ['trace:event:task'],
        limitations: ['时间重叠不是因果证明。'],
      }],
    );
    await store.addSource('har', harFile());

    const graph = store.getEvidenceGraph(200);
    const contribution = graph.edges.find(edge => (
      edge.relationship === 'candidate-contribution'
    ));
    expect(contribution).toMatchObject({
      label: '候选贡献关系',
      confidence: 'high',
      conflictingFields: [],
      counterEvidence: [expect.stringContaining('不能证明')],
      alternativeExplanations: [expect.stringContaining('其他并发请求')],
      limitations: [expect.stringContaining('不是 confirmed 根因')],
    });
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: 'trace:timeline:task',
        kind: 'symptom',
        facts: ['轨道：main'],
      }),
    ]));
    expect(store.getInsights({
      startUs: 1_000_000,
      endUs: 1_100_000,
    }, 10)).toMatchObject({
      insights: [{
        priority: 1,
        phenomenon: 'Long task',
        evidenceQuality: 'high',
        attributionLevel: 'possible-contributor',
        candidateReasons: ['候选贡献关系'],
        verificationSteps: expect.arrayContaining([
          expect.stringContaining('证据路径'),
        ]),
      }],
      totalMatched: 1,
    });
  });

  it('explains an empty Insights range without inventing a cause', () => {
    const store = new CrossSourceStore('trace:1', [traceRequest(1)], 1_000, []);
    expect(store.getInsights({ startUs: 0, endUs: 10 }, 10)).toMatchObject({
      insights: [],
      totalMatched: 0,
      emptyReason: expect.stringContaining('缺少可用于 Insights'),
    });
  });

  it('requires explicit same-kind replacement and rejects invalid removals', async () => {
    const store = new CrossSourceStore('trace:1', [traceRequest(1)], 1_000);
    await store.addSource('har', harFile());

    await expect(store.addSource('har', harFile())).rejects.toThrow(
      'requires explicit replacement',
    );
    await expect(store.addSource('har', harFile(), 'trace:1')).rejects.toThrow(
      'does not match',
    );
    expect(() => store.removeSource('trace:1')).toThrow(
      'Only an existing HAR or NetLog source',
    );
    expect(store.getSources().map(source => source.kind)).toEqual(['har', 'trace']);
  });
});
