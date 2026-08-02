import { TimelineColumnarStore } from './timelineColumnarStore';

describe('TimelineColumnarStore', () => {
  const events = [
    {
      sourceIndex: 4,
      trackId: '1:10',
      startUs: -100,
      durationUs: 150,
      depth: 0,
      category: 'task',
      name: 'long-task',
      processId: 1,
      threadId: 10,
      evidenceIds: ['trace:event:4'],
    },
    {
      sourceIndex: 1,
      trackId: '1:10',
      startUs: 10,
      durationUs: 5,
      depth: 1,
      category: 'script',
      name: 'child',
      processId: 1,
      threadId: 10,
      parentSourceIndex: 4,
      evidenceIds: ['trace:event:1'],
    },
    {
      sourceIndex: 8,
      trackId: '2:20',
      startUs: 20,
      durationUs: 0,
      depth: 0,
      category: 'network',
      name: 'request',
      processId: 2,
      threadId: 20,
      frameId: 'frame-a',
      navigationId: 'nav-a',
      evidenceIds: ['trace:event:8'],
    },
  ];

  it('uses deterministic IDs and returns long events intersecting a closed range', () => {
    const first = TimelineColumnarStore.build(events);
    const second = TimelineColumnarStore.build(events);

    expect(first.query({ startUs: 0, endUs: 12, limit: 20 })).toEqual(
      second.query({ startUs: 0, endUs: 12, limit: 20 }),
    );
    expect(first.query({ startUs: 0, endUs: 12, limit: 20 }).events.map(
      event => event.name,
    )).toEqual(['long-task', 'child']);
    expect(first.query({ startUs: 20, endUs: 20, limit: 20 }).events.map(
      event => event.name,
    )).toEqual(['long-task', 'request']);
  });

  it('deduplicates strings and exposes deterministic continuation', () => {
    const store = TimelineColumnarStore.build(events);
    const first = store.query({ startUs: -100, endUs: 30, limit: 2 });
    expect(first.truncation).toMatchObject({
      truncated: true,
      returnedCount: 2,
      totalMatched: 3,
    });
    expect(store.query({
      startUs: -100,
      endUs: 30,
      limit: 2,
      continuation: first.truncation.continuation,
    }).events.map(event => event.name)).toEqual(['request']);
    expect(store.getStats().stringCount).toBeLessThan(events.length * 3);
  });

  it('continues by numeric source order when equal timestamps cross digit widths', () => {
    const store = TimelineColumnarStore.build([
      { ...events[0], sourceIndex: 2, startUs: 0, name: 'event-2' },
      { ...events[0], sourceIndex: 10, startUs: 0, name: 'event-10' },
    ]);
    const first = store.query({ startUs: 0, endUs: 0, limit: 1 });

    expect(first.events.map(event => event.name)).toEqual(['event-2']);
    expect(store.query({
      startUs: 0,
      endUs: 0,
      limit: 1,
      continuation: first.truncation.continuation,
    }).events.map(event => event.name)).toEqual(['event-10']);
  });

  it('keeps every populated track visible when the first viewport page is truncated', async () => {
    const dense = Array.from({ length: 10 }, (_, index) => ({
      ...events[0],
      sourceIndex: index,
      trackId: 'main',
      startUs: index,
      durationUs: 0,
      name: `main-${index}`,
    }));
    const store = TimelineColumnarStore.build([
      ...dense,
      { ...events[1], sourceIndex: 20, trackId: 'network', startUs: 20 },
      { ...events[2], sourceIndex: 21, trackId: 'rendering', startUs: 21 },
    ]);
    const query = {
      startUs: 0,
      endUs: 30,
      limit: 4,
      balanceByTrack: true,
    };

    const syncResult = store.query(query);
    expect(syncResult.events.map(event => event.trackId)).toEqual([
      'main',
      'main',
      'network',
      'rendering',
    ]);
    expect(syncResult.lod).toMatchObject({
      mode: 'sampled',
      sourceEventCount: 12,
      renderedEventCount: 4,
      level: 3,
    });
    const asyncResult = await store.queryAsync(query, {
      isCancelled: () => false,
      timeoutMs: 1_000,
      now: () => 0,
      yieldControl: () => Promise.resolve(),
    });
    expect(asyncResult.events.map(event => event.trackId)).toEqual([
      'main',
      'main',
      'network',
      'rendering',
    ]);
    expect(asyncResult.lod).toEqual(syncResult.lod);
  });

  it('does not resolve malformed event IDs to source index zero', () => {
    const store = TimelineColumnarStore.build([
      { ...events[0], sourceIndex: 0 },
    ]);

    expect(store.getInput('bad')).toBeUndefined();
    expect(store.getInput('trace:timeline:0')?.sourceIndex).toBe(0);
  });

  it('builds process, thread, frame and navigation indexes and releases columns', () => {
    const store = TimelineColumnarStore.build(events);
    expect(store.eventsByProcess(1)).toHaveLength(2);
    expect(store.eventsByThread(2, 20)).toHaveLength(1);
    expect(store.eventsByFrame('frame-a')).toHaveLength(1);
    expect(store.eventsByNavigation('nav-a')).toHaveLength(1);

    store.release();
    expect(store.getStats()).toEqual({
      eventCount: 0,
      stringCount: 0,
      trackEventCounts: {},
      released: true,
    });
  });

  it('filters before applying Event Log and search limits', async () => {
    const store = TimelineColumnarStore.build([
      { ...events[0], sourceIndex: 0, trackId: 'network', name: 'hidden request', startUs: 0 },
      { ...events[0], sourceIndex: 1, trackId: 'main', name: 'EvaluateScript', startUs: 1 },
      { ...events[0], sourceIndex: 2, trackId: 'main', name: 'Layout callback', startUs: 2 },
    ]);
    const options = {
      isCancelled: () => false,
      timeoutMs: 1_000,
      now: () => 0,
      yieldControl: () => Promise.resolve(),
    };
    const eventLog = await store.queryEventLog({
      range: { startUs: 0, endUs: 10 },
      limit: 1,
      filters: { trackIds: ['main'] },
    }, options);

    expect(eventLog.events.map(event => event.name)).toEqual(['EvaluateScript']);
    expect(eventLog.truncation).toMatchObject({
      truncated: true,
      returnedCount: 1,
      totalMatched: 2,
    });
    await expect(store.queryEventLog({
      range: { startUs: 0, endUs: 10 },
      limit: 10,
      query: 'layout',
      filters: { trackIds: ['main'] },
    }, options)).resolves.toMatchObject({
      events: [expect.objectContaining({ name: 'Layout callback' })],
    });
  });

  it('runs bounded declarative AND queries over the range index', async () => {
    const store = TimelineColumnarStore.build([
      {
        ...events[0],
        sourceIndex: 0,
        trackId: 'rendering',
        category: 'rendering',
        name: 'Layout',
        startUs: -10,
        durationUs: 20,
        status: 'warning' as const,
      },
      {
        ...events[0],
        sourceIndex: 1,
        trackId: 'rendering',
        category: 'rendering',
        name: 'Layout callback',
        startUs: 10,
        durationUs: 4,
        status: 'warning' as const,
      },
      {
        ...events[0],
        sourceIndex: 2,
        trackId: 'main',
        category: 'script',
        name: 'Layout',
        startUs: 20,
        durationUs: 30,
        status: 'normal' as const,
      },
    ]);
    const options = {
      isCancelled: () => false,
      timeoutMs: 1_000,
      now: () => 0,
      yieldControl: () => Promise.resolve(),
    };
    const result = await store.queryCustomEvents({
      range: { startUs: 0, endUs: 30 },
      query: {
        clauses: [
          { field: 'name', operator: 'contains', value: 'Layout' },
          { field: 'trackId', operator: 'equals', value: 'rendering' },
          { field: 'status', operator: 'equals', value: 'warning' },
          { field: 'durationUs', operator: 'gte', value: 5 },
        ],
      },
      limit: 1,
    }, options);

    expect(result.events.map(event => event.id)).toEqual(['trace:timeline:0']);
    expect(result.truncation).toEqual({
      truncated: false,
      returnedCount: 1,
      totalMatched: 1,
    });
  });

  it('bounds declarative query results and continues deterministically', async () => {
    const store = TimelineColumnarStore.build(Array.from(
      { length: 2_001 },
      (_, index) => ({
        ...events[0],
        sourceIndex: index,
        startUs: index,
        durationUs: 1,
        name: `task-${index}`,
      }),
    ));
    const options = {
      isCancelled: () => false,
      timeoutMs: 1_000,
      now: () => 0,
      yieldControl: () => Promise.resolve(),
    };
    const first = await store.queryCustomEvents({
      range: { startUs: 0, endUs: 3_000 },
      query: {
        clauses: [{ field: 'name', operator: 'contains', value: 'task-' }],
      },
      limit: 2_000,
    }, options);

    expect(first.events).toHaveLength(2_000);
    expect(first.truncation).toMatchObject({
      truncated: true,
      returnedCount: 2_000,
      totalMatched: 2_001,
      continuation: 'trace:timeline:1999',
    });
    await expect(store.queryCustomEvents({
      range: { startUs: 0, endUs: 3_000 },
      query: {
        clauses: [{ field: 'name', operator: 'contains', value: 'task-' }],
      },
      limit: 2_000,
      continuation: first.truncation.continuation,
    }, options)).resolves.toMatchObject({
      events: [expect.objectContaining({ id: 'trace:timeline:2000' })],
    });
  });
});
