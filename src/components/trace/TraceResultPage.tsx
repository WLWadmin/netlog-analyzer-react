import type {
  TraceAvailability,
  TraceContextResult,
  TraceFactCounts,
  TraceRequestFacts,
} from '../../parsers/trace/types';
import './traceResultPage.css';

interface TraceResultPageProps {
  result: TraceContextResult;
}

const QUALITY_COPY: Record<TraceAvailability, { label: string; className: string }> = {
  available: { label: '可用', className: 'is-available' },
  partial: { label: '部分可用', className: 'is-partial' },
  missing: { label: '缺失', className: 'is-missing' },
  unsupported: { label: '暂不支持', className: 'is-unsupported' },
};

const QUALITY_ITEMS: Array<{
  key: keyof TraceContextResult['context']['quality'];
  label: string;
}> = [
  { key: 'captureWindow', label: '采集时间范围' },
  { key: 'navigationContext', label: '导航上下文' },
  { key: 'processThreadMetadata', label: '进程与线程元数据' },
  { key: 'frameHierarchy', label: 'Frame 层级' },
  { key: 'rendererMainThread', label: 'Renderer 主线程' },
];

const REQUEST_RESULT_COPY: Record<TraceRequestFacts['result'], string> = {
  success: '成功',
  'http-error': 'HTTP 错误',
  'transport-failed': '传输失败',
  cancelled: '已取消',
  'incomplete-at-trace-end': '录制结束时未完成',
  'unknown-failure': '未知结果',
};

