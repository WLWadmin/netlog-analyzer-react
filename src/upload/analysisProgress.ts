import type { FileParserId } from './fileFormatTypes';

export type AnalysisPhase =
  | 'container-check'
  | 'reading'
  | 'decompressing'
  | 'probing-format'
  | 'awaiting-confirmation'
  | 'validating'
  | 'parsing-structure'
  | 'scanning-records'
  | 'building-facts'
  | 'running-diagnosis'
  | 'preparing-result';

export type ProgressUnit = 'bytes' | 'events' | 'requests' | 'lines' | 'rules';

export interface AnalysisProgress {
  taskId: string;
  parserId?: FileParserId;
  phase: AnalysisPhase;
  label: string;
  mode: 'determinate' | 'indeterminate';
  completed?: number;
  total?: number;
  unit?: ProgressUnit;
  phaseIndex: number;
  phaseCount: number;
  /**
   * Optional bounds for a measured sub-step inside one high-level phase.
   * They describe workflow completion, not elapsed-time estimates.
   */
  phaseProgressStart?: number;
  phaseProgressSpan?: number;
  startedAt: number;
  updatedAt: number;
  resultReady?: boolean;
}

export function buildAnalysisProgress(
  progress: AnalysisProgress,
): AnalysisProgress {
  if (
    progress.mode === 'determinate'
    && (
      progress.completed === undefined
      || progress.total === undefined
      || progress.unit === undefined
    )
  ) {
    throw new Error('determinate progress requires completed, total and unit');
  }
  if (
    progress.completed !== undefined
    && progress.total !== undefined
    && (
      progress.completed < 0
      || progress.total < 0
      || progress.completed > progress.total
    )
  ) {
    throw new Error('progress completed must be between zero and total');
  }
  const phaseProgressStart = progress.phaseProgressStart ?? 0;
  const phaseProgressSpan = progress.phaseProgressSpan ?? 1;
  if (
    phaseProgressStart < 0
    || phaseProgressStart > 1
    || phaseProgressSpan < 0
    || phaseProgressStart + phaseProgressSpan > 1
  ) {
    throw new Error('phase progress range must stay within the current phase');
  }
  return progress;
}

export function isMonotonicProgress(
  previous: AnalysisProgress | undefined,
  next: AnalysisProgress,
): boolean {
  if (!previous) return true;
  if (previous.taskId !== next.taskId) return false;
  if (next.phaseIndex < previous.phaseIndex) return false;
  if (progressRatio(next) < progressRatio(previous)) return false;
  return true;
}

export function progressRatio(
  progress: AnalysisProgress,
): number {
  if (progress.resultReady) return 1;
  const phaseCount = Math.max(1, progress.phaseCount);
  const phaseIndex = Math.min(
    Math.max(0, progress.phaseIndex),
    phaseCount - 1,
  );
  const measuredRatio = progress.mode === 'determinate'
    && progress.completed !== undefined
    && progress.total !== undefined
    && progress.total > 0
    ? progress.completed / progress.total
    : 0;
  const phaseProgressStart = progress.phaseProgressStart ?? 0;
  const phaseProgressSpan = progress.phaseProgressSpan ?? 1;
  const localRatio = phaseProgressStart + measuredRatio * phaseProgressSpan;
  // This is workflow completion, not an ETA. Measured work advances within the
  // current phase; indivisible work stays at the phase boundary.
  const overallRatio = (phaseIndex + localRatio) / phaseCount;
  return Math.min(0.99, Math.max(0.01, overallRatio));
}
