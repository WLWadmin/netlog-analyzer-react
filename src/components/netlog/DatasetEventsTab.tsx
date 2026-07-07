import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Space, Table, Tag, message } from 'antd';
import { getNetlogEventDetailInWorker, queryNetlogEventsInWorker } from '../../workers/workerClient';
import type { NetlogEventRow, QueryNetlogEventsResult } from '../../workers/netlogDatasetQuery';
import { useNavigation } from '../../contexts/NavigationContext';
import {
  clearDatasetEventsFilterState,
  loadDatasetEventsFilterState,
  saveDatasetEventsFilterState,
} from './datasetEventsFilterState';

interface DatasetEventsTabProps {
  analysisId: string;
}

const DatasetEventsTab: React.FC<DatasetEventsTabProps> = ({ analysisId }) => {
  const [page, setPage] = useState(1);
  const [savedFilterState, setSavedFilterState] = useState(() => loadDatasetEventsFilterState(analysisId));
  const [pageSize, setPageSize] = useState(savedFilterState.pageSize);
  const [errorOnly, setErrorOnly] = useState(savedFilterState.errorOnly);
  const [sourceIdFilter, setSourceIdFilter] = useState(savedFilterState.sourceIdFilter);
  const [sourceChainIdFilter, setSourceChainIdFilter] = useState(savedFilterState.sourceChainIdFilter);
  const [typeIdFilter, setTypeIdFilter] = useState(savedFilterState.typeIdFilter);
  const [typeNameFilter, setTypeNameFilter] = useState(savedFilterState.typeNameFilter);
  const [sourceTypeNameFilter, setSourceTypeNameFilter] = useState(savedFilterState.sourceTypeNameFilter);
  const [phaseFilter, setPhaseFilter] = useState(savedFilterState.phaseFilter);
  const [startTimeFilter, setStartTimeFilter] = useState(savedFilterState.startTimeFilter);
  const [endTimeFilter, setEndTimeFilter] = useState(savedFilterState.endTimeFilter);
  const [searchTextFilter, setSearchTextFilter] = useState(savedFilterState.searchTextFilter);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState('');
  const [queryResult, setQueryResult] = useState<QueryNetlogEventsResult>({
    analysisId,
    page: 1,
    pageSize: 100,
    total: 0,
    rows: [],
  });
  const querySeqRef = useRef(0);
  const { intent, consumeIntent } = useNavigation();

  useEffect(() => {
    const state = loadDatasetEventsFilterState(analysisId);
    setSavedFilterState(state);
    setPageSize(state.pageSize);
    setErrorOnly(state.errorOnly);
    setSourceIdFilter(state.sourceIdFilter);
    setSourceChainIdFilter(state.sourceChainIdFilter);
    setTypeIdFilter(state.typeIdFilter);
    setTypeNameFilter(state.typeNameFilter);
    setSourceTypeNameFilter(state.sourceTypeNameFilter);
    setPhaseFilter(state.phaseFilter);
    setStartTimeFilter(state.startTimeFilter);
    setEndTimeFilter(state.endTimeFilter);
    setSearchTextFilter(state.searchTextFilter);
    setPage(1);
  }, [analysisId]);

  useEffect(() => {
    if (!intent || intent.tab !== 'expert') return;
    const filters = intent.filters;
    if (!filters) return;
    if (filters.sourceId) {
      setSourceIdFilter(filters.sourceId);
      setSourceChainIdFilter('');
    }
    if (filters.sourceChainId) {
      setSourceChainIdFilter(filters.sourceChainId);
      setSourceIdFilter('');
    }
    if (filters.errorOnly || filters.errorCode) setErrorOnly(true);
    if (filters.phase) setPhaseFilter(filters.phase);
    if (filters.eventType && /^\d+$/.test(filters.eventType)) setTypeIdFilter(filters.eventType);
    else if (filters.eventType) setTypeNameFilter(filters.eventType);
    setPage(1);
    consumeIntent();
  }, [intent, consumeIntent]);

  const numericOrUndefined = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : undefined;
  };

  useEffect(() => {
    let cancelled = false;
    const querySeq = ++querySeqRef.current;
    setLoading(true);
    queryNetlogEventsInWorker({
      analysisId,
      page,
      pageSize,
      errorOnly,
      sourceId: numericOrUndefined(sourceIdFilter),
      sourceChainId: numericOrUndefined(sourceChainIdFilter),
      typeId: numericOrUndefined(typeIdFilter),
      typeName: typeNameFilter.trim() || undefined,
      sourceTypeName: sourceTypeNameFilter.trim() || undefined,
      phase: numericOrUndefined(phaseFilter),
      startTime: numericOrUndefined(startTimeFilter),
      endTime: numericOrUndefined(endTimeFilter),
      searchText: searchTextFilter.trim() || undefined,
    })
      .then(result => {
        if (!cancelled && querySeq === querySeqRef.current) setQueryResult(result);
      })
      .catch(err => {
        if (!cancelled && querySeq === querySeqRef.current) message.error('Dataset 事件查询失败: ' + (err as Error).message);
      })
      .finally(() => {
        if (!cancelled && querySeq === querySeqRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, page, pageSize, errorOnly, sourceIdFilter, sourceChainIdFilter, typeIdFilter, typeNameFilter, sourceTypeNameFilter, phaseFilter, startTimeFilter, endTimeFilter, searchTextFilter]);

  useEffect(() => {
    saveDatasetEventsFilterState(analysisId, {
      errorOnly,
      sourceIdFilter,
      sourceChainIdFilter,
      typeIdFilter,
      typeNameFilter,
      sourceTypeNameFilter,
      phaseFilter,
      startTimeFilter,
      endTimeFilter,
      searchTextFilter,
      pageSize,
    });
  }, [analysisId, pageSize, errorOnly, sourceIdFilter, sourceChainIdFilter, typeIdFilter, typeNameFilter, sourceTypeNameFilter, phaseFilter, startTimeFilter, endTimeFilter, searchTextFilter]);

  const clearFilters = () => {
    setErrorOnly(false);
    setSourceIdFilter('');
    setSourceChainIdFilter('');
    setTypeIdFilter('');
    setTypeNameFilter('');
    setSourceTypeNameFilter('');
    setPhaseFilter('');
    setStartTimeFilter('');
    setEndTimeFilter('');
    setSearchTextFilter('');
    clearDatasetEventsFilterState(analysisId);
    setPage(1);
  };

  const applySourceFilter = (sourceId: number) => {
    setSourceIdFilter(String(sourceId));
    setSourceChainIdFilter('');
    setPage(1);
  };

  const applySourceChainFilter = (sourceId: number) => {
    setSourceChainIdFilter(String(sourceId));
    setSourceIdFilter('');
    setPage(1);
  };

  const hasStructuredSearchFilter = Boolean(
    sourceIdFilter.trim() ||
    sourceChainIdFilter.trim() ||
    typeIdFilter.trim() ||
    typeNameFilter.trim() ||
    sourceTypeNameFilter.trim() ||
    phaseFilter.trim() ||
    startTimeFilter.trim() ||
    endTimeFilter.trim() ||
    errorOnly
  );

  const openDetail = async (eventId: number) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const raw = await getNetlogEventDetailInWorker({ analysisId, eventId });
      setDetail(JSON.stringify(raw, null, 2));
    } catch (err) {
      setDetail('读取失败：' + (err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <Card
      title="Dataset Events"
      extra={
        <Space>
          <Input
            allowClear
            size="small"
            style={{ width: 120 }}
            placeholder="sourceId"
            value={sourceIdFilter}
            onChange={(event) => { setSourceIdFilter(event.target.value); setPage(1); }}
          />
          <Input
            allowClear
            size="small"
            style={{ width: 130 }}
            placeholder="sourceChainId"
            value={sourceChainIdFilter}
            onChange={(event) => { setSourceChainIdFilter(event.target.value); setPage(1); }}
          />
          <Input
            allowClear
            size="small"
            style={{ width: 100 }}
            placeholder="typeId"
            value={typeIdFilter}
            onChange={(event) => { setTypeIdFilter(event.target.value); setPage(1); }}
          />
          <Input
            allowClear
            size="small"
            style={{ width: 150 }}
            placeholder="typeName"
            value={typeNameFilter}
            onChange={(event) => { setTypeNameFilter(event.target.value); setPage(1); }}
          />
          <Input
            allowClear
            size="small"
            style={{ width: 150 }}
            placeholder="sourceType"
            value={sourceTypeNameFilter}
            onChange={(event) => { setSourceTypeNameFilter(event.target.value); setPage(1); }}
          />
          <Input
            allowClear
            size="small"
            style={{ width: 90 }}
            placeholder="phase"
            value={phaseFilter}
            onChange={(event) => { setPhaseFilter(event.target.value); setPage(1); }}
          />
          <Input
            allowClear
            size="small"
            style={{ width: 110 }}
            placeholder="startTime"
            value={startTimeFilter}
            onChange={(event) => { setStartTimeFilter(event.target.value); setPage(1); }}
          />
          <Input
            allowClear
            size="small"
            style={{ width: 110 }}
            placeholder="endTime"
            value={endTimeFilter}
            onChange={(event) => { setEndTimeFilter(event.target.value); setPage(1); }}
          />
          <Input.Search
            allowClear
            size="small"
            style={{ width: 180 }}
            placeholder="text/params 搜索"
            value={searchTextFilter}
            onChange={(event) => { setSearchTextFilter(event.target.value); setPage(1); }}
          />
          <Button type={errorOnly ? 'primary' : 'default'} onClick={() => { setErrorOnly(prev => !prev); setPage(1); }}>
            仅错误事件
          </Button>
          <Button onClick={clearFilters}>清除筛选</Button>
        </Space>
      }
      bordered={false}
    >
      {(sourceIdFilter || sourceChainIdFilter || typeIdFilter || typeNameFilter || sourceTypeNameFilter || phaseFilter || startTimeFilter || endTimeFilter || searchTextFilter || errorOnly) && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Dataset 查询条件"
          description={`sourceId=${sourceIdFilter || '*'}，sourceChainId=${sourceChainIdFilter || '*'}，typeId=${typeIdFilter || '*'}，typeName=${typeNameFilter || '*'}，sourceType=${sourceTypeNameFilter || '*'}，phase=${phaseFilter || '*'}，startTime=${startTimeFilter || '*'}，endTime=${endTimeFilter || '*'}，searchText=${searchTextFilter || '*'}，errorOnly=${errorOnly ? 'true' : 'false'}`}
        />
      )}
      {searchTextFilter && (
        <Alert
          type={hasStructuredSearchFilter ? 'info' : 'warning'}
          showIcon
          style={{ marginBottom: 12 }}
          message="text/params 搜索会按需读取原始 event JSON"
          description={hasStructuredSearchFilter
            ? '该搜索只在结构化条件筛选后的候选事件中读取原始 JSON；达到扫描或耗时上限时，结果会标记为可能不完整。'
            : '当前未设置 type/source/time/error/sourceChain 等结构化过滤，系统只会扫描有限候选事件。建议先缩小范围后再搜索。'}
        />
      )}
      {queryResult.scanned !== undefined && searchTextFilter && (
        <Alert
          type={queryResult.hasMoreMatchesUnknown ? 'warning' : 'success'}
          showIcon
          style={{ marginBottom: 12 }}
          message={queryResult.hasMoreMatchesUnknown ? 'Raw search 结果可能不完整' : 'Raw search 扫描完成'}
          description={queryResult.hasMoreMatchesUnknown
            ? `当前结果只来自已扫描的 ${queryResult.scanned.toLocaleString()} 个候选事件，可能还有更多命中。请增加 type/source/time/error/sourceChain 过滤条件后重试。`
            : `已扫描 ${queryResult.scanned.toLocaleString()} 个候选事件。`}
        />
      )}
      <Table<NetlogEventRow>
        rowKey="eventId"
        loading={loading}
        dataSource={queryResult.rows}
        pagination={{
          current: page,
          pageSize,
          total: queryResult.total,
          showTotal: (total) => queryResult.hasMoreMatchesUnknown
            ? `当前已找到 ${total} 条，可能还有更多`
            : `共 ${total} 条`,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
        columns={[
          { title: 'Event ID', dataIndex: 'eventId', width: 110 },
          { title: 'Time', dataIndex: 'time', width: 120 },
          { title: 'Type', dataIndex: 'typeName', render: (_, row) => `${row.typeName} (${row.typeId})` },
          {
            title: 'Source',
            dataIndex: 'sourceId',
            width: 260,
            render: (_, row) => (
              <Space size={6}>
                <Button size="small" type="link" style={{ padding: 0 }} onClick={() => applySourceFilter(row.sourceId)}>
                  source#{row.sourceId}
                </Button>
                <Button size="small" type="link" style={{ padding: 0 }} onClick={() => applySourceChainFilter(row.sourceId)}>
                  chain#{row.sourceId}
                </Button>
                <Tag>{row.sourceTypeName}</Tag>
              </Space>
            ),
          },
          { title: 'Phase', dataIndex: 'phaseName', width: 140, render: (_, row) => `${row.phaseName} (${row.phase})` },
          { title: 'Error', dataIndex: 'hasError', width: 90, render: (value) => value ? <Tag color="red">error</Tag> : <Tag>ok</Tag> },
          { title: 'Byte range', key: 'byteRange', width: 170, render: (_, row) => `${row.byteStart} - ${row.byteEnd}` },
          {
            title: 'Detail',
            width: 100,
            render: (_, row) => <Button size="small" onClick={() => openDetail(row.eventId)}>查看</Button>,
          },
        ]}
      />
      <Modal
        title="Raw Event Detail"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={900}
      >
        <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detailLoading ? '正在读取...' : detail}
        </pre>
      </Modal>
    </Card>
  );
};

export default DatasetEventsTab;
