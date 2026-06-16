import { useMemo, Fragment } from 'react';
import { Tabs, Empty, Tag, Tooltip } from 'antd';
import {
  HarRequestEntry,
  decodeResponseBody,
  statusStyle,
  formatBytes,
} from '../../harParser';
import CopyText from './CopyText';
import HarTimingChart from './HarTimingChart';

interface HarRequestDetailProps {
  entry: HarRequestEntry;
}

const sectionTitle = (text: string) => (
  <div
    style={{
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      margin: '4px 0 8px',
    }}
  >
    {text}
  </div>
);

const HeaderList: React.FC<{ headers: { name: string; value: string }[] }> = ({ headers }) => {
  if (!headers.length) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>无</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', fontSize: 13 }}>
      {headers.map((h, i) => (
        <Fragment key={i}>
          <Tooltip title={h.name.length > 30 ? h.name : undefined} placement="topLeft">
            <span
              style={{
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                padding: '6px 16px 6px 0',
                borderBottom: '1px solid var(--border-color)',
                cursor: h.name.length > 30 ? 'help' : 'default',
              }}
            >
              {h.name}
            </span>
          </Tooltip>
          <Tooltip title={h.value.length > 60 ? h.value : undefined} placement="topLeft">
            <span
              style={{
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                padding: '6px 0',
                borderBottom: '1px solid var(--border-color)',
                cursor: h.value.length > 60 ? 'help' : 'default',
              }}
            >
              {h.value}
            </span>
          </Tooltip>
        </Fragment>
      ))}
    </div>
  );
};

const GeneralRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '150px 1fr',
      columnGap: 16,
      alignItems: 'center',
      padding: '8px 0',
      borderBottom: '1px solid var(--border-color)',
      fontSize: 13,
    }}
  >
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <div style={{ minWidth: 0 }}>{children}</div>
  </div>
);

const JsonTree: React.FC<{ data: any; depth?: number }> = ({ data, depth = 0 }) => {
  if (data === null) return <span style={{ color: '#9ca3af' }}>null</span>;
  if (typeof data !== 'object') return <span style={{ color: typeof data === 'string' ? '#34d399' : '#fbbf24' }}>{JSON.stringify(data)}</span>;

  const isArray = Array.isArray(data);
  const entries = Object.entries(data);
  if (entries.length === 0) return <span>{isArray ? '[]' : '{}'}</span>;

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{ margin: '2px 0' }}>
          <span style={{ color: '#93c5fd' }}>{isArray ? '' : `${key}: `}</span>
          <JsonTree data={value} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
};

const PRIORITY_HEADERS = ['server-timing', 'x-response-cinfo', 'x-response-sinfo', 'x-tt-logid', 'server'];
const COPYABLE_PRIORITY_HEADERS = ['x-response-cinfo', 'x-response-sinfo', 'x-tt-logid'];

