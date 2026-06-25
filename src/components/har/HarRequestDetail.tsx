import { useMemo, Fragment } from 'react';
import { Tabs, Tag, Tooltip } from 'antd';
import { FileTextOutlined, InboxOutlined } from '@ant-design/icons';
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

const tooltipOverlayStyle = { maxWidth: 1000 };
const tooltipInnerStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  padding: '10px 14px',
  borderRadius: 8,
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  wordBreak: 'break-all' as const,
  lineHeight: 1.5,
};

const TruncatedText: React.FC<{ text: string; threshold?: number; style?: React.CSSProperties }> = ({ text, threshold = 100, style }) => {
  const shouldTooltip = text.length > threshold;
  const span = (
    <span
      style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'block',
        ...style,
      }}
    >
      {text}
    </span>
  );
  if (!shouldTooltip) return span;
  return (
    <Tooltip title={text} placement="topLeft" overlayStyle={tooltipOverlayStyle} overlayInnerStyle={tooltipInnerStyle}>
      {span}
    </Tooltip>
  );
};

const HeaderList: React.FC<{ headers: { name: string; value: string }[] }> = ({ headers }) => {
  if (!headers.length) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>无</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', fontSize: 13 }}>
      {headers.map((h, i) => (
        <Fragment key={i}>
          <div style={{ padding: '6px 16px 6px 0', borderBottom: '1px solid var(--border-color)' }}>
            <TruncatedText
              text={h.name}
              threshold={50}
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
            <TruncatedText
              text={h.value}
              threshold={80}
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            />
          </div>
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
                    <TruncatedText
                      text={h.value}
                      threshold={80}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}
                    />
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
  ) : entry.responseBodyOmitted ? (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <FileTextOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>大型响应体已省略</div>
      <div style={{ fontSize: 12, color: 'var(--text-disabled)', lineHeight: 1.7 }}>
        {entry.responseBodyOmitReason || '为降低大 HAR 文件的浏览器内存占用，已保留 headers、timing 和核心诊断字段，但未保留完整 body。'}
        {entry.responseBodyOriginalLength ? ` 原始长度约 ${formatBytes(entry.responseBodyOriginalLength)}。` : ''}
      </div>
    </div>
  ) : (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <FileTextOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>该请求未捕获响应体</div>
      <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>可能是OPTIONS预检请求或响应被拦截</div>
    </div>
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
                  <TruncatedText text={q.name} threshold={50} style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} />
                  <TruncatedText text={q.value} threshold={80} style={{ color: 'var(--text-primary)' }} />
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
                    <TruncatedText text={p.name} threshold={50} style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} />
                    <TruncatedText text={p.value} threshold={80} style={{ color: 'var(--text-primary)' }} />
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
            <div style={{ textAlign: 'center', padding: '48px 24px' }}>
              <InboxOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>Payload 内容为空</div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <InboxOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>该请求无 Payload</div>
          <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>GET请求通常不携带请求体</div>
        </div>
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
