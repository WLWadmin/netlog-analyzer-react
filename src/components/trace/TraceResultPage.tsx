import type {
  TraceAvailability,
  TraceContextResult,
} from '../../parsers/trace/types';
import './traceResultPage.css';

interface TraceResultPageProps {
  result: TraceContextResult;
}

const QUALITY_COPY: Record<TraceAvailability, {
  label: string;
  className: string;
}> = {
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

const TraceResultPage: React.FC<TraceResultPageProps> = ({ result }) => {
  const { intake, context } = result;
  const limitations = [
    ...context.quality.disabledCapabilities,
    ...context.quality.warnings,
    ...context.warnings,
  ];

  return (
    <section className="trace-result" aria-labelledby="trace-result-title">
      <header className="trace-result-heading">
        <div>
          <span>PERFORMANCE TRACE</span>
          <h1 id="trace-result-title">Trace 上下文接入结果</h1>
          <p>
            已完成文件校验与上下文聚合。当前页面展示可验证事实和采集质量，
            不把尚未实现的性能诊断表述为根因。
          </p>
        </div>
        <div className={`trace-quality-level is-${context.quality.level}`}>
          <span>证据质量</span>
          <strong>
            {context.quality.level === 'good'
              ? '良好'
              : context.quality.level === 'partial'
                ? '部分可用'
                : '证据不足'}
          </strong>
        </div>
      </header>

      <div className="trace-summary-grid" aria-label="Trace 摘要">
        <div><span>事件</span><strong>{intake.eventCount.toLocaleString()}</strong></div>
        <div><span>JSON 大小</span><strong>{formatBytes(intake.jsonBytes)}</strong></div>
        <div><span>采集时长</span><strong>{formatDuration(result)}</strong></div>
        <div><span>导航</span><strong>{context.navigations.length.toLocaleString()}</strong></div>
        <div><span>进程 / 线程</span><strong>{context.processes.length} / {context.threads.length}</strong></div>
        <div><span>Frame</span><strong>{context.frames.length.toLocaleString()}</strong></div>
      </div>

      <div className="trace-result-grid">
        <article className="trace-result-panel">
          <div className="trace-result-panel-heading">
            <div>
              <span>采集完整性</span>
              <h2>能力可用性</h2>
            </div>
            <small>{intake.encoding === 'gzip-json' ? 'gzip JSON' : 'JSON'}</small>
          </div>
          <dl className="trace-quality-list">
            {QUALITY_ITEMS.map(item => {
              const availability = context.quality[item.key] as TraceAvailability;
              const copy = QUALITY_COPY[availability];
              return (
                <div key={item.key}>
                  <dt>{item.label}</dt>
                  <dd className={copy.className}>{copy.label}</dd>
                </div>
              );
            })}
          </dl>
        </article>

        <article className="trace-result-panel">
          <div className="trace-result-panel-heading">
            <div>
              <span>事实覆盖</span>
              <h2>已建立的上下文</h2>
            </div>
          </div>
          <dl className="trace-fact-list">
            <div><dt>证据引用</dt><dd>{context.evidenceReturnedCount} / {context.evidenceTotalCount}</dd></div>
            <div><dt>事件族</dt><dd>{intake.availableFamilies.length || 0}</dd></div>
            <div><dt>跳过事件</dt><dd>{context.quality.skippedEventCount}</dd></div>
            <div><dt>跨进程 Frame</dt><dd>{context.frames.filter(frame => frame.processSpans.length > 1).length}</dd></div>
          </dl>
          <p className="trace-result-note">
            这些数据用于后续页面加载、主线程、渲染和交互诊断；当前不输出未经证据模型验证的性能根因。
          </p>
        </article>
      </div>

      <article className="trace-result-panel trace-limitations">
        <div className="trace-result-panel-heading">
          <div>
            <span>解释边界</span>
            <h2>限制与下一步</h2>
          </div>
        </div>
        {limitations.length > 0 ? (
          <ul>
            {[...new Set(limitations)].map(item => <li key={item}>{item}</li>)}
          </ul>
        ) : (
          <p>当前上下文未报告额外限制；性能结论仍需后续诊断规则和真实样本门禁。</p>
        )}
      </article>
    </section>
  );
};

export default TraceResultPage;