const FACT_COUNT_COPY: Array<[keyof TraceFactCounts, string]> = [
  ['requests', '请求'],
  ['tasks', '任务'],
  ['profiles', 'Profile'],
  ['milestones', '里程碑'],
  ['animationFrames', '帧'],
  ['rendering', '渲染事件'],
  ['interactions', '交互'],
  ['cpuHotspots', 'CPU 热点'],
  ['forcedReflowClues', 'Forced reflow 线索'],
];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function formatDuration(result: TraceContextResult): string {
  const { captureStartUs, captureEndUs } = result.intake;
  if (captureStartUs === undefined || captureEndUs === undefined) return '未取得';
  const seconds = Math.max(0, captureEndUs - captureStartUs) / 1_000_000;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} 秒`;
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

const TraceResultPage: React.FC<TraceResultPageProps> = ({ result }) => {
  const { intake, context } = result;
  const requests = context.requests ?? [];
  const tasks = context.tasks ?? [];
  const milestones = context.milestones ?? [];
  const frames = context.animationFrames ?? [];
  const interactions = context.interactions ?? [];
  const hotspots = context.cpuHotspots ?? [];
  const forcedClues = context.forcedReflowClues ?? [];
  const frameSummary = context.animationFrameSummary;
  const interactionSummary = context.interactionSummary;
  const requestCounts = requests.reduce<Partial<Record<TraceRequestFacts['result'], number>>>(
    (counts, request) => ({ ...counts, [request.result]: (counts[request.result] ?? 0) + 1 }),
    {},
  );
  const truncationLimitations = context.factCounts
    ? FACT_COUNT_COPY.flatMap(([key, label]) => {
        const count = context.factCounts?.[key];
        return count?.truncated ? [`${label}仅展示 ${count.returned} / ${count.total} 条`] : [];
      })
    : [];
  const factLimitations = [
    ...requests.flatMap(item => item.limitations),
    ...tasks.flatMap(item => item.limitations),
    ...(context.profiles ?? []).flatMap(item => item.limitations),
  ];
  const captureWindowLimitations = context.quality.captureWindow === 'available'
    ? []
    : [`采集窗口限制：${QUALITY_COPY[context.quality.captureWindow].label}，窗口外事件不在本次事实范围内`];
  const limitations = [
    ...captureWindowLimitations,
    ...context.quality.disabledCapabilities,
    ...context.quality.warnings,
    ...context.warnings,
    ...truncationLimitations,
    ...factLimitations,
  ];

  return (
    <section className="trace-result" aria-labelledby="trace-result-title">
      <header className="trace-result-heading">
        <div>
          <span>PERFORMANCE TRACE</span>
          <h1 id="trace-result-title">Trace 上下文接入结果</h1>
          <p>
            已完成文件校验、上下文聚合与有限事实提取。当前页面仅展示可验证事实、
            采集质量和解释边界，不输出未经证据模型验证的性能结论。
          </p>
        </div>
        <div className={`trace-quality-level is-${context.quality.level}`}>
          <span>证据质量</span>
          <strong>{context.quality.level === 'good' ? '良好' : context.quality.level === 'partial' ? '部分可用' : '证据不足'}</strong>
        </div>
      </header>

      <div className="trace-summary-grid" aria-label="Trace 摘要">
        <div><span>事件</span><strong>{intake.eventCount.toLocaleString()}</strong></div>
        <div><span>JSON 大小</span><strong>{formatBytes(intake.jsonBytes)}</strong></div>
        <div><span>采集时长</span><strong>{formatDuration(result)}</strong></div>
        <div><span>导航</span><strong>{context.navigations.length.toLocaleString()}</strong></div>
        <div><span>请求 / 长任务</span><strong>{requests.length} / {tasks.length}</strong></div>
        <div><span>交互 / 帧</span><strong>{interactions.length} / {frames.length}</strong></div>
      </div>

      <div className="trace-result-grid">
        <article className="trace-result-panel">
          <div className="trace-result-panel-heading">
            <div><span>采集完整性</span><h2>能力可用性</h2></div>
            <small>{intake.encoding === 'gzip-json' ? 'gzip JSON' : 'JSON'}</small>
          </div>
          <dl className="trace-quality-list">
            {QUALITY_ITEMS.map(item => {
              const availability = context.quality[item.key] as TraceAvailability;
              const copy = QUALITY_COPY[availability];
              return <div key={item.key}><dt>{item.label}</dt><dd className={copy.className}>{copy.label}</dd></div>;
            })}
          </dl>
        </article>

        <article className="trace-result-panel">
          <div className="trace-result-panel-heading"><div><span>事实覆盖</span><h2>已建立的上下文</h2></div></div>
          <dl className="trace-fact-list">
            <div><dt>证据引用</dt><dd>{context.evidenceReturnedCount} / {context.evidenceTotalCount}</dd></div>
            <div><dt>事件族</dt><dd>{intake.availableFamilies.length || 0}</dd></div>
            <div><dt>跳过事件</dt><dd>{context.quality.skippedEventCount}</dd></div>
            <div><dt>跨进程 Frame</dt><dd>{context.frames.filter(frame => frame.processSpans.length > 1).length}</dd></div>
          </dl>
          <p className="trace-result-note">所有条目均为有限事实；缺失或截断信息统一列入解释边界。</p>
        </article>

        <article className="trace-result-panel">
          <div className="trace-result-panel-heading"><div><span>NETWORK</span><h2>请求结果</h2></div></div>
          <ul className="trace-fact-items">
            {Object.entries(requestCounts).map(([key, value]) => (
              <li key={key}>{REQUEST_RESULT_COPY[key as TraceRequestFacts['result']]} {value}</li>
            ))}
            {requests.length === 0 && <li>未取得请求事实</li>}
          </ul>
        </article>

        <article className="trace-result-panel">
          <div className="trace-result-panel-heading"><div><span>MAIN THREAD</span><h2>长任务与自耗时</h2></div></div>
          <ul className="trace-fact-items">
            {tasks.map(task => <li key={task.id}>{formatMs(task.durationMs)} / 自耗时 {formatMs(task.selfTimeMs)}</li>)}
            {tasks.length === 0 && <li>未取得长任务事实</li>}
          </ul>
        </article>

        <article className="trace-result-panel">
          <div className="trace-result-panel-heading"><div><span>LOADING</span><h2>里程碑</h2></div></div>
          <ul className="trace-fact-items">
            {milestones.map(item => <li key={item.id}>{item.name}{item.candidate ? ' 候选' : ''} {formatMs(item.relativeUs / 1000)}</li>)}
            {milestones.length === 0 && <li>未取得页面里程碑</li>}
          </ul>
        </article>

        <article className="trace-result-panel">
          <div className="trace-result-panel-heading"><div><span>RENDERING</span><h2>帧与布局线索</h2></div></div>
          <ul className="trace-fact-items">
            {frames.map(frame => <li key={frame.id}>{formatMs(frame.durationMs)} / 预算 {formatMs(frame.budgetMs)}</li>)}
            {frameSummary && <li>超预算 {frameSummary.overBudgetCount} / {frameSummary.totalCount}，最长 {formatMs(frameSummary.maxDurationMs)}</li>}
            {frameSummary && <li>16.7 ms 为 60 Hz 参考预算，实际刷新率未知</li>}
            <li>明确 forced reflow 线索 {forcedClues.filter(item => item.confidence === 'explicit').length}</li>
          </ul>
        </article>

        <article className="trace-result-panel">
          <div className="trace-result-panel-heading"><div><span>INTERACTIONS</span><h2>交互三阶段</h2></div></div>
          <ul className="trace-fact-items">
            {interactionSummary?.maxTotalLatencyMs !== undefined && <li>Trace 内最慢交互 {formatMs(interactionSummary.maxTotalLatencyMs)}</li>}
            {interactions.map(item => <li key={item.id}>输入 {item.inputDelayMs.toFixed(1)} / 处理 {item.processingDurationMs.toFixed(1)} / 呈现 {item.presentationDelayMs.toFixed(1)} ms</li>)}
            {interactions.length === 0 && <li>未取得已配对交互</li>}
          </ul>
        </article>

        <article className="trace-result-panel">
          <div className="trace-result-panel-heading"><div><span>CPU PROFILE</span><h2>采样热点</h2></div></div>
          <ul className="trace-fact-items">
            {hotspots.map(item => <li key={item.id}>{item.functionName} · {item.sampleCount} samples</li>)}
            {hotspots.length === 0 && <li>未取得 CPU 热点</li>}
          </ul>
        </article>
      </div>

      <article className="trace-result-panel trace-limitations">
        <div className="trace-result-panel-heading"><div><span>解释边界</span><h2>限制与下一步</h2></div></div>
        {limitations.length > 0 ? (
          <ul>{[...new Set(limitations)].map(item => <li key={item}>{item}</li>)}</ul>
        ) : (
          <p>当前事实未报告额外限制；结论仍需后续诊断规则和真实样本门禁。</p>
        )}
      </article>
    </section>
  );
};

export default TraceResultPage;
