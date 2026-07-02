import { createNetlogQuicStateReducer } from './netlogQuicStateReducer';

describe('createNetlogQuicStateReducer', () => {
  it('聚合 QUIC/HTTP3 session、版本、host 和错误事件', () => {
    const reducer = createNetlogQuicStateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 10,
      byteEnd: 20,
      typeName: 'QUIC_SESSION_PACKET_SENT',
      sourceId: 100,
      sourceTypeName: 'QUIC_SESSION',
      params: {
        host: 'api.example.com',
        peer_address: '203.0.113.10:443',
        version: 'h3-29',
      },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 20,
      byteEnd: 30,
      typeName: 'QUIC_SESSION_CLOSE_ON_ERROR',
      sourceId: 100,
      sourceTypeName: 'QUIC_SESSION',
      params: {
        quic_error: 'QUIC_NETWORK_IDLE_TIMEOUT',
        details: 'idle timeout',
      },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 30,
      byteEnd: 40,
      typeName: 'HTTP3_HEADERS_RECEIVED',
      sourceId: 200,
      sourceTypeName: 'HTTP3_SESSION',
      params: {
        origin: 'https://h3.example.com',
        negotiated_version: 'h3',
      },
    });
    reducer.accept({
      eventId: 4,
      byteStart: 40,
      byteEnd: 50,
      typeName: 'SOCKET_CONNECT',
      sourceId: 300,
      sourceTypeName: 'SOCKET',
      params: { address: '198.51.100.1:443' },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(3);
    expect(view.quicEventCount).toBe(2);
    expect(view.http3EventCount).toBe(1);
    expect(view.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 100,
        eventCount: 2,
        hosts: ['api.example.com'],
        peerAddresses: ['203.0.113.10:443'],
        versions: ['h3-29'],
        errorCount: 1,
        firstEventId: 1,
        lastEventId: 2,
      }),
      expect.objectContaining({
        sourceId: 200,
        eventCount: 1,
        hosts: ['https://h3.example.com'],
        versions: ['h3'],
      }),
    ]));
    expect(view.errors).toEqual([
      expect.objectContaining({
        eventId: 2,
        sourceId: 100,
        error: 'QUIC_NETWORK_IDLE_TIMEOUT',
        details: 'idle timeout',
        byteStart: 20,
        byteEnd: 30,
      }),
    ]);
    expect(view.evidenceGaps).toEqual(expect.arrayContaining([
      'QUIC / HTTP3 使用状态是协议事实，不能单独作为请求失败或慢请求根因。',
      '发现 QUIC / HTTP3 error，请结合对应 raw event、目标 host、网络环境和 HTTP 回退情况判断影响。',
    ]));
  });

  it('缺少 QUIC/HTTP3 事件时输出 evidence gap', () => {
    const reducer = createNetlogQuicStateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 10,
      byteEnd: 20,
      typeName: 'URL_REQUEST',
      sourceId: 100,
      sourceTypeName: 'URL_REQUEST',
      params: { url: 'https://example.com' },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(0);
    expect(view.sessions).toEqual([]);
    expect(view.evidenceGaps).toContain('未发现 QUIC / HTTP3 事件；不代表浏览器或服务端不支持 QUIC，只表示当前 Dataset 未捕获相关事件。');
  });
});
