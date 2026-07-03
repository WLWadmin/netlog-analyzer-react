import type { CompactEventIndex } from './netlogDatasetIndexer';
import type { DataLoadedView, NetlogRawEvidenceStructureView } from './netlogDatasetViews';
import { queryNetlogEvents, type QueryNetlogEventsResult } from './netlogDatasetQuery';

export function buildNetlogRawEvidenceStructureView(dataLoaded: DataLoadedView, eventIndex: CompactEventIndex): NetlogRawEvidenceStructureView {
  const topLevelNodes: NetlogRawEvidenceStructureView['topLevelNodes'] = [
    {
      key: 'constants',
      label: 'constants',
      available: dataLoaded.hasConstants,
      kind: 'metadata',
      description: 'NetLog 常量映射。Dataset 首版只暴露存在性；完整值预览后续通过 metadata 懒加载补齐。',
    },
    {
      key: 'polledData',
      label: 'polledData',
      available: dataLoaded.hasPolledData,
      kind: 'metadata',
      description: '浏览器轮询到的系统网络状态。当前可通过 Data Loaded 和状态 reducer 查看结构化摘要。',
    },
    {
      key: 'systemInfo',
      label: 'systemInfo',
      available: dataLoaded.hasSystemInfo,
      kind: 'metadata',
      description: '系统信息顶层节点。当前只暴露存在性，避免把大对象复制到主线程。',
    },
    {
      key: 'clientInfo',
      label: 'clientInfo',
      available: dataLoaded.hasClientInfo,
      kind: 'metadata',
      description: '客户端信息顶层节点。当前只暴露存在性，避免把大对象复制到主线程。',
    },
    {
      key: 'netLogInfo',
      label: 'netLogInfo',
      available: dataLoaded.hasNetLogInfo,
      kind: 'metadata',
      description: 'NetLog 文件信息顶层节点。当前只暴露存在性，避免把大对象复制到主线程。',
    },
    {
      key: 'events',
      label: 'events',
      available: eventIndex.count > 0,
      kind: 'virtual-events',
      description: '虚拟 events 列表。只返回 eventId/type/source/time/byte range，展开单 event 时再懒加载 raw JSON。',
      eventCount: eventIndex.count,
    },
  ];

  return {
    topLevelNodes,
    evidenceGaps: [
      ...dataLoaded.evidenceGaps,
      'Dataset Raw Evidence 首版不会把完整 events 数组或顶层 metadata 对象复制到主线程；metadata 深层值预览需要后续懒加载 API。',
    ],
  };
}

export function queryNetlogRawEvidenceEvents(
  analysisId: string,
  eventIndex: CompactEventIndex,
  page = 1,
  pageSize = 100
): QueryNetlogEventsResult {
  return queryNetlogEvents(eventIndex, {
    analysisId,
    page,
    pageSize,
  });
}
