import { buildNetlogSourceChainDetailView, buildNetlogSourceChainView } from './netlogSourceChainView';
import type { CompactEventIndex } from './netlogDatasetIndexer';

describe('buildNetlogSourceChainView', () => {
  it('从 CompactEventIndex 构建 URL_REQUEST 到底层 source dependency 链路', () => {
    const index: CompactEventIndex = {
      count: 4,
      time: [1, 2, 3, 4],
      typeId: [1, 2, 3, 4],
      phase: [1, 1, 1, 1],
      flags: [0, 0, 1, 0],
      sourceId: [10, 20, 30, 30],
      sourceTypeId: [10, 20, 30, 30],
      byteStart: [0, 10, 20, 30],
      byteEnd: [9, 19, 29, 39],
      eventTypeNames: { 1: 'URL_REQUEST_START_JOB', 2: 'HTTP_STREAM_REQUEST', 3: 'SOCKET_CONNECT', 4: 'SOCKET_READ' },
      sourceTypeNames: { 10: 'URL_REQUEST', 20: 'HTTP_STREAM', 30: 'SOCKET' },
      sourceDependencyFrom: [10, 20],
      sourceDependencyTo: [20, 30],
      sourceDependencyEventId: [1, 2],
      sourceUrls: { 10: 'https://chain.example/api' },
      sourceHosts: { 10: 'chain.example' },
      sourceErrorCodes: { 30: -105 },
      sourceFirstEventId: { 10: 0, 20: 1, 30: 2 },
      sourceLastEventId: { 10: 0, 20: 1, 30: 3 },
    };

    const view = buildNetlogSourceChainView(index);

    expect(view.roots).toEqual([10]);
    expect(view.chains).toHaveLength(1);
    expect(view.chains[0]).toEqual(expect.objectContaining({
      rootId: 10,
      url: 'https://chain.example/api',
      host: 'chain.example',
      depth: 3,
      hasError: true,
      evidenceGaps: [],
    }));
    expect(view.chains[0].path.map(node => [node.id, node.type])).toEqual([
      [10, 'URL_REQUEST'],
      [20, 'HTTP_STREAM'],
      [30, 'SOCKET'],
    ]);
    expect(view.chains[0].path[2]).toEqual(expect.objectContaining({
      hasError: true,
      errorCode: -105,
      eventCount: 2,
      firstEventId: 2,
      lastEventId: 3,
    }));

    const detail = buildNetlogSourceChainDetailView('analysis-1', index, 10, 1, 10);
    expect(detail.nodes.map(node => node.id)).toEqual([10, 20, 30]);
    expect(detail.edges).toEqual([
      expect.objectContaining({ fromSourceId: 10, toSourceId: 20, sampleEventId: 1, byteStart: 10, byteEnd: 19 }),
      expect.objectContaining({ fromSourceId: 20, toSourceId: 30, sampleEventId: 2, byteStart: 20, byteEnd: 29 }),
    ]);
    expect(detail.events.rows.map(row => row.eventId)).toEqual([0, 1, 2, 3]);
    expect(detail.evidenceGaps).toEqual([]);
  });

  it('source dependency 方向反过来时仍能从 URL_REQUEST 重建链路', () => {
    const index: CompactEventIndex = {
      count: 3,
      time: [1, 2, 3],
      typeId: [1, 2, 3],
      phase: [1, 1, 1],
      flags: [0, 0, 0],
      sourceId: [10, 30, 30],
      sourceTypeId: [10, 30, 30],
      byteStart: [0, 10, 20],
      byteEnd: [9, 19, 29],
      eventTypeNames: { 1: 'URL_REQUEST_START_JOB', 2: 'SOCKET_CONNECT', 3: 'SOCKET_READ' },
      sourceTypeNames: { 10: 'URL_REQUEST', 30: 'SOCKET' },
      sourceDependencyFrom: [30],
      sourceDependencyTo: [10],
      sourceDependencyEventId: [1],
      sourceUrls: { 10: 'https://reverse.example/resource' },
      sourceHosts: { 10: 'reverse.example' },
      sourceFirstEventId: { 10: 0, 30: 1 },
      sourceLastEventId: { 10: 0, 30: 2 },
    };

    const view = buildNetlogSourceChainView(index);

    expect(view.roots).toEqual([10]);
    expect(view.chains[0].path.map(node => node.id)).toEqual([10, 30]);
    expect(view.chains[0].evidenceGaps).toEqual([]);
  });

  it('保留没有 dependency 边的 URL_REQUEST，并明确 evidence gap', () => {
    const index: CompactEventIndex = {
      count: 1,
      time: [1],
      typeId: [1],
      phase: [1],
      flags: [1],
      sourceId: [10],
      sourceTypeId: [10],
      byteStart: [0],
      byteEnd: [9],
      eventTypeNames: { 1: 'URL_REQUEST_FAILED' },
      sourceTypeNames: { 10: 'URL_REQUEST' },
      sourceDependencyFrom: [],
      sourceDependencyTo: [],
      sourceDependencyEventId: [],
      sourceUrls: { 10: 'https://isolated.example/fail' },
      sourceHosts: { 10: 'isolated.example' },
      sourceErrorCodes: { 10: -105 },
      sourceFirstEventId: { 10: 0 },
      sourceLastEventId: { 10: 0 },
    };

    const view = buildNetlogSourceChainView(index);

    expect(view.chains).toHaveLength(1);
    expect(view.chains[0]).toEqual(expect.objectContaining({
      rootId: 10,
      url: 'https://isolated.example/fail',
      depth: 1,
      hasError: true,
      evidenceGaps: [
        '该 URL_REQUEST 没有 source_dependency 边；只能展示孤立 source，不能确认底层 socket/DNS/stream 链路。',
      ],
    }));

    const detail = buildNetlogSourceChainDetailView('analysis-1', index, 10, 1, 10);
    expect(detail.nodes.map(node => node.id)).toEqual([10]);
    expect(detail.edges).toEqual([]);
    expect(detail.events.rows.map(row => row.eventId)).toEqual([0]);
    expect(detail.evidenceGaps).toEqual([
      'source#10 没有 source_dependency 边；只能展示该 source 自身事件。',
      '该 source chain 没有可展示的 dependency edge。',
    ]);
  });

  it('source 不存在时返回 evidence gap 而不是抛错', () => {
    const index: CompactEventIndex = {
      count: 0,
      time: [],
      typeId: [],
      phase: [],
      flags: [],
      sourceId: [],
      sourceTypeId: [],
      byteStart: [],
      byteEnd: [],
      eventTypeNames: {},
      sourceTypeNames: {},
      sourceDependencyFrom: [],
      sourceDependencyTo: [],
      sourceDependencyEventId: [],
    };

    const detail = buildNetlogSourceChainDetailView('analysis-1', index, 99);

    expect(detail.nodes).toEqual([]);
    expect(detail.edges).toEqual([]);
    expect(detail.events.total).toBe(0);
    expect(detail.evidenceGaps).toEqual(['source#99 不存在于 Dataset compact index。']);
  });
});
