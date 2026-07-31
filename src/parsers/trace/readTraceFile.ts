import { classifyParsedTraceSource } from './guards';
import { TraceSourceSniffer } from './sourceSniffer';
import { TRACE_LIMITS } from './traceLimits';
import type {
  ChromiumTraceFile,
  TraceDetectedSource,
  TraceEncoding,
  TraceErrorCode,
  TraceEventFamily,
  TraceIntakeSummary,
  TraceParserWarning,
  TracePublicError,
  TraceTaskPhase,
  TraceTaskProgress,
} from './types';

export type TraceReadOutcome =
  | { kind: 'trace'; summary: TraceIntakeSummary }
  | { kind: 'detected-source'; source: Exclude<TraceDetectedSource, 'trace'>; encoding: TraceEncoding }
  | { kind: 'source-unresolved' };

export type TraceParsedInput =
  | {
      kind: 'trace';
      trace: ChromiumTraceFile;
      intake: TraceIntakeSummary;
      skippedEventCount: number;
    }
  | {
      kind: 'detected-source';
      source: Exclude<TraceDetectedSource, 'trace'>;
      encoding: TraceEncoding;
    }
  | { kind: 'source-unresolved' };

export class TraceIntakeError extends Error {
  readonly publicError: TracePublicError;

  constructor(code: TraceErrorCode, stage: TraceTaskPhase, message: string, recoverable = true) {
    super(message);
    this.name = 'TraceIntakeError';
    this.publicError = { code, stage, message, recoverable };
  }
}

interface ReadTraceFileOptions {
  hint?: 'trace' | 'json-auto';
  onProgress?: (progress: TraceTaskProgress) => void;
  maxCompressedBytes?: number;
  maxJsonBytes?: number;
  maxEvents?: number;
  sourceSniffBytes?: number;
  parseJson?: (text: string) => unknown;
  decompress?: (stream: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
}

interface DecompressionStreamConstructor {
  new (format: 'gzip'): TransformStream<Uint8Array, Uint8Array>;
}

function throwTraceError(
  code: TraceErrorCode,
  stage: TraceTaskPhase,
  message: string,
): never {
  throw new TraceIntakeError(code, stage, message);
}

function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('blob read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

function fileBytes(file: File): ReadableStream<Uint8Array> {
  if (typeof file.stream === 'function') {
    return file.stream();
  }
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new Uint8Array(await blobArrayBuffer(file)));
      controller.close();
    },
  });
}

async function hasGzipMagic(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await blobArrayBuffer(file.slice(0, 2)));
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function gzipExtension(name: string): boolean {
  return name.toLowerCase().endsWith('.gz');
}

function summarizeTrace(
  trace: ChromiumTraceFile,
  encoding: TraceEncoding,
  jsonBytes: number,
  skippedEventCount: number,
): TraceIntakeSummary {
  const families = new Set<TraceEventFamily>();
  let captureStartUs: number | undefined;
  let captureEndUs: number | undefined;

  for (const event of trace.traceEvents) {
    const name = typeof event.name === 'string' ? event.name.toLowerCase() : '';
    const category = typeof event.cat === 'string' ? event.cat.toLowerCase() : '';
    if (category.includes('__metadata') || name === 'process_name' || name === 'thread_name') {
      families.add('metadata');
    }
    if (name.includes('navigation') || name.includes('commitload')) families.add('navigation');
    if (name.includes('resource') || name.includes('request') || name.includes('response')) {
      families.add('network');
    }
    if (name === 'runtask' || category.includes('devtools.timeline')) families.add('main-thread');
    if (/layout|paint|frame|raster/.test(name)) families.add('rendering');
    if (/eventtiming|interaction/.test(name)) families.add('interaction');
    if (/profile|profilechunk/.test(name)) families.add('cpu-profile');

    if (typeof event.ts === 'number' && Number.isFinite(event.ts)) {
      captureStartUs = captureStartUs === undefined ? event.ts : Math.min(captureStartUs, event.ts);
      const end = typeof event.dur === 'number' && Number.isFinite(event.dur)
        ? event.ts + event.dur
        : event.ts;
      captureEndUs = captureEndUs === undefined ? end : Math.max(captureEndUs, end);
    }
  }

  const warnings: TraceParserWarning[] = [];
  if (skippedEventCount > 0) warnings.push('TRACE_SKIPPED_NON_OBJECT_EVENTS');
  return {
    format: 'chromium-trace-object',
    encoding,
    jsonBytes,
    eventCount: trace.traceEvents.length,
    ...(captureStartUs === undefined ? {} : { captureStartUs }),
    ...(captureEndUs === undefined ? {} : { captureEndUs }),
    availableFamilies: [...families].sort(),
    warnings,
  };
}

