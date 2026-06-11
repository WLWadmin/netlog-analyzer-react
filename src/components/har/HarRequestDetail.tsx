import { useMemo } from 'react';
import { Tabs, Empty, Tag } from 'antd';
import {
  HarRequestEntry,
  decodeResponseBody,
  statusColor,
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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {headers.map((h, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 12,
            padding: '6px 0',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 13,
          }}
        >
          <span style={{ color: 'var(--text-muted)', minWidth: 200, maxWidth: 240, wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
            {h.name}
          </span>
          <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all', flex: 1, fontFamily: 'var(--font-mono)' }}>
            {h.value}
          </span>
        </div>
      ))}
    </div>
  );
};

const GeneralRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: 13 }}>
    <span style={{ color: 'var(--text-muted)', minWidth: 120, flexShrink: 0 }}>{label}</span>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
);

const HarRequestDetail: React.FC<HarRequestDetailProps> = ({ entry }) => {
  const decoded = useMemo(() => decodeResponseBody(entry), [entry]);

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
          <Tag color={statusColor(entry.status)} style={{ color: '#fff' }}>
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
      <div>
        {sectionTitle('Response Headers')}
        <HeaderList headers={entry.responseHeaders} />
      </div>
      <div>
        {sectionTitle('Request Headers')}
        <HeaderList headers={entry.requestHeaders} />
      </div>
    </div>
  );

  // Preview Tab
  const previewTab = decoded.text ? (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {decoded.isJson ? 'JSON 已格式化' : '原始响应体'} · {entry.mimeType || '未知类型'}
      </div>
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
    </div>
  ) : (
    <Empty description="该请求未捕获响应体" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  );

  // Timing Tab
  const timingTab = <HarTimingChart timings={entry.timings} total={entry.time} />;

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

  const items = [
    { key: 'headers', label: 'Headers', children: headersTab },
    { key: 'preview', label: 'Preview', children: previewTab },
    { key: 'timing', label: 'Timing', children: timingTab },
    { key: 'diagnosis', label: '诊断', children: diagnosisTab },
  ];

  return <Tabs items={items} size="small" />;
};

export default HarRequestDetail;
