import { createNetlogStreamPoolStateReducer } from './netlogStreamPoolStateReducer';

describe('createNetlogStreamPoolStateReducer', () => {
  it('聚合 stream job waiting、socket pool stall 和 source link', () => {
    const reducer = createNetlogStreamPoolStateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 10,
      byteEnd: 60,
      time: 1,
      typeName: 'HTTP_STREAM_JOB_WAITING_FOR_TRANSPORT_POOL',
      sourceId: 100,
      sourceTypeName: 'HTTP_STREAM_JOB',
      params: { url: 'https://a.example/api', source_dependency: { id: 10 } },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 61,
      byteEnd: 90,
      time: 2,
      typeName: 'SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP',
      sourceId: 100,
      sourceTypeName: 'SOCKET_POOL',
      params: { group_name: 'ssl/a.example:443', net_error: -7 },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(2);
    expect(view.waitCount).toBe(1);
    expect(view.stalledCount).toBe(1);
    expect(view.errorCount).toBe(1);
    expect(view.jobs).toEqual([
      expect.objectContaining({
        sourceId: 100,
        waitCount: 1,
        stalledCount: 1,
        sourceDependencyIds: [10],
      }),
    ]);
    expect(view.sourceLinks).toEqual([
      expect.objectContaining({ fromSourceId: 100, toSourceId: 10 }),
    ]);
    expect(view.impactSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'waiting', requestScoped: true }),
      expect.objectContaining({ kind: 'stalled', error: -7 }),
    ]));
  });
});
