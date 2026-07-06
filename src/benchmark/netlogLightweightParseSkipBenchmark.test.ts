import { TextDecoder } from 'util';
import { runLightweightParseSkipBenchmark } from './netlogLightweightParseSkipBenchmark';

Object.assign(global, { TextDecoder });

describe('runLightweightParseSkipBenchmark', () => {
  it('输出 lightweight parse skip 的可复现指标', async () => {
    const metrics = await runLightweightParseSkipBenchmark({
      lightweightEvents: 20,
      heavyEvents: 3,
      chunkSize: 13,
    });

    expect(metrics).toEqual(expect.objectContaining({
      benchmark: 'netlog-lightweight-parse-skip',
      runtime: 'node-jest',
      eventCount: 23,
      lightweightEvents: 20,
      heavyEvents: 3,
      lightweightParseSkippedEvents: 20,
    }));
    expect(metrics.lightweightParseSkippedBytes).toBeGreaterThan(0);
    expect(metrics.skipEventRate).toBeCloseTo(20 / 23, 4);
    expect(metrics.skippedBytesPerSkippedEvent).toBeGreaterThan(0);
    expect(metrics.indexBuildMs).toBeGreaterThanOrEqual(0);
  });
});
