import { HarTiming, formatHarTime } from '../../harParser';

interface HarTimingChartProps {
  timings: HarTiming;
  total: number;
}

const PHASES: { key: keyof HarTiming; label: string; color: string }[] = [
  { key: 'blocked', label: 'Blocked（排队/阻塞）', color: '#94a3b8' },
  { key: 'dns', label: 'DNS 解析', color: '#22d3ee' },
  { key: 'connect', label: 'Connect（TCP 连接）', color: '#fbbf24' },
  { key: 'ssl', label: 'SSL/TLS 握手', color: '#fb923c' },
  { key: 'send', label: 'Send（发送请求）', color: '#a78bfa' },
  { key: 'wait', label: 'Wait（等待响应 TTFB）', color: '#5ba3f5' },
  { key: 'receive', label: 'Receive（内容下载）', color: '#4ade80' },
];

// 请求耗时瀑布图（各阶段分段展示）
const HarTimingChart: React.FC<HarTimingChartProps> = ({ timings, total }) => {
  const active = PHASES.map(p => ({ ...p, value: Math.max(0, timings[p.key] || 0) }));
  const sum = active.reduce((acc, p) => acc + p.value, 0);
  const denom = sum > 0 ? sum : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 顶部分段条 */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          总耗时 <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatHarTime(total)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: 28,
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-surface)',
          }}
        >
          {active.map(p =>
            p.value > 0 ? (
              <div
                key={p.key}
                title={`${p.label}: ${formatHarTime(p.value)}`}
                style={{
                  width: `${(p.value / denom) * 100}%`,
                  background: p.color,
                  minWidth: 2,
                }}
              />
            ) : null
          )}
        </div>
      </div>

      {/* 阶段明细列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {active.map(p => (
          <div
            key={p.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              borderRadius: 6,
              background: p.value > 0 ? 'var(--bg-surface)' : 'transparent',
              opacity: p.value > 0 ? 1 : 0.45,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color, display: 'inline-block' }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 48, textAlign: 'right' }}>
                {sum > 0 ? ((p.value / denom) * 100).toFixed(0) + '%' : '-'}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  width: 72,
                  textAlign: 'right',
                  fontWeight: 600,
                }}
              >
                {formatHarTime(p.value)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HarTimingChart;
