import {
  ReadableStream as NodeReadableStream,
  TransformStream as NodeTransformStream,
} from 'stream/web';
import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'util';
import { gzipSync, gunzipSync } from 'zlib';
import {
  probeFileFormat,
  probeFileFormatStreamSession,
} from './probeFileFormat';

beforeAll(() => {
  Object.defineProperty(global, 'ReadableStream', {
    configurable: true,
    value: NodeReadableStream,
  });
  Object.defineProperty(global, 'TextDecoder', {
    configurable: true,
    value: NodeTextDecoder,
  });
  Object.defineProperty(global, 'TextEncoder', {
    configurable: true,
    value: NodeTextEncoder,
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

function decompressWithGunzip(
  stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
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
  });
}

describe('probeFileFormat', () => {
  it('replays the consumed prefix and remaining bytes from one source stream', async () => {
    const bytes = new TextEncoder().encode(
      '{"events":[],"constants":{},"padding":"after-probe"}',
    );
    const openStream = jest.fn(() => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 18));
        controller.enqueue(bytes.subarray(18));
        controller.close();
      },
    }));

    const session = await probeFileFormatStreamSession(
      openStream(),
      { fileSize: 20 * 1024 * 1024 + 1 },
    );
    const reader = session.stream.getReader();
    const replayed: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      replayed.push(value);
    }

    expect(openStream).toHaveBeenCalledTimes(1);
    expect(session.outcome.verdicts).toContainEqual(expect.objectContaining({
      kind: 'definite-match',
      parserId: 'chromium-netlog@1',
    }));
    const replayedLength = replayed.reduce(
      (total, chunk) => total + chunk.byteLength,
      0,
    );
    const replayedBytes = new Uint8Array(replayedLength);
    let replayedOffset = 0;
    replayed.forEach(chunk => {
      replayedBytes.set(chunk, replayedOffset);
      replayedOffset += chunk.byteLength;
    });
    expect(new TextDecoder().decode(replayedBytes)).toBe(
      new TextDecoder().decode(bytes),
    );
  });

  it.each([
    ['ZIP', new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 4, 'ZIP_UNSUPPORTED'],
    ['oversized gzip', new Uint8Array([0x1f, 0x8b, 0x08, 0x00]), 65 * 1024 * 1024, 'GZIP_TOO_LARGE'],
  ])('cancels the source stream when %s is rejected before probing', async (
    _label,
    bytes,
    fileSize,
    code,
  ) => {
    const cancel = jest.fn();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel,
    });

    await expect(probeFileFormatStreamSession(source, { fileSize }))
      .rejects.toMatchObject({ code });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

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

  it('returns no parser candidate for an empty file', async () => {
    const outcome = await probeFileFormat(new File([], 'empty.json'));

    expect(outcome.container).toBe('plain');
    expect(parserKinds(outcome)).toEqual([]);
  });

  it.each([
    ['NetLog content with a HAR extension', '{"constants":{},"events":[]}', 'capture.har', 'chromium-netlog@1'],
    ['HAR content with a log extension', '{"log":{"entries":[]}}', 'service.log', 'har@1'],
    ['Go log content with a JSON extension', '[worker] Info 2026-01-01 Got Success GET:https://example.invalid/ +1ms', 'capture.json', 'go-service-log@1'],
  ])('uses structure instead of the file name for %s', async (
    _label,
    content,
    fileName,
    parserId,
  ) => {
    const outcome = await probeFileFormat(new File([content], fileName));

    expect(parserKinds(outcome)).toEqual([[parserId, 'definite-match']]);
  });

  it('does not infer a parser from an extension when content is unsupported', async () => {
    const outcome = await probeFileFormat(new File([
      '{"metadata":"unknown"}',
    ], 'capture.har'));

    expect(parserKinds(outcome)).toEqual([]);
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

  it.each([
    [
      'HAR and NetLog',
      '{"log":{"entries":[]},"events":[],"constants":{}}',
      [['har@1', 'possible-match'], ['chromium-netlog@1', 'possible-match']],
    ],
    [
      'HAR and Trace',
      '{"log":{"entries":[]},"traceEvents":[]}',
      [['har@1', 'possible-match'], ['chromium-performance-trace@1', 'possible-match']],
    ],
    [
      'HAR, NetLog and Trace',
      '{"log":{"entries":[]},"events":[],"constants":{},"traceEvents":[]}',
      [
        ['har@1', 'possible-match'],
        ['chromium-netlog@1', 'possible-match'],
        ['chromium-performance-trace@1', 'possible-match'],
      ],
    ],
  ])('keeps competing %s root signatures ambiguous', async (
    _label,
    content,
    expected,
  ) => {
    const outcome = await probeFileFormat(new File([content], 'capture.json'));

    expect(parserKinds(outcome)).toEqual(expected);
  });

  it.each([
    ['events', '{"events":[{"type":1,"time":"1","source":{"id":1,"type":1}}]}'],
    ['logEvents', '{"logEvents":[{"type":1,"time":"1","source":{"id":1,"type":1}}]}'],
    ['top-level array', '[{"type":1,"time":"1","source":{"id":1,"type":1}}]'],
  ])('recognizes NetLog %s when event semantics are present', async (_label, json) => {
    const outcome = await probeFileFormat(new File([
      json,
    ], 'sample.json'));

    expect(parserKinds(outcome)).toEqual([
      ['chromium-netlog@1', 'definite-match'],
    ]);
  });

  it('recognizes flattened NetLog source fields', async () => {
    const outcome = await probeFileFormat(new File([
      '[{"type":1,"time":"1","source_id":7,"source_type":2}]',
    ], 'flattened.json'));

    expect(parserKinds(outcome)).toEqual([
      ['chromium-netlog@1', 'definite-match'],
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
        decompress: decompressWithGunzip,
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

  it('rejects a damaged gzip instead of trying another parser', async () => {
    const damaged = new Uint8Array(gzipSync('{"traceEvents":[]}'));
    damaged[damaged.length - 1] ^= 0xff;

    await expect(probeFileFormat(
      new File([damaged], 'capture.json.gz'),
      { decompress: decompressWithGunzip },
    )).rejects.toMatchObject({
      code: 'GZIP_INVALID',
    });
  });

  it.each([
    ['HAR', '{"log":{"entries":[]}}'],
    ['NetLog', '{"constants":{},"events":[]}'],
    ['Go log', '[worker] Info 2026-01-01 Got Success GET:https://example.invalid/ +1ms'],
  ])('does not route gzip %s content to another parser', async (
    _label,
    content,
  ) => {
    const compressed = gzipSync(content);
    const outcome = await probeFileFormat(
      new File([compressed], 'capture.gz'),
      { decompress: decompressWithGunzip },
    );

    expect(outcome.container).toBe('gzip');
    expect(parserKinds(outcome)).toEqual([]);
  });

  it('rejects ZIP before reading its contents', async () => {
    await expect(probeFileFormat(new File([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    ], 'sample.zip'))).rejects.toMatchObject({
      code: 'ZIP_UNSUPPORTED',
    });
  });
});
