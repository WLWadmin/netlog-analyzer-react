import {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { createFileParseInput } from '../../../upload/createFileFormatIntake';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';

const STATUS_LABEL = {
  comparable: '可比较',
  'alignment-insufficient': '校时不足',
  'capability-mismatch': '能力不对等',
  'sample-incomparable': '样本不可比',
} as const;

const TraceComparisonPanel: React.FC<{
  client: TraceWorkbenchClient;
  store: TimelineInteractionStore;
}> = ({ client, store }) => {
  const comparisonBaseline = useSyncExternalStore(
    client.subscribe.bind(client),
    () => client.getSnapshot().comparisonBaseline,
    () => client.getSnapshot().comparisonBaseline,
  );
  const comparison = useSyncExternalStore(
    client.subscribe.bind(client),
    () => client.getSnapshot().comparison,
    () => client.getSnapshot().comparison,
  );
  const interaction = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sameScenarioConfirmed, setSameScenarioConfirmed] = useState(false);
  const range = interaction.selection ?? interaction.viewport;
  const baselineAvailable = comparisonBaseline?.baselineAvailable === true;

  useEffect(() => {
    if (!baselineAvailable) return;
    const timer = window.setTimeout(() => {
      void client.queryTraceComparison(range, sameScenarioConfirmed).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [baselineAvailable, client, range, sameScenarioConfirmed]);

  const addBaseline = async (file: File) => {
    setError('');
    setSameScenarioConfirmed(false);
    setLoading(true);
    try {
      const input = await createFileParseInput(file, 'comparison-baseline');
      const trace = input.probeVerdicts?.find(verdict => (
        verdict.parserId === 'chromium-performance-trace@1'
      ));
      if (trace?.kind !== 'definite-match') {
        throw new Error('文件未通过 Chromium Trace 专用格式校验。');
      }
      const response = await client.addComparisonBaseline(file);
      if (response.type !== 'comparison-baseline-result') {
        throw new Error(
          response.type === 'structured-error'
            ? response.error.message
            : '基线 Trace 未返回有效结果。',
        );
      }
      await client.queryTraceComparison(range, false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '基线 Trace 加载失败。');
    } finally {
      setLoading(false);
    }
  };

  const removeBaseline = async () => {
    setError('');
    setLoading(true);
    try {
      const response = await client.removeComparisonBaseline();
      if (response.type !== 'comparison-baseline-result') {
        throw new Error(
          response.type === 'structured-error'
            ? response.error.message
            : '基线移除未返回有效结果。',
        );
      }
      setSameScenarioConfirmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '基线移除失败。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="trace-comparison-panel" aria-labelledby="trace-comparison-heading">
      <h3 id="trace-comparison-heading">本地 Trace 基线比较</h3>
      <p>文件仅在当前 Worker 会话内处理，不上传、不写入 URL 或默认导出。</p>
      <label>
        {baselineAvailable ? '替换基线 Trace' : '选择基线 Trace'}
        <input
          aria-label="选择本地基线 Trace"
          type="file"
          accept=".json,.trace,.gz,application/json,application/gzip"
          disabled={loading}
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void addBaseline(file);
            event.target.value = '';
          }}
        />
      </label>
      {baselineAvailable && (
        <button type="button" disabled={loading} onClick={() => void removeBaseline()}>
          移除基线
        </button>
      )}
      {baselineAvailable && (
        <label>
          <input
            type="checkbox"
            checked={sameScenarioConfirmed}
            disabled={loading}
            onChange={event => setSameScenarioConfirmed(event.target.checked)}
          />
          我确认当前 Trace 与基线 Trace 属于同一场景
        </label>
      )}
      {loading && <p role="status">正在 Worker 内解析并索引基线 Trace。</p>}
      {comparison && (
        <>
          <p>
            状态：{STATUS_LABEL[comparison.status]}。
            {comparison.regression === 'unavailable'
              ? '当前禁止输出性能退化结论。'
              : ` 差异结论：${comparison.regression}。`}
          </p>
          <dl>
            {comparison.metrics.map(metric => (
              <div key={metric.metric}>
                <dt>{metric.metric}</dt>
                <dd>
                  当前 {metric.current} · 基线 {metric.baseline}
                  {metric.deltaPercent === undefined
                    ? ' · 无可用百分比'
                    : ` · ${metric.deltaPercent}%`}
                </dd>
              </div>
            ))}
          </dl>
          {comparison.limitations.map(limitation => (
            <p key={limitation}>限制：{limitation}</p>
          ))}
          <p>证据引用：{comparison.evidenceIds.join('、') || '当前范围无事件引用'}</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
};

export default TraceComparisonPanel;
