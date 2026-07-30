import { MinimalTraceAggregator } from './minimalTraceAggregator';
import type { ChromiumTraceEvent, ChromiumTraceFile } from './types';

const intake = { encoding: 'plain-json' as const, jsonBytes: 1024, skippedEventCount: 0, warnings: [] };
function trace(events: unknown[]): ChromiumTraceFile { return { traceEvents: events as ChromiumTraceEvent[] }; }
async function aggregate(events: unknown[]) {
  return new MinimalTraceAggregator(intake).aggregate(trace(events), {
    isCancelled: () => false, onProgress: () => undefined,
  });
}
const navigation = [
  { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
  { name: 'TracingStartedInBrowser', ts: 0, args: { data: { frames: [
    { frame: 'root', processId: 1, isOutermostMainFrame: true },
  ] } } },
  { name: 'navigationStart', ts: 1, args: { data: { frame: 'root', navigationId: 'nav' } } },
];

describe('MinimalTraceAggregator collector contract fixes', () => {
  it('classifies 200 and 404 and preserves a multi-hop redirect chain', async () => {
    const result = await aggregate([
      ...navigation,
      { name: 'ResourceSendRequest', ts: 100, args: { data: { requestId: 'ok', navigationId: 'nav', url: 'https://example.test/ok' } } },
      { name: 'ResourceReceiveResponse', ts: 110, args: { data: { requestId: 'ok', statusCode: 200 } } },
      { name: 'ResourceFinish', ts: 120, args: { data: { requestId: 'ok' } } },
      { name: 'ResourceSendRequest', ts: 200, args: { data: { requestId: 'missing', navigationId: 'nav', url: 'https://example.test/missing' } } },
      { name: 'ResourceReceiveResponse', ts: 210, args: { data: { requestId: 'missing', statusCode: 404 } } },
      { name: 'ResourceFinish', ts: 220, args: { data: { requestId: 'missing' } } },
      { name: 'ResourceSendRequest', ts: 300, args: { data: { requestId: 'redirect', navigationId: 'nav', url: 'https://example.test/a' } } },
      { name: 'ResourceReceiveResponse', ts: 310, args: { data: { requestId: 'redirect', statusCode: 301 } } },
      { name: 'ResourceSendRequest', ts: 320, args: { data: { requestId: 'redirect', navigationId: 'nav', url: 'https://example.test/b' } } },
      { name: 'ResourceReceiveResponse', ts: 330, args: { data: { requestId: 'redirect', statusCode: 302 } } },
      { name: 'ResourceSendRequest', ts: 340, args: { data: { requestId: 'redirect', navigationId: 'nav', url: 'https://example.test/c' } } },
      { name: 'ResourceReceiveResponse', ts: 350, args: { data: { requestId: 'redirect', statusCode: 200 } } },
      { name: 'ResourceFinish', ts: 360, args: { data: { requestId: 'redirect' } } },
      { name: 'capture-end', ts: 1_000 },
    ]);
    const requests = result.facts.context.requests!;
    const redirects = requests.filter(item => ['/a', '/b', '/c'].includes(item.url?.pathname ?? ''));
    expect(requests.find(item => item.url?.pathname === '/ok')?.result).toBe('success');
    expect(requests.find(item => item.url?.pathname === '/missing')?.result).toBe('http-error');
    expect(redirects).toHaveLength(3);
    expect(redirects.map(item => [item.redirectPreviousRequestId, item.redirectNextRequestId])).toEqual([
      [undefined, redirects[1].id], [redirects[0].id, redirects[2].id], [redirects[1].id, undefined],
    ]);
  });

  it('builds complete B/E nodes into per-node self-time categories', async () => {
    const result = await aggregate([
      ...navigation,
      { name: 'RunTask', ph: 'X', ts: 1_000, dur: 100_000, pid: 1, tid: 10 },
      { name: 'EvaluateScript', ph: 'B', ts: 11_000, pid: 1, tid: 10 },
      { name: 'Layout', ph: 'B', ts: 21_000, pid: 1, tid: 10 },
      { name: 'Layout', ph: 'E', ts: 51_000, pid: 1, tid: 10 },
      { name: 'EvaluateScript', ph: 'E', ts: 81_000, pid: 1, tid: 10 },
      { name: 'capture-end', ts: 120_000 },
    ]);
    expect(result.facts.context.tasks![0]).toEqual(expect.objectContaining({
      selfTimeMs: 30, selfTimeConfidence: 'exact',
      categorySelfTimeMs: { script: 40, rendering: 30, other: 30 }, limitations: [],
    }));
  });

  it('uses only the target navigation renderer main span for dispatch busy time', async () => {
    const result = await aggregate([
      { ph: 'M', name: 'thread_name', pid: 1, tid: 10, args: { name: 'CrRendererMain' } },
      { ph: 'M', name: 'thread_name', pid: 2, tid: 20, args: { name: 'CrRendererMain' } },
      { name: 'FrameCommittedInBrowser', ts: 0, args: { data: { frame: 'root', processId: 1, isOutermostMainFrame: true } } },
      { name: 'navigationStart', ts: 1, args: { data: { frame: 'root', navigationId: 'swap' } } },
      { name: 'FrameCommittedInBrowser', ts: 50_000, args: { data: { frame: 'root', processId: 2, isOutermostMainFrame: true } } },
      { name: 'ResourceSendRequest', ts: 60_000, args: { data: {
        requestId: 'dispatch', navigationId: 'swap', url: 'https://example.test/api',
        calibratedNetworkSendMs: 40, calibratedNetworkResponseMs: 60, rendererResponseEventMs: 90,
        mainThreadProcessingStartMs: 95,
        networkTimeDomain: 'renderer-clock', rendererTimeDomain: 'renderer-clock', traceTimeDomain: 'renderer-clock',
      } } },
      { name: 'RunTask', ph: 'X', ts: 60_000, dur: 30_000, pid: 1, tid: 10 },
      { name: 'RunTask', ph: 'X', ts: 70_000, dur: 10_000, pid: 2, tid: 20 },
      { name: 'capture-end', ts: 100_000 },
    ]);
    const request = result.facts.context.requests![0];
    expect(request.dispatch).toEqual({ dispatchWaitMs: 30, mainThreadOverlapMs: 10 });
    expect(request.timing).toEqual({
      trace: { startUs: 60_000 },
      network: { sendMs: 40, responseMs: 60, durationMs: 20, domain: 'renderer-clock' },
      renderer: { responseEventMs: 90, mainThreadProcessingStartMs: 95, domain: 'renderer-clock' },
      networkToRendererMs: 30,
      rendererQueueMs: 5,
    });
  });

  it('reports timing-domain limitations without mixing partial fields', async () => {
    const result = await aggregate([
      ...navigation,
      { name: 'ResourceSendRequest', ts: 100, args: { data: {
        requestId: 'partial', navigationId: 'nav', url: 'https://example.test/api', calibratedNetworkResponseMs: 10,
      } } },
      { name: 'capture-end', ts: 1_000 },
    ]);
    const request = result.facts.context.requests![0];
    expect(request.timing).toEqual({ trace: { startUs: 100 }, network: { responseMs: 10 } });
    expect(request.limitations).toEqual(expect.arrayContaining([
      'request-network-time-domain-unavailable',
      'request-network-send-timing-unavailable',
      'request-renderer-response-timing-unavailable',
      'request-main-thread-processing-start-unavailable',
      'dispatch-time-domain-unavailable',
    ]));
  });

  it('emits Layout as an observation clue and keeps DTOs private and bounded', async () => {
    const unsafeName = `work\n${'x'.repeat(200)}`;
    const result = await aggregate([
      ...navigation,
      { name: 'RunTask', ph: 'X', ts: 1_000, dur: 60_000, pid: 1, tid: 10 },
      { name: 'Layout', ph: 'X', ts: 10_000, dur: 5_000, pid: 1, tid: 10, args: { data: { stack: [{}] } } },
      { name: 'Profile', ts: 1_000, pid: 1, tid: 10, id: 'p', args: { data: { startTime: 1_000 } } },
      { name: 'ProfileChunk', ts: 2_000, pid: 1, tid: 10, id: 'p', args: { data: {
        cpuProfile: { nodes: [{ id: 1, callFrame: {
          functionName: unsafeName, url: 'https://example.test/app.js?token=secret',
        } }], samples: [1] },
        timeDeltas: [10_000], headers: { Authorization: 'secret' },
      } } },
      { name: 'capture-end', ts: 80_000 },
    ]);
    const hotspot = result.facts.context.cpuHotspots![0];
    const clue = result.facts.context.forcedReflowClues![0];
    const serialized = JSON.stringify(result.facts.context);
    expect(clue).toEqual(expect.objectContaining({ confidence: 'observation', taskId: expect.stringMatching(/^trace:task:1:10:1000:event:\d+$/) }));
    expect(hotspot.functionName.length).toBeLessThanOrEqual(120);
    expect(Array.from(hotspot.functionName).some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })).toBe(false);
    expect(serialized).not.toMatch(/token=secret|Authorization|headers|callFrame|args/);
  });

  it('does not subtract request timestamps across different domains', async () => {
    const result = await aggregate([
      ...navigation,
      { name: 'ResourceSendRequest', ts: 100, args: { data: {
        requestId: 'domains', navigationId: 'nav', url: 'https://example.test/api',
        calibratedNetworkSendMs: 10, calibratedNetworkResponseMs: 30,
        rendererResponseEventMs: 50, mainThreadProcessingStartMs: 60,
        networkTimeDomain: 'network-clock', rendererTimeDomain: 'renderer-clock',
      } } },
      { name: 'capture-end', ts: 1_000 },
    ]);
    const timing = result.facts.context.requests![0].timing;
    expect(timing.network?.durationMs).toBe(20);
    expect(timing.networkToRendererMs).toBeUndefined();
    expect(timing.rendererQueueMs).toBe(10);
    expect(result.facts.context.requests![0].limitations).toContain('request-time-domains-differ');
  });

  it('uses the anonymous fallback for an empty profile function name', async () => {
    const result = await aggregate([
      ...navigation,
      { name: 'Profile', ts: 1_000, pid: 1, tid: 10, id: 'empty', args: { data: { startTime: 1_000 } } },
      { name: 'ProfileChunk', ts: 2_000, pid: 1, tid: 10, id: 'empty', args: { data: {
        cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: '   ' } }], samples: [1] },
        timeDeltas: [5_000],
      } } },
      { name: 'capture-end', ts: 10_000 },
    ]);
    expect(result.facts.context.cpuHotspots![0]).toEqual(expect.objectContaining({
      functionName: '(anonymous)', sampleTimeMs: 5,
    }));
  });


  it('summarizes all frames before bounded detail truncation', async () => {
    const result = await new MinimalTraceAggregator(intake, { maxFactsPerKind: 1 }).aggregate(trace([
      ...navigation,
      { name: 'DrawFrame', ph: 'X', ts: 1_000, dur: 10_000, pid: 1, tid: 10 },
      { name: 'DrawFrame', ph: 'X', ts: 20_000, dur: 20_000, pid: 1, tid: 10 },
      { name: 'DrawFrame', ph: 'X', ts: 50_000, dur: 30_000, pid: 1, tid: 10 },
      { name: 'EventTiming', ts: 2_000, pid: 1, tid: 10, args: { data: {
        interactionId: 1, eventStart: 2_000, processingStart: 3_000,
        processingEnd: 4_000, interactionEnd: 12_000,
      } } },
      { name: 'EventTiming', ts: 20_000, pid: 1, tid: 10, args: { data: {
        interactionId: 2, eventStart: 20_000, processingStart: 25_000,
        processingEnd: 40_000, interactionEnd: 90_000,
      } } },
      { name: 'capture-end', ts: 100_000 },
    ]), { isCancelled: () => false, onProgress: () => undefined });

    expect(result.facts.context.animationFrames).toHaveLength(1);
    expect(result.facts.context.animationFrameSummary).toEqual({
      completeness: 'complete',
      limitations: [],
      totalCount: 3,
      droppedCount: 0,
      overBudgetCount: 2,
      maxDurationMs: 30,
      budgetMs: 16.7,
      budgetBasis: '60hz-reference',
      refreshRate: 'unknown',
    });
    expect(result.facts.context.interactions).toHaveLength(1);
    expect(result.facts.context.interactionSummary).toEqual({
      completeness: 'complete',
      limitations: [],
      totalCount: 2,
      slowestInteractionId: undefined,
      maxTotalLatencyMs: 70,
    });
  });

});
