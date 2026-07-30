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
  onProgress?(progress: FileFormatProbeProgress): void;
  decompress?(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
  maxJsonProbeBytes?: number;
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

export async function probeFileFormat(
  file: File,
  options: ProbeOptions = {},
): Promise<FileFormatProbeOutcome> {
  options.onProgress?.({ phase: 'container-check' });
  const signature = new Uint8Array(await blobArrayBuffer(file.slice(0, 4)));
  if (ZIP_SIGNATURES.some(candidate => startsWith(signature, candidate))) {
    throw new FileFormatProbeError(
      'ZIP_UNSUPPORTED',
      '不支持 ZIP 压缩包，请先解压后再选择诊断文件',
    );
  }

  const gzip = startsWith(signature, GZIP_SIGNATURE);
  const container = gzip ? 'gzip' : 'plain';
  if (gzip && file.size > MAX_COMPRESSED_BYTES) {
    throw new FileFormatProbeError(
      'GZIP_TOO_LARGE',
      '压缩文件超过 64 MiB 安全限制',
    );
  }

  let compressedBytesRead = 0;
  let stream = fileBytes(file);
  if (gzip) {
    const DecompressionStreamClass = (
      globalThis as typeof globalThis & {
        DecompressionStream?: DecompressionStreamConstructor;
      }
    ).DecompressionStream;
    if (!options.decompress && !DecompressionStreamClass) {
      throw new FileFormatProbeError(
        'GZIP_UNSUPPORTED',
        '当前浏览器不支持 gzip 预检',
      );
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
      throw new FileFormatProbeError('GZIP_INVALID', 'gzip 文件已损坏');
    }
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const sniffer = new TraceSourceSniffer();
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
      const { done, value } = await reader.read();
      if (done) break;
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
          processedBytes: gzip ? compressedBytesRead : Math.min(decodedBytes, file.size),
          totalBytes: gzip ? file.size : Math.min(file.size, jsonProbeBudget),
        });
      }
      if (mode === 'text' && textPrefix.length >= MAX_LOG_PROBE_BYTES) {
        await reader.cancel();
        break;
      }
      if (mode === 'json') {
        // Preflight only needs enough structure to bind one parser. The bound
        // parser still validates and parses the complete file before committing.
        const evidenceCodes = sniffer.getEvidenceCodes();
        const sources = sniffer.getDetectedSources();
        if (strongSources(evidenceCodes).length === 1 && sources.length === 1) {
          await reader.cancel();
          break;
        }
      }
      if (mode !== 'text' && decodedBytes >= jsonProbeBudget) {
        await reader.cancel();
        break;
      }
    }
  } catch (error) {
    if (error instanceof FileFormatProbeError) throw error;
    if (gzip) {
      throw new FileFormatProbeError('GZIP_INVALID', 'gzip 文件已损坏');
    }
    throw error;
  }

  options.onProgress?.({
    phase: 'probing-format',
    processedBytes: gzip ? compressedBytesRead : Math.min(decodedBytes, file.size),
    totalBytes: gzip ? file.size : Math.min(file.size, jsonProbeBudget),
  });

  if (mode === 'text') {
    return {
      container,
      verdicts: classifyTextLog(textPrefix)
        ? verdictsForSources(['log'], SOURCE_EVIDENCE.log)
        : verdictsForSources([], []),
    };
  }

  sniffer.feed(decoder.decode());
  sniffer.finish();
  const sources = sniffer.getDetectedSources();
  const evidenceCodes = sniffer.getEvidenceCodes();
  if (gzip && (sources.length !== 1 || sources[0] !== 'trace')) {
    return {
      container,
      verdicts: verdictsForSources([], []),
    };
  }
  return {
    container,
    verdicts: verdictsForSources(sources as SourceKind[], evidenceCodes),
  };
}
