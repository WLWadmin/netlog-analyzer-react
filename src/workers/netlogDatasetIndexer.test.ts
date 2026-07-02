import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { buildNetlogCompactEventIndex, readNetlogEventDetail, type NetlogIndexableFile } from './netlogDatasetIndexer';

Object.assign(global, { TextDecoder });

class ChunkedTextFile implements NetlogIndexableFile {
  private readonly bytes: Uint8Array;
  name = 'chunked-netlog.json';
  size: number;

  constructor(text: string, private readonly chunkSizes: number[]) {
    this.bytes = new TextEncoder().encode(text);
    this.size = this.bytes.length;
  }

  stream(): ReadableStream<Uint8Array> {
    const bytes = this.bytes;
    const chunkSizes = this.chunkSizes;
    let offset = 0;
    let chunkIndex = 0;
    const StreamCtor = NodeReadableStream as unknown as typeof ReadableStream;
    return new StreamCtor({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const size = chunkSizes[chunkIndex] || 8;
        chunkIndex += 1;
        const next = bytes.slice(offset, Math.min(bytes.length, offset + size));
        offset += next.length;
        controller.enqueue(next);
      },
    }) as unknown as ReadableStream<Uint8Array>;
  }

  slice(start?: number, end?: number): Blob {
    const bytes = this.bytes.slice(start, end);
    return {
      text: async () => new TextDecoder().decode(bytes),
    } as Blob;
  }
}

describe('netlogDatasetIndexer', () => {
  it('为 events 建立真实 byteStart/byteEnd，并支持按 eventId 读取 detail', async () => {
    const text = '{"constants":{"logEventTypes":{"URL_REQUEST":1,"SOCKET_CONNECT":2},"logSourceType":{"URL_REQUEST":20,"SOCKET":21}},"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"url":"https://a.example"}},{"time":"2","type":2,"source":{"id":11,"type":21},"phase":2,"params":{"net_error":-105}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11, 13]);

    const { index, endpointEvidence, dataLoaded } = await buildNetlogCompactEventIndex(file);

    expect(index.count).toBe(2);
    expect(index.typeId).toEqual([1, 2]);
    expect(index.sourceId).toEqual([10, 11]);
    expect(index.sourceTypeId).toEqual([20, 21]);
    expect(index.eventTypeNames).toEqual({ 1: 'URL_REQUEST', 2: 'SOCKET_CONNECT' });
    expect(index.sourceTypeNames).toEqual({ 20: 'URL_REQUEST', 21: 'SOCKET' });
    expect(index.phase).toEqual([0, 2]);
    expect(index.flags).toEqual([0, 1]);
    expect(endpointEvidence.guidance[0]).toContain('Dataset Endpoint Evidence');
    expect(dataLoaded).toEqual(expect.objectContaining({
      fileName: 'chunked-netlog.json',
      eventCount: 2,
      hasConstants: true,
      hasClientInfo: false,
      hasNetLogInfo: false,
      eventTypeCount: 2,
      sourceTypeCount: 2,
    }));
    expect(dataLoaded.evidenceGaps).toEqual(expect.arrayContaining([
      '未发现 clientInfo，浏览器客户端版本和平台信息可能缺失。',
      '未发现 netLogInfo，NetLog 采集元信息可能缺失。',
    ]));
    expect(dataLoaded.topEventTypes).toEqual(expect.arrayContaining([
      { name: 'URL_REQUEST', count: 1 },
      { name: 'SOCKET_CONNECT', count: 1 },
    ]));
    await expect(readNetlogEventDetail(file, index, 0)).resolves.toEqual({
      time: '1',
      type: 1,
      source: { id: 10, type: 20 },
      phase: 0,
      params: { url: 'https://a.example' },
    });
    await expect(readNetlogEventDetail(file, index, 1)).resolves.toEqual({
      time: '2',
      type: 2,
      source: { id: 11, type: 21 },
      phase: 2,
      params: { net_error: -105 },
    });
  });

  it('byte offset 基于原始字节，支持多字节字符和跨 chunk 事件', async () => {
    const text = '{"logEvents":[{"time":"1","type":7,"source":{"id":1,"type":2},"params":{"url":"https://例子.example/路径","note":"中文内容"}}]}';
    const file = new ChunkedTextFile(text, [1, 2, 3, 4, 5]);

    const { index } = await buildNetlogCompactEventIndex(file);
    const detail = await readNetlogEventDetail(file, index, 0);

    expect(index.count).toBe(1);
    expect(detail).toEqual({
      time: '1',
      type: 7,
      source: { id: 1, type: 2 },
      params: { url: 'https://例子.example/路径', note: '中文内容' },
    });
  });

  it('从顶层 polledData 提取 DNS server 与 DoH candidate 到 DNS State', async () => {
    const text = '{"polledData":{"hostResolverInfo":{"dnsConfig":{"nameServers":["223.5.5.5:53"],"dohServers":["https://dns.example/dns-query","1.1.1.1"]}}},"events":[{"time":"1","type":7,"source":{"id":1,"type":2},"params":{}}]}';
    const file = new ChunkedTextFile(text, [4, 6, 8, 10]);

    const { dnsState, dataLoaded } = await buildNetlogCompactEventIndex(file);

    expect(dataLoaded.hasPolledData).toBe(true);
    expect(dnsState.configServers).toEqual([
      expect.objectContaining({ ip: '223.5.5.5', source: 'polledData' }),
    ]);
    expect(dnsState.dohCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'https://dns.example/dns-query', source: 'polledData' }),
      expect.objectContaining({ value: '1.1.1.1', source: 'polledData' }),
    ]));
  });

  it('Data Loaded 标记 clientInfo 和 netLogInfo 顶层字段', async () => {
    const text = '{"clientInfo":{"name":"Chrome"},"netLogInfo":{"captureMode":"Default"},"constants":{"logEventTypes":{"URL_REQUEST":1},"logSourceType":{"URL_REQUEST":20}},"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"url":"https://client.example"}}]}';
    const file = new ChunkedTextFile(text, [5, 7, 9, 11]);

    const { dataLoaded } = await buildNetlogCompactEventIndex(file);

    expect(dataLoaded.hasClientInfo).toBe(true);
    expect(dataLoaded.hasNetLogInfo).toBe(true);
    expect(dataLoaded.evidenceGaps).not.toContain('未发现 clientInfo，浏览器客户端版本和平台信息可能缺失。');
    expect(dataLoaded.evidenceGaps).not.toContain('未发现 netLogInfo，NetLog 采集元信息可能缺失。');
  });

  it('从事件 params 提取 source dependency 边到 compact index', async () => {
    const text = '{"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"url":"https://chain.example"}},{"time":"2","type":2,"source":{"id":30,"type":40},"phase":2,"params":{"source_dependencies":[{"id":10},{"dependency":{"sourceId":50}}]}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);

    const { index } = await buildNetlogCompactEventIndex(file);

    expect(index.sourceDependencyFrom).toEqual([30, 30]);
    expect(index.sourceDependencyTo).toEqual([10, 50]);
  });
});
