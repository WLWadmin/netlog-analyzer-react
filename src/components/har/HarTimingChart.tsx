import { Tooltip } from 'antd';
import { HarRequestEntry, formatHarTime } from '../../harParser';
import { normalizeHarTiming, type HarDisplayTimingPhaseKey } from '../../diagnosis/shared/harTimingNormalization';

interface HarTimingChartProps {
  entry: HarRequestEntry;
}

interface TimingRow {
  group: string;
  key: HarDisplayTimingPhaseKey;
  label: string;
  help: string;
  color: string;
}

interface RowPosition {
  left: number;
  width: number;
}

const TIMING_ROWS: TimingRow[] = [
  { group: 'Resource Scheduling', key: 'queueing', label: 'Queueing', help: 'Chrome 记录的浏览器排队/连接槽调度', color: '#94a3b8' },
  { group: 'Connection Start', key: 'stalled', label: 'Stalled / Blocked', help: 'HAR blocked 总量中无法归入 Queueing/Proxy 的部分', color: '#64748b' },
  { group: 'Connection Start', key: 'proxy', label: 'Proxy negotiation', help: 'Chrome 记录的代理协商耗时', color: '#9ca3af' },
  { group: 'Connection Start', key: 'dns', label: 'DNS Lookup', help: '域名解析', color: '#60a5fa' },
  { group: 'Connection Start', key: 'tcp', label: 'Initial connection (TCP)', help: 'TCP 建连；当 HAR 同时有 connect 和 ssl 时，TCP = connect - ssl', color: '#fb923c' },
  { group: 'Connection Start', key: 'ssl', label: 'SSL', help: 'TLS 握手；HAR 中 ssl 已包含在 connect 内，不会重复加入总耗时', color: '#a855f7' },
  { group: 'Service Worker', key: 'service-worker-preparation', label: 'ServiceWorker Preparation', help: 'Service Worker 准备阶段，可能与标准 timing 重叠', color: '#14b8a6' },
  { group: 'Service Worker', key: 'service-worker-request', label: 'Request to ServiceWorker', help: '请求交给 Service Worker 的阶段，可能与标准 timing 重叠', color: '#0d9488' },
  { group: 'Request / Response', key: 'send', label: 'Request sent', help: '发送请求', color: '#7dd3fc' },
  { group: 'Request / Response', key: 'wait', label: 'Waiting for response', help: '从请求发送完成到响应开始的浏览器侧等待时间，不能单独确认服务端内部瓶颈', color: '#4ade80' },
  { group: 'Request / Response', key: 'receive', label: 'Content Download', help: '下载响应内容', color: '#16a34a' },
];

function buildPositions(rows: TimingRow[], timing: ReturnType<typeof normalizeHarTiming>, denom: number): Map<HarDisplayTimingPhaseKey, RowPosition> {
  const positions = new Map<HarDisplayTimingPhaseKey, RowPosition>();
  rows.forEach(row => {
    const phase = timing.phases.find(p => p.key === row.key);
    if (!phase?.available) {
      positions.set(row.key, { left: 0, width: 0 });
      return;
    }
    positions.set(row.key, {
      left: (phase.startOffsetMs / denom) * 100,
      width: (phase.durationMs / denom) * 100,
    });
  });
  return positions;
}

function groupRows(rows: TimingRow[]): { group: string; rows: TimingRow[] }[] {
  const groups: { group: string; rows: TimingRow[] }[] = [];
  rows.forEach(row => {
    const last = groups[groups.length - 1];
    if (last && last.group === row.group) {
      last.rows.push(row);
    } else {
      groups.push({ group: row.group, rows: [row] });
    }
  });
  return groups;
}

