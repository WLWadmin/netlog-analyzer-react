import { useState, useMemo, useRef } from 'react';
import { Card, Table, Tag, Input, Tooltip as AntTooltip, Modal, Descriptions } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined, ClockCircleOutlined, SwapOutlined } from '@ant-design/icons';
import { AnalysisResult, URLRequest, formatDuration, truncateUrl } from '../parser';

interface NetLogRequestListProps {
  result: AnalysisResult;
}

const PHASE_NAMES: Record<string, string> = {
  dns: 'DNS',
  connect: '连接',
  ssl: 'SSL',
  send: '发送',
  wait: '等待',
  download: '下载',
};

const PHASE_COLORS: Record<string, string> = {
  dns: '#a78bfa',
  connect: '#22d3ee',
  ssl: '#34d399',
  send: '#fbbf24',
  wait: '#4a9eff',
  download: '#fb923c',
};

const NetLogRequestList: React.FC<NetLogRequestListProps> = ({ result }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [hoveredReq, setHoveredReq] = useState<number | null>(null);
  const [detailReq, setDetailReq] = useState<URLRequest | null>(null);
  const waterfallRef = useRef<HTMLDivElement>(null);

  // 按开始时间排序的请求列表
  const sortedRequests = useMemo(() => {
    return [...result.urlRequests].sort((a, b) => a.startTime - b.startTime);
  }, [result.urlRequests]);

  // 搜索过滤
  const filteredRequests = useMemo(() => {
    if (!searchKeyword.trim()) return sortedRequests;
    const kw = searchKeyword.trim().toLowerCase();
    return sortedRequests.filter(r => (r.url || '').toLowerCase().includes(kw));
  }, [sortedRequests, searchKeyword]);

  // 瀑布图时间范围
  const timeRange = useMemo(() => {
    if (filteredRequests.length === 0) return { min: 0, max: 1 };
    let min = Infinity;
    let max = 0;
    for (const req of filteredRequests) {
      if (req.startTime < min) min = req.startTime;
      const end = req.endTime || req.startTime + (req.duration || 0);
      if (end > max) max = end;
    }
    return { min, max: Math.max(max, min + 1) };
  }, [filteredRequests]);

  // 列表列定义
  const columns: ColumnsType<URLRequest> = [
    {
      title: '序号',
      key: 'index',
      width: 60,
      render: (_: unknown, __: URLRequest, idx: number) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 12 }}>
          {idx + 1}
        </span>
      ),
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url: string) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)', fontSize: 12 }} title={url}>
          {url || '-'}
        </span>
      ),
    },
    {
      title: '方法',
      dataIndex: 'method',
      key: 'method',
      width: 70,
      render: (m: string) => (
        <Tag style={{ fontSize: 11, fontWeight: 600, border: 'none' }}>
          {m || 'GET'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string, r: URLRequest) => {
        if (r.error || s === 'error') {
          return <Tag color="error" style={{ fontSize: 11, border: 'none', fontWeight: 600 }}>失败</Tag>;
        }
        if (r.statusCode && r.statusCode >= 400) {
          return <Tag color="warning" style={{ fontSize: 11, border: 'none', fontWeight: 600 }}>{r.statusCode}</Tag>;
        }
        return <Tag color="success" style={{ fontSize: 11, border: 'none', fontWeight: 600 }}>{r.statusCode || 'OK'}</Tag>;
      },
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 100,
      align: 'right',
      sorter: (a, b) => (a.duration || 0) - (b.duration || 0),
      render: (d: number, r: URLRequest) => {
        const isSlow = (d || 0) > 3000;
        return (
          <span style={{
            fontFamily: 'var(--font-mono)',
            color: r.error ? '#f87171' : isSlow ? '#fb923c' : 'var(--text-secondary)',
            fontWeight: isSlow || r.error ? 600 : 400,
            fontSize: 13,
          }}>
            {formatDuration(d || 0)}
          </span>
        );
      },
    },
    {
      title: '开始时间',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 110,
      align: 'right',
      render: (t: number) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 12 }}>
          {t.toFixed(0)}ms
        </span>
      ),
    },
    {
      title: '错误信息',
      dataIndex: 'errorDesc',
      key: 'error',
      width: 200,
      ellipsis: true,
      render: (desc: string, r: URLRequest) => {
        if (!r.error && !desc) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
        return (
          <span style={{ color: '#f87171', fontSize: 12 }} title={desc || String(r.error)}>
            {desc || String(r.error)}
          </span>
        );
      },
    },
  ];

  const totalDuration = timeRange.max - timeRange.min;

  // 格式化时间轴刻度
  const formatTimeAxis = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms.toFixed(0)}ms`;
  };

  // 生成时间轴刻度
  const timeTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = 6;
    for (let i = 0; i <= count; i++) {
      ticks.push(timeRange.min + (totalDuration * i) / count);
    }
    return ticks;
  }, [timeRange, totalDuration]);

  if (sortedRequests.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px' }}>
        <SwapOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>暂无URL请求数据</div>
        <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>上传包含URL请求的NetLog文件后即可查看请求详情</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 瀑布流图表区域 */}
      <Card
        title="请求耗时瀑布流（按时间顺序）"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <div
          ref={waterfallRef}
          style={{
            width: '100%',
            height: Math.min(filteredRequests.length * 24 + 80, 600),
            overflow: 'auto',
            fontSize: 12,
          }}
        >
          {/* 表头：时间轴 */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-color)', paddingBottom: 4 }}>
            <div style={{ width: 280, flexShrink: 0, paddingLeft: 8, fontWeight: 600, color: 'var(--text-secondary)' }}>URL</div>
            <div style={{ flex: 1, position: 'relative', height: 24 }}>
              {timeTicks.map((t, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: `${((t - timeRange.min) / totalDuration) * 100}%`,
                    top: 0,
                    transform: 'translateX(-50%)',
                    color: 'var(--text-muted)',
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatTimeAxis(t - timeRange.min)}
                </div>
              ))}
            </div>
          </div>

          {/* 请求行 */}
          {filteredRequests.map((req, idx) => {
            const left = ((req.startTime - timeRange.min) / totalDuration) * 100;
            const width = ((req.duration || 0) / totalDuration) * 100;
            const isError = req.error || req.status === 'error';
            const isSlow = (req.duration || 0) > 3000;
            const rowBg = hoveredReq === idx ? 'rgba(74, 158, 255, 0.06)' : selectedIndex === idx ? 'rgba(74, 158, 255, 0.1)' : 'transparent';

            return (
              <div
                key={req.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 22,
                  cursor: 'pointer',
                  background: rowBg,
                  transition: 'background 0.15s',
                }}
                onClick={() => { setSelectedIndex(idx); setDetailReq(req); }}
                onMouseEnter={() => setHoveredReq(idx)}
                onMouseLeave={() => setHoveredReq(null)}
              >
                {/* URL 名称 */}
                <div
                  style={{
                    width: 260,
                    flexShrink: 0,
                    paddingLeft: 8,
                    whiteSpace: 'nowrap',
                    color: isError ? '#f87171' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                  title={req.url}
                >
                  {req.url ? truncateUrl(req.url, 32) : `请求-${req.id}`}
                </div>

                {/* 时间轴条形 */}
                <div style={{ flex: 1, position: 'relative', height: 16 }}>
                  {/* 总耗时背景条 */}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      width: `${Math.max(0.3, width)}%`,
                      height: '100%',
                      background: isError ? 'rgba(248, 113, 113, 0.15)' : isSlow ? 'rgba(251, 146, 60, 0.15)' : 'rgba(74, 158, 255, 0.12)',
                      borderRadius: 2,
                      border: `1px solid ${isError ? 'rgba(248, 113, 113, 0.4)' : isSlow ? 'rgba(251, 146, 60, 0.4)' : 'rgba(74, 158, 255, 0.3)'}`,
                    }}
                  />
                  {/* 各阶段分解 */}
                  {Object.entries(req.timeline).map(([phase, info]: [string, any]) => {
                    if (!info) return null;
                    const pLeft = ((info.start - timeRange.min) / totalDuration) * 100;
                    const pWidth = ((info.end - info.start) / totalDuration) * 100;
                    return (
                      <AntTooltip
                        key={phase}
                        title={`${PHASE_NAMES[phase]}: ${formatDuration(info.duration)}`}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: `${pLeft}%`,
                            width: `${Math.max(0.2, pWidth)}%`,
                            height: '100%',
                            background: PHASE_COLORS[phase],
                            borderRadius: 1,
                            minWidth: 2,
                          }}
                        />
                      </AntTooltip>
                    );
                  })}
                </div>

                {/* 耗时文本 */}
                <div
                  style={{
                    width: 70,
                    textAlign: 'right',
                    paddingRight: 8,
                    flexShrink: 0,
                    fontFamily: 'var(--font-mono)',
                    color: isError ? '#f87171' : isSlow ? '#fb923c' : 'var(--text-muted)',
                    fontWeight: isError || isSlow ? 600 : 400,
                  }}
                >
                  {formatDuration(req.duration || 0)}
                </div>
              </div>
            );
          })}
        </div>

        {/* 图例 */}
        <div style={{ display: 'flex', gap: 20, marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(74, 158, 255, 0.15)', border: '1px solid rgba(74, 158, 255, 0.4)' }} />
            正常请求
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.4)' }} />
            慢请求 (&gt;3s)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(248, 113, 113, 0.15)', border: '1px solid rgba(248, 113, 113, 0.4)' }} />
            错误请求
          </span>
          {Object.entries(PHASE_NAMES).map(([key, name]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: PHASE_COLORS[key] }} />
              {name}
            </span>
          ))}
        </div>
      </Card>

      {/* 请求列表 */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <span>请求列表（共 {filteredRequests.length} 条{searchKeyword ? ` / 总计 ${sortedRequests.length} 条` : ''}，按开始时间排序）</span>
            <Input
              allowClear
              placeholder="搜索 URL..."
              prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
              value={searchKeyword}
              onChange={e => { setSearchKeyword(e.target.value); setSelectedIndex(null); }}
              style={{ width: 280 }}
              size="small"
            />
          </div>
        }
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <Table<URLRequest>
          columns={columns}
          dataSource={filteredRequests}
          rowKey="id"
          size="small"
          scroll={{ x: 900 }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
          rowClassName={(_record: URLRequest, index: number) =>
            selectedIndex === index ? 'har-request-row-selected' : ''
          }
          onRow={(_record: URLRequest, index?: number) => ({
            onClick: () => setSelectedIndex(index ?? null),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* 点击瀑布流条形弹出的详情弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClockCircleOutlined style={{ color: 'var(--accent-blue)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>请求耗时详情</span>
          </div>
        }
        open={!!detailReq}
        onCancel={() => setDetailReq(null)}
        footer={null}
        width={560}
        styles={{ body: { background: 'var(--bg-elevated)' }, header: { background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-color)' } }}
      >
        {detailReq && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* URL */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>URL</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-blue)', wordBreak: 'break-all' }}>
                {detailReq.url}
              </div>
            </div>

            {/* 总览 */}
            <Descriptions column={2} size="small" bordered={false}>
              <Descriptions.Item label="方法">{detailReq.method || 'GET'}</Descriptions.Item>
              <Descriptions.Item label="状态码">{detailReq.statusCode || '-'}</Descriptions.Item>
              <Descriptions.Item label="总耗时">
                <span style={{ color: (detailReq.duration || 0) > 3000 ? '#fb923c' : 'inherit', fontWeight: 600 }}>
                  {formatDuration(detailReq.duration || 0)}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="开始时间">{detailReq.startTime.toFixed(0)}ms</Descriptions.Item>
            </Descriptions>

            {/* 各阶段耗时分解 */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>各阶段耗时分解</div>
              {Object.entries(detailReq.timeline).filter(([, info]) => info).length === 0 ? (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>无阶段数据</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Object.entries(detailReq.timeline)
                    .filter(([, info]) => info)
                    .map(([phase, info]: [string, any]) => {
                      const total = detailReq.duration || 1;
                      const pct = (info.duration / total) * 100;
                      return (
                        <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 48, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {PHASE_NAMES[phase]}
                          </span>
                          <div style={{ flex: 1, height: 10, background: 'var(--bg-base)', borderRadius: 5, overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.min(100, pct)}%`,
                                height: '100%',
                                background: PHASE_COLORS[phase],
                                borderRadius: 5,
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', width: 80, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {formatDuration(info.duration)}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 50, textAlign: 'right' }}>
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* 错误信息 */}
            {(detailReq.error || detailReq.errorDesc) && (
              <div style={{ padding: 12, background: 'rgba(248, 113, 113, 0.08)', borderRadius: 8, border: '1px solid rgba(248, 113, 113, 0.2)' }}>
                <div style={{ fontSize: 12, color: '#f87171', fontWeight: 600, marginBottom: 4 }}>错误信息</div>
                <div style={{ fontSize: 12, color: '#f87171', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                  {detailReq.errorDesc || String(detailReq.error)}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default NetLogRequestList;
