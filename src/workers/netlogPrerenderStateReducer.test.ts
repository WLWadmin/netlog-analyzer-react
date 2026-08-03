import { createNetlogPrerenderStateReducer } from './netlogPrerenderStateReducer';

describe('createNetlogPrerenderStateReducer', () => {
  it('聚合 prerender/prefetch/preconnect/prediction 事件', () => {
    const { accept, finish } = createNetlogPrerenderStateReducer();

    accept({
      eventId: 0,
      byteStart: 10,
      byteEnd: 50,
      time: 1,
      typeName: 'PRERENDER_NAVIGATION_STARTED',
      sourceId: 100,
      sourceTypeName: 'PRERENDER',
      params: { url: 'https://app.example/page' },
    });
    accept({
      eventId: 1,
      byteStart: 51,
      byteEnd: 90,
      time: 2,
      typeName: 'PREFETCH_REQUEST_FAILED',
      sourceId: 101,
      sourceTypeName: 'PREFETCH',
      params: { url: 'https://app.example/data', net_error: -105 },
    });

    const view = finish();

    expect(view.eventCount).toBe(2);
    expect(view.prerenderCount).toBe(1);
    expect(view.prefetchCount).toBe(1);
    expect(view.errorCount).toBe(1);
    expect(view.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 100, kind: 'prerender', urls: ['https://app.example/page'] }),
      expect.objectContaining({ sourceId: 101, kind: 'prefetch', errorCount: 1 }),
    ]));
    expect(view.impactSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'failed', error: -105, requestScoped: true }),
    ]));
  });
});
