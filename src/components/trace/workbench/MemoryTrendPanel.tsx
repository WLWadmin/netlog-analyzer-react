import {
  useEffect,
  useState,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { AdvancedAnalysisResultResponse } from '../../../workbench/protocol';
import { useStableAnalysisRange } from './useStableAnalysisRange';

interface MemoryTrendPanelProps {
  client: TraceWorkbenchClient;
  range: { startUs: number; endUs: number };
  onFocusRange(range: { startUs: number; endUs: number }): void;
}

type MemoryTrendResponse = AdvancedAnalysisResultResponse & {
  capability: 'memory-trend';
  result: Extract<AdvancedAnalysisResultResponse['result'], {
    kind: 'memory-trend';
  }>;
};

const GC_TYPE_LABELS: Record<
  MemoryTrendResponse['result']['gcEvents'][number]['type'],
  string
> = {
  minor: 'Minor GC',
  major: 'Major GC',
  incremental: 'Incremental GC',
  other: 'GC',
};

function isMemoryTrendResponse(
  response: AdvancedAnalysisResultResponse,
): response is MemoryTrendResponse {
  return response.capability === 'memory-trend'
    && response.result.kind === 'memory-trend';
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(2)} KiB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(2)} MiB`;
}

const MemoryTrendPanel: React.FC<MemoryTrendPanelProps> = ({
  client,
  range,
  onFocusRange,
}) => {
  const [response, setResponse] = useState<MemoryTrendResponse>();
  const [error, setError] = useState('');
  const stableRange = useStableAnalysisRange(range);

  useEffect(() => {
    let disposed = false;
    setResponse(undefined);
    setError('');
    if (!stableRange) return () => {
      disposed = true;
    };
    void client.queryAdvancedAnalysis('memory-trend', stableRange).then(result => {
      if (
        !disposed
        && result.type === 'advanced-analysis-result'
        && isMemoryTrendResponse(result)
      ) {
        setResponse(result);
      }
    }).catch(() => {
      if (!disposed) setError('GC 与内存趋势分析失败，当前时间轴仍可使用。');
    });
    return () => {
      disposed = true;
    };
  }, [client, stableRange]);

  const firstSample = response?.result.samples[0];
  const lastSample = response?.result.samples.at(-1);

  return (
    <section className="trace-advanced-panel" aria-labelledby="trace-memory-heading">
      <h3 id="trace-memory-heading">GC 与内存趋势</h3>
      {!response && !error && <p role="status">正在检查明确的 GC 与内存计数器…</p>}
      {response?.status === 'unavailable' && (
        <p role="status">能力不可用：{response.limitations.join(' ')}</p>
      )}
      {response?.status === 'insufficient' && (
        <p role="status">证据不足：{response.limitations.join(' ')}</p>
      )}
      {response?.status === 'available' && (
        <p role="status">{response.limitations.join(' ')}</p>
      )}
      {response && response.status !== 'unavailable' && (
        <>
          <p>
            GC {response.result.summary.gcCount} 次
            {' · '}累计暂停 {(response.result.summary.totalPauseUs / 1_000).toFixed(2)} ms
            {' · '}最大暂停 {(response.result.summary.maxPauseUs / 1_000).toFixed(2)} ms
          </p>
          {firstSample && lastSample && (
            <p>
              JS Heap Used：{formatBytes(firstSample.bytes)}
              {' → '}{formatBytes(lastSample.bytes)}
              {' · '}样本 {response.result.samples.length}
            </p>
          )}
          {response.result.gcEvents.map(event => (
            <article key={event.eventId}>
              <button
                type="button"
                aria-label={`定位 GC ${event.eventId}`}
                onClick={() => onFocusRange({
                  startUs: event.startUs,
                  endUs: event.startUs + event.durationUs,
                })}
              >
                定位 GC
              </button>
              <p>
                {GC_TYPE_LABELS[event.type]}
                {' · '}{(event.durationUs / 1_000).toFixed(2)} ms
                {' · '}交互上下文 {event.interactionEventIds.length}
                {' · '}长任务上下文 {event.longTaskEventIds.length}
              </p>
            </article>
          ))}
        </>
      )}
      {error && <p className="trace-export-error" role="alert">{error}</p>}
    </section>
  );
};

export default MemoryTrendPanel;
