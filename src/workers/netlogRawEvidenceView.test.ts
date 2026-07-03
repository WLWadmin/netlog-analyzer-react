import { buildNetlogRawEvidenceStructureView, queryNetlogRawEvidenceEvents } from './netlogRawEvidenceView';
import type { CompactEventIndex } from './netlogDatasetIndexer';
import type { DataLoadedView } from './netlogDatasetViews';

const eventIndex: CompactEventIndex = {
  count: 2,
  time: [10, 20],
  typeId: [1, 2],
  sourceTypeId: [10, 20],
  sourceId: [100, 200],
  phase: [0, 2],
  flags: [0, 1],
  byteStart: [1000, 2000],
  byteEnd: [1100, 2200],
  eventTypeNames: { 1: 'URL_REQUEST', 2: 'SOCKET_CONNECT' },
  sourceTypeNames: { 10: 'URL_REQUEST', 20: 'SOCKET' },
  sourceDependencyFrom: [],
  sourceDependencyTo: [],
};

const dataLoaded: DataLoadedView = {
  fileName: 'netlog.json',
  fileSize: 1234,
  eventCount: 2,
  hasConstants: true,
  hasPolledData: false,
  hasSystemInfo: true,
  hasClientInfo: false,
  hasNetLogInfo: true,
  eventTypeCount: 2,
  sourceTypeCount: 2,
  topEventTypes: [],
  topSourceTypes: [],
  evidenceGaps: ['缺少 polledData'],
};

describe('netlogRawEvidenceView', () => {
  it('构建 Dataset raw evidence 顶层虚拟结构，不返回完整 events', () => {
    const view = buildNetlogRawEvidenceStructureView(dataLoaded, eventIndex);

    expect(view.topLevelNodes.map(node => node.key)).toEqual([
      'constants',
      'polledData',
      'systemInfo',
      'clientInfo',
      'netLogInfo',
      'events',
    ]);
    expect(view.topLevelNodes.find(node => node.key === 'events')).toEqual(expect.objectContaining({
      kind: 'virtual-events',
      eventCount: 2,
      available: true,
    }));
    expect(JSON.stringify(view)).not.toContain('SOCKET_CONNECT"');
    expect(view.evidenceGaps.join('\n')).toContain('不会把完整 events 数组');
  });

  it('events 虚拟页只返回 compact row 和 byte range', () => {
    const page = queryNetlogRawEvidenceEvents('analysis-1', eventIndex, 1, 1);

    expect(page.total).toBe(2);
    expect(page.rows).toEqual([
      expect.objectContaining({
        eventId: 0,
        typeName: 'URL_REQUEST',
        sourceId: 100,
        byteStart: 1000,
        byteEnd: 1100,
      }),
    ]);
  });
});
