import { Tooltip } from 'antd';
import type { HarRequestEntry } from '../../harParser';
import { formatHarTime } from '../../harParser';
import type { HarRequestIssue } from '../../diagnosis/shared/harRequestIssue';
import type { HarWaterfallRange } from '../../diagnosis/shared/harWaterfall';
import { getHarWaterfallPosition } from '../../diagnosis/shared/harWaterfall';

interface HarWaterfallCellProps {
  entry: HarRequestEntry;
  range: HarWaterfallRange;
  issue: HarRequestIssue;
}

const HarWaterfallCell: React.FC<HarWaterfallCellProps> = ({ entry, range, issue }) => {
  const position = getHarWaterfallPosition(entry, range);

  if (!position.available) {
    return <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>-</span>;
  }

  const minWidth = entry.time <= 0 ? 2 : entry.time < 1 ? 3 : 4;
  const barColor = entry.isSlow ? 'rgba(251, 146, 60, 0.72)' : 'rgba(34, 211, 238, 0.66)';
  const borderColor = entry.isSlow ? 'rgba(251, 146, 60, 0.9)' : 'rgba(91, 163, 245, 0.75)';

  const tooltip = (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}>
      <div>Started: {entry.startedDateTime || '-'}</div>
      <div>Offset: {formatHarTime(position.startOffsetMs)}</div>
      <div>Total: {formatHarTime(position.durationMs)}</div>
      <div>主问题: {issue.label}</div>
    </div>
  );

  return (
    <Tooltip title={tooltip} placement="topLeft">
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 18,
          borderRadius: 4,
          background: 'linear-gradient(90deg, rgba(148,163,184,0.12), rgba(148,163,184,0.04))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${position.leftPercent}%`,
            top: 4,
            width: `${position.widthPercent}%`,
            minWidth,
            maxWidth: `${100 - position.leftPercent}%`,
            height: 10,
            borderRadius: 999,
            background: barColor,
            border: `1px solid ${borderColor}`,
            boxSizing: 'border-box',
          }}
        />
      </div>
    </Tooltip>
  );
};

export default HarWaterfallCell;
