import type { TraceAnalysisResult } from '../../../diagnosis/trace';
import type {
  TraceAvailability,
  TraceFactCounts,
} from '../../../parsers/trace/types';
import { useTraceTargetNavigation } from '../useTraceTargetNavigation';
import { traceFactDomId } from '../traceDiagnosisViewModel';
import { TraceFactItem, TraceNavigationError } from './TraceTabShared';

const QUALITY_LABEL: Record<TraceAvailability, string> = {
  available: '可用',
  partial: '部分可用',
  missing: '缺失',
  unsupported: '暂不支持',
};

const COUNT_LABEL: Array<[keyof TraceFactCounts, string]> = [
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

function duration(result: TraceAnalysisResult): string {
  const { captureStartUs, captureEndUs } = result.intake;
  if (captureStartUs === undefined || captureEndUs === undefined) return '未取得';
  const seconds = Math.max(0, captureEndUs - captureStartUs) / 1_000_000;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} 秒`;
}

const TraceOverviewTab: React.FC<{ result: TraceAnalysisResult }> = ({ result }) => {
  const { intake, context } = result;
  const navigation = useTraceTargetNavigation('overview');
  const fallbackCounts: Record<keyof TraceFactCounts, number> = {
    requests: context.requests?.length ?? 0,
    tasks: context.tasks?.length ?? 0,
    profiles: context.profiles?.length ?? 0,
    milestones: context.milestones?.length ?? 0,
    animationFrames: context.animationFrames?.length ?? 0,
    rendering: context.rendering?.length ?? 0,
    interactions: context.interactions?.length ?? 0,
    cpuHotspots: context.cpuHotspots?.length ?? 0,
    forcedReflowClues: context.forcedReflowClues?.length ?? 0,
  };
  const limitations = [
    ...(context.quality.captureWindow === 'available'
      ? []
      : [`采集窗口限制：${QUALITY_LABEL[context.quality.captureWindow]}，窗口外事件不在本次事实范围内`]),
    ...context.quality.disabledCapabilities,
    ...context.quality.warnings,
    ...context.warnings,
    ...COUNT_LABEL.flatMap(([key, label]) => (
      context.factCounts?.[key]?.truncated
        ? [`${label}仅展示 ${context.factCounts[key].returned} / ${context.factCounts[key].total} 条`]
        : []
    )),
    ...(context.requests ?? []).flatMap(item => item.limitations),
    ...(context.tasks ?? []).flatMap(item => item.limitations),
    ...(context.profiles ?? []).flatMap(item => item.limitations),
  ];

  return (
    <section aria-label="Trace 上下文概览" data-testid="trace-overview-tab">
      <h2>Trace 上下文概览</h2>
      <TraceNavigationError message={navigation.navigationError} />

      <div className="trace-summary-grid">
        <div><span>事件</span><strong>{intake.eventCount.toLocaleString()}</strong></div>
        <div><span>JSON 大小</span><strong>{formatBytes(intake.jsonBytes)}</strong></div>
        <div><span>采集时长</span><strong>{duration(result)}</strong></div>
        <div><span>导航</span><strong>{context.navigations.length.toLocaleString()}</strong></div>
        <div><span>证据引用</span><strong>{context.evidenceReturnedCount} / {context.evidenceTotalCount}</strong></div>
        <div><span>事件族</span><strong>{intake.availableFamilies.length}</strong></div>
      </div>

      <div className="trace-overview-grid">
        <article
          className={`trace-result-panel${navigation.highlightedDomId === traceFactDomId('quality') ? ' is-highlighted' : ''}`}
          id={traceFactDomId('quality')}
          tabIndex={-1}
        >
          <h2>采集质量</h2>
          <dl className="trace-quality-list">
            <div><dt>采集时间范围</dt><dd className={`is-${context.quality.captureWindow}`}>{QUALITY_LABEL[context.quality.captureWindow]}</dd></div>
            <div><dt>导航上下文</dt><dd className={`is-${context.quality.navigationContext}`}>{QUALITY_LABEL[context.quality.navigationContext]}</dd></div>
            <div><dt>进程与线程元数据</dt><dd className={`is-${context.quality.processThreadMetadata}`}>{QUALITY_LABEL[context.quality.processThreadMetadata]}</dd></div>
            <div><dt>Frame 层级</dt><dd className={`is-${context.quality.frameHierarchy}`}>{QUALITY_LABEL[context.quality.frameHierarchy]}</dd></div>
            <div><dt>Renderer 主线程</dt><dd className={`is-${context.quality.rendererMainThread}`}>{QUALITY_LABEL[context.quality.rendererMainThread]}</dd></div>
            <div><dt>跳过事件</dt><dd>{context.quality.skippedEventCount}</dd></div>
          </dl>
        </article>

        <article className="trace-result-panel">
          <h2>事实覆盖</h2>
          <dl className="trace-fact-list">
            {COUNT_LABEL.map(([key, label]) => {
              const count = context.factCounts?.[key];
              const returned = count?.returned ?? fallbackCounts[key];
              const total = count?.total ?? fallbackCounts[key];
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{returned} / {total}{count?.truncated ? ' · 已截断' : ''}</dd>
                </div>
              );
            })}
          </dl>
        </article>
      </div>

      <article className="trace-result-panel">
        <h2>页面里程碑</h2>
        <ul className="trace-fact-items">
          {(context.milestones ?? []).map(item => (
            <TraceFactItem
              factId={item.id}
              highlightedDomId={navigation.highlightedDomId}
              key={item.id}
            >
              {item.name}{item.candidate ? ' 候选' : ''} {(item.relativeUs / 1000).toFixed(1)} ms
            </TraceFactItem>
          ))}
          {!context.milestones?.length && <li>未取得页面里程碑</li>}
        </ul>
      </article>

      <article className="trace-result-panel trace-limitations">
        <h2>限制与下一步</h2>
        {limitations.length > 0
          ? <ul>{[...new Set(limitations)].map(item => <li key={item}>{item}</li>)}</ul>
          : <p>当前事实未报告额外限制；结论仍需结合真实样本和现场复现验证。</p>}
      </article>
    </section>
  );
};

export default TraceOverviewTab;
