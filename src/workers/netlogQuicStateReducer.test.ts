import { createNetlogQuicStateReducer } from './netlogQuicStateReducer';

describe('createNetlogQuicStateReducer', () => {
  it('聚合 QUIC/HTTP3 session、版本、host 和错误事件', () => {
    const reducer = createNetlogQuicStateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 10,
      byteEnd: 20,
      time: 10,
      typeName: 'QUIC_SESSION_HANDSHAKE_CONFIRMED',
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
      time: 20,
      typeName: 'QUIC_SESSION_VERSION_NEGOTIATED',
      sourceId: 100,
      sourceTypeName: 'QUIC_SESSION',
      params: {
        negotiated_version: 'h3-29',
        peer_address: '203.0.113.10:443',
      },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 30,
      byteEnd: 40,
      time: 30,
      typeName: 'QUIC_SESSION_CONNECTION_MIGRATION',
      sourceId: 100,
      sourceTypeName: 'QUIC_SESSION',
      params: {
        peer_address: '203.0.113.11:443',
        version: 'h3-29',
      },
    });
    reducer.accept({
      eventId: 4,
      byteStart: 40,
      byteEnd: 50,
      time: 40,
      typeName: 'QUIC_SESSION_CLOSE_ON_ERROR',
      sourceId: 100,
      sourceTypeName: 'QUIC_SESSION',
      params: {
        quic_error: 'QUIC_NETWORK_IDLE_TIMEOUT',
        details: 'idle timeout',
      },
    });
    reducer.accept({
      eventId: 5,
      byteStart: 50,
      byteEnd: 60,
      time: 50,
      typeName: 'HTTP3_HEADERS_RECEIVED',
      sourceId: 200,
      sourceTypeName: 'HTTP3_SESSION',
      params: {
        origin: 'https://h3.example.com',
        negotiated_version: 'h3',
      },
    });
    reducer.accept({
      eventId: 6,
      byteStart: 60,
      byteEnd: 70,
      typeName: 'SOCKET_CONNECT',
      sourceId: 300,
      sourceTypeName: 'SOCKET',
      params: { address: '198.51.100.1:443' },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(5);
    expect(view.quicEventCount).toBe(4);
    expect(view.http3EventCount).toBe(1);
    expect(view.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 100,
        eventCount: 4,
        hosts: ['api.example.com'],
        peerAddresses: ['203.0.113.10:443', '203.0.113.11:443'],
        versions: ['h3-29'],
        errorCount: 1,
        firstEventId: 1,
        lastEventId: 4,
        firstByteStart: 10,
        lastByteEnd: 50,
        firstTime: 10,
        lastTime: 40,
        handshakeEventCount: 1,
        versionNegotiationEventCount: 1,
        migrationEventCount: 1,
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
        eventId: 4,
        sourceId: 100,
        error: 'QUIC_NETWORK_IDLE_TIMEOUT',
        details: 'idle timeout',
        byteStart: 40,
        byteEnd: 50,
        time: 40,
      }),
    ]);
    expect(view.stateEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 1, sourceId: 100, kind: 'handshake' }),
      expect.objectContaining({ eventId: 2, sourceId: 100, kind: 'version-negotiation', version: 'h3-29' }),
      expect.objectContaining({ eventId: 3, sourceId: 100, kind: 'migration', peerAddress: '203.0.113.11:443' }),
    ]));
    expect(view.impactSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 1,
        kind: 'handshake',
        sessionSourceId: 100,
        requestScoped: false,
        unresolvedReason: '缺少 URL_REQUEST/source 级 QUIC 锚点；只能作为协议状态或候选线索。',
      }),
      expect.objectContaining({
        eventId: 4,
        kind: 'error',
        sessionSourceId: 100,
        error: 'QUIC_NETWORK_IDLE_TIMEOUT',
        requestScoped: false,
        unresolvedReason: '缺少 URL_REQUEST/source 级 QUIC 错误锚点；只能作为协议错误候选线索。',
      }),
    ]));
    expect(view.requestScopedCandidateCount).toBe(0);
    expect(view.evidenceGaps).toEqual(expect.arrayContaining([
      'QUIC / HTTP3 使用状态是协议事实，不能单独作为请求失败或慢请求根因。',
      '发现 QUIC / HTTP3 error，请结合对应 raw event、目标 host、网络环境和 HTTP 回退情况判断影响。',
      '部分 QUIC / HTTP3 impact 只有协议 session 锚点，缺少 URL_REQUEST 关联；只能作为协议候选线索。',
    ]));
  });

  it('URL_REQUEST 级 HTTP3 错误会作为 request-scoped candidate', () => {
    const reducer = createNetlogQuicStateReducer();

    reducer.accept({
      eventId: 7,
      byteStart: 70,
      byteEnd: 80,
      time: 70,
      typeName: 'HTTP3_URL_REQUEST_FAILED',
      sourceId: 400,
      sourceTypeName: 'URL_REQUEST',
      params: {
        url: 'https://h3.example.com/api',
        negotiated_version: 'h3',
        net_error: -7,
        details: 'timeout',
      },
    });

    const view = reducer.finish();

    expect(view.requestScopedCandidateCount).toBe(1);
    expect(view.impactSummaries).toEqual([
      expect.objectContaining({
        eventId: 7,
        kind: 'error',
        sourceId: 400,
        sessionSourceId: 400,
        host: 'https://h3.example.com/api',
        version: 'h3',
        error: -7,
        details: 'timeout',
        requestScoped: true,
        unresolvedReason: undefined,
      }),
    ]);
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
