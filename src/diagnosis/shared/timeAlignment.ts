/**
 * HAR / NetLog 时间基准对齐
 *
 * 重要说明：
 * - HAR 的 `startedDateTime/startMs` 是“绝对时间”（通常为 epoch ms）
 * - NetLog 的 `event.time`/`URLRequest.startTime` 在不同采集配置下可能是相对时间
 * - 在无法明确 NetLog time origin 的情况下，不应直接做绝对时间差计算，否则会误关联
 *
 * 当前策略：
 * - 保守禁用 time-window 对齐，仅提供禁用原因，供联合诊断写入 limitations/confidenceFactors
 * - 后续如果 parser 能提供 `netlogTimeOriginMs`（或明确 event.time 为 epoch），再启用
 */

import type { HarRequestEntry } from '../../harParser';
import type { NetlogClockContext, URLRequest } from '../../parsers/netlog/parser';

export interface TimeAlignmentContext {
  enabled: boolean;
  reason: string;
  windowMs?: number;
  clockKind: NetlogClockContext['kind'] | 'missing';
  confidence: NetlogClockContext['confidence'];
  originMs?: number;
  evidence?: string;
}

export function buildTimeAlignmentContext(
  harEntries: HarRequestEntry[],
  netlogRequests: URLRequest[],
  netlogClockContext?: NetlogClockContext
): TimeAlignmentContext {
  const hasHarTime = harEntries.some(e => Number.isFinite(e.startMs));
  const hasNetlogTime = netlogRequests.some(r => Number.isFinite(r.startTime));

  if (!hasHarTime || !hasNetlogTime) {
    return {
      enabled: false,
      reason: 'HAR 或 NetLog 缺少可比较时间字段，禁用时间窗口对齐',
      clockKind: netlogClockContext?.kind || 'missing',
      confidence: netlogClockContext?.confidence || 'none',
      evidence: netlogClockContext?.evidence,
    };
  }

  if (netlogClockContext?.confidence === 'verified' && Number.isFinite(netlogClockContext.originMs)) {
    return {
      enabled: true,
      reason: 'NetLog time origin 已由结构化 clock context 验证，可启用时间窗口对齐',
      windowMs: 5000,
      clockKind: netlogClockContext.kind,
      confidence: netlogClockContext.confidence,
      originMs: netlogClockContext.originMs,
      evidence: netlogClockContext.evidence,
    };
  }

  return {
    enabled: false,
    reason: 'NetLog event.time/startTime 的 time origin 未明确，禁用时间窗口对齐以避免误关联',
    clockKind: netlogClockContext?.kind || 'missing',
    confidence: netlogClockContext?.confidence || 'none',
    evidence: netlogClockContext?.evidence,
  };
}

export function netlogTimeToEpochMs(time: number, context: TimeAlignmentContext): number | undefined {
  if (!context.enabled || !Number.isFinite(time)) return undefined;
  if (context.clockKind === 'epoch') return time;
  if (context.clockKind === 'time-tick-offset' && Number.isFinite(context.originMs)) {
    return (context.originMs || 0) + time;
  }
  return undefined;
}
