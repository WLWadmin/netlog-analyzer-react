import { Tooltip } from 'antd';
import { HarTiming, HarTimingPhaseKey, formatHarTime } from '../../harParser';
import { CHART_COLORS } from '../../constants/chartColors';

interface HarTimingChartProps {
  timings: HarTiming;
  total: number;
  timingAvailability?: Partial<Record<HarTimingPhaseKey, boolean>>;
}

interface TimingRow {
  group: string;
  key: HarTimingPhaseKey;
  label: string;
  help: string;
  color: string;
}

interface RowPosition {
  left: number;
  width: number;
}

const TIMING_ROWS: TimingRow[] = [
  { group: 'Resource Scheduling', key: 'blocked', label: 'Queueing', help: '浏览器排队/等待连接槽/代理调度', color: '#94a3b8' },
  { group: 'Connection Start', key: 'dns', label: 'DNS Lookup', help: '域名解析', color: CHART_COLORS.phases.dns },
  { group: 'Connection Start', key: 'connect', label: 'Initial connection', help: 'TCP 建连', color: CHART_COLORS.phases.connect },
  { group: 'Connection Start', key: 'ssl', label: 'SSL', help: 'TLS 握手', color: CHART_COLORS.phases.ssl },
  { group: 'Request / Response', key: 'send', label: 'Request sent', help: '发送请求', color: CHART_COLORS.phases.send },
  { group: 'Request / Response', key: 'wait', label: 'Waiting for server response', help: '等待服务端首字节响应，TTFB', color: CHART_COLORS.phases.wait },
  { group: 'Request / Response', key: 'receive', label: 'Content Download', help: '下载响应内容', color: CHART_COLORS.phases.download },
];

function isTimingAvailable(key: HarTimingPhaseKey, timingAvailability?: Partial<Record<HarTimingPhaseKey, boolean>>): boolean {
  return timingAvailability?.[key] !== false;
}

function getRecordedDuration(row: TimingRow, timings: HarTiming, timingAvailability?: Partial<Record<HarTimingPhaseKey, boolean>>): number {
  if (!isTimingAvailable(row.key, timingAvailability)) return 0;
  return Math.max(0, timings[row.key] || 0);
}

function buildPositions(rows: TimingRow[], timings: HarTiming, timingAvailability: HarTimingChartProps['timingAvailability'], denom: number): Map<HarTimingPhaseKey, RowPosition> {
  const positions = new Map<HarTimingPhaseKey, RowPosition>();
  let currentOffset = 0;
  rows.forEach(row => {
    if (!isTimingAvailable(row.key, timingAvailability)) {
      positions.set(row.key, { left: 0, width: 0 });
      return;
    }
    const duration = getRecordedDuration(row, timings, timingAvailability);
    positions.set(row.key, {
      left: (currentOffset / denom) * 100,
      width: (duration / denom) * 100,
    });
    currentOffset += duration;
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
const HarTimingChart: React.FC<HarTimingChartProps> = ({ timings, total, timingAvailability }) => {
  const recordedSum = TIMING_ROWS.reduce((sum, row) => sum + getRecordedDuration(row, timings, timingAvailability), 0);
  const denom = Math.max(total || 0, recordedSum, 1);
  const positions = buildPositions(TIMING_ROWS, timings, timingAvailability, denom);
  const primary = TIMING_ROWS
    .map(row => ({ row, duration: getRecordedDuration(row, timings, timingAvailability) }))
    .filter(item => item.duration > 0)
    .sort((a, b) => b.duration - a.duration)[0];
  const primaryPercent = primary ? Math.round((primary.duration / denom) * 100) : 0;
  const requestStarted = getRecordedDuration(TIMING_ROWS[0], timings, timingAvailability);
  const queueingAvailable = isTimingAvailable('blocked', timingAvailability);
  const unaccounted = Math.max(0, total - recordedSum);
  const groups = groupRows(TIMING_ROWS);

  const hasRecordedTiming = recordedSum > 0;

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
        <span>Queueing <strong style={{ color: 'var(--text-primary)', fontFamily: queueingAvailable ? 'var(--font-mono)' : undefined }}>{queueingAvailable ? formatHarTime(timings.blocked || 0) : '未记录'}</strong></span>
        <span>Request started <strong style={{ color: 'var(--text-primary)', fontFamily: queueingAvailable ? 'var(--font-mono)' : undefined }}>{queueingAvailable ? formatHarTime(requestStarted) : '未记录'}</strong></span>
        <span>Total <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatHarTime(total)}</strong></span>
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
                  const available = isTimingAvailable(row.key, timingAvailability);
                  const duration = getRecordedDuration(row, timings, timingAvailability);
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
