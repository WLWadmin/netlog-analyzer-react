import type { ChromiumTraceEvent } from '../parsers/trace/types';
import { RawEvidenceStore } from './rawEvidenceStore';

describe('RawEvidenceStore', () => {
  it('returns allowlisted details without args or sensitive values', () => {
    const events: ChromiumTraceEvent[] = [{
      name: 'ResourceSendRequest',
      cat: 'network',
      ph: 'X',
      ts: 10,
      dur: 5,
      pid: 1,
      tid: 2,
      args: {
        data: {
          url: 'https://private.invalid/path?token=<REDACTED>',
          headers: { Authorization: '<REDACTED>' },
        },
      },
    }];
    const store = new RawEvidenceStore(events);

    expect(store.getDetail('trace:event:0')).toEqual({
      evidenceId: 'trace:event:0',
      name: 'ResourceSendRequest',
      category: 'network',
      phase: 'X',
      timestampUs: 10,
      durationUs: 5,
      processId: 1,
      threadId: 2,
    });
    expect(JSON.stringify(store.getDetail('trace:event:0'))).not.toMatch(
      /private\.invalid|Authorization|token|args/,
    );
  });

  it('deduplicates screenshots, enforces budgets and releases all bytes', () => {
    const encoded = 'AQIDBA==';
    const events: ChromiumTraceEvent[] = [
      { name: 'Screenshot', ts: 1, args: { snapshot: encoded } },
      { name: 'Screenshot', ts: 2, args: { snapshot: encoded } },
      { name: 'Screenshot', ts: 3, args: { snapshot: 'A'.repeat(100) } },
    ];
    const store = new RawEvidenceStore(events, {
      maxScreenshotCount: 2,
      maxScreenshotEncodedBytes: 16,
      maxSingleScreenshotEncodedBytes: 16,
      maxScreenshotDecodedBytes: 64,
    });

    expect(store.getScreenshotSummaries()).toEqual([
      expect.objectContaining({
        screenshotId: 'trace:screenshot:0',
        timestampUs: 1,
        encodedBytes: 4,
      }),
    ]);
    expect(store.getScreenshot('trace:screenshot:0')).toEqual(
      expect.objectContaining({
        screenshotId: 'trace:screenshot:0',
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    );
    expect(store.getStats()).toMatchObject({
      screenshotCount: 1,
      deduplicatedScreenshotCount: 1,
      rejectedScreenshotCount: 1,
      screenshotEncodedBytes: 4,
    });

    store.release();
    expect(store.getStats()).toEqual(expect.objectContaining({
      evidenceCount: 0,
      screenshotCount: 0,
      screenshotEncodedBytes: 0,
      screenshotDecodedBytes: 0,
      released: true,
    }));
  });

  it('does not deduplicate distinct screenshots that share a 32-bit hash', () => {
    const store = new RawEvidenceStore([
      { name: 'Screenshot', ts: 1, args: { snapshot: 'ehKre1FCAAA=' } },
      { name: 'Screenshot', ts: 2, args: { snapshot: 'N/CnvMAYAQA=' } },
    ]);

    expect(store.getStats()).toMatchObject({
      screenshotCount: 2,
      deduplicatedScreenshotCount: 0,
    });
  });
});
