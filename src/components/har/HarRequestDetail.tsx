import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Tabs, Tag, Tooltip, Button, message } from 'antd';
import { CopyOutlined, FileTextOutlined, InboxOutlined } from '@ant-design/icons';
import {
  HarRequestEntry,
  HarCookie,
  statusStyle,
  formatBytes,
} from '../../harParser';
import CopyText from './CopyText';
import HarTimingChart from './HarTimingChart';
import { getHarRequestIssue, type HarRequestIssue } from '../../diagnosis/shared/harRequestIssue';
import { buildHarRedirectLinks } from '../../diagnosis/shared/harRedirectChain';
import { copyText } from '../../utils/copyText';
import { buildHarRequestCopyText, sanitizeHarUrl } from './buildHarRequestCopyText';
import HarCodeViewer from './HarCodeViewer';
import { loadHarResponseBody, type HarResponseBodySource } from './harResponseBodyGateway';
import { decodeHarResponseBody, sanitizeHarHtmlForPreview, type DecodedHarBody } from './decodeHarResponseBody';
import type { HarResponseBodyPayload } from '../../workers/protocols';
import { buildHarIssueClusters, getHarEvidenceLevelLabel, getHarRoleLabel } from '../../diagnosis/shared/harIssueClusters';
import { buildHarClusterCopyText } from './buildHarClusterCopyText';
import {
  buildHarRequestEvidenceConclusion,
  getHarRequestAnomalyHints,
  type HarRequestAnomalyHint,
} from '../../diagnosis/shared/harRequestEvidence';

