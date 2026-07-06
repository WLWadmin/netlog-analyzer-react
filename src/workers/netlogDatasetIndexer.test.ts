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

  it('构建 Dataset 时生成 Cache State', async () => {
    const text = '{"constants":{"logEventTypes":{"HTTP_CACHE_OPEN_ENTRY":1,"HTTP_CACHE_READ_DATA":2},"logSourceType":{"URL_REQUEST":20}},"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"url":"https://cache.example/app.css"}},{"time":"2","type":2,"source":{"id":10,"type":20},"phase":2,"params":{"url":"https://cache.example/app.css","net_error":-2}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);

    const { cacheState } = await buildNetlogCompactEventIndex(file);

    expect(cacheState.eventCount).toBe(2);
    expect(cacheState.openCount).toBe(1);
    expect(cacheState.readCount).toBe(1);
    expect(cacheState.errorCount).toBe(1);
    expect(cacheState.entries).toEqual([
      expect.objectContaining({
        sourceId: 10,
        urls: ['https://cache.example/app.css'],
        operationKinds: expect.arrayContaining(['open', 'read']),
      }),
    ]);
    expect(cacheState.impactSummaries).toEqual([
      expect.objectContaining({
        kind: 'error',
        requestScoped: true,
        error: -2,
      }),
    ]);
  });

  it('构建 Dataset 时生成 Alt-Svc 和 StreamPool State', async () => {
    const text = '{"constants":{"logEventTypes":{"HTTP_STREAM_JOB_CONTROLLER_ALT_SVC_FOUND":1,"HTTP_STREAM_JOB_WAITING_FOR_TRANSPORT_POOL":2,"SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP":3},"logSourceType":{"HTTP_STREAM_JOB_CONTROLLER":20,"HTTP_STREAM_JOB":21,"SOCKET_POOL":22}},"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"host":"alt.example","protocol":"h3","alternative_service":"alt.example:443"}},{"time":"2","type":2,"source":{"id":11,"type":21},"phase":0,"params":{"url":"https://alt.example/api","source_dependency":{"id":10}}},{"time":"3","type":3,"source":{"id":11,"type":22},"phase":0,"params":{"group_name":"ssl/alt.example:443","net_error":-7}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);

    const { altSvcState, streamPoolState } = await buildNetlogCompactEventIndex(file);

    expect(altSvcState.eventCount).toBe(1);
    expect(altSvcState.foundCount).toBe(1);
    expect(altSvcState.alternatives).toEqual([
      expect.objectContaining({ host: 'alt.example', protocol: 'h3' }),
    ]);
    expect(streamPoolState.eventCount).toBe(2);
    expect(streamPoolState.waitCount).toBe(1);
    expect(streamPoolState.stalledCount).toBe(1);
    expect(streamPoolState.errorCount).toBe(1);
    expect(streamPoolState.sourceLinks).toEqual([
      expect.objectContaining({ fromSourceId: 11, toSourceId: 10 }),
    ]);
  });

  it('构建 Dataset 时生成 Reporting/NEL State', async () => {
    const text = '{"constants":{"logEventTypes":{"REPORTING_HEADER_PARSED":1,"NETWORK_ERROR_LOGGING_REPORT_QUEUED":2,"REPORTING_UPLOAD_FAILED":3},"logSourceType":{"URL_REQUEST":20,"REPORTING":21}},"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"origin":"https://app.example","group":"default","endpoint_url":"https://reports.example/nel"}},{"time":"2","type":2,"source":{"id":11,"type":20},"phase":0,"params":{"origin":"https://app.example","url":"https://app.example/api","report_type":"network-error"}},{"time":"3","type":3,"source":{"id":12,"type":21},"phase":0,"params":{"origin":"https://app.example","endpoint_url":"https://reports.example/nel","net_error":-105}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);

    const { reportingState } = await buildNetlogCompactEventIndex(file);

    expect(reportingState.eventCount).toBe(3);
    expect(reportingState.endpointCount).toBe(2);
    expect(reportingState.queuedCount).toBe(1);
    expect(reportingState.failureCount).toBe(1);
    expect(reportingState.impactSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'endpoint-config', requestScoped: true }),
      expect.objectContaining({ kind: 'queued', requestScoped: true }),
      expect.objectContaining({ kind: 'upload-failure', error: -105 }),
    ]));
  });

  it('无错误轻量事件保留 compact index，但跳过 heavy onEvent 回调', async () => {
    const text = '{"constants":{"logEventTypes":{"SOCKET_BYTES_RECEIVED":1,"URL_REQUEST":2},"logSourceType":{"SOCKET":20,"URL_REQUEST":21}},"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"byte_count":1024}},{"time":"2","type":2,"source":{"id":11,"type":21},"phase":0,"params":{"url":"https://keep.example"}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);
    const onEvent = jest.fn();
    const onLightweightEvent = jest.fn();

    const { index, socketsState } = await buildNetlogCompactEventIndex(file, { onEvent, onLightweightEvent });

    expect(index.count).toBe(2);
    expect(index.typeId).toEqual([1, 2]);
    expect(index.byteStart).toHaveLength(2);
    expect(onLightweightEvent).toHaveBeenCalledWith(1, 20, expect.objectContaining({
      eventId: 0,
      typeName: 'SOCKET_BYTES_RECEIVED',
    }));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual(expect.objectContaining({ type: 2 }));
    expect(socketsState.eventCount).toBe(0);
  });

  it('无错误轻量事件命中 probe gate 时不执行完整 JSON.parse', async () => {
    const text = '{"constants":{"logEventTypes":{"SOCKET_BYTES_RECEIVED":1,"URL_REQUEST":2},"logSourceType":{"SOCKET":20,"URL_REQUEST":21}},"events":[{"time":"123.5","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"byte_count":1024}},{"time":"2","type":2,"source":{"id":11,"type":21},"phase":0,"params":{"url":"https://keep.example"}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);
    const originalParse = JSON.parse;
    const parseSpy = jest.spyOn(JSON, 'parse').mockImplementation((value: string) => {
      if (typeof value === 'string' && value.includes('"byte_count":1024')) {
        throw new Error('lightweight event should not be fully parsed');
      }
      return originalParse(value);
    });
    const onLightweightEvent = jest.fn();

    try {
      const { index, parseSkipStats } = await buildNetlogCompactEventIndex(file, { onLightweightEvent });

      expect(index.count).toBe(2);
      expect(index.time[0]).toBe(123.5);
      expect(index.sourceId[0]).toBe(10);
      expect(index.sourceTypeId[0]).toBe(20);
      expect(onLightweightEvent).toHaveBeenCalledWith(1, 20, expect.objectContaining({
        eventId: 0,
        typeName: 'SOCKET_BYTES_RECEIVED',
      }));
      expect(parseSkipStats.lightweightParseSkippedEvents).toBe(1);
      expect(parseSkipStats.lightweightParseSkippedBytes).toBeGreaterThan(0);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('带错误或 source dependency 的轻量事件不跳过 heavy reducer 路径', async () => {
    const text = '{"constants":{"logEventTypes":{"SOCKET_BYTES_RECEIVED":1},"logSourceType":{"SOCKET":20}},"events":[{"time":"1","type":1,"source":{"id":10,"type":20},"phase":0,"params":{"net_error":-7}},{"time":"2","type":1,"source":{"id":11,"type":20},"phase":0,"params":{"source_dependency":{"id":99},"byte_count":2048}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);
    const onEvent = jest.fn();
    const onLightweightEvent = jest.fn();

    const { index, parseSkipStats, socketsState } = await buildNetlogCompactEventIndex(file, { onEvent, onLightweightEvent });

    expect(index.count).toBe(2);
    expect(parseSkipStats.lightweightParseSkippedEvents).toBe(0);
    expect(parseSkipStats.lightweightParseSkippedBytes).toBe(0);
    expect(parseSkipStats.socketParseSkippedEvents).toBe(1);
    expect(parseSkipStats.socketParseSkippedBytes).toBeGreaterThan(0);
    expect(onLightweightEvent).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(socketsState.eventCount).toBe(2);
    expect(socketsState.errors).toEqual([
      expect.objectContaining({ eventId: 0, error: -7 }),
    ]);
    expect(index.sourceDependencyFrom).toEqual([11]);
    expect(index.sourceDependencyTo).toEqual([99]);
  });

  it('带 dependency 的 socket 事件保留完整 parse 路径和 Endpoint Evidence socket peer', async () => {
    const text = '{"constants":{"logEventTypes":{"URL_REQUEST_START_JOB":1,"SOCKET_CONNECT":2},"logSourceType":{"URL_REQUEST":20,"SOCKET":21}},"events":[{"time":"1","type":1,"source":{"id":100,"type":20},"phase":0,"params":{"url":"https://socket.example/api"}},{"time":"2","type":2,"source":{"id":200,"type":21},"phase":0,"params":{"address":"203.0.113.200:443","source_dependency":{"id":100}}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);
    const onEvent = jest.fn();

    const { index, endpointEvidence, socketsState } = await buildNetlogCompactEventIndex(file, { onEvent });

    expect(index.count).toBe(2);
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(socketsState.eventCount).toBe(1);
    expect(socketsState.lazyParamsStats).toEqual({
      probeAttemptedEvents: 1,
      probeSatisfiedEvents: 1,
      fallbackParamEvents: 0,
      earlyReducerEvents: 0,
    });
    expect(socketsState.sockets).toEqual([
      expect.objectContaining({
        sourceId: 200,
        peerAddresses: ['203.0.113.200:443'],
        sourceDependencyIds: [100],
      }),
    ]);
    expect(endpointEvidence.failedOrSlowIps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'socket-peer',
        ip: '203.0.113.200',
        sourceId: 200,
        eventId: 1,
      }),
    ]));
  });

  it('无 dependency 的 socket 事件可 parse-skip 并保留 Endpoint Evidence global candidate', async () => {
    const text = '{"constants":{"logEventTypes":{"UDP_CONNECT":1},"logSourceType":{"UDP_SOCKET":20}},"events":[{"time":"1","type":1,"source":{"id":300,"type":20},"phase":0,"params":{"address":"203.0.113.201:443"}}]}';
    const file = new ChunkedTextFile(text, [3, 5, 7, 11]);
    const onEvent = jest.fn();

    const { index, parseSkipStats, endpointEvidence, socketsState } = await buildNetlogCompactEventIndex(file, { onEvent });

    expect(index.count).toBe(1);
    expect(onEvent).not.toHaveBeenCalled();
    expect(parseSkipStats.socketParseSkippedEvents).toBe(1);
    expect(parseSkipStats.socketParseSkippedBytes).toBeGreaterThan(0);
    expect(socketsState.lazyParamsStats.earlyReducerEvents).toBe(1);
    expect(endpointEvidence.failedOrSlowIps).toEqual([
      expect.objectContaining({
        role: 'socket-peer',
        association: 'global-candidate',
        ip: '203.0.113.201',
        sourceId: 300,
        eventId: 0,
      }),
    ]);
    expect(endpointEvidence.sourceGraphStats).toEqual(expect.objectContaining({
      socketPeerTotal: 1,
      socketPeerSourceGraphAssociated: 0,
      socketPeerGlobalCandidate: 1,
      globalCandidateParamKeys: { address: 1 },
    }));
  });
});
