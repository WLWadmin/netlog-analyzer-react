import { createNetlogAltSvcStateReducer } from './netlogAltSvcStateReducer';

describe('createNetlogAltSvcStateReducer', () => {
  it('聚合 Alt-Svc found 和 broken 线索', () => {
    const reducer = createNetlogAltSvcStateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 10,
      byteEnd: 60,
      time: 1,
      typeName: 'HTTP_STREAM_JOB_CONTROLLER_ALT_SVC_FOUND',
      sourceId: 100,
      sourceTypeName: 'HTTP_STREAM_JOB_CONTROLLER',
      params: { host: 'a.example', protocol: 'h3', alternative_service: 'a.example:443' },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 61,
      byteEnd: 90,
      time: 2,
      typeName: 'ALTERNATE_SERVICE_BROKEN',
      sourceId: 101,
      sourceTypeName: 'URL_REQUEST',
      params: { host: 'a.example', protocol: 'h3', error: -352 },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(2);
    expect(view.foundCount).toBe(1);
    expect(view.brokenCount).toBe(1);
    expect(view.alternatives[0]).toEqual(expect.objectContaining({
      host: 'a.example',
      protocol: 'h3',
      brokenCount: 1,
    }));
    expect(view.impactSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'mapped', requestScoped: true }),
      expect.objectContaining({ kind: 'broken', error: -352, requestScoped: true }),
    ]));
  });
});
