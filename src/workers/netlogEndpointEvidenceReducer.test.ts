import { createNetlogEndpointEvidenceReducer } from './netlogEndpointEvidenceReducer';

describe('netlogEndpointEvidenceReducer', () => {
  it('从全量事件 seed 产出 x-request-ip、socket peer 和 DNS answer 证据', () => {
    const reducer = createNetlogEndpointEvidenceReducer();

    reducer.accept({
      eventId: 0,
      byteStart: 0,
      byteEnd: 99,
      time: 10,
      typeName: 'URL_REQUEST_START_JOB',
      sourceId: 100,
      sourceTypeName: 'URL_REQUEST',
      phase: 0,
      params: { url: 'https://api.example.com/data', method: 'GET' },
    });
    reducer.accept({
      eventId: 1,
      byteStart: 100,
      byteEnd: 199,
      time: 20,
      typeName: 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS',
      sourceId: 100,
      sourceTypeName: 'URL_REQUEST',
      phase: 2,
      params: { headers: ['x-request-ip: 198.51.100.7'] },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 200,
      byteEnd: 299,
      time: 25,
      typeName: 'SOCKET_CONNECT',
      sourceId: 200,
      sourceTypeName: 'SOCKET',
      phase: 2,
      params: { address: '203.0.113.8:443' },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 300,
      byteEnd: 399,
      time: 30,
      typeName: 'HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS',
      sourceId: 300,
      sourceTypeName: 'HOST_RESOLVER_IMPL_JOB',
      phase: 2,
      params: {
        results: {
          aliases: ['api.example.com'],
          ip_endpoints: [{ endpoint_address: '203.0.113.9', endpoint_port: 0 }],
        },
      },
    });

    const summary = reducer.finish();

    expect(summary.failedOrSlowIps).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'server-observed-client-ip', ip: '198.51.100.7', eventId: 1, sourceId: 100, byteStart: 100, byteEnd: 199 }),
      expect.objectContaining({ role: 'socket-peer', ip: '203.0.113.8', host: '未关联到具体请求', eventId: 2, sourceId: 200, byteStart: 200, byteEnd: 299 }),
      expect.objectContaining({ role: 'dns-answer', ip: '203.0.113.9', host: 'api.example.com', eventId: 3, sourceId: 300, byteStart: 300, byteEnd: 399 }),
    ]));
    expect(summary.dnsAnswers).toEqual([
      expect.objectContaining({ host: 'api.example.com', ips: ['203.0.113.9'], eventId: 3, sourceId: 300, byteStart: 300, byteEnd: 399 }),
    ]);
    expect(summary.cipSipRows.some(row => row.sipIps.includes('203.0.113.8'))).toBe(false);
    expect(summary.cipSipRows.some(row => (row.socketPeerIps || []).includes('203.0.113.8'))).toBe(true);
  });
});
