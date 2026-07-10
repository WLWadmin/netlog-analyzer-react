import type { HarRequestEntry } from '../../harParser';

export type HarDisplayTimingPhaseKey =
  | 'queueing'
  | 'stalled'
  | 'proxy'
  | 'dns'
  | 'tcp'
  | 'ssl'
  | 'service-worker-preparation'
  | 'service-worker-request'
  | 'send'
  | 'wait'
  | 'receive';

export interface HarNormalizedTimingPhase {
  key: HarDisplayTimingPhaseKey;
  available: boolean;
  durationMs: number;
  startOffsetMs: number;
  source:
    | 'har-standard'
    | 'chrome-custom'
    | 'derived-from-blocked'
    | 'derived-from-connect'
    | 'derived-from-worker-offsets';
  overlapsStandardTotal?: boolean;
}

export interface HarNormalizedTiming {
  phases: HarNormalizedTimingPhase[];
  totalMs: number;
  accountedMs: number;
  unaccountedMs: number;
  responseStartOffsetMs?: number;
  hasChromeDetail: boolean;
}

const EPSILON_MS = 0.5;

function isAvailable(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function addPhase(phases: HarNormalizedTimingPhase[], phase: HarNormalizedTimingPhase): void {
  phases.push(phase);
}

export function normalizeHarTiming(entry: HarRequestEntry): HarNormalizedTiming {
  const phases: HarNormalizedTimingPhase[] = [];
  const t = entry.timings;
  const a = entry.timingAvailability || {};
  const chrome = entry.chromeTiming;
  let offset = 0;
  let accountedMs = 0;

  const blockedTotal = a.blocked === false ? undefined : t.blocked;
  const queueing = chrome?.blockedQueueingMs;
  const proxy = chrome?.blockedProxyMs;
  const hasChromeBlockedDetail = isAvailable(queueing) || isAvailable(proxy);

  if (isAvailable(blockedTotal)) {
    const safeQueueing = isAvailable(queueing) ? queueing : 0;
    const safeProxy = isAvailable(proxy) ? proxy : 0;
    if (hasChromeBlockedDetail) {
      const stalled = Math.max(0, blockedTotal - safeQueueing - safeProxy);
      if (isAvailable(queueing)) {
        addPhase(phases, { key: 'queueing', available: true, durationMs: queueing, startOffsetMs: offset, source: 'chrome-custom' });
        offset += queueing;
      }
      if (isAvailable(proxy)) {
        addPhase(phases, { key: 'proxy', available: true, durationMs: proxy, startOffsetMs: offset, source: 'chrome-custom' });
        offset += proxy;
      }
      addPhase(phases, { key: 'stalled', available: true, durationMs: stalled, startOffsetMs: offset, source: 'derived-from-blocked' });
      offset += stalled;
    } else {
      addPhase(phases, { key: 'stalled', available: true, durationMs: blockedTotal, startOffsetMs: offset, source: 'derived-from-blocked' });
      offset += blockedTotal;
    }
    accountedMs += blockedTotal;
  }

  if (a.dns !== false) {
    addPhase(phases, { key: 'dns', available: true, durationMs: t.dns, startOffsetMs: offset, source: 'har-standard' });
    offset += t.dns;
    accountedMs += t.dns;
  }

  const connectAvailable = a.connect !== false;
  const sslAvailable = a.ssl !== false;
  if (connectAvailable && sslAvailable) {
    const tcp = Math.max(0, t.connect - t.ssl);
    addPhase(phases, { key: 'tcp', available: true, durationMs: tcp, startOffsetMs: offset, source: 'derived-from-connect' });
    offset += tcp;
    addPhase(phases, { key: 'ssl', available: true, durationMs: t.ssl, startOffsetMs: offset, source: 'har-standard' });
    offset += t.ssl;
    accountedMs += t.connect;
  } else if (connectAvailable) {
    addPhase(phases, { key: 'tcp', available: true, durationMs: t.connect, startOffsetMs: offset, source: 'har-standard' });
    offset += t.connect;
    accountedMs += t.connect;
  } else if (sslAvailable) {
    addPhase(phases, { key: 'ssl', available: true, durationMs: t.ssl, startOffsetMs: offset, source: 'har-standard' });
  }

  const workerStart = chrome?.workerStartMs;
  const workerReady = chrome?.workerReadyMs;
  if (isAvailable(workerStart) && isAvailable(workerReady) && workerReady >= workerStart) {
    addPhase(phases, {
      key: 'service-worker-preparation',
      available: true,
      durationMs: workerReady - workerStart,
      startOffsetMs: workerStart,
      source: 'derived-from-worker-offsets',
      overlapsStandardTotal: true,
    });
  }

  const workerFetchStart = chrome?.workerFetchStartMs;
  const workerRespondWithSettled = chrome?.workerRespondWithSettledMs;
  if (isAvailable(workerFetchStart) && isAvailable(workerRespondWithSettled) && workerRespondWithSettled >= workerFetchStart) {
    addPhase(phases, {
      key: 'service-worker-request',
      available: true,
      durationMs: workerRespondWithSettled - workerFetchStart,
      startOffsetMs: workerFetchStart,
      source: 'derived-from-worker-offsets',
      overlapsStandardTotal: true,
    });
  }

  if (a.send !== false) {
    addPhase(phases, { key: 'send', available: true, durationMs: t.send, startOffsetMs: offset, source: 'har-standard' });
    offset += t.send;
    accountedMs += t.send;
  }
  let responseStartOffsetMs: number | undefined;
  if (a.wait !== false) {
    addPhase(phases, { key: 'wait', available: true, durationMs: t.wait, startOffsetMs: offset, source: 'har-standard' });
    offset += t.wait;
    accountedMs += t.wait;
    responseStartOffsetMs = offset;
  }
  if (a.receive !== false) {
    addPhase(phases, { key: 'receive', available: true, durationMs: t.receive, startOffsetMs: offset, source: 'har-standard' });
    offset += t.receive;
    accountedMs += t.receive;
  }

  const totalMs = Math.max(0, entry.time || 0);
  const normalizedAccounted = Math.abs(accountedMs - totalMs) <= EPSILON_MS ? totalMs : accountedMs;

  return {
    phases,
    totalMs,
    accountedMs: normalizedAccounted,
    unaccountedMs: Math.max(0, totalMs - normalizedAccounted),
    responseStartOffsetMs,
    hasChromeDetail: Boolean(chrome && Object.values(chrome).some(value => value !== undefined)),
  };
}

export function getHarTimingPhase(timing: HarNormalizedTiming, key: HarDisplayTimingPhaseKey): HarNormalizedTimingPhase | undefined {
  return timing.phases.find(phase => phase.key === key);
}
