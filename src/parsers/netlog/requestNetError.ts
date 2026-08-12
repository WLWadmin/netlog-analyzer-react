import type { ParsedEvent } from './parser';

const NON_TERMINAL_REQUEST_NET_ERRORS = new Set([
  -1,   // ERR_IO_PENDING
  -173, // ERR_WS_UPGRADE
  -406, // ERR_CACHE_RACE
]);

export function getTerminalRequestNetError(event: ParsedEvent): number | null {
  if (event.source.typeName !== 'URL_REQUEST') return null;
  const raw = event.params?.net_error;
  if (raw === undefined || raw === null || raw === '') return null;
  const code = Number(raw);
  if (
    !Number.isFinite(code)
    || code === 0
    || NON_TERMINAL_REQUEST_NET_ERRORS.has(code)
  ) {
    return null;
  }
  return code;
}
