import {
  ReadableStream as NodeReadableStream,
  TransformStream as NodeTransformStream,
} from 'stream/web';
import { TextDecoder as NodeTextDecoder } from 'util';
import { gzipSync, gunzipSync } from 'zlib';
import { probeFileFormat } from './probeFileFormat';

beforeAll(() => {
  Object.defineProperty(global, 'ReadableStream', {
    configurable: true,
    value: NodeReadableStream,
  });
  Object.defineProperty(global, 'TextDecoder', {
    configurable: true,
    value: NodeTextDecoder,
  });
  Object.defineProperty(global, 'TransformStream', {
    configurable: true,
    value: NodeTransformStream,
  });
});

function parserKinds(outcome: Awaited<ReturnType<typeof probeFileFormat>>) {
  return outcome.verdicts
    .filter(verdict => verdict.kind !== 'no-match')
    .map(verdict => [verdict.parserId, verdict.kind]);
}

describe('probeFileFormat', () => {
  it.each([
    ['HAR', '{"log":{"entries":[]}}', 'har@1'],
    ['NetLog', '{"constants":{},"events":[]}', 'chromium-netlog@1'],
    ['Trace', '{"traceEvents":[]}', 'chromium-performance-trace@1'],
    ['Go Log', '[worker] Info 2026-01-01 Got Success GET:https://example.invalid/ +1ms', 'go-service-log@1'],
  ])('detects %s by structure without returning source content', async (
    _label,
    content,
    parserId,
  ) => {
    const outcome = await probeFileFormat(new File([content], 'sample.data'));

    expect(parserKinds(outcome)).toEqual([[parserId, 'definite-match']]);
    expect(JSON.stringify(outcome)).not.toContain('example.invalid');
    expect(JSON.stringify(outcome)).not.toContain('traceEvents');
  });

  it('keeps conflicting JSON signatures ambiguous', async () => {
    const outcome = await probeFileFormat(new File([
      '{"traceEvents":[],"events":[]}',
    ], 'sample.json'));

    expect(parserKinds(outcome)).toEqual([
      ['chromium-netlog@1', 'possible-match'],
      ['chromium-performance-trace@1', 'possible-match'],
    ]);
  });

  it('keeps a generic events array as a possible NetLog match', async () => {
    const outcome = await probeFileFormat(new File([
      '{"events":[{"type":1,"time":"1","source":{"id":1,"type":1}}]}',
    ], 'sample.json'));

    expect(parserKinds(outcome)).toEqual([
      ['chromium-netlog@1', 'possible-match'],
    ]);
  });

  it('stops after a bounded prefix when a unique strong signature is found', async () => {
    const onProgress = jest.fn();
    const file = new File([
      '{"traceEvents":[],',
      `"padding":"${'x'.repeat(6 * 1024 * 1024)}"}`,
    ], 'large-trace.json');

    const outcome = await probeFileFormat(file, { onProgress });
    const processedBytes = onProgress.mock.calls
      .map(([progress]) => progress.processedBytes)
      .filter((value): value is number => typeof value === 'number');

    expect(parserKinds(outcome)).toEqual([
      ['chromium-performance-trace@1', 'definite-match'],
    ]);
    expect(Math.max(...processedBytes)).toBeLessThan(file.size);
    expect(Math.max(...processedBytes)).toBeLessThanOrEqual(256 * 1024);
  });

  it('does not scan an unknown JSON file beyond the probe budget', async () => {
    const onProgress = jest.fn();
    const file = new File([
      `{"metadata":"${'x'.repeat(6 * 1024 * 1024)}"}`,
    ], 'unknown.json');

    const outcome = await probeFileFormat(file, {
      onProgress,
      maxJsonProbeBytes: 512 * 1024,
    });
    const processedBytes = onProgress.mock.calls
      .map(([progress]) => progress.processedBytes)
      .filter((value): value is number => typeof value === 'number');

    expect(parserKinds(outcome)).toEqual([]);
    expect(Math.max(...processedBytes)).toBeLessThanOrEqual(512 * 1024);
  });

  it('detects gzip Trace by magic bytes and reports compressed work units', async () => {
    const compressed = gzipSync('{"traceEvents":[]}');
    const onProgress = jest.fn();
    const outcome = await probeFileFormat(
      new File([compressed], 'sample.json'),
      {
        onProgress,
        decompress: stream => new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = stream.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            controller.enqueue(new Uint8Array(gunzipSync(Buffer.concat(chunks))));
            controller.close();
          },
        }),
      },
    );

    expect(outcome.container).toBe('gzip');
    expect(parserKinds(outcome)).toEqual([
      ['chromium-performance-trace@1', 'definite-match'],
    ]);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'probing-format',
      totalBytes: compressed.byteLength,
    }));
  });

  it('rejects ZIP before reading its contents', async () => {
    await expect(probeFileFormat(new File([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    ], 'sample.zip'))).rejects.toMatchObject({
      code: 'ZIP_UNSUPPORTED',
    });
  });
});
