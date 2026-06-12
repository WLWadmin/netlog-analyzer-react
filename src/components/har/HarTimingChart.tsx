import { Tooltip } from 'antd';
import { HarTiming, formatHarTime } from '../../harParser';

interface HarTimingChartProps {
  timings: HarTiming;
  total: number;
}

interface PhaseInfo {
  key: keyof HarTiming;
  label: string;
  color: string;
  value: number;
}

const PHASE_DEFS: { key: keyof HarTiming; label: string; color: string }[] = [
  { key: 'blocked', label: 'Blocked（排队/阻塞）', color: '#94a3b8' },
  { key: 'dns', label: 'DNS 解析', color: '#22d3ee' },
  { key: 'connect', label: 'Connect（TCP 连接）', color: '#fbbf24' },
  { key: 'ssl', label: 'SSL/TLS 握手', color: '#fb923c' },
  { key: 'send', label: 'Send（发送请求）', color: '#a78bfa' },
  { key: 'wait', label: 'Wait（等待响应 TTFB）', color: '#5ba3f5' },
  { key: 'receive', label: 'Receive（内容下载）', color: '#4ade80' },
];

// 请求耗时瀑布图（浏览器 Network Timing 风格）
const HarTimingChart: React.FC<HarTimingChartProps> = ({ timings, total }) => {
  const phases: PhaseInfo[] = PHASE_DEFS.map(p => ({
    ...p,
    value: Math.max(0, timings[p.key] || 0),
  }));

  const sum = phases.reduce((acc, p) => acc + p.value, 0);
  const denom = sum > 0 ? sum : 1;

  // 计算每个阶段的起始位置（百分比）
  let currentOffset = 0;
  const phasePositions = phases.map(p => {
    const width = (p.value / denom) * 100;
    const pos = { left: currentOffset, width };
    currentOffset += width;
    return pos;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 总耗时标题 */}
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        总耗时{' '}
        <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 14 }}>
          {formatHarTime(total)}
        </span>
      </div>

      {/* 瀑布流条形图 */}
      <div
        style={{
          width: '100%',
          height: 32,
          borderRadius: 4,
          overflow: 'hidden',
          background: 'var(--bg-base)',
          border: '1px solid var(--border-color)',
          position: 'relative',
        }}
      >
        {phases.map((p, idx) =>
          p.value > 0 ? (
            <Tooltip
              key={p.key}
              title={`${p.label}: ${formatHarTime(p.value)} (${((p.value / denom) * 100).toFixed(1)}%)`}
            >
              <div
                style={{
                  position: 'absolute',
                  left: `${phasePositions[idx].left}%`,
                  width: `${phasePositions[idx].width}%`,
                  height: '100%',
                  background: p.color,
                  cursor: 'pointer',
                  minWidth: p.value > 0 ? 2 : 0,
                }}
              />
            </Tooltip>
          ) : null
        )}
      </div>

      {/* 阶段明细表格（浏览器 Network 风格） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* 表头 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 0',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 11,
            color: 'var(--text-muted)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          <span style={{ flex: 1 }}>阶段</span>
          <span style={{ width: 60, textAlign: 'right' }}>占比</span>
          <span style={{ width: 80, textAlign: 'right' }}>耗时</span>
        </div>

        {phases.map((p, idx) => (
          <div
            key={p.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px solid var(--border-color)',
              opacity: p.value > 0 ? 1 : 0.4,
            }}
          >
            {/* 阶段名 + 颜色块 + 迷你瀑布条 */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: p.color,
                  flexShrink: 0,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {p.label}
              </span>
              {/* 迷你瀑布条 */}
              <div
                style={{
                  flex: 1,
                  height: 6,
                  background: 'var(--bg-base)',
                  borderRadius: 3,
                  marginLeft: 8,
                  overflow: 'hidden',
                  minWidth: 40,
                }}
              >
                <div
                  style={{
                    width: `${(p.value / denom) * 100}%`,
                    height: '100%',
                    background: p.color,
                    borderRadius: 3,
                    minWidth: p.value > 0 ? 2 : 0,
                  }}
                />
              </div>
            </div>

            {/* 占比 */}
            <span
              style={{
                width: 60,
                textAlign: 'right',
                fontSize: 12,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {p.value > 0 ? ((p.value / denom) * 100).toFixed(0) + '%' : '-'}
            </span>

            {/* 耗时 */}
            <span
              style={{
                width: 80,
                textAlign: 'right',
                fontSize: 13,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
              }}
            >
              {formatHarTime(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HarTimingChart;
