import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FileSearchOutlined } from '@ant-design/icons';
import type { NetlogRawEvidenceMetadataValueView, NetlogRawEvidenceStructureView } from '../../workers/netlogDatasetViews';
import type { NetlogEventRow, QueryNetlogEventsResult } from '../../workers/netlogDatasetQuery';
import {
  getNetlogEventDetailInWorker,
  getNetlogRawEvidenceMetadataInWorker,
  getNetlogRawEvidenceStructureInWorker,
  queryNetlogRawEvidenceEventsInWorker,
} from '../../workers/workerClient';

interface DatasetRawEvidenceExplorerProps {
  analysisId: string;
  fileName?: string;
}

const PAGE_SIZE = 100;

export default function DatasetRawEvidenceExplorer({ analysisId, fileName }: DatasetRawEvidenceExplorerProps) {
  const [structure, setStructure] = useState<NetlogRawEvidenceStructureView>();
  const [eventsPage, setEventsPage] = useState<QueryNetlogEventsResult>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailText, setDetailText] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    getNetlogRawEvidenceStructureInWorker({ analysisId })
      .then(result => {
        if (!cancelled) setStructure(result);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [analysisId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    queryNetlogRawEvidenceEventsInWorker({ analysisId, page, pageSize: PAGE_SIZE })
      .then(result => {
        if (!cancelled) setEventsPage(result);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [analysisId, page]);

  const openEventDetail = async (row: NetlogEventRow) => {
    setDetailTitle(`event#${row.eventId} ${row.typeName}`);
    setDetailText('读取中...');
    setDetailOpen(true);
    try {
      const detail = await getNetlogEventDetailInWorker({ analysisId, eventId: row.eventId });
      setDetailText(JSON.stringify(detail, null, 2));
    } catch (err) {
      setDetailText(err instanceof Error ? err.message : String(err));
    }
  };

  const openMetadataDetail = async (key: NetlogRawEvidenceMetadataValueView['key']) => {
    setDetailTitle(`${key} raw JSON`);
    setDetailText('读取中...');
    setDetailOpen(true);
    try {
      const detail = await getNetlogRawEvidenceMetadataInWorker({ analysisId, key });
      setDetailText(JSON.stringify(detail, null, 2));
    } catch (err) {
      setDetailText(err instanceof Error ? err.message : String(err));
    }
  };

  const columns: ColumnsType<NetlogEventRow> = [
    { title: 'eventId', dataIndex: 'eventId', width: 90 },
    { title: 'typeName', dataIndex: 'typeName', ellipsis: true },
    { title: 'source', width: 190, render: (_, row) => <span>{row.sourceTypeName}#{row.sourceId}</span> },
    { title: 'time', dataIndex: 'time', width: 120 },
    {
      title: 'byte range',
      width: 170,
      render: (_, row) => <span>{row.byteStart}-{row.byteEnd}</span>,
    },
    {
      title: 'raw detail',
      width: 110,
      render: (_, row) => <Button size="small" onClick={() => openEventDetail(row)}>查看</Button>,
    },
  ];

  if (error) {
    return (
      <Card>
        <Alert type="warning" showIcon message="Dataset Raw Evidence 读取失败" description={error} />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        styles={{ body: { padding: 18 } }}
        style={{
          borderRadius: 16,
          borderColor: 'rgba(99, 102, 241, 0.18)',
          background: 'linear-gradient(180deg, rgba(99,102,241,0.07), var(--bg-elevated) 72px)',
        }}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space wrap>
            <FileSearchOutlined style={{ color: '#6366f1' }} />
            <Typography.Text strong>Dataset Raw Evidence 虚拟树</Typography.Text>
            {fileName && <Tag>{fileName}</Tag>}
            <Tag color="blue">不加载完整 events 到主线程</Tag>
          </Space>
          <Typography.Text type="secondary">
            顶层 metadata 和单个 event 都按 byte range 懒加载；events 使用 Dataset compact index 分页，不把完整 events 放入主线程。
          </Typography.Text>
        </Space>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 16 }}>
        <Card title="顶层节点" size="small" loading={!structure}>
          {structure?.topLevelNodes.map(node => (
            <div key={node.key} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
              <Space wrap>
                <Typography.Text strong>{node.label}</Typography.Text>
                <Tag color={node.available ? 'green' : 'default'}>{node.available ? '存在' : '缺失'}</Tag>
                <Tag>{node.kind === 'virtual-events' ? '虚拟 events' : 'metadata'}</Tag>
                {node.kind === 'metadata' && node.available && node.byteStart !== undefined && node.byteEnd !== undefined && (
                  <Button size="small" onClick={() => openMetadataDetail(node.key as NetlogRawEvidenceMetadataValueView['key'])}>
                    查看 raw
                  </Button>
                )}
              </Space>
              <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
                {node.description}
              </div>
              {node.byteStart !== undefined && node.byteEnd !== undefined && (
                <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                  <Descriptions.Item label="byte range">{node.byteStart}-{node.byteEnd}</Descriptions.Item>
                </Descriptions>
              )}
              {node.eventCount !== undefined && (
                <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                  <Descriptions.Item label="eventCount">{node.eventCount.toLocaleString()}</Descriptions.Item>
                </Descriptions>
              )}
            </div>
          ))}
          {structure?.evidenceGaps.length ? (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="Evidence gaps"
              description={structure.evidenceGaps.join('；')}
            />
          ) : null}
        </Card>

        <Card title="events 虚拟列表" size="small">
          <Table
            rowKey="eventId"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={eventsPage?.rows || []}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: eventsPage?.total || 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
          />
        </Card>
      </div>

      <Modal
        open={detailOpen}
        title={detailTitle}
        width={900}
        footer={null}
        onCancel={() => setDetailOpen(false)}
      >
        <pre style={{ maxHeight: 560, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {detailText}
        </pre>
      </Modal>
    </div>
  );
}