interface HarRequestDetailProps {
  entry: HarRequestEntry;
  allEntries?: HarRequestEntry[];
  bodySource?: HarResponseBodySource;
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

const ANOMALY_STATE_LABELS: Record<HarRequestAnomalyHint['state'], string> = {
  anomaly: '超过参考阈值',
  'within-reference': '未超过参考阈值',
  'not-applicable': '不适用（HAR 记录为 -1）',
  missing: '字段缺失',
  invalid: '字段值无效',
};

const EVIDENCE_LEVEL_LABELS: Record<HarRequestAnomalyHint['evidenceLevel'], string> = {
  'anomaly-hint': '异常提示',
  'needs-evidence': '需要补证',
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
    <Tooltip title={text} placement="topLeft" styles={{ root: tooltipOverlayStyle, container: tooltipInnerStyle }}>
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

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>{text}</div>
);

const JsonTree: React.FC<{ data: any; depth?: number }> = ({ data, depth = 0 }) => {
  if (data === null) return <span style={{ color: 'var(--text-muted)' }}>null</span>;
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

const ROLE_HINT_LABELS: Record<NonNullable<HarRequestIssue['roleHint']>, string> = {
  user: '用户先看',
  it: 'IT / 网络管理员先看',
  frontend: '前端先看',
  backend: '后端先看',
};

function maskCookieValue(value?: string): string {
  if (value === undefined) return '-';
  if (!value) return '(empty)';
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

const CookieList: React.FC<{ title: string; cookies?: HarCookie[] }> = ({ title, cookies = [] }) => {
  const [visibleValues, setVisibleValues] = useState<Set<number>>(new Set());
  if (!cookies.length) return null;

  return (
    <div>
      {sectionTitle(title)}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cookies.map((cookie, index) => {
          const isVisible = visibleValues.has(index);
          return (
            <div
              key={`${cookie.name}-${index}`}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr) auto', gap: 10, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{cookie.name}</span>
                {isVisible ? (
                  <CopyText text={cookie.value ?? ''} label={`${cookie.name} Cookie value`} emptyText="(empty)" />
                ) : (
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                    {maskCookieValue(cookie.value)}
                  </span>
                )}
                <Button
                  size="small"
                  type="text"
                  onClick={() => setVisibleValues(current => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })}
                >
                  {isVisible ? '隐藏' : '显示完整值'}
                </Button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {cookie.domain && <Tag>{cookie.domain}</Tag>}
                {cookie.path && <Tag>{cookie.path}</Tag>}
                {cookie.httpOnly && <Tag color="blue">HttpOnly</Tag>}
                {cookie.secure && <Tag color="green">Secure</Tag>}
                {cookie.sameSite && <Tag color="purple">SameSite={cookie.sameSite}</Tag>}
                {cookie.expires && <Tag>Expires={cookie.expires}</Tag>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function issueTagColor(severity: HarRequestIssue['severity']): string {
  switch (severity) {
    case 'critical': return '#b91c1c';
    case 'warning': return '#c2410c';
    case 'info': return '#0e7490';
    case 'normal': return '#15803d';
  }
}

const AUTO_LOAD_BODY_LIMIT = 4 * 1024 * 1024;
const EMPTY_BODY_SOURCE: HarResponseBodySource = {};

function initialBodyPayload(entry: HarRequestEntry): HarResponseBodyPayload | null {
  if (!entry.responseBody) return null;
  return {
    state: 'available',
    text: entry.responseBody,
    encoding: entry.responseEncoding || entry.responseBodyDescriptor?.encoding || '',
    mimeType: entry.mimeType || entry.responseBodyDescriptor?.mimeType || '',
    originalLength: entry.responseBodyDescriptor?.originalLength || entry.responseBody.length,
  };
}

const HarRequestDetail: React.FC<HarRequestDetailProps> = ({ entry, allEntries = [entry], bodySource = EMPTY_BODY_SOURCE }) => {
  const [showAllInitiatorFrames, setShowAllInitiatorFrames] = useState(false);
  const [bodyPayload, setBodyPayload] = useState<HarResponseBodyPayload | null>(() => initialBodyPayload(entry));
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const bodyRequestVersion = useRef(0);
  const issue = useMemo(() => getHarRequestIssue(entry), [entry]);
  const evidenceConclusion = useMemo(
    () => buildHarRequestEvidenceConclusion(entry),
    [entry],
  );
  const anomalyHints = useMemo(() => getHarRequestAnomalyHints(entry), [entry]);
  const responseStatus = entry.standard.response.status;
  const recordedStatus = responseStatus.state === 'value' ? responseStatus.value : undefined;
  const statusLabel = responseStatus.state === 'missing'
    ? '未记录'
    : responseStatus.state === 'invalid'
      ? '无效值'
      : responseStatus.state === 'not-available'
        ? '不适用'
        : responseStatus.value === 0
          ? '失败/未完成'
          : String(responseStatus.value);
  const recordedStatusStyle = recordedStatus === undefined
    ? { color: 'var(--text-secondary)', bg: 'var(--bg-surface)' }
    : statusStyle(recordedStatus);
  const issueClusters = useMemo(() => buildHarIssueClusters(allEntries), [allEntries]);
  const issueCluster = useMemo(
    () => issueClusters.find(cluster => cluster.affectedRequestIds.includes(entry.id)),
    [issueClusters, entry.id]
  );
  const redirectLinks = useMemo(() => buildHarRedirectLinks(allEntries), [allEntries]);
  const outgoingRedirect = useMemo(() => redirectLinks.find(link => link.fromRequestId === entry.id), [redirectLinks, entry.id]);
  const incomingRedirect = useMemo(() => redirectLinks.find(link => link.toRequestId === entry.id), [redirectLinks, entry.id]);
  const safeSummary = useMemo(() => buildHarRequestCopyText(entry), [entry]);
  const loadBody = useMemo(() => {
    return async () => {
      const requestVersion = ++bodyRequestVersion.current;
      setBodyLoading(true);
      setBodyError(null);
      try {
        const payload = await loadHarResponseBody(bodySource, entry);
        if (bodyRequestVersion.current === requestVersion) setBodyPayload(payload);
      } catch (error) {
        if (bodyRequestVersion.current === requestVersion) {
          setBodyError(error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '<URL>') : '响应体读取失败');
        }
      } finally {
        if (bodyRequestVersion.current === requestVersion) setBodyLoading(false);
      }
    };
  }, [bodySource, entry]);
  useEffect(() => {
    let cancelled = false;
    const requestVersion = ++bodyRequestVersion.current;
    setBodyPayload(initialBodyPayload(entry));
    setBodyError(null);
    setBodyLoading(false);
    if (entry.responseBody) return () => { cancelled = true; };

    const shouldAutoLoad = entry.responseBodyDescriptor?.state === 'inline'
      || entry.responseBodyDescriptor?.state === 'absent'
      || (entry.responseBodyDescriptor?.state === 'deferred' && (entry.responseBodyDescriptor.originalLength || 0) <= AUTO_LOAD_BODY_LIMIT);
    if (!shouldAutoLoad) return () => { cancelled = true; };

    setBodyLoading(true);
    loadHarResponseBody(bodySource, entry)
      .then(payload => {
        if (!cancelled && bodyRequestVersion.current === requestVersion) setBodyPayload(payload);
      })
      .catch(error => {
        if (!cancelled && bodyRequestVersion.current === requestVersion) {
          setBodyError(error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '<URL>') : '响应体读取失败');
        }
      })
      .finally(() => {
        if (!cancelled && bodyRequestVersion.current === requestVersion) setBodyLoading(false);
      });
    return () => { cancelled = true; };
  }, [bodySource, entry]);
  const decoded: DecodedHarBody | null = useMemo(
    () => bodyPayload?.state === 'available' ? decodeHarResponseBody(bodyPayload) : null,
    [bodyPayload]
  );

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
              color: recordedStatusStyle.color,
              background: recordedStatusStyle.bg,
              border: 'none',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {statusLabel} {entry.statusText}
          </Tag>
        </GeneralRow>
        <GeneralRow label="主问题">
          <Tag
            style={{
              color: issueTagColor(issue.severity),
              background: 'var(--bg-surface)',
              border: `1px solid ${issueTagColor(issue.severity)}40`,
              fontWeight: 700,
            }}
          >
            {issue.label}
          </Tag>
        </GeneralRow>
        {issue.kind !== 'normal' && (
          <GeneralRow label="失败原因">
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {issue.kind === 'status-zero'
                ? '浏览器没有取得 HTTP 响应，不是服务端返回状态码 0。'
                : issue.kind === 'net-error' && entry.netErrorText
                  ? `${entry.netErrorText}：${issue.detail}`
                  : issue.kind === 'blocked' && entry.blockedReason
                    ? `浏览器或安全策略记录了阻止原因：${entry.blockedReason}。`
                    : issue.detail}
            </span>
          </GeneralRow>
        )}
        {issue.kind !== 'normal' && (
          <GeneralRow label="处理建议">
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {issue.roleHint ? `${ROLE_HINT_LABELS[issue.roleHint]}：` : ''}
              {issue.detail}
            </span>
          </GeneralRow>
        )}
        <GeneralRow label="Remote Address">
          <CopyText text={entry.remoteAddress} label="Remote Address" />
        </GeneralRow>
        <GeneralRow label="Protocol">
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{entry.protocol}</span>
        </GeneralRow>
        <GeneralRow label="Priority">
          <span style={{ fontFamily: 'var(--font-mono)', color: entry.priority ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {entry.priority || 'HAR 未记录'}
          </span>
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

  const bodyPlaceholder = bodyLoading ? (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <FileTextOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>正在读取响应内容...</div>
    </div>
  ) : bodyError ? (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <FileTextOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>响应内容读取失败</div>
      <div style={{ fontSize: 12, color: 'var(--text-disabled)', lineHeight: 1.7 }}>{bodyError}</div>
      <Button size="small" style={{ marginTop: 12 }} onClick={loadBody}>重新读取</Button>
    </div>
  ) : entry.responseBodyDescriptor?.state === 'deferred' ? (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <FileTextOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>大型响应体未进入初始结果</div>
      <div style={{ fontSize: 12, color: 'var(--text-disabled)', lineHeight: 1.7 }}>
        可按需从本地 HAR 读取。原始长度约 {formatBytes(entry.responseBodyDescriptor.originalLength)}。
      </div>
      <Button size="small" type="primary" style={{ marginTop: 12 }} onClick={loadBody}>加载响应内容</Button>
    </div>
  ) : (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <FileTextOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>该请求未捕获响应体</div>
      <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>可能是 OPTIONS 预检请求或响应被拦截</div>
    </div>
  );

  const binaryBodyPlaceholder = decoded?.isBinary ? (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <FileTextOutlined style={{ fontSize: 40, color: 'var(--text-disabled)', display: 'block', marginBottom: 12 }} />
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>该响应为二进制内容，无法按文本预览</div>
      <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>
        {decoded.mimeType || '未知 MIME'}{decoded.bytes ? ` · 解码后 ${formatBytes(decoded.bytes.byteLength)}` : ''}
      </div>
    </div>
  ) : null;

  // Preview Tab
  const previewTab = decoded?.isImage && decoded.dataUrl ? (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        图片预览 · {entry.mimeType || '未知类型'} · {formatBytes(entry.contentSize)}
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 16, textAlign: 'center', maxHeight: 520, overflow: 'auto' }}>
        <img
          src={decoded.dataUrl}
          alt={entry.name}
          style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4, objectFit: 'contain' }}
        />
      </div>
    </div>
  ) : decoded?.isMedia && decoded.dataUrl ? (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        媒体预览 · {entry.mimeType || '未知类型'} · {formatBytes(entry.contentSize)}
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
        <video
          src={decoded.dataUrl}
          controls
          style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4 }}
        />
      </div>
    </div>
  ) : decoded?.text ? (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {decoded.isJson ? 'JSON 已格式化' : decoded.mimeType.toLowerCase().includes('html') ? '安全 HTML 预览' : '响应预览'} · {entry.mimeType || '未知类型'}
        {decoded.decodeError ? ` · ${decoded.decodeError}` : ''}
      </div>
      {decoded.isJson && decoded.parsed ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, fontSize: 12.5, maxHeight: 480, overflow: 'auto' }}>
          <JsonTree data={decoded.parsed} />
        </div>
      ) : decoded.mimeType.toLowerCase().includes('html') ? (
        <iframe
          title="安全 HTML 预览"
          sandbox=""
          srcDoc={sanitizeHarHtmlForPreview(decoded.text)}
          style={{ width: '100%', minHeight: 520, border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff' }}
        />
      ) : (
        <HarCodeViewer
          source={decoded.text}
          mimeType={entry.mimeType}
          rawType={entry.rawType}
          url={entry.url}
          maxHeight={520}
        />
      )}
    </div>
  ) : binaryBodyPlaceholder || bodyPlaceholder;

