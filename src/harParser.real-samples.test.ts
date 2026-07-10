import fs from 'fs';
import path from 'path';
import { loadHarResponseBody } from './components/har/harResponseBodyGateway';
import { getHarTimingPhase, normalizeHarTiming } from './diagnosis/shared/harTimingNormalization';
import type { HarAnalysisResult } from './harParser';
import { parseHar } from './harParser';

const SINGLE_SAMPLE_PATH = process.env.HAR_SAMPLE_PATH;
const SAMPLE_DIR = process.env.HAR_REAL_SAMPLE_DIR;
const shouldRunSingleSample = Boolean(SINGLE_SAMPLE_PATH);
const shouldRunSanitizedDirectory = process.env.RUN_HAR_REAL_SAMPLES === '1' && Boolean(SAMPLE_DIR);

function getSampleFiles(): string[] {
  if (!shouldRunSanitizedDirectory || !SAMPLE_DIR) return [];
  return fs.readdirSync(SAMPLE_DIR)
    .filter(file => file.endsWith('.har') || file.endsWith('.json'))
    .sort();
}

(shouldRunSingleSample ? describe : describe.skip)('parseHar HAR-REAL-01', () => {
  let parsed: HarAnalysisResult;
  let rawData: any;
  let rawEntryCount = 0;

  beforeAll(() => {
    const raw = fs.readFileSync(SINGLE_SAMPLE_PATH as string, 'utf8');
    rawData = JSON.parse(raw);
    rawEntryCount = Array.isArray(rawData?.log?.entries) ? rawData.log.entries.length : 0;
    parsed = parseHar(rawData);
  });

  it('matches the sanitized aggregate baseline without printing request evidence', () => {
    const queueingCount = parsed.entries.filter(entry => entry.chromeTiming?.blockedQueueingMs !== undefined).length;
    const stalledCount = parsed.entries.filter(entry => entry.chromeTiming?.blockedQueueingMs !== undefined
      && (getHarTimingPhase(normalizeHarTiming(entry), 'stalled')?.durationMs || 0) > 0).length;
    const connectAndSsl = parsed.entries.filter(entry => entry.timings.connect > 0 && entry.timings.ssl > 0);
    const workerCount = parsed.entries.filter(entry => entry.chromeTiming?.workerStartMs !== undefined).length;
    const diskCacheCount = parsed.entries.filter(entry => entry.cacheInfo?.source === 'disk').length;
    const deferred = parsed.entries.filter(entry => entry.responseBodyDescriptor?.state === 'deferred');
    const deferredScripts = deferred.filter(entry => entry.category === 'js');
    const base64TextCount = parsed.entries.filter(entry => {
      const mimeType = entry.responseBodyDescriptor?.mimeType?.toLowerCase() || '';
      return entry.responseBodyDescriptor?.encoding?.toLowerCase() === 'base64'
        && (mimeType.startsWith('text/')
          || mimeType.includes('json')
          || mimeType.includes('javascript')
          || mimeType.includes('xml')
          || mimeType.includes('html')
          || mimeType.includes('css'));
    }).length;

    expect(parsed.totalRequests).toBe(rawEntryCount);
    expect(parsed.totalRequests).toBe(442);
    expect(queueingCount).toBe(392);
    expect(stalledCount).toBe(391);
    expect(connectAndSsl).toHaveLength(6);
    expect(workerCount).toBe(65);
    expect(diskCacheCount).toBe(149);
    expect(deferred).toHaveLength(36);
    expect(deferredScripts).toHaveLength(30);
    expect(base64TextCount).toBe(3);
    expect(deferred.every(entry => entry.responseBody === '')).toBe(true);
  });

  it('does not double count ssl in normalized connection timing', () => {
    const connectAndSsl = parsed.entries.filter(entry => entry.timings.connect > 0 && entry.timings.ssl > 0);
    connectAndSsl.forEach(entry => {
      const normalized = normalizeHarTiming(entry);
      const tcp = getHarTimingPhase(normalized, 'tcp')?.durationMs || 0;
      const ssl = getHarTimingPhase(normalized, 'ssl')?.durationMs || 0;
      expect(tcp + ssl).toBeCloseTo(entry.timings.connect, 3);
    });
  });

  it('loads every deferred body through the safe main-thread gateway', async () => {
    const deferred = parsed.entries.filter(entry => entry.responseBodyDescriptor?.state === 'deferred');
    const payloads = await Promise.all(deferred.map(entry => loadHarResponseBody({ rawData }, entry)));

    expect(payloads).toHaveLength(36);
    expect(payloads.every((payload, index) => payload.state === 'available'
      && payload.originalLength === deferred[index].responseBodyDescriptor?.originalLength)).toBe(true);
  });
});

(shouldRunSanitizedDirectory ? describe : describe.skip)('parseHar sanitized sample directory', () => {
  const files = getSampleFiles();

  it('has at least one sample', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('parses sample %s', file => {
    const fullPath = path.join(SAMPLE_DIR || '', file);
    const parsed = parseHar(JSON.parse(fs.readFileSync(fullPath, 'utf8')));
    expect(parsed.totalRequests).toBe(parsed.entries.length);
    expect(parsed.entries.every(entry => Array.isArray(entry.requestHeaders))).toBe(true);
    expect(parsed.entries.every(entry => Array.isArray(entry.responseHeaders))).toBe(true);
  });
});
