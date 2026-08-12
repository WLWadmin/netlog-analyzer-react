import { TraceSourceSniffer } from '../parsers/trace/sourceSniffer';
import type {
  FileParserId,
  ProbeVerdict,
  SourceKind,
} from './fileFormatTypes';

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];
const GZIP_SIGNATURE = [0x1f, 0x8b];
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_LOG_PROBE_BYTES = 64 * 1024;
const DEFAULT_JSON_PROBE_BYTES = 4 * 1024 * 1024;
const PROBE_CHUNK_BYTES = 64 * 1024;
const LOG_LINE_PATTERN = /^\[[^\]]+\]\s+(Info|Error|Warn|Debug)\b/;

const SOURCE_PARSER: Record<SourceKind, FileParserId> = {
  har: 'har@1',
  netlog: 'chromium-netlog@1',
  trace: 'chromium-performance-trace@1',
  log: 'go-service-log@1',
};

const SOURCE_EVIDENCE: Record<SourceKind, string[]> = {
  har: ['HAR_LOG_OBJECT', 'HAR_ENTRIES_ARRAY'],
  netlog: ['NETLOG_CONSTANTS_OBJECT', 'NETLOG_EVENTS_ARRAY'],
  trace: ['TRACE_EVENTS_ARRAY'],
  log: ['GO_LOG_TEXT', 'GO_LOG_LINE_SYNTAX'],
};

export interface FileFormatProbeProgress {
  phase: 'container-check' | 'reading' | 'decompressing' | 'probing-format';
  processedBytes?: number;
  totalBytes?: number;
}

export interface FileFormatProbeOutcome {
  container: 'plain' | 'gzip';
  verdicts: ProbeVerdict[];
}

export class FileFormatProbeError extends Error {
  readonly code:
    | 'ZIP_UNSUPPORTED'
    | 'GZIP_TOO_LARGE'
    | 'GZIP_UNSUPPORTED'
    | 'GZIP_INVALID';

  constructor(code: FileFormatProbeError['code'], message: string) {
    super(message);
    this.name = 'FileFormatProbeError';
    this.code = code;
  }
}

interface ProbeOptions {
  signal?: AbortSignal;
  onProgress?(progress: FileFormatProbeProgress): void;
  decompress?(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
  maxJsonProbeBytes?: number;
}

interface ProbeStreamSessionOptions extends ProbeOptions {
  fileSize: number;
}

export interface FileFormatProbeStreamSession {
  outcome: FileFormatProbeOutcome;
  stream: ReadableStream<Uint8Array>;
}

async function cancelStreamBeforeThrow(
  stream: ReadableStream<Uint8Array>,
  error: Error,
): Promise<never> {
  await stream.cancel(error).catch(() => undefined);
  throw error;
}

interface DecompressionStreamConstructor {
  new (format: 'gzip'): TransformStream<Uint8Array, Uint8Array>;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(blob);
  });
}

function fileBytes(file: File): ReadableStream<Uint8Array> {
  if (typeof file.stream === 'function') return file.stream();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= file.size) {
        controller.close();
        return;
      }
      const end = Math.min(file.size, offset + PROBE_CHUNK_BYTES);
      controller.enqueue(new Uint8Array(
        await blobArrayBuffer(file.slice(offset, end)),
      ));
      offset = end;
    },
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('文件预检已取消', 'AbortError');
  }
}

async function cancelSourceIfAborted(
  source: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal?.aborted) return;
  await source.cancel(signal.reason).catch(() => undefined);
  assertNotAborted(signal);
}

async function readSignaturePrefix(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<{
  bytes: Uint8Array;
  stream: ReadableStream<Uint8Array>;
}> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (byteLength < 4) {
      assertNotAborted(signal);
      const { done, value } = await reader.read();
      assertNotAborted(signal);
      if (done) break;
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }
  const signature = new Uint8Array(Math.min(4, byteLength));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= signature.byteLength) break;
    const length = Math.min(chunk.byteLength, signature.byteLength - offset);
    signature.set(chunk.subarray(0, length), offset);
    offset += length;
  }
  let replayedPrefix = false;
  return {
    bytes: signature,
    stream: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!replayedPrefix) {
          replayedPrefix = true;
          for (const chunk of chunks) controller.enqueue(chunk);
          if (chunks.length > 0) return;
        }
        return reader.read().then(({ done, value }) => {
          if (done) controller.close();
          else controller.enqueue(value);
        });
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    }),
  };
}

