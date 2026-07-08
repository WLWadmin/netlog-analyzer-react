function pad(value: number, size = 2) {
  return String(value).padStart(size, '0');
}

export function formatNetlogWallTime(time: number | undefined, timeTickOffset?: number): string {
  if (time === undefined || !Number.isFinite(time)) return '-';
  if (timeTickOffset === undefined || !Number.isFinite(timeTickOffset)) return `${Math.round(time)}ms`;

  const date = new Date(timeTickOffset + time);
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
    '.',
    pad(date.getMilliseconds(), 3),
  ].join('');
}

export function formatNetlogWallTimeRange(start: number | undefined, end: number | undefined, timeTickOffset?: number): string {
  return `${formatNetlogWallTime(start, timeTickOffset)} - ${formatNetlogWallTime(end, timeTickOffset)}`;
}
