import type { ChromiumTraceEvent } from './types';

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function readEventData(
  event: ChromiumTraceEvent,
): Record<string, unknown> | undefined {
  return readRecord(readRecord(event.args)?.data);
}

export function readLocalId(value: unknown): string | undefined {
  const identifier = readString(value);
  if (
    identifier === undefined
    || identifier.length > 256
    || identifier.includes('://')
    || identifier.includes('?')
    || identifier.includes('#')
  ) {
    return undefined;
  }
  return identifier;
}

export function readFrameId(event: ChromiumTraceEvent): string | undefined {
  const args = readRecord(event.args);
  const data = readEventData(event);
  return readLocalId(data?.frame)
    ?? readLocalId(data?.frameId)
    ?? readLocalId(args?.frame);
}

export function readParentFrameId(event: ChromiumTraceEvent): string | undefined {
  const data = readEventData(event);
  return readLocalId(data?.parent) ?? readLocalId(data?.parentFrameId);
}

export function readNavigationId(event: ChromiumTraceEvent): string | undefined {
  return readLocalId(readEventData(event)?.navigationId);
}

export function readProcessId(event: ChromiumTraceEvent): number | undefined {
  return readFiniteNumber(readEventData(event)?.processId);
}

export function readThreadId(event: ChromiumTraceEvent): number | undefined {
  return readFiniteNumber(event.tid);
}

export function readIsOutermostFrame(
  event: ChromiumTraceEvent,
): boolean | undefined {
  const data = readEventData(event);
  return readBoolean(data?.isOutermostMainFrame)
    ?? readBoolean(data?.isOutermost);
}
