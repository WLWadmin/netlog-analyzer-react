import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream } from 'stream/web';
import { scanNetlogEventJson, type NetlogStreamScanMeta } from './netlogStreamScanner';

Object.assign(global, { TextDecoder, TextEncoder, ReadableStream });

async function collect(chunks: string[]) {
  const meta: NetlogStreamScanMeta = { bytesRead: 0, parsedEvents: 0, skippedEvents: 0, reachedEventsEnd: false };
  const events: string[] = [];
  const topLevelFields: Record<string, unknown> = {};
  async function* source() {
    for (const chunk of chunks) yield chunk;
  }
  for await (const eventJson of scanNetlogEventJson(source(), meta, {
    onTopLevelField: (key, valueJson) => {
      topLevelFields[key] = JSON.parse(valueJson);
    },
  })) {
    events.push(eventJson);
  }
  return { events, meta, topLevelFields };
}

async function collectFromStream(text: string) {
  const meta: NetlogStreamScanMeta = { bytesRead: 0, parsedEvents: 0, skippedEvents: 0, reachedEventsEnd: false };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, 12)));
      controller.enqueue(encoder.encode(text.slice(12)));
      controller.close();
    },
  });
  const events: string[] = [];
  for await (const eventJson of scanNetlogEventJson(stream, meta)) {
    events.push(eventJson);
  }
  return { events, meta };
}

describe('scanNetlogEventJson', () => {
  it('从 events 数组提取单条事件 JSON', async () => {
    const { events, meta } = await collect(['{"constants":{},"events":[{"type":1,"params":{"url":"https://a.com"}}]}']);

    expect(events).toEqual(['{"type":1,"params":{"url":"https://a.com"}}']);
    expect(meta.parsedEvents).toBe(1);
    expect(meta.reachedEventsEnd).toBe(true);
  });

  it('兼容 Chrome NetLog 的 logEvents 数组', async () => {
    const { events, meta } = await collect(['{"constants":{},"logEvents":[{"type":7,"source":{"id":1,"type":1}}]}']);

    expect(events).toEqual(['{"type":7,"source":{"id":1,"type":1}}']);
    expect(meta.parsedEvents).toBe(1);
    expect(meta.reachedEventsEnd).toBe(true);
  });

  it('支持真实 file.stream 风格的 ReadableStream<Uint8Array>', async () => {
    const { events, meta } = await collectFromStream('{"constants":{},"logEvents":[{"type":7,"source":{"id":1,"type":1}}]}');

    expect(events).toEqual(['{"type":7,"source":{"id":1,"type":1}}']);
    expect(meta.parsedEvents).toBe(1);
    expect(meta.reachedEventsEnd).toBe(true);
  });

  it('不会把嵌套对象里的 events 字段误识别为顶层事件数组', async () => {
    const { events } = await collect([
      '{"metadata":{"events":[{"type":999}]},"constants":{},"logEvents":[{"type":1}]}',
    ]);

    expect(events).toEqual(['{"type":1}']);
  });

  it('在进入 events 前提取顶层 constants 和 polledData', async () => {
    const { events, topLevelFields } = await collect([
      '{"constants":{"logEventTypes":{"1":"URL_REQUEST"},"logSourceType":{"1":"URL_REQUEST"}},',
      '"polledData":{"dns_config":{"nameservers":["223.5.5.5:53"]}},',
      '"events":[{"type":1,"source":{"id":1,"type":1}}]}',
    ]);

    expect(events).toEqual(['{"type":1,"source":{"id":1,"type":1}}']);
    expect(topLevelFields.constants).toEqual({
      logEventTypes: { '1': 'URL_REQUEST' },
      logSourceType: { '1': 'URL_REQUEST' },
    });
    expect(topLevelFields.polledData).toEqual({
      dns_config: { nameservers: ['223.5.5.5:53'] },
    });
  });

  it('支持 chunk 切在对象和字符串中间', async () => {
    const { events } = await collect([
      '{"events":[{"type":1,"params":{"text":"a',
      '\\"{not object}\\"',
      '","nested":{"ok":true}}},{"type":2}]}',
    ]);

    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]).params.text).toBe('a"{not object}"');
    expect(JSON.parse(events[0]).params.nested.ok).toBe(true);
  });

  it('找不到 events/logEvents 时抛出明确错误', async () => {
    await expect(collect(['{"metadata":{"events":[{"type":999}]}}'])).rejects.toThrow('未找到 NetLog events/logEvents 数组');
  });

  it('events 未结束时抛出截断错误', async () => {
    await expect(collect(['{"events":[{"type":1}'])).rejects.toThrow('文件可能被截断');
  });
});