  const responseTab = decoded?.text ? (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        解码后的原始响应内容 · {entry.mimeType || '未知类型'}
        {bodyPayload?.encoding ? ` · encoding=${bodyPayload.encoding}` : ''}
        {decoded.decodeError ? ` · ${decoded.decodeError}` : ''}
      </div>
      <HarCodeViewer
        source={decoded.text}
        mimeType={entry.mimeType}
        rawType={entry.rawType}
        url={entry.url}
        format={false}
        maxHeight={520}
        truncateLines={false}
        showLineNumbers={false}
      />
    </div>
  ) : binaryBodyPlaceholder || bodyPlaceholder;

  // Timing Tab
  const timingTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {entry.isFailed && (
        <div
          style={{
            padding: '10px 12px',
            background: 'rgba(251, 146, 60, 0.08)',
            border: '1px solid rgba(251, 146, 60, 0.25)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          该请求未拿到完整 HTTP 响应，Timing 只能说明失败前浏览器记录到的阶段耗时。若要确认 DNS、TLS、代理或系统网络栈原因，建议补充 NetLog。
        </div>
      )}
      <HarTimingChart entry={entry} />
    </div>
  );

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
                    <TruncatedText text={p.value ?? '-'} threshold={80} style={{ color: 'var(--text-primary)' }} />
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

  const initiatorFrames = entry.initiator?.stack || [];
  const visibleInitiatorFrames = showAllInitiatorFrames ? initiatorFrames : initiatorFrames.slice(0, 5);

  const initiatorTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        {sectionTitle('Initiator')}
        {entry.initiator ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <GeneralRow label="Type">
              <span style={{ fontFamily: 'var(--font-mono)' }}>{entry.initiator.type || '-'}</span>
            </GeneralRow>
            <GeneralRow label="URL">
              {entry.initiator.url
                ? <CopyText text={sanitizeHarUrl(entry.initiator.url)} label="Initiator URL（脱敏）" />
                : <span style={{ color: 'var(--text-muted)' }}>HAR 未记录</span>}
            </GeneralRow>
            <GeneralRow label="Line / Column">
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {entry.initiator.lineNumber ?? '-'} / {entry.initiator.columnNumber ?? '-'}
              </span>
            </GeneralRow>
            {visibleInitiatorFrames.length ? (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 12 }}>
                {visibleInitiatorFrames.map((frame, index) => (
                  <div key={index} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginBottom: 6 }}>
                    {frame.functionName || '(anonymous)'} · {frame.url ? sanitizeHarUrl(frame.url) : '-'}:{frame.lineNumber ?? '-'}:{frame.columnNumber ?? '-'}
                  </div>
                ))}
                {initiatorFrames.length > 5 && (
                  <Button size="small" type="link" onClick={() => setShowAllInitiatorFrames(value => !value)} style={{ paddingInline: 0 }}>
                    {showAllInitiatorFrames ? '收起调用栈' : `展开其余 ${initiatorFrames.length - 5} 条`}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState text="HAR 未提供 Initiator 信息。" />
        )}
      </div>
    </div>
  );

  const cookiesTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <CookieList title="Request Cookies" cookies={entry.requestCookies} />
      <CookieList title="Response Cookies" cookies={entry.responseCookies} />
      {!entry.requestCookies?.length && !entry.responseCookies?.length && (
        <div>
          {sectionTitle('Cookies')}
          <EmptyState text="HAR 未提供结构化 Cookie 字段。" />
        </div>
      )}
    </div>
  );

  const cacheRows: Array<{ label: string; value: string }> = entry.cacheInfo ? [
    { label: 'Cache-Control', value: entry.cacheInfo.cacheControl || '' },
    { label: 'ETag', value: entry.cacheInfo.etag || '' },
    { label: 'Age', value: entry.cacheInfo.age || '' },
    { label: 'Expires', value: entry.cacheInfo.expires || '' },
    { label: 'Last-Modified', value: entry.cacheInfo.lastModified || '' },
    { label: 'Disk Cache', value: entry.cacheInfo.fromDiskCache === undefined ? '' : entry.cacheInfo.fromDiskCache ? '是' : '否' },
    { label: 'Memory Cache', value: entry.cacheInfo.fromMemoryCache === undefined ? '' : entry.cacheInfo.fromMemoryCache ? '是' : '否' },
    { label: 'Service Worker', value: entry.cacheInfo.fromServiceWorker === undefined ? '' : entry.cacheInfo.fromServiceWorker ? '是' : '否' },
    { label: 'Prefetch Cache', value: entry.cacheInfo.fromPrefetchCache === undefined ? '' : entry.cacheInfo.fromPrefetchCache ? '是' : '否' },
    { label: '浏览器缓存命中标记', value: entry.cacheInfo.fromCache ? '是' : '' },
    { label: '协商缓存', value: entry.cacheInfo.status304 ? '返回 304 Not Modified' : '' },
  ].filter(row => row.value !== '') : [];

  const networkTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        {sectionTitle('安全请求摘要')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            默认摘要会移除 query/hash，不包含请求体、Cookie、Authorization 或完整 Header。
          </div>
          <Button
            size="small"
            icon={<CopyOutlined />}
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              try {
                await copyText(safeSummary);
                message.success('已复制安全请求摘要');
              } catch {
                message.error('复制失败，请手动复制');
              }
            }}
          >
            复制请求摘要
          </Button>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {safeSummary}
          </pre>
        </div>
      </div>

      <div>
        {sectionTitle('Redirect')}
        {entry.redirect || outgoingRedirect || incomingRedirect ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entry.redirect?.status !== undefined && (
              <GeneralRow label="Status">
                <span style={{ fontFamily: 'var(--font-mono)' }}>{entry.redirect.status}</span>
              </GeneralRow>
            )}
            {entry.redirect?.redirectURL && (
              <GeneralRow label="redirectURL">
                <CopyText text={entry.redirect.redirectURL} label="redirectURL" />
              </GeneralRow>
            )}
            {entry.redirect?.location && (
              <GeneralRow label="Location">
                <CopyText text={entry.redirect.location} label="Location" />
              </GeneralRow>
            )}
            {outgoingRedirect && (
              <GeneralRow label="疑似下一跳">
                <span style={{ color: 'var(--text-secondary)' }}>
                  请求 #{outgoingRedirect.toRequestId} · {outgoingRedirect.targetUrl} · 基于显式目标匹配
                </span>
              </GeneralRow>
            )}
            {incomingRedirect && (
              <GeneralRow label="疑似来源">
                <span style={{ color: 'var(--text-secondary)' }}>
                  请求 #{incomingRedirect.fromRequestId} · 基于显式目标匹配
                </span>
              </GeneralRow>
            )}
          </div>
        ) : (
          <EmptyState text="未发现 Redirect 原始证据。" />
        )}
      </div>

      <div>
        {sectionTitle('Cache')}
        {cacheRows.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cacheRows.map(row => (
              <GeneralRow key={row.label} label={row.label}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{row.value}</span>
              </GeneralRow>
            ))}
          </div>
        ) : (
          <EmptyState text="未发现 cache header 或浏览器缓存命中线索。" />
        )}
      </div>

      <div>
        {sectionTitle('Connection')}
        {entry.connectionInfo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <GeneralRow label="Connection ID">
              <span style={{ fontFamily: 'var(--font-mono)' }}>{entry.connectionInfo.connectionId || '-'}</span>
            </GeneralRow>
            <GeneralRow label="Remote Address">
              <span style={{ fontFamily: 'var(--font-mono)' }}>{entry.connectionInfo.remoteAddress || entry.remoteAddress || '-'}</span>
            </GeneralRow>
            <GeneralRow label="Protocol">
              <span style={{ fontFamily: 'var(--font-mono)' }}>{entry.connectionInfo.protocol || entry.protocol || '-'}</span>
            </GeneralRow>
          </div>
        ) : (
          <EmptyState text="HAR 未提供连接聚合信息。" />
        )}
      </div>
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
      {issueCluster && (
        <div>
          {sectionTitle('所属问题组')}
          <div
            style={{
              padding: '12px 14px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{issueCluster.title}</strong>
              <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(buildHarClusterCopyText(issueCluster))}>复制问题组摘要</Button>
            </div>
            <div>证据等级：{getHarEvidenceLevelLabel(issueCluster.evidenceLevel)} · 同组 {issueCluster.affectedRequestCount} 个请求 · {issueCluster.affectedDomainCount} 个域名</div>
            <div>归组依据：{issueCluster.groupingReason}</div>
            <div>当前请求{issueCluster.representativeRequestIds.includes(entry.id) ? '是' : '不是'}代表请求；代表请求：{issueCluster.representativeRequestIds.map(id => `#${id + 1}`).join('、')}</div>
            <div>建议先看：{issueCluster.roleHints.map(getHarRoleLabel).join(' / ')}。这是优先排查方向，不代表确定责任归属。</div>
            {issueCluster.requiresNetLog && <div>需要补证：建议补充同次 NetLog，以确认底层网络栈原因。</div>}
          </div>
        </div>
      )}
      <div>
        {sectionTitle('证据结论')}
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <div>{evidenceConclusion.summary}</div>
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border-color)' }}>
            {anomalyHints.map(hint => (
              <div
                key={hint.key}
                style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}
              >
                <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {hint.label}：{ANOMALY_STATE_LABELS[hint.state]}
                </div>
                <div>
                  实际值：{hint.actualValue === undefined ? '—' : `${hint.actualValue} ${hint.unit}`}
                  {' · '}参考阈值：{hint.thresholdValue} {hint.unit}
                  {' · '}证据等级：{EVIDENCE_LEVEL_LABELS[hint.evidenceLevel]}
                </div>
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {hint.sourcePath}
                </div>
                <div>建议补充：{hint.supplement}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border-color)' }}>
            {evidenceConclusion.facts.map(fact => (
              <div
                key={`${fact.label}:${fact.sourcePath}`}
                style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}
              >
                <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fact.label}</div>
                <div>{fact.detail}</div>
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {fact.sourcePath}
                </div>
              </div>
            ))}
          </div>
          {evidenceConclusion.requiredEvidence.map(item => (
            <div key={item}>需要补证：{item}</div>
          ))}
        </div>
      </div>
      <div>
        {sectionTitle('关键字段速查')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {diagItem('Remote Address', entry.remoteAddress, '浏览器记录的远端连接地址，不代表源站或故障节点归属')}
          {diagItem('x-tt-logid', entry.xTtLogid, '可用于后端链路排查')}
          {diagItem('x-tt-cip', entry.xTtCip, '客户端出口 IP')}
          {diagItem('x-lsc-source-ip', entry.xLscSourceIp, 'LSC 回源 IP')}
        </div>
      </div>
      <div>
        {sectionTitle('Server-Timing（服务端自报指标）')}
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
          服务端通过响应头提供的自报指标，需与同次服务端日志交叉核验。
        </div>
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
      {issue.roleHint && issue.kind !== 'normal' && (
        <div>
          {sectionTitle('排查转交建议')}
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>{ROLE_HINT_LABELS[issue.roleHint]}</strong>
            ：这是优先排查方向，不代表确定责任归属。{issue.detail}
          </div>
        </div>
      )}
    </div>
  );

  const hasPayload = entry.queryString.length > 0 || !!entry.postData;

  const items = [
    { key: 'headers', label: 'Headers', children: headersTab },
    ...(hasPayload ? [{ key: 'payload', label: 'Payload', children: payloadTab }] : []),
    { key: 'preview', label: 'Preview', children: previewTab },
    { key: 'response', label: 'Response', children: responseTab },
    { key: 'initiator', label: 'Initiator', children: initiatorTab },
    { key: 'timing', label: 'Timing', children: timingTab },
    { key: 'cookies', label: 'Cookies', children: cookiesTab },
    { key: 'network', label: 'Network', children: networkTab },
    { key: 'diagnosis', label: '诊断', children: diagnosisTab },
  ];

  return <Tabs items={items} size="small" />;
};

export default HarRequestDetail;
