import { buildNetlogSourceChainView } from './netlogSourceChainView';
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
    };

    const view = buildNetlogSourceChainView(index);

    expect(view.roots).toEqual([10]);
    expect(view.chains).toHaveLength(1);
    expect(view.chains[0]).toEqual(expect.objectContaining({
      rootId: 10,
      url: 'source#10',
      depth: 3,
      hasError: true,
    }));
    expect(view.chains[0].path.map(node => [node.id, node.type])).toEqual([
      [10, 'URL_REQUEST'],
      [20, 'HTTP_STREAM'],
      [30, 'SOCKET'],
    ]);
    expect(view.chains[0].path[2]).toEqual(expect.objectContaining({
      hasError: true,
      eventCount: 2,
    }));
  });
});
