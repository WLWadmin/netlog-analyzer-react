import { Tooltip } from 'antd';
import type { HarRequestEntry } from '../../harParser';
import { formatHarTime } from '../../harParser';
import type { HarRequestIssue } from '../../diagnosis/shared/harRequestIssue';
import type { HarWaterfallMarkerPosition, HarWaterfallRange } from '../../diagnosis/shared/harWaterfall';
import { getHarWaterfallPosition, getHarWaterfallSegments } from '../../diagnosis/shared/harWaterfall';

interface HarWaterfallCellProps {
  entry: HarRequestEntry;
  range: HarWaterfallRange;
  markers?: HarWaterfallMarkerPosition[];
  issue: HarRequestIssue;
}

const HarWaterfallCell: React.FC<HarWaterfallCellProps> = ({ entry, range, markers = [], issue }) => {
  const position = getHarWaterfallPosition(entry, range);
  const segments = getHarWaterfallSegments(entry);

  if (!position.available) {
    return <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>-</span>;
  }

  const minWidth = entry.time <= 0 ? 2 : entry.time < 1 ? 3 : 4;
  const tooltip = (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}>
      <div>Started: {entry.startedDateTime || '-'}</div>
      <div>Offset: {formatHarTime(position.startOffsetMs)}</div>
      {segments.map(segment => (
        <div key={segment.key}>{segment.label}: {formatHarTime(segment.durationMs)}</div>
      ))}
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
        {markers.map(marker => (
          <span
            key={marker.key}
            title={marker.label}
            style={{
              position: 'absolute',
              left: `${marker.leftPercent}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: marker.color,
              opacity: 0.75,
              zIndex: 2,
            }}
          />
        ))}
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
            overflow: 'hidden',
            border: `1px solid ${entry.isSlow ? 'rgba(251, 146, 60, 0.9)' : 'rgba(91, 163, 245, 0.75)'}`,
            boxSizing: 'border-box',
            background: 'rgba(148, 163, 184, 0.18)',
          }}
        >
          {segments.map(segment => {
            const width = segment.durationMs > 0 && segment.widthPercent < 1 ? 2 : `${segment.widthPercent}%`;
            return (
              <span
                key={segment.key}
                style={{
                  position: 'absolute',
                  left: `${segment.leftPercent}%`,
                  top: 0,
                  height: '100%',
                  width,
                  background: segment.striped
                    ? `repeating-linear-gradient(45deg, ${segment.color}, ${segment.color} 2px, transparent 2px, transparent 4px)`
                    : segment.color,
                }}
              />
            );
          })}
        </div>
      </div>
    </Tooltip>
  );
};

export default HarWaterfallCell;
