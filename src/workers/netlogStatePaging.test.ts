import { pageNetlogState } from './netlogStatePaging';

it('returns bounded independent pages with complete totals and original evidence identifiers', () => {
  const view = {
    errors: Array.from({ length: 20001 }, (_, eventId) => ({ eventId, sourceId: eventId + 10, byteStart: eventId * 100 })),
    sessions: [{ sourceId: 1 }],
    eventCount: 30000,
    evidenceGaps: ['未采集到请求终态'],
  };
  const first = pageNetlogState(view, { pages: {} });
  const last = pageNetlogState(view, { pages: { errors: 2501 } });
  expect(first.errors).toHaveLength(8);
  expect(last.errors).toEqual([{ eventId: 20000, sourceId: 20010, byteStart: 2000000 }]);
  expect(last.sessions).toEqual(view.sessions);
  expect(last.paging?.totals).toEqual({ errors: 20001, sessions: 1 });
  expect(last.eventCount).toBe(30000);
  expect(last.evidenceGaps).toEqual(view.evidenceGaps);
  expect(pageNetlogState(view)).toBe(view);
  expect(view.errors).toHaveLength(20001);
});

it('keeps full QUIC kind counts and pages string lists without mutating reducer snapshots', () => {
  const view = Object.freeze({
    stateEvents: Array.from({ length: 20 }, (_, i) => ({ kind: i < 10 ? 'handshake' : 'migration' })),
    pacUrls: Array.from({ length: 10 }, (_, i) => `pac-${i}`),
    evidenceGaps: [],
  });
  const next = pageNetlogState(view, { pages: { stateEvents: 2, pacUrls: 2 } });
  expect(next.paging?.kindCounts).toEqual({ handshake: 10, migration: 10 });
  expect(next.pacUrls).toEqual(['pac-8', 'pac-9']);
  expect(next.stateEvents).toHaveLength(8);
});

it.each([NaN, Infinity, -4, 999])('normalizes invalid or out-of-range page %s', page => {
  const result = pageNetlogState({ errors: [1, 2, 3] }, { pages: { errors: page } });
  expect(result.errors).toEqual([1, 2, 3]);
  expect(result.paging?.pages.errors).toBe(1);
});
