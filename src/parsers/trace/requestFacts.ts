import { type TraceInterval, unionDuration } from './taskFacts';

export type TraceRequestResult =
  | 'success'
  | 'http-error'
  | 'transport-failed'
  | 'cancelled'
  | 'incomplete-at-trace-end'
  | 'unknown-failure';

export interface RequestClassificationInput {
  statusCode?: number;
  failed?: boolean;
  cancelledSignal: 'explicit' | 'navigation-overlap' | 'none';
  hasFinish: boolean;
  traceEnded: boolean;
}

export interface RequestClassification {
  result: TraceRequestResult;
  confidence: 'high' | 'medium' | 'observation';
}

export function classifyRequest(
  input: RequestClassificationInput,
): RequestClassification {
  if (input.statusCode !== undefined && input.statusCode >= 400) {
    return { result: 'http-error', confidence: 'high' };
  }
  if (input.failed === true && input.cancelledSignal === 'explicit') {
    return { result: 'cancelled', confidence: 'high' };
  }
  if (input.failed === true && input.cancelledSignal === 'navigation-overlap') {
    return { result: 'cancelled', confidence: 'medium' };
  }
  if (input.failed === true) {
    return { result: 'transport-failed', confidence: 'medium' };
  }
  if (!input.hasFinish && input.traceEnded) {
    return { result: 'incomplete-at-trace-end', confidence: 'observation' };
  }
  if (input.statusCode !== undefined && input.statusCode < 400) {
    return { result: 'success', confidence: 'high' };
  }
  return { result: 'unknown-failure', confidence: 'observation' };
}

export interface DispatchWaitInput {
  calibratedNetworkResponseMs: number;
  rendererResponseEventMs: number;
  networkTimeDomain?: string;
  rendererTimeDomain?: string;
  traceTimeDomain?: string;
  mainThreadBusyIntervals: readonly TraceInterval[];
}

export interface DispatchWaitFact {
  dispatchWaitMs: number;
  mainThreadOverlapMs: number;
}

export function buildDispatchWaitFact(
  input: DispatchWaitInput,
): DispatchWaitFact | undefined {
  if (!input.networkTimeDomain
    || input.networkTimeDomain !== input.rendererTimeDomain
    || input.rendererTimeDomain !== input.traceTimeDomain
    || !Number.isFinite(input.calibratedNetworkResponseMs)
    || !Number.isFinite(input.rendererResponseEventMs)) {
    return undefined;
  }
  const dispatchWaitMs = Math.max(
    input.rendererResponseEventMs - input.calibratedNetworkResponseMs,
    0,
  );
  if (dispatchWaitMs === 0) return undefined;

  const waitInterval = {
    start: input.calibratedNetworkResponseMs,
    end: input.rendererResponseEventMs,
  };
  const overlaps = input.mainThreadBusyIntervals.map(interval => ({
    start: Math.max(waitInterval.start, interval.start),
    end: Math.min(waitInterval.end, interval.end),
  }));
  const mainThreadOverlapMs = unionDuration(overlaps);
  return mainThreadOverlapMs > 0
    ? { dispatchWaitMs, mainThreadOverlapMs }
    : undefined;
}