// 请求耗时瀑布图（浏览器 Network Timing 风格）
const HarTimingChart: React.FC<HarTimingChartProps> = ({ entry }) => {
  const normalized = normalizeHarTiming(entry);
  const denom = Math.max(normalized.totalMs || 0, normalized.accountedMs, 1);
  const positions = buildPositions(TIMING_ROWS, normalized, denom);
  const phaseByKey = new Map(normalized.phases.map(phase => [phase.key, phase]));
  const primary = TIMING_ROWS
    .map(row => ({ row, duration: phaseByKey.get(row.key)?.durationMs || 0 }))
    .filter(item => item.duration > 0)
    .sort((a, b) => b.duration - a.duration)[0];
  const primaryPercent = primary ? Math.round((primary.duration / denom) * 100) : 0;
  const queueing = phaseByKey.get('queueing');
  const queueingAvailable = Boolean(queueing);
  const requestSent = phaseByKey.get('send');
  const requestStartedAvailable = Boolean(requestSent?.available);
  const requestStarted = requestSent?.startOffsetMs || 0;
  const unaccounted = normalized.unaccountedMs;
  const groups = groupRows(TIMING_ROWS);

  const hasRecordedTiming = normalized.phases.some(phase => phase.available && phase.durationMs > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
          fontSize: 13,
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}
      >
        {primary ? (
          <>
            主要耗时：
            <strong style={{ color: 'var(--text-primary)' }}> {primary.row.label} {formatHarTime(primary.duration)}</strong>
            ，约占总耗时 {primaryPercent}%。
          </>
        ) : (
          '各阶段耗时较分散或 HAR 未记录阶段 timing，未发现单一阶段明显突出。'
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-muted)' }}>
        <span>Queueing <strong style={{ color: 'var(--text-primary)', fontFamily: queueingAvailable ? 'var(--font-mono)' : undefined }}>{queueingAvailable ? formatHarTime(queueing?.durationMs || 0) : '未记录'}</strong></span>
        <span>Request started <strong style={{ color: 'var(--text-primary)', fontFamily: requestStartedAvailable ? 'var(--font-mono)' : undefined }}>{requestStartedAvailable ? formatHarTime(requestStarted) : '未记录'}</strong></span>
        <span>Total <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatHarTime(normalized.totalMs)}</strong></span>
        <span>Accounted <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatHarTime(normalized.accountedMs)}</strong></span>
      </div>

      {!hasRecordedTiming ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 10 }}>
          HAR 未记录可展示的 Timing 阶段。
        </div>
      ) : (
        <div
          style={{
            overflowX: 'auto',
            paddingBottom: 4,
          }}
        >
          <div style={{ minWidth: 620 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '190px minmax(240px, 1fr) 90px',
                gap: 12,
                padding: '6px 0',
                borderBottom: '1px solid var(--border-color)',
                fontSize: 11,
                color: 'var(--text-muted)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              <span>Phase</span>
              <span>Timeline</span>
              <span style={{ textAlign: 'right' }}>Duration</span>
            </div>

            {groups.map(group => (
              <div key={group.group}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, margin: '14px 0 4px' }}>
                  {group.group}
                </div>
                {group.rows.map(row => {
                  const phase = phaseByKey.get(row.key);
                  const available = Boolean(phase?.available);
                  const duration = phase?.durationMs || 0;
                  const pos = positions.get(row.key) || { left: 0, width: 0 };
                  const shouldMarker = duration > 0 && pos.width < 1;
                  const width = shouldMarker ? 3 : `${pos.width}%`;
                  return (
                    <div
                      key={row.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '190px minmax(240px, 1fr) 90px',
                        gap: 12,
                        alignItems: 'center',
                        padding: '7px 0',
                        opacity: available ? 1 : 0.5,
                      }}
                    >
                      <Tooltip title={row.help}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {row.label}
                        </span>
                      </Tooltip>
                      <div
                        style={{
                          height: 16,
                          background: 'var(--bg-base)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 8,
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        {available && duration > 0 && (
                          <Tooltip title={`${row.label}: ${formatHarTime(duration)} (${((duration / denom) * 100).toFixed(1)}%)`}>
                            <div
                              style={{
                                position: 'absolute',
                                left: `${pos.left}%`,
                                width,
                                height: '100%',
                                background: row.color,
                                borderRadius: 8,
                                cursor: 'pointer',
                              }}
                            />
                          </Tooltip>
                        )}
                      </div>
                      <span
                        style={{
                          textAlign: 'right',
                          fontSize: 13,
                          color: available ? 'var(--text-primary)' : 'var(--text-muted)',
                          fontFamily: available ? 'var(--font-mono)' : undefined,
                          fontWeight: duration > 0 ? 600 : 400,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {available ? formatHarTime(duration) : '未记录'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {unaccounted > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          说明：仍有
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}> {formatHarTime(unaccounted)} </span>
          耗时未在已记录阶段中拆分，图表按总耗时口径保留空白。
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        如果响应头包含 Server-Timing，下方 Server-Timing 区域可辅助后端定位服务端内部耗时；它不会和浏览器侧 Timing 合并到同一张图。
      </div>
    </div>
  );
};

export default HarTimingChart;
