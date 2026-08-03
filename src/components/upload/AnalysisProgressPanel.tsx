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

function useAnimatedPercent(targetPercent: number, taskId: string): number {
  const [displayPercent, setDisplayPercent] = useState(targetPercent);
  const displayRef = useRef(targetPercent);

  useEffect(() => {
    displayRef.current = targetPercent;
    setDisplayPercent(targetPercent);
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const start = displayRef.current;
    if (targetPercent <= start) return undefined;
    if (typeof window.requestAnimationFrame !== 'function') {
      displayRef.current = targetPercent;
      setDisplayPercent(targetPercent);
      return undefined;
    }
    const startedAt = performance.now();
    const duration = Math.min(400, Math.max(120, (targetPercent - start) * 8));
    let frame = 0;
    const animate = (now: number) => {
      const ratio = Math.min(1, (now - startedAt) / duration);
      const next = Math.min(
        targetPercent,
        Math.round(start + (targetPercent - start) * ratio),
      );
      displayRef.current = next;
      setDisplayPercent(next);
      if (ratio < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [targetPercent]);

  return displayPercent;
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
  const displayPercent = useAnimatedPercent(
    targetPercent,
    acceptedProgress.taskId,
  );

  useEffect(() => {
    localStartedAt.current = Date.now();
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
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
    : Math.max(0, Math.ceil((autoContinueAt - now) / 1000));
  const workCopy = acceptedProgress.resultReady
    ? '全部本地分析已完成'
    : acceptedProgress.mode === 'determinate'
      ? `已处理 ${acceptedProgress.completed?.toLocaleString()} / ${acceptedProgress.total?.toLocaleString()} ${acceptedProgress.unit ? UNIT_COPY[acceptedProgress.unit] : ''}`
      : '正在执行不可拆分的本地任务';

  return (
    <div className="analysis-progress-panel" aria-live="polite">
      <div className="analysis-progress-heading">
        <div className="analysis-progress-percent" aria-label={`任务完成度 ${displayPercent}%`}>
          <strong>{displayPercent}%</strong>
          <span>任务完成度</span>
        </div>
        <div className="analysis-progress-current">
          <span>{acceptedProgress.resultReady ? '结果已就绪' : '当前任务'}</span>
          <h2>{acceptedProgress.label}</h2>
          <p>{workCopy}</p>
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
        className="analysis-progress-track"
        role="progressbar"
        aria-label={acceptedProgress.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayPercent}
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
