import { useEffect, useRef, useState } from 'react';
import {
  isMonotonicProgress,
  progressRatio,
  type AnalysisProgress,
} from '../../upload/analysisProgress';

interface AnalysisProgressPanelProps {
  progress: AnalysisProgress;
  autoContinueAt?: number;
  onCancel(): void;
  onContinue?(): void;
}

interface ActivityRecord {
  phase: AnalysisProgress['phase'];
  label: string;
  startedAt: number;
  endedAt?: number;
}

const UNIT_COPY: Record<NonNullable<AnalysisProgress['unit']>, string> = {
  bytes: '字节',
  events: '个事件',
  requests: '个请求',
  lines: '行日志',
  rules: '项任务',
};

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${Math.max(0.1, milliseconds / 1_000).toFixed(1)} 秒`;
  }
  return `${(milliseconds / 1_000).toFixed(1)} 秒`;
}

function completedLabel(label: string): string {
  return label.replace(/^正在/, '');
}

function useAnimatedPercent(progress: AnalysisProgress): number {
  const targetPercent = Math.floor(progressRatio(progress) * 100);
  const { taskId, resultReady } = progress;
  // This is presentation-only interpolation, never a Worker fact or an ETA.
  // Leave room before the next phase and keep long waits visibly active via CSS.
  const phaseCount = Math.max(1, progress.phaseCount);
  const phaseIndex = Math.min(Math.max(0, progress.phaseIndex), phaseCount - 1);
  const ceiling = Math.max(targetPercent, Math.min(99, Math.ceil((phaseIndex + 1) / phaseCount * 100) - 1));
  const [display, setDisplay] = useState({ taskId, percent: targetPercent });
  const displayRef = useRef(display);

  useEffect(() => {
    const start = displayRef.current.taskId === taskId
      ? Math.max(targetPercent, displayRef.current.percent) : targetPercent;
    const publish = (percent: number) => {
      // Only integer changes are visible; fractional updates must not render
      // the entire panel while the Worker is parsing a large file.
      const nextPercent = Math.floor(percent);
      if (displayRef.current.taskId === taskId && displayRef.current.percent === nextPercent) return;
      displayRef.current = { taskId, percent: nextPercent };
      setDisplay(displayRef.current);
    };
    publish(start);
    if (resultReady) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const waitingMs = Math.max(0, Date.now() - startedAt - 1_000);
      publish(start + Math.max(0, ceiling - start) * (1 - Math.exp(-waitingMs / 45_000)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [targetPercent, taskId, ceiling, resultReady]);

  return resultReady ? 100 : display.taskId !== taskId
    ? targetPercent : Math.max(targetPercent, Math.floor(display.percent));
}

const AnalysisProgressPanel: React.FC<AnalysisProgressPanelProps> = ({
  progress,
  autoContinueAt,
  onCancel,
  onContinue,
}) => {
  const acceptedProgressRef = useRef(progress);
  if (
    acceptedProgressRef.current.taskId !== progress.taskId
    || isMonotonicProgress(acceptedProgressRef.current, progress)
  ) {
    acceptedProgressRef.current = progress;
  }
  const acceptedProgress = acceptedProgressRef.current;
  const localStartedAt = useRef(Date.now());
  const activityTaskId = useRef(acceptedProgress.taskId);
  const [now, setNow] = useState(Date.now());
  const [activity, setActivity] = useState<ActivityRecord[]>([{
    phase: acceptedProgress.phase,
    label: acceptedProgress.label,
    startedAt: Date.now(),
  }]);
  const targetPercent = Math.floor(progressRatio(acceptedProgress) * 100);
  const displayPercent = useAnimatedPercent(acceptedProgress);
  const isEstimated = !acceptedProgress.resultReady && displayPercent > targetPercent;
  const percentLabel = isEstimated ? '预估进度' : '任务完成度';

  useEffect(() => {
    localStartedAt.current = Date.now();
    setNow(Date.now());
    // Elapsed time and the result countdown are displayed in seconds.
    // The flowing indicator uses CSS and needs no high-frequency React timer.
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [acceptedProgress.taskId]);

  useEffect(() => {
    const changedAt = Date.now();
    setActivity(previous => {
      if (activityTaskId.current !== acceptedProgress.taskId) {
        activityTaskId.current = acceptedProgress.taskId;
        return [{
          phase: acceptedProgress.phase,
          label: acceptedProgress.label,
          startedAt: changedAt,
        }];
      }
      const last = previous[previous.length - 1];
      if (!last) {
        return [{
          phase: acceptedProgress.phase,
          label: acceptedProgress.label,
          startedAt: changedAt,
        }];
      }
      if (last.phase === acceptedProgress.phase) {
        return [
          ...previous.slice(0, -1),
          {
            ...last,
            label: acceptedProgress.label,
            ...(acceptedProgress.resultReady ? { endedAt: changedAt } : {}),
          },
        ];
      }
      return [
        ...previous.slice(0, -1),
        { ...last, endedAt: changedAt },
        {
          phase: acceptedProgress.phase,
          label: acceptedProgress.label,
          startedAt: changedAt,
          ...(acceptedProgress.resultReady ? { endedAt: changedAt } : {}),
        },
      ];
    });
  }, [
    acceptedProgress.label,
    acceptedProgress.phase,
    acceptedProgress.resultReady,
    acceptedProgress.taskId,
  ]);

  const remainingSeconds = autoContinueAt === undefined
    ? undefined
    : Math.max(0, Math.ceil((autoContinueAt - Math.max(now, Date.now())) / 1000));
  const workCopy = acceptedProgress.resultReady
    ? '全部本地分析已完成'
    : acceptedProgress.mode === 'determinate'
      ? `已处理 ${acceptedProgress.completed?.toLocaleString()} / ${acceptedProgress.total?.toLocaleString()} ${acceptedProgress.unit ? UNIT_COPY[acceptedProgress.unit] : ''}`
      : '正在执行不可拆分的本地任务';

  return (
    <div className="analysis-progress-panel" aria-live="polite">
      <div className="analysis-progress-heading">
        <div className="analysis-progress-percent" aria-label={`${percentLabel} ${displayPercent}%`}>
          <strong>{displayPercent}%</strong>
          <span>{percentLabel}</span>
        </div>
        <div className="analysis-progress-current">
          <span>{acceptedProgress.resultReady ? '结果已就绪' : '当前任务'}</span>
          <h2>{acceptedProgress.label}</h2>
          <p>{workCopy}</p>
          {isEstimated && <p>进度为等待期间的估算，实际完成以分析结果为准</p>}
        </div>
        <div className="analysis-progress-actions">
          <span aria-label={`已用时 ${formatElapsed(now - localStartedAt.current)}`}>
            {formatElapsed(now - localStartedAt.current)}
          </span>
          {acceptedProgress.resultReady ? (
            <button className="primary-action" type="button" onClick={onContinue}>
              立即查看结果
            </button>
          ) : (
            <button type="button" onClick={onCancel}>停止分析</button>
          )}
        </div>
      </div>

      <div
        className={`analysis-progress-track${acceptedProgress.resultReady ? '' : ' is-active'}`}
        role="progressbar"
        aria-label={acceptedProgress.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayPercent}
        aria-valuetext={`${percentLabel} ${displayPercent}%`}
      >
        <div style={{ width: `${displayPercent}%` }} />
      </div>

      {remainingSeconds !== undefined ? (
        <p className="analysis-result-countdown">
          {remainingSeconds} 秒后自动进入结果页面
        </p>
      ) : null}

      <ol className="analysis-activity" aria-label="解析阶段记录">
        {activity.map((record, index) => {
          const isCurrent = index === activity.length - 1
            && !acceptedProgress.resultReady;
          const duration = (record.endedAt ?? now) - record.startedAt;
          return (
            <li className={isCurrent ? 'is-current' : 'is-complete'} key={`${record.phase}-${index}`}>
              <span aria-hidden="true">{isCurrent ? '•' : '✓'}</span>
              <strong>
                {isCurrent
                  ? `当前：${record.label}`
                  : `已完成：${completedLabel(record.label)}`}
              </strong>
              <time>{formatDuration(duration)}</time>
            </li>
          );
        })}
      </ol>

      <div className="analysis-progress-meta">
        <span>本地 Worker 处理，文件不会上传服务器</span>
      </div>
    </div>
  );
};

export default AnalysisProgressPanel;