function replayConsumedStream(
  chunks: Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  let prefixIndex = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (prefixIndex < chunks.length) {
        controller.enqueue(chunks[prefixIndex++]);
        return;
      }
      return reader.read().then(({ done, value }) => {
        if (done) controller.close();
        else controller.enqueue(value);
      });
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function noMatch(parserId: FileParserId, code: string): ProbeVerdict {
  return { kind: 'no-match', parserId, evidenceCodes: [code] };
}

function strongSources(evidenceCodes: readonly string[]): SourceKind[] {
  const evidence = new Set(evidenceCodes);
  return (Object.keys(SOURCE_EVIDENCE) as SourceKind[]).filter(source => (
    SOURCE_EVIDENCE[source].every(code => evidence.has(code))
  ));
}

function verdictsForSources(
  sources: SourceKind[],
  evidenceCodes: readonly string[],
): ProbeVerdict[] {
  const sourceSet = new Set(sources);
  const strongSourceSet = new Set(strongSources(evidenceCodes));
  const uniqueStrongSource = strongSourceSet.size === 1 && sourceSet.size === 1
    ? [...strongSourceSet][0]
    : undefined;
  return (Object.keys(SOURCE_PARSER) as SourceKind[]).map(source => {
    const parserId = SOURCE_PARSER[source];
    if (!sourceSet.has(source)) {
      return noMatch(parserId, `${source.toUpperCase()}_SIGNATURE_MISSING`);
    }
    return {
      kind: source === uniqueStrongSource ? 'definite-match' : 'possible-match',
      parserId,
      evidenceCodes: SOURCE_EVIDENCE[source]
        .filter(code => evidenceCodes.includes(code)),
    };
  });
}

function classifyTextLog(prefix: string): boolean {
  const lines = prefix.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 64);
  if (lines.length === 0) return false;
  const matches = lines.filter(line => LOG_LINE_PATTERN.test(line)).length;
  return matches > 0 && matches / lines.length >= 0.5;
}