export async function readTraceFileForWorker(
  file: File,
  options: ReadTraceFileOptions = {},
): Promise<TraceParsedInput> {
  const maxCompressedBytes: number = options.maxCompressedBytes ?? TRACE_LIMITS.maxCompressedBytes;
  const maxJsonBytes: number = options.maxJsonBytes ?? TRACE_LIMITS.maxJsonBytes;
  const maxEvents: number = options.maxEvents ?? TRACE_LIMITS.maxEvents;
  const sourceSniffBytes = options.sourceSniffBytes ?? TRACE_LIMITS.sourceSniffBytes;
  const hint = options.hint ?? 'trace';
  const parseJson = options.parseJson ?? JSON.parse;
  const gzip = await hasGzipMagic(file);
  const encoding: TraceEncoding = gzip ? 'gzip-json' : 'plain-json';

  if (gzip && file.size > maxCompressedBytes) {
    throwTraceError(
      'TRACE_COMPRESSED_FILE_TOO_LARGE',
      'reading-file',
      '压缩 Trace 超过 64 MiB 安全限制',
    );
  }

  let stream = fileBytes(file);
  if (gzip) {
    const DecompressionStreamClass = (
      globalThis as typeof globalThis & {
        DecompressionStream?: DecompressionStreamConstructor;
      }
    ).DecompressionStream;
    if (!options.decompress && !DecompressionStreamClass) {
      throwTraceError('TRACE_GZIP_UNSUPPORTED', 'decompressing', '当前浏览器不支持 gzip 解压');
    }
    try {
      stream = options.decompress
        ? options.decompress(stream)
        : stream.pipeThrough(new DecompressionStreamClass!('gzip'));
    } catch {
      throwTraceError('TRACE_GZIP_INVALID', 'decompressing', 'gzip Trace 已损坏');
    }
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const sniffDecoder = new TextDecoder();
  const sniffer = new TraceSourceSniffer();
  const chunks: string[] = [];
  let jsonBytes = 0;
  let sniffedBytes = 0;
  let sniffing = true;
  options.onProgress?.({ phase: 'sniffing-source', processedBytes: 0, totalBytes: file.size });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (sniffing) {
        const remaining = Math.max(0, sourceSniffBytes - sniffedBytes);
        const sniffBytes = value.subarray(0, Math.min(value.byteLength, remaining));
        sniffedBytes += sniffBytes.byteLength;
        const sniffed = sniffer.feed(sniffDecoder.decode(sniffBytes, {
          stream: sniffedBytes < sourceSniffBytes,
        }));
        if (sniffed.kind === 'error') {
          await reader.cancel();
          throwTraceError(sniffed.code, 'sniffing-source', '不支持当前 JSON 顶层结构');
        }
        if (sniffed.kind === 'detected' && sniffed.source === 'trace') {
          sniffing = false;
        } else if (sniffedBytes >= sourceSniffBytes) {
          sniffing = false;
          if (hint === 'json-auto' && file.size > maxJsonBytes) {
            await reader.cancel();
            if (
              sniffed.kind === 'detected'
              && (sniffed.source === 'har' || sniffed.source === 'netlog')
            ) {
              if (gzip) {
                throwTraceError(
                  'TRACE_NON_TRACE_GZIP_UNSUPPORTED',
                  'sniffing-source',
                  '当前不支持 gzip 压缩的 HAR 或 NetLog',
                );
              }
              return { kind: 'detected-source', source: sniffed.source, encoding };
            }
            if (!gzip) {
              return { kind: 'source-unresolved' };
            }
          }
        }
      }
      if (jsonBytes + value.byteLength > maxJsonBytes) {
        await reader.cancel();
        throwTraceError('TRACE_JSON_TOO_LARGE', gzip ? 'decompressing' : 'reading-file', 'Trace JSON 超过 128 MiB 安全限制');
      }
      jsonBytes += value.byteLength;
      const text = decoder.decode(value, { stream: true });
      chunks.push(text);
      options.onProgress?.({
        phase: gzip ? 'decompressing' : 'reading-file',
        processedBytes: gzip ? jsonBytes : Math.min(jsonBytes, file.size),
        totalBytes: gzip ? undefined : file.size,
      });
    }
  } catch (error) {
    if (error instanceof TraceIntakeError) throw error;
    if (gzip) {
      throwTraceError('TRACE_GZIP_INVALID', 'decompressing', 'gzip Trace 已损坏');
    }
    throw error;
  }

  chunks.push(decoder.decode());
  const finalSniff = sniffing ? sniffer.finish() : { kind: 'pending' } as const;
  if (finalSniff.kind === 'error') {
    throwTraceError(finalSniff.code, 'sniffing-source', '不支持当前 JSON 顶层结构');
  }

  options.onProgress?.({ phase: 'parsing-json' });
  let parsed: unknown;
  try {
    parsed = parseJson(chunks.join(''));
  } catch {
    throwTraceError('TRACE_JSON_INVALID', 'parsing-json', 'Trace JSON 不完整或损坏');
  }
  chunks.length = 0;

  options.onProgress?.({ phase: 'validating-trace' });
  const classification = classifyParsedTraceSource(parsed, maxEvents);
  if (classification.kind === 'detected-source') {
    if (gzip) {
      throwTraceError(
        'TRACE_NON_TRACE_GZIP_UNSUPPORTED',
        'validating-trace',
        '当前不支持 gzip 压缩的 HAR 或 NetLog',
      );
    }
    return { ...classification, encoding };
  }
  if (classification.kind === 'error') {
    throwTraceError(classification.code, 'validating-trace', 'Trace 文件结构不受支持');
  }

  const warnings: TraceParserWarning[] = [];
  if (classification.skippedEventCount > 0) {
    warnings.push('TRACE_SKIPPED_NON_OBJECT_EVENTS');
  }
  if (gzipExtension(file.name) !== gzip) {
    warnings.push('TRACE_EXTENSION_GZIP_MISMATCH');
  }
  return {
    kind: 'trace',
    trace: classification.trace,
    skippedEventCount: classification.skippedEventCount,
    intake: {
      format: 'chromium-trace-object',
      encoding,
      jsonBytes,
      eventCount: classification.trace.traceEvents.length,
      availableFamilies: [],
      warnings,
    },
  };
}

export async function readTraceFile(
  file: File,
  options: ReadTraceFileOptions = {},
): Promise<TraceReadOutcome> {
  const outcome = await readTraceFileForWorker(file, options);
  if (outcome.kind !== 'trace') return outcome;

  options.onProgress?.({ phase: 'summarizing-intake' });
  const summary = summarizeTrace(
    outcome.trace,
    outcome.intake.encoding,
    outcome.intake.jsonBytes,
    outcome.skippedEventCount,
  );
  summary.warnings.push(...outcome.intake.warnings.filter(
    warning => !summary.warnings.includes(warning),
  ));
  return { kind: 'trace', summary };
}
