import type { ChromiumTraceFile } from '../parsers/trace/types';
import { MinimalTraceEngineAdapter } from './traceEngineAdapter';

const trace: ChromiumTraceFile = {
  traceEvents: [
    {
      name: 'RunTask',
      cat: 'devtools.timeline',
      ph: 'X',
      ts: 10,
      dur: 20,
      pid: 1,
      tid: 10,
      args: { privateDetail: '<REDACTED>' },
    },
    {
      name: 'Screenshot',
      ts: 15,
      args: { snapshot: 'AQIDBA==' },
    },
  ],
};

describe('MinimalTraceEngineAdapter', () => {
  it('produces deterministic metadata, capabilities and timeline IDs', async () => {
    const first = new MinimalTraceEngineAdapter(trace, {
      encoding: 'plain-json',
      jsonBytes: 100,
      skippedEventCount: 0,
      warnings: [],
    });
    const second = new MinimalTraceEngineAdapter(trace, {
      encoding: 'plain-json',
      jsonBytes: 100,
      skippedEventCount: 0,
      warnings: [],
    });
    const options = {
      isCancelled: () => false,
      onProgress: jest.fn(),
    };

    const firstAnalysis = await first.analyze(options);
    const secondAnalysis = await second.analyze(options);
    expect(firstAnalysis).toEqual(secondAnalysis);
    expect(first.getMetadata()).toEqual({
      engine: 'minimal-trace-aggregator',
      eventCount: 2,
      jsonBytes: 100,
    });
    expect(first.getCapabilities()).toEqual(expect.arrayContaining([
      { capability: 'timeline-events', status: 'available' },
      { capability: 'event-detail', status: 'available' },
      { capability: 'screenshots', status: 'available' },
      expect.objectContaining({ capability: 'cpu-profile', status: 'missing' }),
    ]));

    const session = await first.buildSessionData({
      isCancelled: () => false,
      onProgress: jest.fn(),
    });
    expect(session.timeline.query({
      startUs: 10,
      endUs: 30,
      limit: 10,
    }).events.map(event => event.id)).toEqual([
      'trace:timeline:0',
    ]);
    expect(JSON.stringify(session.timeline.query({
      startUs: 10,
      endUs: 30,
      limit: 10,
    }))).not.toMatch(/args|privateDetail|AQIDBA/);
  });

  it('uses cooperative cancellation for aggregation and indexing', async () => {
    const adapter = new MinimalTraceEngineAdapter(trace, {
      encoding: 'plain-json',
      jsonBytes: 100,
      skippedEventCount: 0,
      warnings: [],
    }, {
      cancellationInterval: 1,
    });

    await expect(adapter.analyze({
      isCancelled: () => true,
      onProgress: jest.fn(),
    })).rejects.toMatchObject({ name: 'TraceAggregationCancelled' });
  });

  it('releases timeline and raw evidence resources', async () => {
    const adapter = new MinimalTraceEngineAdapter(trace, {
      encoding: 'plain-json',
      jsonBytes: 100,
      skippedEventCount: 0,
      warnings: [],
    });
    await adapter.analyze({
      isCancelled: () => false,
      onProgress: jest.fn(),
    });
    const session = await adapter.buildSessionData({
      isCancelled: () => false,
      onProgress: jest.fn(),
    });
    adapter.release();

    expect(session.timeline.getStats().eventCount).toBe(0);
    expect(session.evidence.getStats().evidenceCount).toBe(0);
  });

  it('projects bounded analysis facts into semantic Timeline tracks', async () => {
    const adapter = new MinimalTraceEngineAdapter({
      traceEvents: [
        {
          name: 'TracingStartedInBrowser',
          ts: 0,
          args: { data: { frames: [{ frame: 'root', processId: 1, isOutermostMainFrame: true }] } },
        },
        {
          name: 'navigationStart',
          ts: 1,
          args: { data: { frame: 'root', navigationId: 'nav' } },
        },
        {
          name: 'ResourceSendRequest',
          ts: 100,
          args: { data: { requestId: 'request', navigationId: 'nav', url: 'https://example.test/path' } },
        },
        {
          name: 'ResourceReceiveResponse',
          ts: 200,
          args: { data: { requestId: 'request', statusCode: 404 } },
        },
        {
          name: 'ResourceFinish',
          ts: 400,
          args: { data: { requestId: 'request' } },
        },
        { name: 'RunTask', ph: 'X', ts: 500, dur: 80_000, pid: 1, tid: 1 },
        { name: 'Layout', ph: 'X', ts: 700, dur: 20_000, pid: 1, tid: 1 },
      ],
    }, {
      encoding: 'plain-json',
      jsonBytes: 1_000,
      skippedEventCount: 0,
      warnings: [],
    });
    const options = { isCancelled: () => false, onProgress: jest.fn() };
    await adapter.analyze(options);
    const session = await adapter.buildSessionData(options);
    const events = session.timeline.query({
      startUs: 0,
      endUs: 100_000,
      limit: 100,
    }).events;

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trackId: 'network',
        durationUs: 300,
        status: 'error',
      }),
      expect.objectContaining({
        trackId: 'main',
        durationUs: 80_000,
        status: 'warning',
      }),
      expect.objectContaining({
        trackId: 'rendering',
        durationUs: 20_000,
      }),
    ]));
    expect(JSON.stringify(events)).not.toMatch(/example\.test|requestId|args/);
  });

  it('keeps unclassified evidence out of the Timeline and deduplicates request lifecycle events', async () => {
    const unclassified = Array.from({ length: 2_000 }, (_, index) => ({
      name: `Unclassified-${index}`,
      ph: 'I',
      ts: index,
      pid: 1,
      tid: 1,
      args: { retainedOnlyInEvidence: index },
    }));
    const adapter = new MinimalTraceEngineAdapter({
      traceEvents: [
        ...unclassified,
        {
          name: 'ResourceSendRequest',
          ts: 3_000,
          args: { data: { requestId: 'request', url: 'https://example.test/resource' } },
        },
        {
          name: 'ResourceReceiveResponse',
          ts: 4_000,
          args: { data: { requestId: 'request', statusCode: 200 } },
        },
        {
          name: 'ResourceFinish',
          ts: 5_000,
          args: { data: { requestId: 'request' } },
        },
        { name: 'RunTask', ph: 'X', ts: 6_000, dur: 70_000, pid: 1, tid: 1 },
        { name: 'Layout', ph: 'X', ts: 7_000, dur: 10_000, pid: 1, tid: 1 },
      ],
    }, {
      encoding: 'plain-json',
      jsonBytes: 100_000,
      skippedEventCount: 0,
      warnings: [],
    });
    const options = { isCancelled: () => false, onProgress: jest.fn() };
    await adapter.analyze(options);
    const session = await adapter.buildSessionData(options);
    const result = session.timeline.query({
      startUs: 0,
      endUs: 100_000,
      limit: 10,
    });

    expect(result.events.map(event => event.trackId)).toEqual([
      'network',
      'main',
      'rendering',
    ]);
    expect(result.events.filter(event => event.trackId === 'network')).toHaveLength(1);
    expect(result.truncation).toMatchObject({
      truncated: false,
      totalMatched: 3,
    });
    expect(session.evidence.getDetail('trace:event:1999')).toMatchObject({
      evidenceId: 'trace:event:1999',
      name: 'Unclassified-1999',
    });
  });
});
