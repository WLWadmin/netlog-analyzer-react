import {
  readTraceFile,
  readTraceFileForWorker,
  TraceIntakeError,
} from './readTraceFile';
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import path from 'path';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextDecoder as NodeTextDecoder } from 'util';

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

function expectCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(TraceIntakeError);
  expect((error as TraceIntakeError).publicError.code).toBe(code);
}

function makeFile(parts: BlobPart[], name: string): File {
  return new File(parts, name, { type: 'application/octet-stream' });
}

function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe('readTraceFile', () => {
  it('returns equivalent bounded summaries for plain and gzip fixtures', async () => {
    const plainBytes = new Uint8Array(readFileSync(path.join(
      __dirname,
      '__fixtures__/minimal-trace.json',
    )));
    const gzipBytes = new Uint8Array(readFileSync(path.join(
      __dirname,
      '__fixtures__/minimal-trace.json.gz',
    )));
    const plain = makeFile([plainBytes], 'sample.trace');

    const plainResult = await readTraceFile(plain);
    const gzipResult = await readTraceFile(makeFile([gzipBytes], 'sample.trace.gz'), {
      decompress: () => streamBytes(new Uint8Array(gunzipSync(gzipBytes))),
    });

    expect(plainResult.kind).toBe('trace');
    expect(gzipResult.kind).toBe('trace');
    if (plainResult.kind !== 'trace' || gzipResult.kind !== 'trace') return;
    expect({
      ...gzipResult.summary,
      encoding: plainResult.summary.encoding,
    }).toEqual(plainResult.summary);
  });

  it('uses gzip magic instead of the extension', async () => {
    const result = await readTraceFile(makeFile([
      '{"traceEvents":[]}',
    ], 'sample.trace.gz'));

    expect(result).toEqual({
      kind: 'trace',
      summary: expect.objectContaining({
        encoding: 'plain-json',
        warnings: ['TRACE_EXTENSION_GZIP_MISMATCH'],
      }),
    });
  });

  it.each([
    ['{"log":{"entries":[]}}', 'har'],
    ['{"events":[],"constants":{}}', 'netlog'],
  ])('returns plain HAR and NetLog as normal routing outcomes', async (json, source) => {
    await expect(readTraceFile(makeFile([json], 'sample.json'))).resolves.toEqual({
      kind: 'detected-source',
      source,
      encoding: 'plain-json',
    });
  });

  it('rejects invalid gzip data', async () => {
    const invalid = makeFile([new Uint8Array([0x1f, 0x8b, 0, 1, 2])], 'sample.trace.gz');
    try {
      await readTraceFile(invalid, {
        decompress: () => new ReadableStream({
          start(controller) {
            controller.error(new Error('invalid gzip'));
          },
        }),
      });
      throw new Error('expected invalid gzip to fail');
    } catch (error) {
      expectCode(error, 'TRACE_GZIP_INVALID');
    }
  });

  it('enforces compressed and JSON byte limits before parsing', async () => {
    const parseJson = jest.fn();
    const plain = makeFile(['{"traceEvents":[]}'], 'sample.trace');
    await expect(readTraceFile(plain, { maxJsonBytes: 4, parseJson })).rejects.toBeDefined();
    expect(parseJson).not.toHaveBeenCalled();

    const gzipLike = makeFile([new Uint8Array([0x1f, 0x8b, 0, 0])], 'sample.trace.gz');
    Object.defineProperty(gzipLike, 'size', { value: 65 * 1024 * 1024 });
    try {
      await readTraceFile(gzipLike);
    } catch (error) {
      expectCode(error, 'TRACE_COMPRESSED_FILE_TOO_LARGE');
    }
  });

  it('enforces the event count after JSON parsing', async () => {
    try {
      await readTraceFile(makeFile(['{"traceEvents":[{},{}]}'], 'sample.trace'), {
        maxEvents: 1,
      });
    } catch (error) {
      expectCode(error, 'TRACE_EVENT_LIMIT_EXCEEDED');
    }
  });

  it('uses the Trace byte limit when json-auto confirms traceEvents in the sniff prefix', async () => {
    const parseJson = jest.fn();
    const file = makeFile(['{"traceEvents":[{},{}]}'], 'large.json');
    Object.defineProperty(file, 'size', { value: 500 });

    await expect(readTraceFile(file, {
      hint: 'json-auto',
      sourceSniffBytes: 16,
      maxJsonBytes: 20,
      parseJson,
    })).rejects.toMatchObject({
      publicError: { code: 'TRACE_JSON_TOO_LARGE' },
    });
    expect(parseJson).not.toHaveBeenCalled();
  });

  it('keeps a near-limit json-auto Trace on the Trace intake path', async () => {
    const file = makeFile(['{"traceEvents":[]}'], 'near-limit.json');
    Object.defineProperty(file, 'size', { value: 109 });

    await expect(readTraceFile(file, {
      hint: 'json-auto',
      sourceSniffBytes: 16,
      maxJsonBytes: 128,
    })).resolves.toEqual({
      kind: 'trace',
      summary: expect.objectContaining({ eventCount: 0 }),
    });
  });

  it('returns a distinct large JSON fallback when json-auto has no prefix signature', async () => {
    const file = makeFile(['{"padding":"xxxxxxxxxxxxxxxx"}'], 'large.json');
    Object.defineProperty(file, 'size', { value: 500 });

    await expect(readTraceFile(file, {
      hint: 'json-auto',
      sourceSniffBytes: 8,
      maxJsonBytes: 128,
    })).resolves.toEqual({ kind: 'source-unresolved' });
  });

  it('returns confirmed NetLog when a large json-auto prefix contains top-level events', async () => {
    const file = makeFile(['{"events":[],"padding":"xxxxxxxx"}'], 'large.json');
    Object.defineProperty(file, 'size', { value: 500 });

    await expect(readTraceFile(file, {
      hint: 'json-auto',
      sourceSniffBytes: 16,
      maxJsonBytes: 128,
    })).resolves.toEqual({
      kind: 'detected-source',
      source: 'netlog',
      encoding: 'plain-json',
    });
  });

  it('never returns raw events or sensitive event fields', async () => {
    const result = await readTraceFile(makeFile([
      '{"traceEvents":[{"name":"ResourceSendRequest","args":{"url":"https://private.invalid","headers":{"Authorization":"secret"}}}]}',
    ], 'sample.trace'));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('traceEvents');
    expect(serialized).not.toContain('private.invalid');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('secret');
  });

  it('keeps parsed Trace and original event indexes only in the Worker outcome', async () => {
    const result = await readTraceFileForWorker(makeFile([
      '{"traceEvents":[{"name":"first"},null,{"name":"third"}]}',
    ], 'sample.trace'));

    expect(result.kind).toBe('trace');
    if (result.kind !== 'trace') return;
    expect(result.trace.traceEvents).toEqual([
      { name: 'first' },
      {},
      { name: 'third' },
    ]);
    expect(result.skippedEventCount).toBe(1);
    expect(result.intake).not.toHaveProperty('trace');
    expect(result.intake).not.toHaveProperty('traceEvents');
  });
});