const HarRequestDetail: React.FC<HarRequestDetailProps> = ({ entry }) => {
  const decoded = useMemo(() => decodeResponseBody(entry), [entry]);

  const { priorityHeaders, otherResponseHeaders } = useMemo(() => {
    const priority: { name: string; value: string }[] = [];
    const other: { name: string; value: string }[] = [];
    entry.responseHeaders.forEach(h => {
      if (PRIORITY_HEADERS.includes(h.name.toLowerCase())) {
        priority.push(h);
      } else {
        other.push(h);
      }
    });
    // 按 PRIORITY_HEADERS 顺序排序
    priority.sort((a, b) => {
      const idxA = PRIORITY_HEADERS.indexOf(a.name.toLowerCase());
      const idxB = PRIORITY_HEADERS.indexOf(b.name.toLowerCase());
      return idxA - idxB;
    });
    return { priorityHeaders: priority, otherResponseHeaders: other };
  }, [entry.responseHeaders]);

  // Headers Tab
  const headersTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        {sectionTitle('General')}
        <GeneralRow label="Request URL">
          <CopyText text={entry.url} label="URL" />
        </GeneralRow>
        <GeneralRow label="Request Method">
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{entry.method}</span>
        </GeneralRow>
        <GeneralRow label="Status Code">
          <Tag
            style={{
              color: statusStyle(entry.status).color,
              background: statusStyle(entry.status).bg,
              border: 'none',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {entry.status === 0 ? '失败/未完成' : entry.status} {entry.statusText}
          </Tag>
        </GeneralRow>
        <GeneralRow label="Remote Address">
          <CopyText text={entry.remoteAddress} label="Remote Address" />
        </GeneralRow>
        <GeneralRow label="Protocol">
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{entry.protocol}</span>
        </GeneralRow>
      </div>

      {priorityHeaders.length > 0 && (
        <div>
          {sectionTitle('关键响应头')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {priorityHeaders.map((h, i) => {
              const canCopy = COPYABLE_PRIORITY_HEADERS.includes(h.name.toLowerCase());
              return (
                <div
                  key={i}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {h.name}
                    </span>
                  </div>
                  {canCopy ? (
                    <CopyText text={h.value} label={h.name} />
                  ) : (
                    <Tooltip title={h.value.length > 60 ? h.value : undefined} placement="topLeft">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', cursor: h.value.length > 60 ? 'help' : 'default' }}>
                        {h.value}
                      </span>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        {sectionTitle('Response Headers')}
        <HeaderList headers={otherResponseHeaders} />
      </div>
      <div>
        {sectionTitle('Request Headers')}
        <HeaderList headers={entry.requestHeaders} />
      </div>
    </div>
  );

  // Preview Tab
  const previewTab = decoded.isImage && decoded.imageSrc ? (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        图片预览 · {entry.mimeType || '未知类型'} · {formatBytes(entry.contentSize)}
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 16, textAlign: 'center', maxHeight: 520, overflow: 'auto' }}>
        <img
          src={decoded.imageSrc}
          alt={entry.name}
          style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4, objectFit: 'contain' }}
        />
      </div>
    </div>
  ) : decoded.isMedia && decoded.imageSrc ? (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        媒体预览 · {entry.mimeType || '未知类型'} · {formatBytes(entry.contentSize)}
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
        <video
          src={decoded.imageSrc}
          controls
          style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4 }}
        />
      </div>
    </div>
  ) : decoded.text ? (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {decoded.isJson ? 'JSON 已格式化' : '原始响应体'} · {entry.mimeType || '未知类型'}
      </div>
      {decoded.isJson && decoded.parsed ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, fontSize: 12.5, maxHeight: 480, overflow: 'auto' }}>
          <JsonTree data={decoded.parsed} />
        </div>
      ) : (
        <pre
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            padding: 14,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            maxHeight: 480,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            margin: 0,
          }}
        >
          {decoded.text}
        </pre>
      )}
    </div>
  ) : (
    <Empty description="该请求未捕获响应体" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  );

  // Timing Tab
  const timingTab = <HarTimingChart timings={entry.timings} total={entry.time} />;

  // Payload Tab
  const payloadTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {entry.queryString.length > 0 && (
        <div>
          {sectionTitle('Query String Parameters')}
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, fontSize: 13 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px 16px' }}>
              {entry.queryString.map((q, i) => (
                <Fragment key={i}>
                  <Tooltip title={q.name.length > 30 ? q.name : undefined} placement="topLeft">
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: q.name.length > 30 ? 'help' : 'default' }}>{q.name}</span>
                  </Tooltip>
                  <Tooltip title={q.value.length > 60 ? q.value : undefined} placement="topLeft">
                    <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: q.value.length > 60 ? 'help' : 'default' }}>{q.value}</span>
                  </Tooltip>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
      {entry.postData ? (
        <div>
          {sectionTitle('Request Payload')}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {entry.postData.mimeType || '未知类型'}
          </div>
          {entry.postData.params && entry.postData.params.length > 0 ? (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, fontSize: 13 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px 16px' }}>
                {entry.postData.params.map((p, i) => (
                  <Fragment key={i}>
                    <Tooltip title={p.name.length > 30 ? p.name : undefined} placement="topLeft">
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: p.name.length > 30 ? 'help' : 'default' }}>{p.name}</span>
                    </Tooltip>
                    <Tooltip title={p.value.length > 60 ? p.value : undefined} placement="topLeft">
                      <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: p.value.length > 60 ? 'help' : 'default' }}>{p.value}</span>
                    </Tooltip>
                  </Fragment>
                ))}
              </div>
            </div>
          ) : entry.postData.text ? (
            (() => {
              const isJsonPayload = entry.postData.mimeType?.includes('json') || (entry.postData.text.trim().startsWith('{') || entry.postData.text.trim().startsWith('['));
              let parsedPayload: any = null;
              if (isJsonPayload) {
                try { parsedPayload = JSON.parse(entry.postData.text); } catch { /* not valid json */ }
              }
              return (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {parsedPayload ? 'JSON 已格式化' : '原始 Payload'} · {entry.postData.mimeType || '未知类型'}
                  </div>
                  {parsedPayload ? (
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, fontSize: 12.5, maxHeight: 480, overflow: 'auto' }}>
                      <JsonTree data={parsedPayload} />
                    </div>
                  ) : (
                    <pre style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                      {entry.postData.text}
                    </pre>
                  )}
                </div>
              );
            })()
          ) : (
            <Empty description="Payload 内容为空" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      ) : (
        <Empty description="该请求无 Payload" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );

  // 诊断 Tab
  const diagItem = (label: string, value: string, hint?: string) => (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      <CopyText text={value} label={label} />
    </div>
  );

  const diagnosisTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        {sectionTitle('关键字段速查')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {diagItem('Remote Address', entry.remoteAddress, '源站/边缘节点 IP')}
          {diagItem('x-tt-logid', entry.xTtLogid, '可用于后端链路排查')}
          {diagItem('x-tt-cip', entry.xTtCip, '客户端出口 IP')}
          {diagItem('x-lsc-source-ip', entry.xLscSourceIp, 'LSC 回源 IP')}
        </div>
      </div>
      <div>
        {sectionTitle('Server-Timing（CDN / 源站耗时）')}
        {entry.serverTiming.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entry.serverTiming.map((st, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{st.name}</span>
                <span style={{ display: 'flex', gap: 14 }}>
                  {st.desc && <span style={{ color: 'var(--text-secondary)' }}>{st.desc}</span>}
                  {st.dur !== undefined && (
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {st.dur} ms
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>未发现 Server-Timing 响应头</div>
        )}
      </div>
    </div>
  );

  const hasPayload = entry.queryString.length > 0 || !!entry.postData;

  const items = [
    { key: 'headers', label: 'Headers', children: headersTab },
    { key: 'preview', label: 'Preview', children: previewTab },
    ...(hasPayload ? [{ key: 'payload', label: 'Payload', children: payloadTab }] : []),
    { key: 'timing', label: 'Timing', children: timingTab },
    { key: 'diagnosis', label: '诊断', children: diagnosisTab },
  ];

  return <Tabs items={items} size="small" />;
};

export default HarRequestDetail;
