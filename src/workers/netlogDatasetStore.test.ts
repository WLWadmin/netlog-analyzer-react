import { createNetlogDatasetStore } from './netlogDatasetStore';

describe('createNetlogDatasetStore', () => {
  it('导入文件后返回 analysisId 并可按 ID 取回', () => {
    const store = createNetlogDatasetStore();
    const file = new File(['{"events":[]}'], 'large-netlog.json', { type: 'application/json' });

    const meta = store.importFile(file, {
      count: 0,
      time: [],
      typeId: [],
      sourceTypeId: [],
      sourceId: [],
      phase: [],
      flags: [],
      byteStart: [],
      byteEnd: [],
    });

    expect(meta.analysisId).toMatch(/^netlog-dataset-/);
    expect(meta.fileName).toBe('large-netlog.json');
    expect(meta.fileSize).toBe(file.size);
    expect(meta.status).toBe('ready');
    expect(meta.eventCount).toBe(0);
    expect(store.get(meta.analysisId)?.file).toBe(file);
    expect(store.get(meta.analysisId)?.eventIndex?.count).toBe(0);
    expect(store.size()).toBe(1);
  });

  it('保存 Reporting/NEL state', () => {
    const store = createNetlogDatasetStore();
    const file = new File(['{"events":[]}'], 'reporting-netlog.json', { type: 'application/json' });
    const reportingState = {
      endpoints: [],
      events: [],
      impactSummaries: [],
      eventCount: 1,
      endpointCount: 0,
      queuedCount: 0,
      uploadCount: 0,
      successCount: 0,
      failureCount: 0,
      cacheCount: 0,
      requestScopedCandidateCount: 0,
      evidenceGaps: [],
    };

    const meta = store.importFile(file, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reportingState);

    expect(store.get(meta.analysisId)?.reportingState).toBe(reportingState);
  });

  it('支持释放单个 dataset 和全部 dataset', () => {
    const store = createNetlogDatasetStore();
    const first = store.importFile(new File(['{}'], 'a.json'));
    store.importFile(new File(['{}'], 'b.json'));

    expect(store.release(first.analysisId)).toBe(true);
    expect(store.size()).toBe(1);
    expect(store.releaseAll()).toBe(1);
    expect(store.size()).toBe(0);
  });
});
