export const isPerfDebugEnabled = () =>
  process.env.NODE_ENV === 'development' &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem('netlog_perf_debug') === '1';

const PERF_LOG_MIN_MS = 1;

export function measurePerf<T>(label: string, fn: () => T): T {
  if (!isPerfDebugEnabled()) return fn();

  const start = performance.now();
  try {
    return fn();
  } finally {
    const cost = performance.now() - start;
    if (cost >= PERF_LOG_MIN_MS) {
      console.info(`[perf] ${label}: ${cost.toFixed(1)}ms`);
    }
  }
}

export async function measurePerfAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!isPerfDebugEnabled()) return fn();

  const start = performance.now();
  try {
    return await fn();
  } finally {
    const cost = performance.now() - start;
    if (cost >= PERF_LOG_MIN_MS) {
      console.info(`[perf] ${label}: ${cost.toFixed(1)}ms`);
    }
  }
}

export function perfLog(message: string, extra?: unknown) {
  if (!isPerfDebugEnabled()) return;
  if (extra === undefined) {
    console.info(`[perf] ${message}`);
  } else {
    console.info(`[perf] ${message}`, extra);
  }
}
