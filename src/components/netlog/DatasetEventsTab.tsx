import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Space, Table, Tag, message } from 'antd';
import { getNetlogEventDetailInWorker, queryNetlogEventsInWorker } from '../../workers/workerClient';
import type { NetlogEventRow, QueryNetlogEventsResult } from '../../workers/netlogDatasetQuery';
import { useNavigation } from '../../contexts/NavigationContext';

interface DatasetEventsTabProps {
  analysisId: string;
}

const DatasetEventsTab: React.FC<DatasetEventsTabProps> = ({ analysisId }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [errorOnly, setErrorOnly] = useState(false);
  const [sourceIdFilter, setSourceIdFilter] = useState('');
  const [typeIdFilter, setTypeIdFilter] = useState('');
  const [typeNameFilter, setTypeNameFilter] = useState('');
  const [sourceTypeNameFilter, setSourceTypeNameFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
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
  const { intent, consumeIntent } = useNavigation();

  useEffect(() => {
    if (!intent || intent.tab !== 'expert') return;
    const filters = intent.filters;
    if (!filters) return;
    if (filters.sourceId) setSourceIdFilter(filters.sourceId);
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
    setLoading(true);
    queryNetlogEventsInWorker({
      analysisId,
      page,
      pageSize,
      errorOnly,
      sourceId: numericOrUndefined(sourceIdFilter),
      typeId: numericOrUndefined(typeIdFilter),
      typeName: typeNameFilter.trim() || undefined,
      sourceTypeName: sourceTypeNameFilter.trim() || undefined,
      phase: numericOrUndefined(phaseFilter),
    })
      .then(result => {
        if (!cancelled) setQueryResult(result);
      })
      .catch(err => {
        if (!cancelled) message.error('Dataset 事件查询失败: ' + (err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, page, pageSize, errorOnly, sourceIdFilter, typeIdFilter, typeNameFilter, sourceTypeNameFilter, phaseFilter]);

  const clearFilters = () => {
    setErrorOnly(false);
    setSourceIdFilter('');
    setTypeIdFilter('');
    setTypeNameFilter('');
    setSourceTypeNameFilter('');
    setPhaseFilter('');
    setPage(1);
  };

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
          <Button type={errorOnly ? 'primary' : 'default'} onClick={() => { setErrorOnly(prev => !prev); setPage(1); }}>
            仅错误事件
          </Button>
          <Button onClick={clearFilters}>清除筛选</Button>
        </Space>
      }
      bordered={false}
    >
      {(sourceIdFilter || typeIdFilter || typeNameFilter || sourceTypeNameFilter || phaseFilter || errorOnly) && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Dataset 查询条件"
          description={`sourceId=${sourceIdFilter || '*'}，typeId=${typeIdFilter || '*'}，typeName=${typeNameFilter || '*'}，sourceType=${sourceTypeNameFilter || '*'}，phase=${phaseFilter || '*'}，errorOnly=${errorOnly ? 'true' : 'false'}`}
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
          { title: 'Source', dataIndex: 'sourceId', width: 180, render: (_, row) => `${row.sourceId} / ${row.sourceTypeName}` },
          { title: 'Phase', dataIndex: 'phaseName', width: 140, render: (_, row) => `${row.phaseName} (${row.phase})` },
          { title: 'Error', dataIndex: 'hasError', width: 90, render: (value) => value ? <Tag color="red">error</Tag> : <Tag>ok</Tag> },
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
