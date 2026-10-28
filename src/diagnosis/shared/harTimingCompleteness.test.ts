import { parseHar } from '../../harParser';
import { getHarTimingCompleteness } from './harTimingCompleteness';
import { getHarRequestIssue } from './harRequestIssue';
import { buildHarRequestEvidenceConclusion } from './harRequestEvidence';
import { getHarTimingPhase, normalizeHarTiming } from './harTimingNormalization';
import { getHarWaterfallSegments, getHarWaterfallSortValue, buildHarWaterfallRange } from './harWaterfall';
import { buildHarObservations } from './diagnosisObservation';
import { buildHarIssueClusters } from './harIssueClusters';

function request(timings: Record<string, unknown>, time: unknown = 100, status = 200) {
  return parseHar({ log: { entries: [{
    request: { method: 'GET', url: 'https://example.test/', headers: [] },
    response: { status, headers: [], content: {} },
    startedDateTime: '2026-10-28T00:00:00Z', time, timings,
  }] } }).entries[0];
}

it.each([
  [{ send: 0, wait: 8000, receive: 0 }, 1],
  [{ send: 0, wait: 0, receive: 0, connect: 10, ssl: 8000 }, 10],
])('keeps contradictory timing as raw facts without phase attribution', (timings, time) => {
  const entry = request(timings, time);
  expect(getHarTimingCompleteness(entry).complete).toBe(false);
  expect(getHarRequestIssue(entry).kind).toBe('incomplete-timing');
  expect(buildHarObservations([entry])).toEqual([]);
  expect(buildHarIssueClusters([entry])).toEqual([]);
  expect(buildHarRequestEvidenceConclusion(entry).summary).toContain('矛盾');
  const normalized = normalizeHarTiming(entry);
  expect(getHarTimingPhase(normalized, 'wait')).toBeUndefined();
  expect(normalized.responseStartOffsetMs).toBeUndefined();
  expect(getHarWaterfallSegments(entry)).toEqual([]);
  expect(entry.standard.timings.wait).toMatchObject({ state: 'value', value: timings.wait });
  expect(getHarRequestIssue(request(timings, time, 503)).kind).toBe('server-error');
});

it('preserves recorded slow total without assigning a contradictory stage', () => {
  const entry = request({ send: 0, wait: 8000, receive: 0 }, 5000);
  expect(getHarRequestIssue(entry)).toMatchObject({ kind: 'slow', durationMs: 5000 });
  expect(getHarRequestIssue(entry).phase).toBeUndefined();
  expect(getHarRequestIssue(entry).roleHint).toBeUndefined();
});

it('retains response facts but refuses to call empty timings normal', () => {
  const entry = request({});
  expect(getHarTimingCompleteness(entry).unavailable.map(field => field.sourcePath)).toEqual([
    '$.log.entries[0].timings.send', '$.log.entries[0].timings.wait', '$.log.entries[0].timings.receive',
  ]);
  expect(entry.status).toBe(200);
  expect(entry.isFailed).toBe(false);
  expect(getHarRequestIssue(entry).kind).toBe('incomplete-timing');
  expect(buildHarObservations([entry])).toEqual([]);
  expect(buildHarIssueClusters([entry])).toEqual([]);
  expect(buildHarRequestEvidenceConclusion(entry).summary).toContain('不能确认请求正常');
  expect(getHarRequestIssue(request({}, 100, 503)).kind).toBe('server-error');
});

it.each([
  [{ send: 0, wait: 0, receive: 0, dns: -1, ssl: -1 }, true],
  [{ send: -1, wait: 0, receive: 0 }, false],
  [{ send: 0, wait: 'bad', receive: 0 }, false],
  [{ send: 0, receive: 0 }, false],
])('distinguishes zero, optional -1 and missing or invalid required phases', (timings, complete) => {
  expect(getHarTimingCompleteness(request(timings)).complete).toBe(complete);
});

it('shows known durations without inventing subsequent positions or response starts', () => {
  const entry = request({ wait: 50, receive: 50 });
  const normalized = normalizeHarTiming(entry);
  expect(normalized.phases.find(phase => phase.key === 'wait')).toMatchObject({ durationMs: 50, positionAvailable: false });
  expect(normalized.phases.find(phase => phase.key === 'receive')).toMatchObject({ durationMs: 50, positionAvailable: false });
  expect(normalized.responseStartOffsetMs).toBeUndefined();
  expect(getHarWaterfallSortValue(entry, 'response-time')).toBe(Infinity);
  expect(getHarWaterfallSegments(entry)).toEqual([]);
});

it('does not put missing total time on a timeline as zero milliseconds', () => {
  const entry = request({ send: 0, wait: 0, receive: 0 }, undefined);
  // Omit the field explicitly, since the helper has a default time.
  const missing = parseHar({ log: { entries: [{
    request: { url: 'https://example.test/', headers: [] }, response: { status: 200, headers: [], content: {} },
    startedDateTime: entry.startedDateTime, timings: { send: 0, wait: 0, receive: 0 },
  }] } }).entries[0];
  expect(getHarTimingCompleteness(missing).totalAvailable).toBe(false);
  expect(buildHarWaterfallRange([missing]).available).toBe(false);
});