export async function probeFileFormatStreamSession(
  source: ReadableStream<Uint8Array>,
  options: ProbeStreamSessionOptions,
): Promise<FileFormatProbeStreamSession> {
  await cancelSourceIfAborted(source, options.signal);
  options.onProgress?.({ phase: 'container-check' });
  await cancelSourceIfAborted(source, options.signal);
  const prefix = await readSignaturePrefix(source, options.signal);
  const signature = prefix.bytes;
  if (ZIP_SIGNATURES.some(candidate => startsWith(signature, candidate))) {
    return cancelStreamBeforeThrow(prefix.stream, new FileFormatProbeError(
      'ZIP_UNSUPPORTED',
      '不支持 ZIP 压缩包，请先解压后再选择诊断文件',
    ));
  }

  const gzip = startsWith(signature, GZIP_SIGNATURE);
  const container = gzip ? 'gzip' : 'plain';
  if (gzip && options.fileSize > MAX_COMPRESSED_BYTES) {
    return cancelStreamBeforeThrow(prefix.stream, new FileFormatProbeError(
      'GZIP_TOO_LARGE',
      '压缩文件超过 64 MiB 安全限制',
    ));
  }

  let compressedBytesRead = 0;
  let stream = prefix.stream;
  if (gzip) {
    const DecompressionStreamClass = (
      globalThis as typeof globalThis & {
        DecompressionStream?: DecompressionStreamConstructor;
      }
    ).DecompressionStream;
    if (!options.decompress && !DecompressionStreamClass) {
      return cancelStreamBeforeThrow(stream, new FileFormatProbeError(
        'GZIP_UNSUPPORTED',
        '当前浏览器不支持 gzip 预检',
      ));
    }
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        compressedBytesRead += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    try {
      const countedStream = stream.pipeThrough(counter);
      stream = options.decompress
        ? options.decompress(countedStream)
        : countedStream.pipeThrough(new DecompressionStreamClass!('gzip'));
    } catch {
      return cancelStreamBeforeThrow(
        stream,
        new FileFormatProbeError('GZIP_INVALID', 'gzip 文件已损坏'),
      );
    }
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const sniffer = new TraceSourceSniffer();
  const consumedChunks: Uint8Array[] = [];
  const jsonProbeBudget = Math.max(
    1,
    options.maxJsonProbeBytes ?? DEFAULT_JSON_PROBE_BYTES,
  );
  let decodedBytes = 0;
  let textPrefix = '';
  let mode: 'unknown' | 'json' | 'text' = 'unknown';
  let lastProgressAt = 0;

  try {
    while (true) {
      assertNotAborted(options.signal);
      const { done, value } = await reader.read();
      assertNotAborted(options.signal);
      if (done) break;
      consumedChunks.push(value);
      const remainingBudget = Math.max(0, jsonProbeBudget - decodedBytes);
      const probeValue = mode === 'text'
        ? value
        : value.subarray(0, remainingBudget);
      decodedBytes += probeValue.byteLength;
      const text = decoder.decode(probeValue, { stream: true });
      if (textPrefix.length < MAX_LOG_PROBE_BYTES) {
        textPrefix += text.slice(0, MAX_LOG_PROBE_BYTES - textPrefix.length);
      }
      if (mode === 'unknown') {
        const first = textPrefix.match(/\S/)?.[0];
        if (first) mode = first === '{' ? 'json' : 'text';
      }
      if (mode === 'json') sniffer.feed(text);

      const now = Date.now();
      if (now - lastProgressAt >= 100) {
        lastProgressAt = now;
        options.onProgress?.({
          phase: gzip ? 'decompressing' : mode === 'json' ? 'probing-format' : 'reading',
          processedBytes: gzip ? compressedBytesRead : Math.min(decodedBytes, options.fileSize),
          totalBytes: gzip ? options.fileSize : Math.min(options.fileSize, jsonProbeBudget),
        });
      }
      if (mode === 'text' && textPrefix.length >= MAX_LOG_PROBE_BYTES) {
        break;
      }
      if (mode === 'json') {
        // Preflight only needs enough structure to bind one parser. The bound
        // parser still validates and parses the complete file before committing.
        const evidenceCodes = sniffer.getEvidenceCodes();
        const sources = sniffer.getDetectedSources();
        if (strongSources(evidenceCodes).length === 1 && sources.length === 1) {
          break;
        }
      }
      if (mode !== 'text' && decodedBytes >= jsonProbeBudget) {
        break;
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (error instanceof FileFormatProbeError) throw error;
    if (gzip) {
      throw new FileFormatProbeError('GZIP_INVALID', 'gzip 文件已损坏');
    }
    throw error;
  }

  options.onProgress?.({
    phase: 'probing-format',
    processedBytes: gzip ? compressedBytesRead : Math.min(decodedBytes, options.fileSize),
    totalBytes: gzip ? options.fileSize : Math.min(options.fileSize, jsonProbeBudget),
  });

  const replayStream = replayConsumedStream(consumedChunks, reader);
  if (mode === 'text') {
    return {
      outcome: {
        container,
        verdicts: classifyTextLog(textPrefix)
          ? verdictsForSources(['log'], SOURCE_EVIDENCE.log)
          : verdictsForSources([], []),
      },
      stream: replayStream,
    };
  }

  sniffer.feed(decoder.decode());
  sniffer.finish();
  const sources = sniffer.getDetectedSources();
  const evidenceCodes = sniffer.getEvidenceCodes();
  if (gzip && (sources.length !== 1 || sources[0] !== 'trace')) {
    return {
      outcome: {
        container,
        verdicts: verdictsForSources([], []),
      },
      stream: replayStream,
    };
  }
  return {
    outcome: {
      container,
      verdicts: verdictsForSources(sources as SourceKind[], evidenceCodes),
    },
    stream: replayStream,
  };
}

export async function probeFileFormat(
  file: File,
  options: ProbeOptions = {},
): Promise<FileFormatProbeOutcome> {
  const session = await probeFileFormatStreamSession(fileBytes(file), {
    ...options,
    fileSize: file.size,
  });
  await session.stream.cancel();
  return session.outcome;
}
