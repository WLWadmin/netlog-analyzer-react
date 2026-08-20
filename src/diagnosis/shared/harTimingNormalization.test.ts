import { parseHar, type HarRequestEntry } from '../../harParser';
import { getHarTimingPhase, normalizeHarTiming } from './harTimingNormalization';

function entry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 1,
    name: 'api',
    url: 'https://example.com/api',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '-',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: '',
    size: 0,
    contentSize: 0,
    time: 0,
    startedDateTime: '2026-06-25T00:00:00.000Z',
    startMs: 1000,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
    timingAvailability: { blocked: true, dns: true, connect: true, ssl: true, send: true, wait: true, receive: true },
    requestHeaders: [],
    responseHeaders: [],
    responseBody: '',
    responseEncoding: '',
    queryString: [],
    serverTiming: [],
    xTtLogid: '',
    xTtCip: '',
    xLscSourceIp: '',
    isFailed: false,
    isSlow: false,
    ...overrides,
    standard: overrides.standard ?? parseHar({
      log: { entries: [{
        request: { method: 'GET', url: 'https://example.test/', headers: [] },
        response: { status: 200, headers: [], content: {} },
        timings: { send: 0, wait: 0, receive: 0 },
      }] },
    }).entries[0].standard,
  };
}

describe('normalizeHarTiming', () => {
  it('splits queueing, proxy and stalled from Chrome blocked details', () => {
    const timing = normalizeHarTiming(entry({
      time: 100,
      timings: { blocked: 30, dns: 10, connect: 20, ssl: 5, send: 1, wait: 30, receive: 9 },
      chromeTiming: { blockedQueueingMs: 10, blockedProxyMs: 5 },
    }));

    expect(getHarTimingPhase(timing, 'queueing')?.durationMs).toBe(10);
    expect(getHarTimingPhase(timing, 'proxy')?.durationMs).toBe(5);
    expect(getHarTimingPhase(timing, 'stalled')?.durationMs).toBe(15);
  });

  it('uses stalled instead of fake queueing when Chrome blocked detail is missing', () => {
    const timing = normalizeHarTiming(entry({
      time: 30,
      timings: { blocked: 30, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
    }));

    expect(getHarTimingPhase(timing, 'queueing')).toBeUndefined();
    expect(getHarTimingPhase(timing, 'stalled')?.durationMs).toBe(30);
    expect(getHarTimingPhase(timing, 'stalled')?.source).toBe('derived-from-blocked');
  });

  it('does not double count ssl because it is included in connect', () => {
    const timing = normalizeHarTiming(entry({
      time: 100,
      timings: { blocked: 0, dns: 10, connect: 50, ssl: 20, send: 5, wait: 30, receive: 5 },
    }));

    expect(getHarTimingPhase(timing, 'tcp')?.durationMs).toBe(30);
    expect(getHarTimingPhase(timing, 'ssl')?.durationMs).toBe(20);
    expect(timing.accountedMs).toBe(100);
    expect(timing.unaccountedMs).toBe(0);
    expect(timing.responseStartOffsetMs).toBe(95);
  });

  it('keeps ssl visible when connect is not recorded without adding it to standard total', () => {
    const timing = normalizeHarTiming(entry({
      time: 10,
      timings: { blocked: 0, dns: 0, connect: 0, ssl: 20, send: 0, wait: 10, receive: 0 },
      timingAvailability: { blocked: true, dns: true, connect: false, ssl: true, send: true, wait: true, receive: true },
    }));

    expect(getHarTimingPhase(timing, 'ssl')?.durationMs).toBe(20);
    expect(timing.accountedMs).toBe(10);
  });

  it('adds worker phases as overlapping offsets', () => {
    const timing = normalizeHarTiming(entry({
      time: 80,
      timings: { blocked: 10, dns: 0, connect: 0, ssl: 0, send: 1, wait: 60, receive: 9 },
      chromeTiming: { workerStartMs: 12, workerReadyMs: 20, workerFetchStartMs: 22, workerRespondWithSettledMs: 70 },
    }));

    expect(getHarTimingPhase(timing, 'service-worker-preparation')).toEqual({
      key: 'service-worker-preparation',
      available: true,
      durationMs: 8,
      startOffsetMs: 12,
      source: 'derived-from-worker-offsets',
      overlapsStandardTotal: true,
    });
    expect(getHarTimingPhase(timing, 'service-worker-request')?.durationMs).toBe(48);
    expect(timing.accountedMs).toBe(80);
  });

  it('ignores invalid worker offsets and negative chrome fields', () => {
    const timing = normalizeHarTiming(entry({
      time: 10,
      timings: { blocked: 10, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
      chromeTiming: { blockedQueueingMs: undefined, workerStartMs: 20, workerReadyMs: 10 },
    }));

    expect(getHarTimingPhase(timing, 'service-worker-preparation')).toBeUndefined();
    expect(getHarTimingPhase(timing, 'stalled')?.durationMs).toBe(10);
  });
});
