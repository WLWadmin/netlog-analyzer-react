import {
  useEffect,
  useState,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { AdvancedAnalysisResultResponse } from '../../../workbench/protocol';
import { useStableAnalysisRange } from './useStableAnalysisRange';

interface AnimationCompositionPanelProps {
  client: TraceWorkbenchClient;
  range: { startUs: number; endUs: number };
  onFocusRange(range: { startUs: number; endUs: number }): void;
}

type AnimationResponse = AdvancedAnalysisResultResponse & {
  capability: 'animation-composition';
  result: Extract<AdvancedAnalysisResultResponse['result'], {
    kind: 'animation-composition';
  }>;
};

const STATE_LABELS: Record<
  AnimationResponse['result']['animations'][number]['state'],
  string
> = {
  composited: '已合成',
  'not-composited': '未合成',
  unknown: '状态未知',
};

function isAnimationResponse(
  response: AdvancedAnalysisResultResponse,
): response is AnimationResponse {
  return response.capability === 'animation-composition'
    && response.result.kind === 'animation-composition';
}

const AnimationCompositionPanel: React.FC<AnimationCompositionPanelProps> = ({
  client,
  range,
  onFocusRange,
}) => {
  const [response, setResponse] = useState<AnimationResponse>();
  const [error, setError] = useState('');
  const stableRange = useStableAnalysisRange(range);

  useEffect(() => {
    let disposed = false;
    setResponse(undefined);
    setError('');
    if (!stableRange) return () => {
      disposed = true;
    };
    void client.queryAdvancedAnalysis('animation-composition', stableRange).then(result => {
      if (
        !disposed
        && result.type === 'advanced-analysis-result'
        && isAnimationResponse(result)
      ) {
        setResponse(result);
      }
    }).catch(() => {
      if (!disposed) setError('动画合成分析失败，当前时间轴仍可使用。');
    });
    return () => {
      disposed = true;
    };
  }, [client, stableRange]);

  return (
    <section className="trace-advanced-panel" aria-labelledby="trace-animation-heading">
      <h3 id="trace-animation-heading">动画合成状态</h3>
      {!response && !error && <p role="status">正在检查明确的动画与 compositor 证据…</p>}
      {response?.status === 'unavailable' && (
        <p role="status">能力不可用：{response.limitations.join(' ')}</p>
      )}
      {response?.status === 'insufficient' && (
        <p role="status">证据不足：{response.limitations.join(' ')}</p>
      )}
      {response?.status === 'available' && (
        <p role="status">{response.limitations.join(' ')}</p>
      )}
      {response?.result.animations.map(animation => (
        <article key={animation.animationId}>
          <button
            type="button"
            onClick={() => onFocusRange({
              startUs: animation.startUs,
              endUs: animation.endUs,
            })}
            aria-label={`定位动画 ${animation.animationId}`}
          >
            定位动画
          </button>
          <p>
            {STATE_LABELS[animation.state]}
            {' · '}{(animation.startUs / 1_000).toFixed(2)}
            –{(animation.endUs / 1_000).toFixed(2)} ms
          </p>
          <p>
            关联帧 {animation.frameEventIds.length}
            {' · '}渲染活动 {animation.renderingEventIds.length}
          </p>
          <p>{animation.limitations.join(' ')}</p>
        </article>
      ))}
      {error && <p className="trace-export-error" role="alert">{error}</p>}
    </section>
  );
};

export default AnimationCompositionPanel;
