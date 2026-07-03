import { createNetlogHttp2StateReducer } from './netlogHttp2StateReducer';

describe('createNetlogHttp2StateReducer', () => {
  it('聚合 HTTP/2 session、stream、GOAWAY、RST_STREAM 和错误事件', () => {
    const reducer = createNetlogHttp2StateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 10,
      byteEnd: 20,
      time: 10,
      typeName: 'HTTP2_SESSION_INITIALIZED',
      sourceId: 100,
      sourceTypeName: 'HTTP2_SESSION',
      params: {
        host: 'api.example.com',
        protocol: 'h2',
      },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 20,
      byteEnd: 30,
      time: 20,
      typeName: 'HTTP2_STREAM_SEND_HEADERS',
      sourceId: 200,
      sourceTypeName: 'HTTP2_STREAM',
      params: {
        session_id: 100,
        stream_id: 3,
        url: 'https://api.example.com/data',
      },
    });
    reducer.accept({
      eventId: 3,
      byteStart: 30,
      byteEnd: 40,
      time: 30,
      typeName: 'HTTP2_STREAM_RST_STREAM',
      sourceId: 200,
      sourceTypeName: 'HTTP2_STREAM',
      params: {
        session_id: 100,
        stream_id: 3,
        error_code: 'PROTOCOL_ERROR',
        details: 'rst by peer',
      },
    });
    reducer.accept({
      eventId: 4,
      byteStart: 40,
      byteEnd: 50,
      time: 40,
      typeName: 'HTTP2_SESSION_SEND_GOAWAY',
      sourceId: 100,
      sourceTypeName: 'HTTP2_SESSION',
      params: {
        error_code: 0,
      },
    });
    reducer.accept({
      eventId: 5,
      byteStart: 50,
      byteEnd: 60,
      time: 50,
      typeName: 'HTTP2_SESSION_UPDATE_RECV_WINDOW',
      sourceId: 100,
      sourceTypeName: 'HTTP2_SESSION',
      params: {},
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(5);
    expect(view.goawayCount).toBe(1);
    expect(view.rstStreamCount).toBe(1);
    expect(view.windowUpdateCount).toBe(1);
    expect(view.sessions).toEqual([
      expect.objectContaining({
        sourceId: 100,
        eventCount: 5,
        streamCount: 1,
        hosts: expect.arrayContaining(['api.example.com', 'https://api.example.com/data']),
        protocols: ['h2'],
        goawayCount: 1,
        rstStreamCount: 1,
        windowUpdateCount: 1,
        errorCount: 2,
        firstEventId: 1,
        lastEventId: 5,
        firstByteStart: 10,
        lastByteEnd: 60,
        firstTime: 10,
        lastTime: 50,
      }),
    ]);
    expect(view.streams).toEqual([
      expect.objectContaining({
        sourceId: 200,
        sessionSourceId: 100,
        streamId: 3,
        eventCount: 2,
        hosts: ['https://api.example.com/data'],
        errorCount: 1,
        firstEventId: 2,
        lastEventId: 3,
        firstByteStart: 20,
        lastByteEnd: 40,
        firstTime: 20,
        lastTime: 30,
      }),
    ]);
    expect(view.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 3,
        sourceId: 200,
        sessionSourceId: 100,
        streamId: 3,
        error: 'PROTOCOL_ERROR',
        details: 'rst by peer',
        time: 30,
      }),
      expect.objectContaining({
        eventId: 4,
        sourceId: 100,
        error: 0,
      }),
    ]));
  });

  it('缺少 HTTP/2 事件时输出 evidence gap', () => {
    const reducer = createNetlogHttp2StateReducer();

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
    expect(view.sessions).toEqual([]);
    expect(view.evidenceGaps).toContain('未发现 HTTP/2 事件；不代表浏览器或服务端不支持 HTTP/2，只表示当前 Dataset 未捕获相关事件。');
  });

  it('stream 无法关联 session 时输出 evidence gap，不推断影响范围', () => {
    const reducer = createNetlogHttp2StateReducer();

    reducer.accept({
      eventId: 10,
      byteStart: 100,
      byteEnd: 120,
      time: 1000,
      typeName: 'HTTP2_STREAM_RST_STREAM',
      sourceId: 300,
      sourceTypeName: 'HTTP2_STREAM',
      params: {
        stream_id: 7,
        error_code: 'REFUSED_STREAM',
      },
    });

    const view = reducer.finish();

    expect(view.streams).toEqual([
      expect.objectContaining({
        sourceId: 300,
        sessionSourceId: undefined,
        streamId: 7,
        firstByteStart: 100,
        lastByteEnd: 120,
        firstTime: 1000,
        lastTime: 1000,
      }),
    ]);
    expect(view.evidenceGaps).toContain('存在未关联到 HTTP/2 session 的 stream；不能用相同 host 或相近时间直接推断影响范围。');
  });
});
