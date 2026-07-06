import { createNetlogSocketsStateReducer } from './netlogSocketsStateReducer';

describe('createNetlogSocketsStateReducer', () => {
  it('聚合 socket connect、tls、stall、pool 和错误事件', () => {
    const reducer = createNetlogSocketsStateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 10,
      byteEnd: 20,
      time: 10,
      typeName: 'SOCKET_POOL_BOUND_TO_CONNECT_JOB',
      sourceId: 100,
      sourceTypeName: 'SOCKET',
      params: {
        group_name: 'ssl/www.example.com:443',
      },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 20,
      byteEnd: 30,
      time: 20,
      typeName: 'TCP_CONNECT',
      sourceId: 100,
      sourceTypeName: 'SOCKET',
      params: {
        address: '203.0.113.10:443',
      },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 30,
      byteEnd: 40,
      time: 30,
      typeName: 'SSL_CONNECT',
      sourceId: 100,
      sourceTypeName: 'SSL_CONNECT_JOB',
      params: {
        peer_address: '203.0.113.10:443',
      },
    });
    reducer.accept({
      eventId: 4,
      byteStart: 40,
      byteEnd: 50,
      time: 40,
      typeName: 'SOCKET_STALLED_MAX_SOCKETS_PER_GROUP',
      sourceId: 100,
      sourceTypeName: 'SOCKET',
      params: {},
    });
    reducer.accept({
      eventId: 5,
      byteStart: 50,
      byteEnd: 60,
      time: 50,
      typeName: 'TCP_CONNECT_ATTEMPT',
      sourceId: 100,
      sourceTypeName: 'SOCKET',
      params: {
        net_error: -102,
        details: 'connection refused',
      },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(5);
    expect(view.connectCount).toBe(2);
    expect(view.tlsCount).toBe(1);
    expect(view.stallCount).toBe(1);
    expect(view.socketPoolCount).toBe(1);
    expect(view.sockets).toEqual([
      expect.objectContaining({
        sourceId: 100,
        sourceTypeName: 'SOCKET',
        eventCount: 5,
        connectCount: 2,
        tlsCount: 1,
        stallCount: 1,
        errorCount: 1,
        peerAddresses: ['203.0.113.10:443'],
        socketPools: ['ssl/www.example.com:443'],
        firstEventId: 1,
        lastEventId: 5,
        firstByteStart: 10,
        lastByteEnd: 60,
        firstTime: 10,
        lastTime: 50,
        sourceDependencyIds: [],
      }),
    ]);
    expect(view.errors).toEqual([
      expect.objectContaining({
        eventId: 5,
        sourceId: 100,
        typeName: 'TCP_CONNECT_ATTEMPT',
        error: -102,
        details: 'connection refused',
        time: 50,
        sourceDependencyIds: [],
      }),
    ]);
    expect(view.impactSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 2,
        kind: 'connect',
        peerAddress: '203.0.113.10:443',
        requestScoped: false,
        unresolvedReason: '缺少 source_dependency 或 URL_REQUEST 锚点；peer address/connect/stall 只能作为连接层候选线索。',
      }),
      expect.objectContaining({
        eventId: 4,
        kind: 'stall',
        requestScoped: false,
      }),
      expect.objectContaining({
        eventId: 5,
        kind: 'error',
        error: -102,
        details: 'connection refused',
        requestScoped: false,
        unresolvedReason: '缺少 source_dependency 或 URL_REQUEST 锚点；socket error 只能作为连接层错误候选线索。',
      }),
    ]));
    expect(view.requestScopedCandidateCount).toBe(0);
    expect(view.lazyParamsStats).toEqual({
      probeAttemptedEvents: 0,
      probeSatisfiedEvents: 0,
      fallbackParamEvents: 5,
    });
    expect(view.evidenceGaps).toContain('部分 Socket impact 只有连接层锚点，缺少 source_dependency 或 URL_REQUEST 关联；只能作为连接层候选线索。');
  });

  it('缺少 socket 事件时输出 evidence gap', () => {
    const reducer = createNetlogSocketsStateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 10,
      byteEnd: 20,
      typeName: 'URL_REQUEST',
      sourceId: 1,
      sourceTypeName: 'URL_REQUEST',
      params: { url: 'https://example.com' },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(0);
    expect(view.sockets).toEqual([]);
    expect(view.evidenceGaps).toContain('未发现 Socket / TCP / TLS 事件；不代表没有建立连接，只表示当前 Dataset 未捕获连接层事件。');
  });

  it('记录 Socket 显式 source dependency 边，不用 peer address 猜请求范围', () => {
    const reducer = createNetlogSocketsStateReducer();

    reducer.accept({
      eventId: 10,
      byteStart: 100,
      byteEnd: 120,
      time: 1000,
      typeName: 'SOCKET_CONNECT',
      sourceId: 700,
      sourceTypeName: 'SOCKET',
      params: {
        source_dependency: { id: 300, type: 'CONNECT_JOB' },
        address: '203.0.113.70:443',
        net_error: -102,
      },
    });

    const view = reducer.finish();

    expect(view.sockets).toEqual([
      expect.objectContaining({
        sourceId: 700,
        sourceDependencyIds: [300],
      }),
    ]);
    expect(view.errors).toEqual([
      expect.objectContaining({
        eventId: 10,
        sourceId: 700,
        sourceDependencyIds: [300],
      }),
    ]);
    expect(view.impactSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 10,
        kind: 'connect',
        sourceDependencyIds: [300],
        requestScoped: true,
        unresolvedReason: undefined,
      }),
      expect.objectContaining({
        eventId: 10,
        kind: 'error',
        error: -102,
        sourceDependencyIds: [300],
        requestScoped: true,
        unresolvedReason: undefined,
      }),
    ]));
    expect(view.requestScopedCandidateCount).toBe(2);
    expect(view.sourceLinks).toEqual([
      expect.objectContaining({
        fromSourceId: 700,
        toSourceId: 300,
        kind: 'source-dependency',
        eventId: 10,
      }),
    ]);
    expect(view.evidenceGaps).not.toContain('未发现 Socket 显式 source dependency 边；连接层影响范围不能用 peer address 或时间邻近直接外推。');
  });

  it('可以只用 eventJson probe 生成常见 socket params，不读取完整 params 对象', () => {
    const reducer = createNetlogSocketsStateReducer();

    reducer.accept({
      eventId: 20,
      byteStart: 200,
      byteEnd: 260,
      time: 2000,
      typeName: 'TCP_CONNECT_ATTEMPT',
      sourceId: 800,
      sourceTypeName: 'SOCKET',
      eventJson: '{"time":"2000","type":1,"source":{"id":800,"type":20},"phase":0,"params":{"address":"198.51.100.8:443","group_name":"ssl/probe.example:443","net_error":-7,"details":"timeout","source_dependency":{"id":301,"type":"CONNECT_JOB"}}}',
    });

    const view = reducer.finish();

    expect(view.lazyParamsStats).toEqual({
      probeAttemptedEvents: 1,
      probeSatisfiedEvents: 1,
      fallbackParamEvents: 0,
    });
    expect(view.sockets).toEqual([
      expect.objectContaining({
        sourceId: 800,
        peerAddresses: ['198.51.100.8:443'],
        socketPools: ['ssl/probe.example:443'],
        sourceDependencyIds: [301],
        errorCount: 1,
      }),
    ]);
    expect(view.errors).toEqual([
      expect.objectContaining({
        eventId: 20,
        error: -7,
        details: 'timeout',
        peerAddress: '198.51.100.8:443',
        sourceDependencyIds: [301],
      }),
    ]);
    expect(view.requestScopedCandidateCount).toBe(2);
  });

  it('复杂 source dependency probe 不足时回退到 params 对象', () => {
    const reducer = createNetlogSocketsStateReducer();

    reducer.accept({
      eventId: 21,
      byteStart: 260,
      byteEnd: 320,
      time: 2100,
      typeName: 'SOCKET_CONNECT',
      sourceId: 801,
      sourceTypeName: 'SOCKET',
      eventJson: '{"time":"2100","type":1,"source":{"id":801,"type":20},"phase":0,"params":{"source_dependency":{},"address":"198.51.100.9:443"}}',
      params: {
        sourceDependency: { id: 302 },
        address: '198.51.100.9:443',
      },
    });

    const view = reducer.finish();

    expect(view.lazyParamsStats).toEqual({
      probeAttemptedEvents: 1,
      probeSatisfiedEvents: 0,
      fallbackParamEvents: 1,
    });
    expect(view.sockets).toEqual([
      expect.objectContaining({
        sourceId: 801,
        peerAddresses: ['198.51.100.9:443'],
        sourceDependencyIds: [302],
      }),
    ]);
  });
});
