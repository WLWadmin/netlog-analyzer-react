import { createNetlogReportingStateReducer } from './netlogReportingStateReducer';

describe('createNetlogReportingStateReducer', () => {
  it('聚合 Reporting/NEL endpoint、队列和上传失败线索', () => {
    const reducer = createNetlogReportingStateReducer();

    reducer.accept({
      eventId: 0,
      byteStart: 10,
      byteEnd: 60,
      time: 1,
      typeName: 'REPORTING_HEADER_PARSED',
      sourceId: 100,
      sourceTypeName: 'URL_REQUEST',
      params: {
        origin: 'https://app.example',
        group: 'default',
        endpoint_url: 'https://reports.example/nel?token=secret',
        priority: 1,
        weight: 10,
      },
    });
    reducer.accept({
      eventId: 1,
      byteStart: 61,
      byteEnd: 90,
      time: 2,
      typeName: 'NETWORK_ERROR_LOGGING_REPORT_QUEUED',
      sourceId: 101,
      sourceTypeName: 'URL_REQUEST',
      params: {
        origin: 'https://app.example',
        report_type: 'network-error',
        url: 'https://app.example/api',
      },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 91,
      byteEnd: 130,
      time: 3,
      typeName: 'REPORTING_UPLOAD_FAILED',
      sourceId: 102,
      sourceTypeName: 'REPORTING',
      params: {
        origin: 'https://app.example',
        endpoint_url: 'https://reports.example/nel',
        net_error: -105,
      },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 131,
      byteEnd: 150,
      time: 4,
      typeName: 'HTTP_TRANSACTION_TUNNEL_READ_HEADERS',
      sourceId: 103,
      sourceTypeName: 'URL_REQUEST',
      params: { net_error: -111 },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(3);
    expect(view.endpointCount).toBe(2);
    expect(view.queuedCount).toBe(1);
    expect(view.failureCount).toBe(1);
    expect(view.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        origin: 'https://app.example',
        group: 'default',
        url: 'https://reports.example/nel?token=secret',
        eventCount: 1,
      }),
      expect.objectContaining({
        origin: 'https://app.example',
        url: 'https://reports.example/nel',
        failureCount: 1,
      }),
    ]));
    expect(view.impactSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'endpoint-config',
        requestScoped: true,
      }),
      expect.objectContaining({
        kind: 'upload-failure',
        error: -105,
        requestScoped: true,
      }),
    ]));
    expect(view.evidenceGaps).toEqual(expect.arrayContaining([
      'Reporting/NEL 是浏览器上报网络错误的旁路机制，不能单独作为用户请求失败根因。',
    ]));
  });
});
