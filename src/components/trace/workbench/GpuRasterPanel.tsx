import {
  useEffect,
  useState,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { AdvancedAnalysisResultResponse } from '../../../workbench/protocol';

interface GpuRasterPanelProps {
  client: TraceWorkbenchClient;
  range: { startUs: number; endUs: number };
  onFocusRange(range: { startUs: number; endUs: number }): void;
}

type GpuRasterResponse = AdvancedAnalysisResultResponse & {
  capability: 'gpu-raster';
  result: Extract<AdvancedAnalysisResultResponse['result'], {
    kind: 'gpu-raster';
  }>;
};

function isGpuRasterResponse(
  response: AdvancedAnalysisResultResponse,
): response is GpuRasterResponse {
  return response.capability === 'gpu-raster'
    && response.result.kind === 'gpu-raster';
}

const GpuRasterPanel: React.FC<GpuRasterPanelProps> = ({
  client,
  range,
  onFocusRange,
}) => {
  const [response, setResponse] = useState<GpuRasterResponse>();
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setResponse(undefined);
    setError('');
    void client.queryAdvancedAnalysis('gpu-raster', range).then(result => {
      if (
        !disposed
        && result.type === 'advanced-analysis-result'
        && isGpuRasterResponse(result)
      ) {
        setResponse(result);
      }
    }).catch(() => {
      if (!disposed) setError('GPU/Raster 摘要查询失败，当前时间轴仍可使用。');
    });
    return () => {
      disposed = true;
    };
  }, [client, range]);

  return (
    <section className="trace-advanced-panel" aria-labelledby="trace-gpu-raster-heading">
      <h3 id="trace-gpu-raster-heading">GPU / Raster 摘要</h3>
      {!response && !error && <p role="status">正在检查明确的 GPU/Raster 证据…</p>}
      {response?.status === 'unavailable' && (
        <p role="status">能力不可用：{response.limitations.join(' ')}</p>
      )}
      {response?.status === 'insufficient' && (
        <p role="status">证据不足：{response.limitations.join(' ')}</p>
      )}
      {response?.status === 'available' && (
        <>
          <p role="status">{response.limitations.join(' ')}</p>
          <p>
            记录到 {response.result.summary.intervalCount} 个 GPU/Raster 区间
            {' · '}GPU {response.result.summary.gpuIntervalCount}
            {' · '}Raster {response.result.summary.rasterIntervalCount}
            {' · '}累计 {(response.result.summary.totalDurationUs / 1_000).toFixed(2)} ms
            {' · '}最大 {(response.result.summary.maxDurationUs / 1_000).toFixed(2)} ms
          </p>
          {response.result.intervals.map(interval => (
            <article key={interval.eventId}>
              <button
                type="button"
                aria-label={`定位 GPU/Raster ${interval.eventId}`}
                onClick={() => onFocusRange({
                  startUs: interval.startUs,
                  endUs: interval.startUs + interval.durationUs,
                })}
              >
                定位 {interval.activity === 'gpu' ? 'GPU' : 'Raster'}
              </button>
              <p>
                {interval.activity === 'gpu' ? 'GPU 活动' : 'Raster 活动'}
                {' · '}{(interval.startUs / 1_000).toFixed(2)} ms
                {' · '}持续 {(interval.durationUs / 1_000).toFixed(2)} ms
              </p>
            </article>
          ))}
        </>
      )}
      {error && <p className="trace-export-error" role="alert">{error}</p>}
    </section>
  );
};

export default GpuRasterPanel;
