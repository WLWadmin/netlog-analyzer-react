import { createNetlogCacheStateReducer } from './netlogCacheStateReducer';

describe('createNetlogCacheStateReducer', () => {
  it('聚合 HTTP cache 操作、错误和 request-scoped impact', () => {
    const reducer = createNetlogCacheStateReducer();

    reducer.accept({
      eventId: 0,
      byteStart: 10,
      byteEnd: 50,
      time: 1,
      typeName: 'HTTP_CACHE_OPEN_ENTRY',
      sourceId: 100,
      sourceTypeName: 'URL_REQUEST',
      params: { url: 'https://a.example/app.js', source_dependency: { id: 10 } },
    });
    reducer.accept({
      eventId: 1,
      byteStart: 51,
      byteEnd: 90,
      time: 2,
      typeName: 'HTTP_CACHE_READ_DATA',
      sourceId: 100,
      sourceTypeName: 'URL_REQUEST',
      params: { url: 'https://a.example/app.js', net_error: -2 },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 91,
      byteEnd: 130,
      time: 3,
      typeName: 'HOST_RESOLVER_MANAGER_CACHE_HIT',
      sourceId: 200,
      sourceTypeName: 'HOST_RESOLVER',
      params: { host: 'a.example' },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(2);
    expect(view.openCount).toBe(1);
    expect(view.readCount).toBe(1);
    expect(view.errorCount).toBe(1);
    expect(view.entries).toEqual([
      expect.objectContaining({
        sourceId: 100,
        eventCount: 2,
        operationKinds: expect.arrayContaining(['open', 'read']),
        urls: ['https://a.example/app.js'],
        sourceDependencyIds: [10],
        errorCount: 1,
      }),
    ]);
    expect(view.impactSummaries).toEqual([
      expect.objectContaining({
        kind: 'error',
        requestScoped: true,
        url: 'https://a.example/app.js',
        error: -2,
      }),
    ]);
    expect(view.evidenceGaps).toEqual(expect.arrayContaining([
      'Cache State 展示浏览器缓存层事实，不能单独把 cache miss、revalidation 或 doom 当成请求失败根因。',
    ]));
  });
});
