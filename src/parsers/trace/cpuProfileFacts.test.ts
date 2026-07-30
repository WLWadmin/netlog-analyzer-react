import { appendProfileChunkSamples } from './cpuProfileFacts';

describe('appendProfileChunkSamples', () => {
  it('advances sample timestamps using complete sample and delta pairs', () => {
    expect(appendProfileChunkSamples(1_000, [7, 8], [10, 20])).toEqual({
      samples: [
        { nodeId: 7, timestampUs: 1_010, deltaUs: 10 },
        { nodeId: 8, timestampUs: 1_030, deltaUs: 20 },
      ],
      endTimeUs: 1_030,
      warnings: [],
    });
  });

  it('skips an incomplete tail and returns a parser warning', () => {
    expect(appendProfileChunkSamples(1_000, [7, 8, 9], [10, 20])).toEqual({
      samples: [
        { nodeId: 7, timestampUs: 1_010, deltaUs: 10 },
        { nodeId: 8, timestampUs: 1_030, deltaUs: 20 },
      ],
      endTimeUs: 1_030,
      warnings: ['TRACE_PROFILE_CHUNK_TAIL_INCOMPLETE'],
    });
    expect(appendProfileChunkSamples(1_000, [7], [10, 20])).toEqual({
      samples: [{ nodeId: 7, timestampUs: 1_010, deltaUs: 10 }],
      endTimeUs: 1_010,
      warnings: ['TRACE_PROFILE_CHUNK_TAIL_INCOMPLETE'],
    });
  });
});
