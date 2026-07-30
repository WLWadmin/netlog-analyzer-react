import fs from 'fs';
import path from 'path';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextDecoder as NodeTextDecoder } from 'util';
import { gunzipSync } from 'zlib';
import { readFiniteNumber, readRecord } from './eventAccessors';
import { MinimalTraceAggregator } from './minimalTraceAggregator';
import { readTraceFile, readTraceFileForWorker } from './readTraceFile';

const PLAIN_SAMPLE_PATH = process.env.TRACE_PLAIN_SAMPLE_PATH;
const GZIP_SAMPLE_PATH = process.env.TRACE_GZIP_SAMPLE_PATH;
const shouldRun = Boolean(PLAIN_SAMPLE_PATH && GZIP_SAMPLE_PATH);

beforeAll(() => {
  Object.defineProperty(global, 'ReadableStream', {
    configurable: true,
    value: NodeReadableStream,
  });
  Object.defineProperty(global, 'TextDecoder', {
    configurable: true,
    value: NodeTextDecoder,
  });
});

function loadSample(samplePath: string): File {
  const bytes = fs.readFileSync(samplePath);
  return new File([bytes], path.basename(samplePath));
}

(shouldRun ? describe : describe.skip)('readTraceFile sanitized real samples', () => {
  it('routes a plain Chromium Trace without exposing sample content', async () => {
    const outcome = await readTraceFile(loadSample(PLAIN_SAMPLE_PATH as string));

    expect(outcome.kind).toBe('trace');
    if (outcome.kind !== 'trace') throw new Error('expected trace outcome');
    expect(outcome.summary.encoding).toBe('plain-json');
    expect(outcome.summary.eventCount).toBeGreaterThan(0);
  });

  it('routes a gzip Chromium Trace by magic bytes', async () => {
    const compressed = fs.readFileSync(GZIP_SAMPLE_PATH as string);
    const outcome = await readTraceFile(loadSample(GZIP_SAMPLE_PATH as string), {
      decompress: () => new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(gunzipSync(compressed)));
          controller.close();
        },
      }),
    });

    expect(outcome.kind).toBe('trace');
    if (outcome.kind !== 'trace') throw new Error('expected trace outcome');
    expect(outcome.summary.encoding).toBe('gzip-json');
    expect(outcome.summary.eventCount).toBeGreaterThan(0);
  });

  it('builds facts for event families present in a real plain Trace', async () => {
    const outcome = await readTraceFileForWorker(loadSample(PLAIN_SAMPLE_PATH as string));
    expect(outcome.kind).toBe('trace');
    if (outcome.kind !== 'trace') throw new Error('expected trace outcome');

    const result = await new MinimalTraceAggregator({
      encoding: outcome.intake.encoding,
      jsonBytes: outcome.intake.jsonBytes,
      skippedEventCount: outcome.skippedEventCount,
      warnings: outcome.intake.warnings,
    }).aggregate(outcome.trace, {
      isCancelled: () => false,
      onProgress: () => undefined,
    });
    const names = new Set(outcome.trace.traceEvents.map(event => event.name));

    const hasProfileSamples = outcome.trace.traceEvents.some(event => {
      if (event.name !== 'ProfileChunk') return false;
      const data = readRecord(readRecord(event.args)?.data);
      const cpuProfile = readRecord(data?.cpuProfile);
      const nodes = cpuProfile?.nodes;
      const samples = cpuProfile?.samples;
      return Array.isArray(nodes)
        && Array.isArray(samples)
        && samples.some(value => readFiniteNumber(value) !== undefined);
    });
    expect({
      requestFactsAvailable: !names.has('ResourceSendRequest')
        || (result.facts.context.requests?.length ?? 0) > 0,
      frameFactsAvailable: !(names.has('DrawFrame') || names.has('DroppedFrame'))
        || (result.facts.context.animationFrames?.length ?? 0) > 0,
      cpuHotspotsAvailable: !(names.has('Profile') && hasProfileSamples)
        || (result.facts.context.cpuHotspots?.length ?? 0) > 0,
    }).toEqual({
      requestFactsAvailable: true,
      frameFactsAvailable: true,
      cpuHotspotsAvailable: true,
    });
  });
});
