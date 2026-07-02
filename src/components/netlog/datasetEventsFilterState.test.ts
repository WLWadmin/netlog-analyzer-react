import {
  clearDatasetEventsFilterState,
  loadDatasetEventsFilterState,
  parseDatasetEventsFilterState,
  saveDatasetEventsFilterState,
} from './datasetEventsFilterState';

describe('datasetEventsFilterState', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('解析坏 JSON 时回退默认状态', () => {
    const state = parseDatasetEventsFilterState('{bad-json');

    expect(state).toEqual(expect.objectContaining({
      errorOnly: false,
      sourceIdFilter: '',
      pageSize: 100,
    }));
  });

  it('保存和读取同一个 analysisId 的筛选状态', () => {
    saveDatasetEventsFilterState('a1', {
      errorOnly: true,
      sourceIdFilter: '10',
      typeIdFilter: '20',
      typeNameFilter: 'URL_REQUEST',
      sourceTypeNameFilter: 'SOCKET',
      phaseFilter: '2',
      startTimeFilter: '100',
      endTimeFilter: '200',
      pageSize: 250,
    });

    expect(loadDatasetEventsFilterState('a1')).toEqual({
      errorOnly: true,
      sourceIdFilter: '10',
      typeIdFilter: '20',
      typeNameFilter: 'URL_REQUEST',
      sourceTypeNameFilter: 'SOCKET',
      phaseFilter: '2',
      startTimeFilter: '100',
      endTimeFilter: '200',
      pageSize: 250,
    });
    expect(loadDatasetEventsFilterState('a2').sourceIdFilter).toBe('');
  });

  it('清除指定 analysisId 的筛选状态', () => {
    saveDatasetEventsFilterState('a1', {
      errorOnly: true,
      sourceIdFilter: '10',
      typeIdFilter: '',
      typeNameFilter: '',
      sourceTypeNameFilter: '',
      phaseFilter: '',
      startTimeFilter: '',
      endTimeFilter: '',
      pageSize: 100,
    });

    clearDatasetEventsFilterState('a1');

    expect(loadDatasetEventsFilterState('a1').errorOnly).toBe(false);
  });

  it('对 pageSize 做安全归一化', () => {
    expect(parseDatasetEventsFilterState(JSON.stringify({ pageSize: 9999 })).pageSize).toBe(500);
    expect(parseDatasetEventsFilterState(JSON.stringify({ pageSize: -1 })).pageSize).toBe(100);
  });
});
