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
      'trace:timeline:1',
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
});
