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
    const text = '{"constants":{"logEventTypes":{"URL_REQUEST":1}},"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"url":"https://a.example"}},{"time":"2","type":2,"source":{"id":11,"type":21},"phase":2,"params":{"net_error":-105}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11, 13]);

    const index = await buildNetlogCompactEventIndex(file);

    expect(index.count).toBe(2);
    expect(index.typeId).toEqual([1, 2]);
    expect(index.sourceId).toEqual([10, 11]);
    expect(index.sourceTypeId).toEqual([20, 21]);
    expect(index.phase).toEqual([0, 2]);
    expect(index.flags).toEqual([0, 1]);
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

    const index = await buildNetlogCompactEventIndex(file);
    const detail = await readNetlogEventDetail(file, index, 0);

    expect(index.count).toBe(1);
    expect(detail).toEqual({
      time: '1',
      type: 7,
      source: { id: 1, type: 2 },
      params: { url: 'https://例子.example/路径', note: '中文内容' },
    });
  });
});
