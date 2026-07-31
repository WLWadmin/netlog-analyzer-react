import { TRACE_LIMITS } from './traceLimits';
import type {
  ChromiumTraceEvent,
  TraceSourceClassification,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function classifyParsedTraceSource(
  value: unknown,
  maxEvents: number = TRACE_LIMITS.maxEvents,
): TraceSourceClassification {
  if (Array.isArray(value)) {
    return { kind: 'error', code: 'TRACE_TOP_LEVEL_ARRAY_UNSUPPORTED' };
  }
  if (!isRecord(value)) {
    return { kind: 'error', code: 'TRACE_SHAPE_INVALID' };
  }

  const signatures = [
    Array.isArray(value.traceEvents) ? 'trace' : undefined,
    isRecord(value.log) && Array.isArray(value.log.entries) ? 'har' : undefined,
    Array.isArray(value.events) ? 'netlog' : undefined,
  ].filter((source): source is 'trace' | 'har' | 'netlog' => source !== undefined);

  if (new Set(signatures).size > 1) {
    return { kind: 'error', code: 'TRACE_SOURCE_AMBIGUOUS' };
  }
  if (signatures[0] === 'har' || signatures[0] === 'netlog') {
    return { kind: 'detected-source', source: signatures[0] };
  }
  if (signatures[0] !== 'trace') {
    return { kind: 'error', code: 'TRACE_SOURCE_UNKNOWN' };
  }

  const events: unknown[] = Array.isArray(value.traceEvents)
    ? value.traceEvents
    : [];
  if (events.length > maxEvents) {
    return { kind: 'error', code: 'TRACE_EVENT_LIMIT_EXCEEDED' };
  }
  let skippedEventCount = 0;
  const traceEvents = events.map(event => {
    if (isRecord(event)) return event as ChromiumTraceEvent;
    skippedEventCount += 1;
    return {};
  });
  return {
    kind: 'trace',
    trace: { ...value, traceEvents },
    skippedEventCount,
  };
}
