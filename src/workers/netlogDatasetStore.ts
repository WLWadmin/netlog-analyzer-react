import type { CompactEventIndex } from './netlogDatasetIndexer';
import type { DnsIpEvidenceSummary } from '../diagnosis/ipEvidence';
import type { DataLoadedView, DnsStateView, ProxyStateView, QuicStateView, Http2StateView } from './netlogDatasetViews';

export interface NetlogDatasetMeta {
  analysisId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  importedAt: number;
  status: 'ready';
  eventCount?: number;
}

export interface NetlogDataset {
  analysisId: string;
  file: File;
  meta: NetlogDatasetMeta;
  eventIndex?: CompactEventIndex;
  endpointEvidence?: DnsIpEvidenceSummary;
  dataLoaded?: DataLoadedView;
  dnsState?: DnsStateView;
  proxyState?: ProxyStateView;
  quicState?: QuicStateView;
  http2State?: Http2StateView;
}

export interface NetlogDatasetStore {
  importFile(
    file: File,
    eventIndex?: CompactEventIndex,
    endpointEvidence?: DnsIpEvidenceSummary,
    dataLoaded?: DataLoadedView,
    dnsState?: DnsStateView,
    proxyState?: ProxyStateView,
    quicState?: QuicStateView,
    http2State?: Http2StateView
  ): NetlogDatasetMeta;
  get(analysisId: string): NetlogDataset | undefined;
  release(analysisId: string): boolean;
  releaseAll(): number;
  size(): number;
}

export function createNetlogDatasetStore(): NetlogDatasetStore {
  let counter = 0;
  const datasets = new Map<string, NetlogDataset>();

  const importFile = (
    file: File,
    eventIndex?: CompactEventIndex,
    endpointEvidence?: DnsIpEvidenceSummary,
    dataLoaded?: DataLoadedView,
    dnsState?: DnsStateView,
    proxyState?: ProxyStateView,
    quicState?: QuicStateView,
    http2State?: Http2StateView
  ): NetlogDatasetMeta => {
    counter += 1;
    const analysisId = `netlog-dataset-${Date.now()}-${counter}`;
    const meta: NetlogDatasetMeta = {
      analysisId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/json',
      importedAt: Date.now(),
      status: 'ready',
      eventCount: eventIndex?.count,
    };
    datasets.set(analysisId, { analysisId, file, meta, eventIndex, endpointEvidence, dataLoaded, dnsState, proxyState, quicState, http2State });
    return meta;
  };

  return {
    importFile,
    get: (analysisId) => datasets.get(analysisId),
    release: (analysisId) => datasets.delete(analysisId),
    releaseAll: () => {
      const count = datasets.size;
      datasets.clear();
      return count;
    },
    size: () => datasets.size,
  };
}
