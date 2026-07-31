import { useState } from 'react';
import type { FileParserId } from '../../upload/fileFormatTypes';

export type ParserMode = 'recommend' | FileParserId;

interface ParserModeSelectProps {
  value: ParserMode;
  traceEnabled: boolean;
  onChange(value: ParserMode): void;
}

const ParserModeSelect: React.FC<ParserModeSelectProps> = ({
  value,
  traceEnabled,
  onChange,
}) => {
  const [manualExpanded, setManualExpanded] = useState(value !== 'recommend');
  const formats: Array<{ parserId: FileParserId; label: string }> = [
    { parserId: 'har@1', label: 'HAR' },
    { parserId: 'chromium-netlog@1', label: 'NetLog' },
    ...(traceEnabled
      ? [{
          parserId: 'chromium-performance-trace@1' as const,
          label: 'Performance Trace',
        }]
      : []),
    { parserId: 'go-service-log@1', label: 'Go Log' },
  ];

  return (
    <section className="parser-mode-select" aria-label="文件解析方式">
      <div className="parser-mode-copy">
        <strong>选择解析方式</strong>
        <span>自动识别仅在文件结构唯一明确时开始；不确定时会请你选择。</span>
      </div>
      <div className="parser-mode-actions">
        <button
          className={value === 'recommend' ? 'is-active' : ''}
          type="button"
          aria-pressed={value === 'recommend'}
          onClick={() => {
            setManualExpanded(false);
            onChange('recommend');
          }}
        >
          自动识别（推荐）
        </button>
        <button
          className={manualExpanded ? 'is-active-secondary' : ''}
          type="button"
          aria-pressed={manualExpanded}
          onClick={() => setManualExpanded(true)}
        >
          指定文件格式
        </button>
      </div>
      {manualExpanded ? (
        <div className="parser-format-options" aria-label="可用文件格式">
          {formats.map(format => (
            <button
              key={format.parserId}
              className={value === format.parserId ? 'is-active' : ''}
              type="button"
              aria-pressed={value === format.parserId}
              onClick={() => onChange(format.parserId)}
            >
              {format.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default ParserModeSelect;
