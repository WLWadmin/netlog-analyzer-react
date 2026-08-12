import type { ParsedEvent } from './parser';

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value));
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function updateFnv1a32(hash: number, text: string): number {
  let next = hash;
  for (let index = 0; index < text.length; index += 1) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, 0x01000193);
  }
  return next;
}

function formatHash(hash: number): string {
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function hashStableValue(value: unknown): string {
  return formatHash(updateFnv1a32(0x811c9dc5, stableStringify(value)));
}

export function netlogEventIdentity(event: ParsedEvent) {
  return {
    time: event.time,
    type: event.type,
    typeName: event.typeName,
    sourceId: event.source.id,
    sourceType: event.source.type,
    sourceTypeName: event.source.typeName,
    phase: event.phase,
    phaseName: event.phaseName,
    error: Number(event.params?.net_error ?? event.params?.error_code ?? 0),
  };
}

export interface StableSequenceFingerprint {
  accept(value: unknown): void;
  finish(): string;
}

export function createStableSequenceFingerprint(): StableSequenceFingerprint {
  let hash = updateFnv1a32(0x811c9dc5, '[');
  let count = 0;
  let finished: string | undefined;
  return {
    accept(value) {
      if (finished) throw new Error('Stable sequence fingerprint is already finished');
      if (count > 0) hash = updateFnv1a32(hash, ',');
      hash = updateFnv1a32(hash, stableStringify(value));
      count += 1;
    },
    finish() {
      if (!finished) finished = formatHash(updateFnv1a32(hash, ']'));
      return finished;
    },
  };
}
