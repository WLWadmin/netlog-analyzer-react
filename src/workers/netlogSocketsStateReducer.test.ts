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
      }),
    ]);
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
});
