import {
  loadRawEvidenceStructure,
  readRawEvidenceValuePreview,
  searchRawEvidence,
} from './rawEvidenceGateway';
import {
  getRawStructureInWorker,
  getRawValueInWorker,
  isWorkerSupported,
  searchRawJsonInWorker,
} from '../../workers/workerClient';

jest.mock('../../workers/workerClient', () => ({
  getRawStructureInWorker: jest.fn(),
  getRawValueInWorker: jest.fn(),
  isWorkerSupported: jest.fn(),
  searchRawJsonInWorker: jest.fn(),
}));

const isWorkerSupportedMock = isWorkerSupported as jest.Mock;
const searchRawJsonInWorkerMock = searchRawJsonInWorker as jest.Mock;
const getRawStructureInWorkerMock = getRawStructureInWorker as jest.Mock;
const getRawValueInWorkerMock = getRawValueInWorker as jest.Mock;

describe('rawEvidenceGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isWorkerSupportedMock.mockReturnValue(true);
  });

  it('Worker 搜索成功时返回 Worker 结果', async () => {
    const workerResults = [{ path: '$.log.entries[0].request.url', key: 'url', value: 'https://example.com', type: 'string' }];
    searchRawJsonInWorkerMock.mockResolvedValue(workerResults);

    const result = await searchRawEvidence({ rawDataId: 'raw-1', rawData: { local: true } }, 'url');

    expect(result).toEqual({ value: workerResults, fallbackUsed: false });
    expect(searchRawJsonInWorkerMock).toHaveBeenCalledWith('raw-1', 'url', expect.any(Object));
  });

  it('Worker 搜索失败且有 rawData 时降级到主线程搜索', async () => {
    searchRawJsonInWorkerMock.mockRejectedValue(new Error('worker failed'));

    const result = await searchRawEvidence({ rawDataId: 'raw-1', rawData: { log: { version: '1.2' } } }, 'version');

    expect(result.fallbackUsed).toBe(true);
    expect(result.value.some(match => match.path.includes('version'))).toBe(true);
  });

  it('Worker 搜索失败且无 rawData 时抛出明确错误', async () => {
    searchRawJsonInWorkerMock.mockRejectedValue(new Error('worker failed'));

    await expect(searchRawEvidence({ rawDataId: 'raw-1' }, 'version')).rejects.toThrow('Worker 搜索失败，请重新上传文件后重试');
  });

  it('无 rawDataId 时使用主线程结构', async () => {
    const result = await loadRawEvidenceStructure({ rawData: { log: { entries: [] } } });

    expect(result.fallbackUsed).toBe(false);
    expect(result.value.length).toBeGreaterThan(0);
    expect(getRawStructureInWorkerMock).not.toHaveBeenCalled();
  });

  it('Worker 结构读取失败且有 rawData 时降级到主线程结构', async () => {
    getRawStructureInWorkerMock.mockRejectedValue(new Error('worker failed'));

    const result = await loadRawEvidenceStructure({ rawDataId: 'raw-1', rawData: { log: { entries: [] } } });

    expect(result.fallbackUsed).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
  });

  it('value preview 主线程 fallback 会截断长文本', async () => {
    isWorkerSupportedMock.mockReturnValue(false);
    const longValue = 'x'.repeat(60_000);

    const result = await readRawEvidenceValuePreview({ rawData: { log: { body: longValue } } }, 'log.body');

    expect(result.fallbackUsed).toBe(false);
    expect(result.value.length).toBeLessThan(longValue.length);
    expect(result.value).toContain('内容过长已截断');
    expect(getRawValueInWorkerMock).not.toHaveBeenCalled();
  });
});
