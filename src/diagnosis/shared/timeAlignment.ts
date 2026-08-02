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
import type { TimeAlignment } from '../../workbench/crossSourceProtocol';

export interface AlignmentAnchor {
  anchorId: string;
  type: TimeAlignment['anchorType'];
  sourceTime: { value: number; unit: 'us' | 'ms' };
  traceTimeUs: number;
  evidenceIds: string[];
}

function toUs(time: AlignmentAnchor['sourceTime']): number | undefined {
  if (!Number.isFinite(time.value)) return undefined;
  const value = time.unit === 'ms' ? time.value * 1_000 : time.value;
  return Number.isSafeInteger(Math.trunc(value)) ? value : undefined;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function alignClockDomains(input: {
  alignmentId: string;
  sourceIds: string[];
  anchors: AlignmentAnchor[];
  conflictThresholdUs?: number;
  unavailableReason?: string;
}): TimeAlignment {
  if (input.unavailableReason) {
    return {
      alignmentId: input.alignmentId,
      sourceIds: [...input.sourceIds],
      anchorType: input.anchors[0]?.type ?? 'phase-feature',
      offsetUs: 0,
      uncertaintyUs: Number.MAX_SAFE_INTEGER,
      sampleCount: 0,
      conflicts: [],
      confidence: 'unavailable',
      limitations: [input.unavailableReason],
    };
  }
  const validAnchors = input.anchors.flatMap(anchor => {
    const sourceUs = toUs(anchor.sourceTime);
    return sourceUs === undefined || !Number.isFinite(anchor.traceTimeUs)
      ? []
      : [{ anchor, sourceUs, offsetUs: anchor.traceTimeUs - sourceUs }];
  });
  if (validAnchors.length === 0) {
    return {
      alignmentId: input.alignmentId,
      sourceIds: [...input.sourceIds],
      anchorType: input.anchors[0]?.type ?? 'phase-feature',
      offsetUs: 0,
      uncertaintyUs: Number.MAX_SAFE_INTEGER,
      sampleCount: 0,
      conflicts: [],
      confidence: 'unavailable',
      limitations: [
        input.unavailableReason ?? '没有有限且单位明确的校时锚点。',
      ],
    };
  }
  const offsetUs = median(validAnchors.map(item => item.offsetUs));
  const uncertaintyUs = Math.max(
    ...validAnchors.map(item => Math.abs(item.offsetUs - offsetUs)),
  );
  const conflictThresholdUs = input.conflictThresholdUs ?? 5_000;
  const conflicts = validAnchors
    .filter(item => Math.abs(item.offsetUs - offsetUs) > conflictThresholdUs)
    .map(item => `锚点 ${item.anchor.anchorId} 与中位 offset 冲突`);
  const sourceTimes = validAnchors.map(item => item.sourceUs);
  const confidence = conflicts.length > 0
    ? 'low'
    : validAnchors.length >= 2
      ? 'high'
      : 'medium';
  return {
    alignmentId: input.alignmentId,
    sourceIds: [...input.sourceIds],
    anchorType: validAnchors[0].anchor.type,
    offsetUs,
    uncertaintyUs,
    sampleCount: validAnchors.length,
    conflicts,
    validRange: {
      startUs: Math.min(...sourceTimes),
      endUs: Math.max(...sourceTimes),
    },
    confidence,
    limitations: [
      ...(validAnchors.length === 1
        ? ['只有一个校时锚点，不能排除时钟漂移。']
        : []),
      ...(conflicts.length > 0
        ? ['锚点冲突，禁止用于确定性端到端耗时。']
        : []),
    ],
  };
}

export function projectAlignedTimeUs(
  time: { value: number; unit: 'us' | 'ms' },
  alignment: TimeAlignment,
): number | undefined {
  if (
    alignment.confidence === 'unavailable'
    || alignment.confidence === 'low'
  ) return undefined;
  const sourceUs = toUs(time);
  if (sourceUs === undefined) return undefined;
  if (
    alignment.validRange
    && (
      sourceUs < alignment.validRange.startUs
      || sourceUs > alignment.validRange.endUs
    )
  ) return undefined;
  const projected = sourceUs + alignment.offsetUs;
  return Number.isSafeInteger(Math.trunc(projected)) ? projected : undefined;
}

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
