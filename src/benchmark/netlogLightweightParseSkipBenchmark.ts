import { buildNetlogCompactEventIndex, type NetlogIndexableFile } from '../workers/netlogDatasetIndexer';

export interface LightweightParseSkipBenchmarkOptions {
  lightweightEvents?: number;
  heavyEvents?: number;
  chunkSize?: number;
}

export interface LightweightParseSkipBenchmarkMetrics {
  benchmark: 'netlog-lightweight-parse-skip';
  runtime: 'node-jest';
  eventCount: number;
  lightweightEvents: number;
  heavyEvents: number;
  indexBuildMs: number;
  lightweightParseSkippedEvents: number;
  lightweightParseSkippedBytes: number;
  skipEventRate: number;
  skippedBytesPerSkippedEvent: number;
}

class SyntheticNetlogFile implements NetlogIndexableFile {
  readonly name = 'synthetic-lightweight-parse-skip-netlog.json';
  readonly size: number;
  private readonly bytes: Uint8Array;
  private readonly chunkSize: number;

  constructor(text: string, chunkSize: number) {
    this.bytes = Uint8Array.from(Array.from(text, ch => ch.charCodeAt(0)));
    this.size = this.bytes.byteLength;
    this.chunkSize = chunkSize;
  }

  stream(): ReadableStream<Uint8Array> {
    const bytes = this.bytes;
    const chunkSize = this.chunkSize;
    let offset = 0;
    return {
      getReader() {
        return {
          async read() {
        if (offset >= bytes.length) {
              return { done: true, value: undefined };
        }
        const next = Math.min(bytes.length, offset + chunkSize);
            const value = bytes.slice(offset, next);
        offset = next;
            return { done: false, value };
          },
          releaseLock() {
            // no-op for synthetic benchmark stream
          },
        };
      },
    } as unknown as ReadableStream<Uint8Array>;
  }

  slice(start?: number, end?: number): Blob {
    const bytes = this.bytes.slice(start ?? 0, end ?? this.bytes.length);
    return {
      text: async () => Array.from(bytes, byte => String.fromCharCode(byte)).join(''),
    } as Blob;
  }
}

function buildSyntheticNetlogText(lightweightEvents: number, heavyEvents: number): string {
  const events: string[] = [];
  for (let i = 0; i < lightweightEvents; i += 1) {
    events.push(JSON.stringify({
      time: String(1000 + i / 10),
      type: 1,
      source: { id: 1000 + i, type: 20 },
      phase: 0,
      params: {
        byte_count: 1024 + i,
        preview: 'x'.repeat(16),
      },
    }));
  }
  for (let i = 0; i < heavyEvents; i += 1) {
    events.push(JSON.stringify({
      time: String(2000 + i / 10),
      type: 2,
      source: { id: 2000 + i, type: 21 },
      phase: 0,
      params: {
        url: `https://example.com/resource/${i}`,
        method: 'GET',
      },
    }));
  }
  const constants = JSON.stringify({
    logEventTypes: {
      SOCKET_BYTES_RECEIVED: 1,
      URL_REQUEST_START_JOB: 2,
    },
    logSourceType: {
      SOCKET: 20,
      URL_REQUEST: 21,
    },
  });
  return `{"constants":${constants},"events":[${events.join(',')}]}`;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function runLightweightParseSkipBenchmark(
  options: LightweightParseSkipBenchmarkOptions = {}
): Promise<LightweightParseSkipBenchmarkMetrics> {
  const lightweightEvents = options.lightweightEvents ?? 500;
  const heavyEvents = options.heavyEvents ?? 25;
  const file = new SyntheticNetlogFile(
    buildSyntheticNetlogText(lightweightEvents, heavyEvents),
    options.chunkSize ?? 97
  );
  const startedAt = nowMs();
  const { index, parseSkipStats } = await buildNetlogCompactEventIndex(file);
  const indexBuildMs = Math.round(nowMs() - startedAt);
  const skippedEvents = parseSkipStats.lightweightParseSkippedEvents ?? 0;
  const skippedBytes = parseSkipStats.lightweightParseSkippedBytes ?? 0;

  return {
    benchmark: 'netlog-lightweight-parse-skip',
    runtime: 'node-jest',
    eventCount: index.count,
    lightweightEvents,
    heavyEvents,
    indexBuildMs,
    lightweightParseSkippedEvents: skippedEvents,
    lightweightParseSkippedBytes: skippedBytes,
    skipEventRate: index.count ? Math.round((skippedEvents / index.count) * 10000) / 10000 : 0,
    skippedBytesPerSkippedEvent: skippedEvents
      ? Math.round(skippedBytes / skippedEvents)
      : 0,
  };
}
