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
    expect(summary.dnsAnswerSourceStats).toEqual({
      candidateCount: 1,
      uniqueHostIpPairs: 1,
      missingTraceCount: 0,
      bySourceKind: { dnsTaskResult: 1 },
      byTypeName: { HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS: 1 },
    });
    expect(summary.cipSipRows.some(row => row.sipIps.includes('203.0.113.8'))).toBe(false);
    expect(summary.cipSipRows.some(row => (row.socketPeerIps || []).includes('203.0.113.8'))).toBe(true);
    expect(summary.cipSipRows.find(row => row.host === 'api.example.com')?.evidenceTraces).toEqual(expect.arrayContaining([
      { eventId: 1, sourceId: 100, byteStart: 100, byteEnd: 199 },
      { eventId: 3, sourceId: 300, byteStart: 300, byteEnd: 399 },
    ]));
    expect(summary.cipSipRows.find(row => row.host === '未关联到具体请求')?.evidenceTraces).toEqual([
      { eventId: 2, sourceId: 200, byteStart: 200, byteEnd: 299 },
    ]);
  });

  it('通过 source graph 关联 URL_REQUEST 与 socket peer，但不把 socket peer 塞进 SIP', () => {
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
      params: { url: 'https://graph.example.com/data', method: 'GET' },
    });
    reducer.accept({
      eventId: 1,
      byteStart: 100,
      byteEnd: 199,
      time: 20,
      typeName: 'HTTP_STREAM_JOB',
      sourceId: 200,
      sourceTypeName: 'HTTP_STREAM_JOB',
      phase: 2,
      params: { source_dependency: { id: 100, type: 'URL_REQUEST' } },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 200,
      byteEnd: 299,
      time: 30,
      typeName: 'SOCKET_CONNECT',
      sourceId: 300,
      sourceTypeName: 'SOCKET',
      phase: 2,
      params: {
        source_dependency: { id: 200, type: 'HTTP_STREAM_JOB' },
        address: '203.0.113.20:443',
      },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 300,
      byteEnd: 399,
      time: 40,
      typeName: 'SOCKET_CONNECT',
      sourceId: 400,
      sourceTypeName: 'SOCKET',
      phase: 2,
      params: { address: '203.0.113.21:443' },
    });

    const summary = reducer.finish();

    expect(summary.failedOrSlowIps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'socket-peer',
        association: 'source-graph',
        ip: '203.0.113.20',
        host: 'graph.example.com',
        url: 'https://graph.example.com/data',
        eventId: 2,
        sourceId: 300,
      }),
      expect.objectContaining({
        role: 'socket-peer',
        association: 'global-candidate',
        ip: '203.0.113.21',
        host: '未关联到具体请求',
        eventId: 3,
        sourceId: 400,
      }),
    ]));
    const graphRow = summary.cipSipRows.find(row => row.host === 'graph.example.com');
    expect(graphRow?.socketPeerIps).toContain('203.0.113.20');
    expect(graphRow?.sipIps).not.toContain('203.0.113.20');
    expect(graphRow?.evidenceAssociations).toContain('source-graph');
    expect(summary.cipSipRows.find(row => row.host === '未关联到具体请求')?.evidenceAssociations).toContain('global-candidate');
    expect(summary.sourceGraphStats).toEqual({
      socketPeerTotal: 2,
      socketPeerSourceGraphAssociated: 1,
      socketPeerGlobalCandidate: 1,
      sourceDependencyEdges: 2,
      sourceDependencyUnparsed: 0,
      globalCandidateByTypeName: { SOCKET_CONNECT: 1 },
      globalCandidateBySourceTypeName: { SOCKET: 1 },
      globalCandidateParamKeys: { address: 1 },
      sourceGraphDepthHit: { '2': 1 },
      sourceGraphUnresolvedReasons: { noSourceLink: 1 },
    });
  });

  it('统计数组和嵌套 source dependency 覆盖率，并记录未解析依赖', () => {
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
      params: { url: 'https://nested.example.com/data' },
    });
    reducer.accept({
      eventId: 1,
      byteStart: 100,
      byteEnd: 199,
      time: 20,
      typeName: 'HTTP_STREAM_JOB',
      sourceId: 200,
      sourceTypeName: 'HTTP_STREAM_JOB',
      phase: 2,
      params: {
        source_dependencies: [
          { id: 100, type: 'URL_REQUEST' },
          { dependency: { sourceId: 999 } },
        ],
      },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 200,
      byteEnd: 299,
      time: 30,
      typeName: 'SOCKET_CONNECT',
      sourceId: 300,
      sourceTypeName: 'SOCKET',
      phase: 2,
      params: {
        sourceDependency: { dependencies: [{ source_id: 200 }] },
        address: '203.0.113.30:443',
      },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 300,
      byteEnd: 399,
      time: 40,
      typeName: 'SOCKET_CONNECT',
      sourceId: 400,
      sourceTypeName: 'SOCKET',
      phase: 2,
      params: {
        source_dependency: { type: 'BROKEN_DEPENDENCY' },
        address: '203.0.113.31:443',
      },
    });

    const summary = reducer.finish();

    expect(summary.failedOrSlowIps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'socket-peer',
        association: 'source-graph',
        ip: '203.0.113.30',
        host: 'nested.example.com',
      }),
      expect.objectContaining({
        role: 'socket-peer',
        association: 'global-candidate',
        ip: '203.0.113.31',
      }),
    ]));
    expect(summary.sourceGraphStats).toEqual({
      socketPeerTotal: 2,
      socketPeerSourceGraphAssociated: 1,
      socketPeerGlobalCandidate: 1,
      sourceDependencyEdges: 3,
      sourceDependencyUnparsed: 1,
      globalCandidateByTypeName: { SOCKET_CONNECT: 1 },
      globalCandidateBySourceTypeName: { SOCKET: 1 },
      globalCandidateParamKeys: { address: 1, source_dependency: 1 },
      sourceGraphDepthHit: { '2': 1 },
      sourceGraphUnresolvedReasons: { noSourceLink: 1 },
    });
  });

  it('通过明确 source id 字段建立 source graph，并保留未关联原因统计', () => {
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
      params: { url: 'https://source-id.example.com/data' },
    });
    reducer.accept({
      eventId: 1,
      byteStart: 100,
      byteEnd: 199,
      time: 20,
      typeName: 'SOCKET_CONNECT',
      sourceId: 300,
      sourceTypeName: 'SOCKET',
      phase: 2,
      params: {
        url_request_source_id: 100,
        peer_address: '203.0.113.40:443',
      },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 200,
      byteEnd: 299,
      time: 30,
      typeName: 'SOCKET_CONNECT',
      sourceId: 400,
      sourceTypeName: 'SOCKET',
      phase: 2,
      params: {
        source_dependency: { type: 'SOCKET_POOL' },
        peer_address: '203.0.113.41:443',
      },
    });

    const summary = reducer.finish();

    expect(summary.failedOrSlowIps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'socket-peer',
        association: 'source-graph',
        associationReason: 'sourceDependency',
        ip: '203.0.113.40',
        host: 'source-id.example.com',
      }),
      expect.objectContaining({
        role: 'socket-peer',
        association: 'global-candidate',
        unresolvedReason: 'noSourceLink',
        ip: '203.0.113.41',
      }),
    ]));
    expect(summary.cipSipRows.find(row => row.host === 'source-id.example.com')?.sipIps).not.toContain('203.0.113.40');
    expect(summary.sourceGraphStats).toEqual({
      socketPeerTotal: 2,
      socketPeerSourceGraphAssociated: 1,
      socketPeerGlobalCandidate: 1,
      sourceDependencyEdges: 1,
      sourceDependencyUnparsed: 1,
      globalCandidateByTypeName: { SOCKET_CONNECT: 1 },
      globalCandidateBySourceTypeName: { SOCKET: 1 },
      globalCandidateParamKeys: { peer_address: 1, source_dependency: 1 },
      sourceGraphDepthHit: { '1': 1 },
      sourceGraphUnresolvedReasons: { noSourceLink: 1 },
    });
  });
});
