import type { CompactEventIndex, NetlogIndexableFile } from './netlogDatasetIndexer';
import { readNetlogTopLevelValue } from './netlogDatasetIndexer';
import type { DataLoadedView, NetlogRawEvidenceMetadataValueView, NetlogRawEvidenceStructureView } from './netlogDatasetViews';
import { queryNetlogEvents, type QueryNetlogEventsResult } from './netlogDatasetQuery';

export type NetlogRawEvidenceMetadataKey = NetlogRawEvidenceMetadataValueView['key'];

function metadataRange(eventIndex: CompactEventIndex, key: string): { byteStart?: number; byteEnd?: number } {
  const range = eventIndex.topLevelValueRanges?.[key];
  if (!range) return {};
  return range;
}

export function buildNetlogRawEvidenceStructureView(dataLoaded: DataLoadedView, eventIndex: CompactEventIndex): NetlogRawEvidenceStructureView {
  const topLevelNodes: NetlogRawEvidenceStructureView['topLevelNodes'] = [
    {
      key: 'constants',
      label: 'constants',
      available: dataLoaded.hasConstants,
      kind: 'metadata',
      description: 'NetLog 常量映射。点击后按 byte range 懒加载原始 JSON。',
      ...metadataRange(eventIndex, 'constants'),
    },
    {
      key: 'polledData',
      label: 'polledData',
      available: dataLoaded.hasPolledData,
      kind: 'metadata',
      description: '浏览器轮询到的系统网络状态。当前可通过 Data Loaded 和状态 reducer 查看结构化摘要。',
      ...metadataRange(eventIndex, 'polledData'),
    },
    {
      key: 'systemInfo',
      label: 'systemInfo',
      available: dataLoaded.hasSystemInfo,
      kind: 'metadata',
      description: '系统信息顶层节点。点击后按 byte range 懒加载原始 JSON。',
      ...metadataRange(eventIndex, 'systemInfo'),
    },
    {
      key: 'clientInfo',
      label: 'clientInfo',
      available: dataLoaded.hasClientInfo,
      kind: 'metadata',
      description: '客户端信息顶层节点。点击后按 byte range 懒加载原始 JSON。',
      ...metadataRange(eventIndex, 'clientInfo'),
    },
    {
      key: 'netLogInfo',
      label: 'netLogInfo',
      available: dataLoaded.hasNetLogInfo,
      kind: 'metadata',
      description: 'NetLog 文件信息顶层节点。点击后按 byte range 懒加载原始 JSON。',
      ...metadataRange(eventIndex, 'netLogInfo'),
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
      'Dataset Raw Evidence 不会把完整 events 数组或顶层 metadata 对象复制到主线程；metadata 点击时才按 byte range 懒加载。',
    ],
  };
}

export async function getNetlogRawEvidenceMetadataValue(
  file: NetlogIndexableFile,
  eventIndex: CompactEventIndex,
  key: NetlogRawEvidenceMetadataKey
): Promise<NetlogRawEvidenceMetadataValueView> {
  const range = eventIndex.topLevelValueRanges?.[key];
  if (!range) {
    throw new Error(`NetLog Raw Evidence metadata 不存在：${key}`);
  }
  const value = await readNetlogTopLevelValue(file, eventIndex, key);
  return {
    key,
    byteStart: range.byteStart,
    byteEnd: range.byteEnd,
    value,
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
