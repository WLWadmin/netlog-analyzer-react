import { useState, useMemo } from 'react';
import { Card, Table, Tag, Alert, Descriptions, Progress, Badge, Modal, Button, List, Collapse } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { AnalysisResult, formatDuration, truncateUrl } from '../parser';

const { Panel } = Collapse;

interface OverviewTabProps {
  result: AnalysisResult;
}

// Group errors by description and count occurrences
function groupErrors(errors: { code: number | string; desc: string; time: number }[]) {
  const map = new Map<string, { desc: string; code: number | string; count: number; times: number[] }>();
  for (const e of errors) {
    const key = `${e.code}|${e.desc}`;
    if (map.has(key)) {
      const item = map.get(key)!;
      item.count++;
      item.times.push(e.time);
    } else {
      map.set(key, { desc: e.desc, code: e.code, count: 1, times: [e.time] });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// Modal for showing all errors of a domain
const ErrorDetailModal: React.FC<{
  open: boolean;
  onClose: () => void;
  domain: string;
  errors: { code: number | string; desc: string; time: number }[];
}> = ({ open, onClose, domain, errors }) => {
  const grouped = useMemo(() => groupErrors(errors), [errors]);
  return (
    <Modal
      title={<span style={{ color: 'var(--text-primary)' }}>🐛 {domain} — 错误详情</span>}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose} type="primary" style={{ background: '#4a9eff', borderColor: '#4a9eff' }}>
          关闭
        </Button>,
      ]}
      width={600}
      style={{ top: 80 }}
      className="netlog-modal-dark"
    >
      <List
        dataSource={grouped}
        renderItem={(item) => (
          <List.Item style={{ borderBottom: '1px solid var(--border-color)', padding: '12px 0' }}>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <Tag color="orange">{item.code}</Tag>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14 }}>{item.desc}</span>
                <Tag color="red" style={{ marginLeft: 'auto' }}>× {item.count}</Tag>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                首次出现: {item.times[0]?.toFixed(0) || '-'}ms · 末次出现: {item.times[item.times.length - 1]?.toFixed(0) || '-'}ms
              </div>
            </div>
          </List.Item>
        )}
      />
      <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 12, textAlign: 'right' }}>
        共 {errors.length} 条错误记录，{grouped.length} 种错误类型
      </div>
    </Modal>
  );
};

// Error description cell component with "more" button
const ErrorDescCell: React.FC<{
  errors: { code: number | string; desc: string; time: number }[];
  domain: string;
}> = ({ errors, domain }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const grouped = useMemo(() => groupErrors(errors), [errors]);

  if (grouped.length === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>无错误</span>;
  }

  return (
    <>
      <div style={{ fontSize: 13 }}>
        {grouped.slice(0, 2).map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-primary)' }}>{item.desc}</span>
            <Tag color="red">× {item.count}</Tag>
          </div>
        ))}
        {grouped.length > 2 && (
          <Button
            type="link"
            size="small"
            onClick={() => setModalOpen(true)}
            style={{ padding: 0, color: '#4a9eff', fontSize: 13 }}
          >
            +{grouped.length - 2} 更多
          </Button>
        )}
      </div>
      <ErrorDetailModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        domain={domain}
        errors={errors}
      />
    </>
  );
};

