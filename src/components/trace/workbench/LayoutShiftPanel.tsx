import {
  useEffect,
  useState,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { AdvancedAnalysisResultResponse } from '../../../workbench/protocol';

interface LayoutShiftPanelProps {
  client: TraceWorkbenchClient;
  range: { startUs: number; endUs: number };
  onFocusRange(range: { startUs: number; endUs: number }): void;
}

type LayoutShiftResponse = AdvancedAnalysisResultResponse & {
  capability: 'layout-shifts';
  result: Extract<AdvancedAnalysisResultResponse['result'], {
    kind: 'layout-shifts';
  }>;
};

function isLayoutShiftResponse(
  response: AdvancedAnalysisResultResponse,
): response is LayoutShiftResponse {
  return response.capability === 'layout-shifts'
    && response.result.kind === 'layout-shifts';
}

const LayoutShiftPanel: React.FC<LayoutShiftPanelProps> = ({
  client,
  range,
  onFocusRange,
}) => {
  const [response, setResponse] = useState<LayoutShiftResponse>();
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setError('');
    void client.queryAdvancedAnalysis('layout-shifts', range).then(result => {
      if (disposed || result.type !== 'advanced-analysis-result') return;
      if (isLayoutShiftResponse(result)) setResponse(result);
    }).catch(() => {
      if (!disposed) setError('布局偏移分析失败，当前时间轴仍可使用。');
    });
    return () => {
      disposed = true;
    };
  }, [client, range]);

  return (
    <section className="trace-advanced-panel" aria-labelledby="trace-layout-shift-heading">
      <h3 id="trace-layout-shift-heading">布局偏移详情</h3>
      {!response && !error && <p role="status">正在检查明确的 LayoutShift 证据…</p>}
      {response && response.status !== 'available' && (
        <p role="status">
          {response.status === 'unavailable' ? '能力不可用：' : '证据不足：'}
          {response.limitations.join(' ')}
        </p>
      )}
      {response?.status === 'available' && (
        <p role="status">{response.limitations.join(' ')}</p>
      )}
      {response?.result.clusters.map(cluster => (
        <article key={cluster.clusterId}>
          <button
            type="button"
            onClick={() => onFocusRange({
              startUs: cluster.startUs,
              endUs: cluster.endUs,
            })}
            aria-label={`定位布局偏移簇 ${cluster.clusterId}`}
          >
            定位簇
          </button>
          <p>
            {(cluster.startUs / 1_000).toFixed(2)}–{(cluster.endUs / 1_000).toFixed(2)} ms
            {' · '}累计值 {cluster.cumulativeScore.toFixed(4)}
            {' · '}成员事件 {cluster.memberEventIds.length}
          </p>
          <p>{cluster.limitations.join(' ')}</p>
        </article>
      ))}
      {response?.status === 'available' && response.result.clusters.length === 0 && (
        <p role="status">当前范围有 LayoutShift，但没有可计入 CLS 的事件。</p>
      )}
      {error && <p className="trace-export-error" role="alert">{error}</p>}
    </section>
  );
};

export default LayoutShiftPanel;
