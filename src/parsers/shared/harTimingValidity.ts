const SUM_PHASES = ['blocked', 'dns', 'connect', 'send', 'wait', 'receive'] as const;

function duration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// HAR includes ssl within connect. Missing stages cannot prove equality,
// but recorded stages can disprove the total; allow 2ms export rounding.
export function harTimingContradictions(total: unknown, timings: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const time = duration(total);
  const sum = SUM_PHASES.reduce((value, key) => value + (duration(timings[key]) ?? 0), 0);
  if (time !== undefined && sum > time + 2) paths.push('timings');
  const ssl = duration(timings.ssl);
  const connect = duration(timings.connect);
  if (ssl !== undefined && connect !== undefined && ssl > connect + 2) paths.push('timings.ssl');
  return paths;
}