// Group issues by category+message, keeping slow requests separate
function groupIssues(
  errors: AnalysisResult['errors'],
  warnings: AnalysisResult['warnings']
) {
  const all = [
    ...errors.map(e => ({ ...e, severity: 'error' as const })),
    ...warnings.map(w => ({ ...w, severity: 'warning' as const })),
  ];

  const grouped = new Map<
    string,
    {
      category: string;
      message: string;
      severity: 'error' | 'warning';
      count: number;
      items: typeof all;
    }
  >();

  for (const item of all) {
    // Slow requests: keep each one separate (group by full message)
    const isSlowRequest = item.category === '慢请求';
    const key = isSlowRequest ? `slow-${item.message}` : `${item.category}|${item.message}`;

    if (grouped.has(key)) {
      const g = grouped.get(key)!;
      g.count++;
      g.items.push(item);
    } else {
      grouped.set(key, {
        category: item.category,
        message: item.message,
        severity: item.severity,
        count: 1,
        items: [item],
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const order = { error: 0, warning: 1 };
    if (order[a.severity] !== order[b.severity]) {
      return order[a.severity] - order[b.severity];
    }
    return b.count - a.count;
  });
}

// Group by category for load-more
function groupByCategory(
  issues: ReturnType<typeof groupIssues>
) {
  const map = new Map<string, typeof issues>();
  for (const item of issues) {
    const cat = item.category;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(item);
  }
  return map;
}

// Single issue alert component
const IssueAlert: React.FC<{
  item: ReturnType<typeof groupIssues>[0];
  index: number;
  expandedKeys: string[];
  setExpandedKeys: (keys: string[]) => void;
}> = ({ item, index, expandedKeys, setExpandedKeys }) => {
  const isSlowRequest = item.category === '慢请求';
  const hasMultiple = item.count > 1 && !isSlowRequest;
  const color = item.severity === 'error' ? 'red' : 'orange';

  return (
    <Alert
      key={`issue-${index}`}
      message={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge color={color} />
          <Tag color={color}>{item.category}</Tag>
          <span
            style={{
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={item.message}
          >
            {item.message}
          </span>
          {hasMultiple && (
            <Tag color={color} style={{ marginLeft: 'auto', flexShrink: 0 }}>
              × {item.count}
            </Tag>
          )}
        </div>
      }
      description={
        <div style={{ marginTop: 8 }}>
          {isSlowRequest ? (
            <pre
              style={{
                margin: 0,
                fontSize: 13,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                lineHeight: 1.6,
              }}
            >
              {item.items[0].detail}
            </pre>
          ) : hasMultiple ? (
            <Collapse
              ghost
              bordered={false}
              activeKey={expandedKeys}
              onChange={(keys) => setExpandedKeys(keys as string[])}
              style={{ background: 'transparent' }}
            >
              <Panel
                header={
                  <span style={{ color: '#9ca3af', fontSize: 13 }}>
                    点击查看 {item.count} 条详情
                  </span>
                }
                key={`panel-${index}`}
                style={{ padding: 0 }}
              >
                {item.items.map((sub, idx) => (
                  <pre
                    key={idx}
                    style={{
                      margin: '4px 0',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                      lineHeight: 1.5,
                      padding: '8px 12px',
                      background: 'var(--bg-base)',
                      borderRadius: 6,
                    }}
                  >
                    {sub.detail}
                  </pre>
                ))}
              </Panel>
            </Collapse>
          ) : (
            <pre
              style={{
                margin: 0,
                fontSize: 13,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                lineHeight: 1.6,
              }}
            >
              {item.items[0].detail}
            </pre>
          )}
        </div>
      }
      type={item.severity as any}
      style={{
        marginBottom: 10,
        background: 'var(--bg-surface)',
        border: `1px solid ${color === 'red' ? 'rgba(248, 113, 113, 0.2)' : 'rgba(251, 191, 36, 0.2)'}`,
      }}
    />
  );
};

// Issue Summary List Component with category grouping and load-more
const IssueSummaryList: React.FC<{
  errors: AnalysisResult['errors'];
  warnings: AnalysisResult['warnings'];
}> = ({ errors, warnings }) => {
  const grouped = useMemo(() => groupIssues(errors, warnings), [errors, warnings]);
  const byCategory = useMemo(() => groupByCategory(grouped), [grouped]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loadedCategories, setLoadedCategories] = useState<Map<string, number>>(new Map());

  const INITIAL_SHOW = 10;
  const LOAD_MORE_STEP = 100;
  const FULL_THRESHOLD = 300;

  return (
    <>
      {Array.from(byCategory.entries()).map(([category, items]) => {
        const clickCount = loadedCategories.get(category) || 0;
        // Special marker for "load all" state
        const isAllLoaded = clickCount === 999;
        const visibleCount = isAllLoaded ? items.length : INITIAL_SHOW + clickCount * LOAD_MORE_STEP;
        const visibleItems = items.slice(0, visibleCount);
        const remaining = items.length - visibleCount;
        const showLoadAll = visibleCount >= FULL_THRESHOLD && items.length > visibleCount;
        const hasMore = remaining > 0;

        return (
          <div key={category} style={{ marginBottom: 16 }}>
            {/* Category header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
                padding: '6px 0',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <Tag
                color={items[0]?.severity === 'error' ? 'red' : 'orange'}
                style={{ fontWeight: 600, fontSize: 13 }}
              >
                {category}
              </Tag>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                共 {items.length} 条
              </span>
            </div>

            {/* Issue items */}
            {visibleItems.map((item, i) => (
              <IssueAlert
                key={`${category}-${i}`}
                item={item}
                index={i}
                expandedKeys={expandedKeys}
                setExpandedKeys={setExpandedKeys}
              />
            ))}

            {/* Load more / Collapse button */}
            {hasMore ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <Button
                  type="link"
                  icon={<DownOutlined />}
                  onClick={() =>
                    setLoadedCategories(prev => {
                      const newMap = new Map(prev);
                      if (showLoadAll || isAllLoaded) {
                        // Load all: set marker to 999
                        newMap.set(category, 999);
                      } else {
                        newMap.set(category, (prev.get(category) || 0) + 1);
                      }
                      return newMap;
                    })
                  }
                  style={{ color: '#0ea5e9', fontSize: 13 }}
                >
                  {showLoadAll ? `加载全部 (剩余${remaining}条)` : `加载更多 (剩余${remaining}条)`}
                </Button>
              </div>
            ) : clickCount > 0 ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <Button
                  type="link"
                  icon={<UpOutlined />}
                  onClick={() =>
                    setLoadedCategories(prev => {
                      const newMap = new Map(prev);
                      newMap.delete(category);
                      return newMap;
                    })
                  }
                  style={{ color: 'var(--text-muted)', fontSize: 13 }}
                >
                  收起
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
      {(errors.length > 0 || warnings.length > 0) && grouped.length < errors.length + warnings.length && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>
          已合并重复项，更多详情请查看「定因诊断」选项卡
        </div>
      )}
    </>
  );
};

const OverviewTab: React.FC<OverviewTabProps> = ({ result }) => {
  const pi = result.proxyInfo;

  // Protocol distribution
  const protocolData = Object.entries(result.protocols)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
  const maxProto = protocolData.length > 0 ? Math.max(...protocolData.map(p => p.count)) : 1;

  // Top slow requests
  const topRequests = result.urlRequests
    .filter(q => q.duration)
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 20);

  const requestColumns = [
    { title: 'URL', dataIndex: 'url', key: 'url', render: (url: string) => <span title={url}>{truncateUrl(url, 50)}</span> },
    { title: '方法', dataIndex: 'method', key: 'method', render: (m: string) => <Tag color="blue">{m}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string, r: any) => getStatusTag(s, r.statusCode) },
    { title: '耗时', dataIndex: 'duration', key: 'duration', render: (d: number) => (
      <span style={{ fontWeight: 600, color: d > 3000 ? '#f87171' : d > 1000 ? '#fbbf24' : '#34d399' }}>{formatDuration(d)}</span>
    )},
  ];

  // Failed domains
  const failedDomainColumns = [
    { title: '域名', dataIndex: 'domain', key: 'domain', render: (d: string) => <strong>{d}</strong> },
    { title: '解析 IP', dataIndex: 'resolvedIp', key: 'resolvedIp', render: (ip: string | null) =>
      ip ? <Tag color="cyan">{ip}</Tag> : <span style={{ color: 'var(--text-muted)' }}>未解析</span>
    },
    { title: 'Remote IP', dataIndex: 'remoteIp', key: 'remoteIp', render: (ip: string | null) =>
      ip ? <Tag color="geekblue">{ip}</Tag> : <span style={{ color: 'var(--text-muted)' }}>未解析</span>
    },
    { title: '错误次数', dataIndex: 'count', key: 'count', render: (c: number) => <Tag color="red">{c}</Tag> },
    { title: '错误码', dataIndex: 'errorCodes', key: 'errorCodes', render: (codes: any[]) =>
      codes.map(c => <Tag color="orange" key={c}>{c}</Tag>)
    },
    { title: '错误描述', dataIndex: 'errors', key: 'errors', render: (errors: any[], record: any) => (
      <ErrorDescCell errors={errors} domain={record.domain} />
    )},
  ];

  return (
    <>
      {/* Proxy/VPN Detection */}
      <Card title="🌐 代理 / VPN 环境检测" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
        {pi.isVPN || pi.hasProxy || result.proxyEvents.length > 0 ? (
          <>
            <div style={{ marginBottom: 12 }}>
              {pi.isVPN ? (
                <Tag color="red">🚨 检测到 VPN</Tag>
              ) : pi.hasProxy ? (
                <Tag color="orange">⚠️ 使用了代理</Tag>
              ) : (
                <Tag color="blue">ℹ️ 代理事件</Tag>
              )}
              <span style={{ color: 'var(--text-secondary)', marginLeft: 12 }}>代理模式: <strong style={{ color: 'var(--text-primary)' }}>{pi.proxyType || '未知'}</strong></span>
            </div>
            {pi.proxyList.length > 0 && (
              <>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>代理服务器列表</div>
                <div style={{ marginBottom: 12 }}>
                  {pi.proxyList.map(p => <Tag color="cyan" key={p}>{p}</Tag>)}
                </div>
              </>
            )}
            {pi.pacUrl && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>PAC 脚本地址:</span>
                <div style={{ fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: 13, color: '#fbbf24', marginTop: 4 }}>{pi.pacUrl}</div>
              </div>
            )}
            {pi.vpnHints.length > 0 && (
              <>
                <div style={{ fontSize: 13, color: '#f87171', marginBottom: 8, fontWeight: 600 }}>VPN 检测线索</div>
                {pi.vpnHints.map((h, i) => (
                  <Alert
                    key={i}
                    message={<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{h}</span>}
                    type="error"
                    style={{ marginBottom: 8, background: 'var(--bg-surface)', borderColor: '#f87171' }}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          <Alert
            message={<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>未检测到代理或 VPN</span>}
            description={<span style={{ color: 'var(--text-secondary)' }}>当前网络环境为直连模式，未配置代理服务器。</span>}
            type="success"
            style={{ background: 'var(--bg-surface)', borderColor: '#34d399' }}
          />
        )}
      </Card>

      {/* Failed Domains */}
      {result.failedDomains.length > 0 && (
        <Card title="❌ 网络报错域名与 IP 列表" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <Table
            dataSource={result.failedDomains}
            columns={failedDomainColumns}
            rowKey="domain"
            pagination={false}
            size="small"
            scroll={{ x: 'max-content', y: 400 }}
            sticky={{ offsetHeader: 0 }}
          />
        </Card>
      )}

      {/* Issue Summary */}
      {(result.errors.length > 0 || result.warnings.length > 0) && (
        <Card title="⚠️ 问题摘要" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <IssueSummaryList errors={result.errors} warnings={result.warnings} />
        </Card>
      )}

      {/* Protocol Distribution */}
      {protocolData.length > 0 && (
        <Card title="📡 协议分布" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          {protocolData.map(p => (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
              <div style={{ width: 100, fontSize: 13, color: 'var(--text-secondary)' }}>{p.name}</div>
              <Progress percent={Math.round(p.count / maxProto * 100)} showInfo={false} strokeColor="#4a9eff" trailColor="var(--bg-surface)" style={{ flex: 1 }} />
              <div style={{ width: 40, textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)' }}>{p.count}</div>
            </div>
          ))}
        </Card>
      )}

      {/* Top Slow Requests */}
      {topRequests.length > 0 && (
        <Card title="🐌 耗时最长的请求 (Top 20)" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <Table dataSource={topRequests} columns={requestColumns} rowKey="id" pagination={false} size="small" scroll={{ x: 'max-content', y: 400 }} sticky={{ offsetHeader: 0 }} />
        </Card>
      )}

      {/* DNS Records */}
      {Object.keys(result.hosts).length > 0 && (
        <Card title="🌐 DNS 解析记录" style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <Descriptions column={2} size="small">
            {Object.entries(result.hosts).map(([host, ip]) => (
              <Descriptions.Item key={host} label={host}>
                <Tag color="cyan">{ip}</Tag>
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      )}
    </>
  );
};

function getStatusTag(status: string, code?: number) {
  if (status === 'error') return <Tag color="red">失败</Tag>;
  if (!code) return <Tag color="blue">{status || '-'}</Tag>;
  if (code >= 200 && code < 300) return <Tag color="green">{code}</Tag>;
  if (code >= 300 && code < 400) return <Tag color="blue">{code}</Tag>;
  if (code >= 400 && code < 500) return <Tag color="orange">{code}</Tag>;
  if (code >= 500) return <Tag color="red">{code}</Tag>;
  return <Tag color="blue">{code}</Tag>;
}

export default OverviewTab;
