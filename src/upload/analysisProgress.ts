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
  return progress;
}

export function isMonotonicProgress(
  previous: AnalysisProgress | undefined,
  next: AnalysisProgress,
): boolean {
  if (!previous) return true;
  if (previous.taskId !== next.taskId) return false;
  if (next.phaseIndex < previous.phaseIndex) return false;
  if (
    next.phaseIndex === previous.phaseIndex
    && next.phase === previous.phase
    && progressRatio(next) < progressRatio(previous)
  ) {
    return false;
  }
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
  const localRatio = progress.mode === 'determinate'
    && progress.completed !== undefined
    && progress.total !== undefined
    && progress.total > 0
    ? progress.completed / progress.total
    : 0;
  // This is workflow completion, not an ETA. Measured work advances within the
  // current phase; indivisible work stays at the phase boundary.
  const overallRatio = (phaseIndex + localRatio) / phaseCount;
  return Math.min(0.99, Math.max(0.01, overallRatio));
}
