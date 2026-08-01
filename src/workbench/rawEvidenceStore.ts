import type { ChromiumTraceEvent } from '../parsers/trace/types';

export interface RawEvidenceDetailDto {
  evidenceId: string;
  name?: string;
  category?: string;
  phase?: string;
  timestampUs?: number;
  durationUs?: number;
  processId?: number;
  threadId?: number;
}

export interface ScreenshotSummaryDto {
  screenshotId: string;
  evidenceId: string;
  timestampUs: number;
  encodedBytes: number;
  decodedBytes: number;
}

export interface ScreenshotPayload {
  screenshotId: string;
  mimeType: 'image/jpeg';
  bytes: Uint8Array;
}

export interface RawEvidenceStoreOptions {
  maxScreenshotCount?: number;
  maxScreenshotEncodedBytes?: number;
  maxScreenshotDecodedBytes?: number;
  maxSingleScreenshotEncodedBytes?: number;
}

const DEFAULT_MAX_SCREENSHOTS = 2_000;
const DEFAULT_MAX_SCREENSHOT_ENCODED_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_SCREENSHOT_DECODED_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_SINGLE_SCREENSHOT_ENCODED_BYTES = 4 * 1024 * 1024;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function screenshotBase64(event: ChromiumTraceEvent): string | undefined {
  if (event.name !== 'Screenshot') return undefined;
  const args = record(event.args);
  const data = record(args?.data);
  const value = stringValue(args?.snapshot)
    ?? stringValue(data?.snapshot);
  return value && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
    ? value
    : undefined;
}

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function decodeBase64(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface StoredScreenshot {
  summary: ScreenshotSummaryDto;
  encoded: string;
}

export class RawEvidenceStore {
  private readonly events = new Map<string, ChromiumTraceEvent>();
  private readonly screenshots = new Map<string, StoredScreenshot>();
  private readonly screenshotEncodings = new Set<string>();
  private screenshotEncodedBytes = 0;
  private screenshotDecodedBytes = 0;
  private deduplicatedScreenshotCount = 0;
  private rejectedScreenshotCount = 0;
  private released = false;

  constructor(
    events: ChromiumTraceEvent[],
    options: RawEvidenceStoreOptions = {},
  ) {
    const maxScreenshotCount = options.maxScreenshotCount ?? DEFAULT_MAX_SCREENSHOTS;
    const maxEncodedBytes = options.maxScreenshotEncodedBytes
      ?? DEFAULT_MAX_SCREENSHOT_ENCODED_BYTES;
    const maxDecodedBytes = options.maxScreenshotDecodedBytes
      ?? DEFAULT_MAX_SCREENSHOT_DECODED_BYTES;
    const maxSingleEncodedBytes = options.maxSingleScreenshotEncodedBytes
      ?? DEFAULT_MAX_SINGLE_SCREENSHOT_ENCODED_BYTES;

    events.forEach((event, sourceIndex) => {
      const evidenceId = `trace:event:${sourceIndex}`;
      this.events.set(evidenceId, event);
      const encoded = screenshotBase64(event);
      if (!encoded) return;
      const encodedBytes = decodedByteLength(encoded);
      // Chromium Screenshot events do not reliably include dimensions.
      // Reserve a conservative decoded-memory budget instead of undercounting JPEG expansion.
      const decodedBytes = encodedBytes * 16;
      if (this.screenshotEncodings.has(encoded)) {
        this.deduplicatedScreenshotCount += 1;
        return;
      }
      if (
        this.screenshots.size >= maxScreenshotCount
        || encodedBytes > maxSingleEncodedBytes
        || this.screenshotEncodedBytes + encodedBytes > maxEncodedBytes
        || this.screenshotDecodedBytes + decodedBytes > maxDecodedBytes
      ) {
        this.rejectedScreenshotCount += 1;
        return;
      }
      const screenshotId = `trace:screenshot:${sourceIndex}`;
      const timestampUs = finiteNumber(event.ts) ?? 0;
      const summary = {
        screenshotId,
        evidenceId,
        timestampUs,
        encodedBytes,
        decodedBytes,
      };
      this.screenshotEncodings.add(encoded);
      this.screenshots.set(screenshotId, { summary, encoded });
      this.screenshotEncodedBytes += encodedBytes;
      this.screenshotDecodedBytes += decodedBytes;
    });
  }

  getDetail(evidenceId: string): RawEvidenceDetailDto | undefined {
    const event = this.events.get(evidenceId);
    if (!event || this.released) return undefined;
    const name = stringValue(event.name);
    const category = stringValue(event.cat);
    const phase = stringValue(event.ph);
    const timestampUs = finiteNumber(event.ts);
    const durationUs = finiteNumber(event.dur);
    const processId = finiteNumber(event.pid);
    const threadId = finiteNumber(event.tid);
    return {
      evidenceId,
      ...(name ? { name } : {}),
      ...(category ? { category } : {}),
      ...(phase ? { phase } : {}),
      ...(timestampUs === undefined ? {} : { timestampUs }),
      ...(durationUs === undefined ? {} : { durationUs }),
      ...(processId === undefined ? {} : { processId }),
      ...(threadId === undefined ? {} : { threadId }),
    };
  }

  getScreenshotSummaries(): ScreenshotSummaryDto[] {
    return [...this.screenshots.values()]
      .map(item => item.summary)
      .sort((left, right) => (
        left.timestampUs - right.timestampUs
        || left.screenshotId.localeCompare(right.screenshotId)
      ));
  }

  getScreenshot(screenshotId: string): ScreenshotPayload | undefined {
    const stored = this.screenshots.get(screenshotId);
    if (!stored || this.released) return undefined;
    try {
      return {
        screenshotId,
        mimeType: 'image/jpeg',
        bytes: decodeBase64(stored.encoded),
      };
    } catch {
      return undefined;
    }
  }

  getStats(): {
    evidenceCount: number;
    screenshotCount: number;
    deduplicatedScreenshotCount: number;
    rejectedScreenshotCount: number;
    screenshotEncodedBytes: number;
    screenshotDecodedBytes: number;
    released: boolean;
  } {
    return {
      evidenceCount: this.events.size,
      screenshotCount: this.screenshots.size,
      deduplicatedScreenshotCount: this.deduplicatedScreenshotCount,
      rejectedScreenshotCount: this.rejectedScreenshotCount,
      screenshotEncodedBytes: this.screenshotEncodedBytes,
      screenshotDecodedBytes: this.screenshotDecodedBytes,
      released: this.released,
    };
  }

  release(): void {
    this.events.clear();
    this.screenshots.clear();
    this.screenshotEncodings.clear();
    this.screenshotEncodedBytes = 0;
    this.screenshotDecodedBytes = 0;
    this.released = true;
  }
}
