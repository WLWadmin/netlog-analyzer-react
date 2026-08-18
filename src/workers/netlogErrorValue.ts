const NON_ERROR_STRINGS = new Set(['', '0', 'OK', 'NO_ERROR', 'NET_OK']);

export function normalizeNetlogErrorValue(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return NON_ERROR_STRINGS.has(trimmed.toUpperCase()) ? undefined : trimmed;
}
