import type { TraceDiagnosisSeverity } from './types';

export interface TraceRuleThreshold {
  warning: number;
  critical: number;
}

export const TRACE_RULE_THRESHOLDS = {
  pageMilestoneMs: { warning: 2_500, critical: 4_000 },
  longTaskMs: { warning: 50, critical: 200 },
  cpuHotspotSampleTimeMs: { warning: 50, critical: 200 },
  requestDurationMs: { warning: 1_000, critical: 3_000 },
  rendererQueueMs: { warning: 100, critical: 500 },
  renderingEventMs: { warning: 50, critical: 200 },
  interactionLatencyMs: { warning: 200, critical: 500 },
  droppedFrameRatio: { warning: 0.1, critical: 0.25 },
} as const;

export function severityForThreshold(
  value: number,
  threshold: TraceRuleThreshold,
): TraceDiagnosisSeverity | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (value >= threshold.critical) return 'critical';
  if (value >= threshold.warning) return 'warning';
  return undefined;
}
