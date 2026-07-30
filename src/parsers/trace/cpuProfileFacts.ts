import type { TraceParserWarning } from './types';

export interface CpuProfileSample {
  nodeId: number;
  timestampUs: number;
  deltaUs: number;
}

export interface ProfileChunkSamplesResult {
  samples: CpuProfileSample[];
  endTimeUs: number;
  warnings: TraceParserWarning[];
}

export function appendProfileChunkSamples(
  startTimeUs: number,
  samples: readonly number[],
  timeDeltas: readonly number[],
): ProfileChunkSamplesResult {
  const pairedCount = Math.min(samples.length, timeDeltas.length);
  const negativeIndex = timeDeltas.slice(0, pairedCount).findIndex(delta => delta < 0);
  const completeCount = negativeIndex === -1 ? pairedCount : negativeIndex;
  const completeSamples: CpuProfileSample[] = [];
  let timestampUs = startTimeUs;

  for (let index = 0; index < completeCount; index += 1) {
    timestampUs += timeDeltas[index];
    completeSamples.push({ nodeId: samples[index], timestampUs, deltaUs: timeDeltas[index] });
  }
  return {
    samples: completeSamples,
    endTimeUs: timestampUs,
    warnings: [
      ...(negativeIndex === -1 ? [] : ['TRACE_PROFILE_NEGATIVE_TIME_DELTA' as const]),
      ...(samples.length === timeDeltas.length ? [] : ['TRACE_PROFILE_CHUNK_TAIL_INCOMPLETE' as const]),
    ],
  };
}
