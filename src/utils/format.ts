// Shared formatting utilities

export function formatDuration(ms: number): string {
  if (!ms || ms === 0) return '-';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return ms.toFixed(0) + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

export function truncateUrl(url: string, maxLen: number): string {
  if (!url) return '-';
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const full = u.host + path;
    if (full.length <= maxLen) return full;
    return full.substring(0, maxLen - 2) + '\u00B7\u00B7\u00B7';
  } catch {
    if (url.length <= maxLen) return url;
    return url.substring(0, maxLen - 2) + '\u00B7\u00B7\u00B7';
  }
}

export function formatTime(ms: number): string {
  if (ms === Infinity || ms === 0) return '-';
  return ms.toFixed(0) + 'ms';
}
