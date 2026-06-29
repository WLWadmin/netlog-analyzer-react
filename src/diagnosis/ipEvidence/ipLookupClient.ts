import { classifyIpScope } from './ipNormalize';
import type { IpLookupBatchSummary, IpLookupResult } from './ipLookupTypes';

export const DEFAULT_IP_LOOKUP_PROXY_URL = 'https://netlog-ip-lookup-proxy.a17267750421.workers.dev';

const LOOKUP_TIMEOUT_MS = 8000;
const LOOKUP_MAX_PER_MINUTE = 40;
const DEFAULT_LOOKUP_CONCURRENCY = 3;
const DEFAULT_LOOKUP_LIMIT = 20;

const requestTimestamps: number[] = [];

export function shouldLookupIp(ip: string): boolean {
  return classifyIpScope(ip) === 'public';
}

function reserveLookupBudget(count = 1): boolean {
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60_000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length + count > LOOKUP_MAX_PER_MINUTE) return false;
  for (let i = 0; i < count; i += 1) requestTimestamps.push(now);
  return true;
}

function normalizeLookupResult(ip: string, data: any, self = false): IpLookupResult {
  return {
    ip: data.query || data.ip || ip,
    status: data.status === 'success' ? 'success' : 'fail',
    country: data.country,
    regionName: data.regionName,
    city: data.city,
    timezone: data.timezone,
    isp: data.isp,
    org: data.org,
    as: data.as,
    asname: data.asname,
    message: data.message || data.error,
    self,
  };
}

async function readWorkerJson(resp: Response): Promise<any> {
  const text = await resp.text();
  if (!text) {
    return {
      status: 'fail',
      message: resp.ok ? 'empty response' : `HTTP ${resp.status}`,
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      status: 'fail',
      message: resp.ok ? 'invalid json response' : `HTTP ${resp.status}`,
    };
  }
}

function rateLimitResult(ip: string, self = false): IpLookupResult {
  return {
    ip,
    status: 'fail',
    message: '查询频率已达到本地保护阈值，请 1 分钟后再试。',
    self,
  };
}

function shouldStopByRateLimit(result: IpLookupResult): boolean {
  return result.status === 'fail' && /限流|频率|rate|limit|429/i.test(result.message || '');
}

export async function lookupIpViaProxy(
  ip: string,
  proxyUrl = DEFAULT_IP_LOOKUP_PROXY_URL,
  timeoutMs = LOOKUP_TIMEOUT_MS
): Promise<IpLookupResult> {
  if (!shouldLookupIp(ip)) {
    return {
      ip,
      status: 'fail',
      message: '仅查询公网 IP，内网 / 保留地址不会外发。',
    };
  }

  if (!reserveLookupBudget()) return rateLimitResult(ip);

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${proxyUrl.replace(/\/$/, '')}/?ip=${encodeURIComponent(ip)}`;
    const resp = await fetch(url, { signal: controller.signal });
    if (resp.status === 429) {
      return {
        ip,
        status: 'fail',
        message: '上游 IP 查询服务限流，请稍后再试。',
      };
    }
    const data = await readWorkerJson(resp);
    const result = normalizeLookupResult(ip, data);
    if (result.status === 'success') return result;
    if (!resp.ok && !result.message) {
      return { ...result, message: `HTTP ${resp.status}` };
    }
    return result;
  } catch (err) {
    return {
      ip,
      status: 'fail',
      message: err instanceof Error ? err.message : '查询失败',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function lookupCurrentClientIp(
  proxyUrl = DEFAULT_IP_LOOKUP_PROXY_URL,
  timeoutMs = LOOKUP_TIMEOUT_MS
): Promise<IpLookupResult> {
  if (!reserveLookupBudget()) return rateLimitResult('', true);

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${proxyUrl.replace(/\/$/, '')}/?self=1`;
    const resp = await fetch(url, { signal: controller.signal });
    if (resp.status === 429) {
      return {
        ip: '',
        status: 'fail',
        message: '上游 IP 查询服务限流，请稍后再试。',
        self: true,
      };
    }
    const data = await readWorkerJson(resp);
    const result = normalizeLookupResult('', data, true);
    if (result.status === 'success') return result;
    if (!resp.ok && !result.message) {
      return { ...result, message: `HTTP ${resp.status}`, self: true };
    }
    return result;
  } catch (err) {
    return {
      ip: '',
      status: 'fail',
      message: err instanceof Error ? err.message : '查询失败',
      self: true,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function lookupIpsWithLimit(
  ips: string[],
  onResult: (ip: string, result: IpLookupResult) => void,
  options?: { concurrency?: number; limit?: number; proxyUrl?: string }
): Promise<IpLookupBatchSummary> {
  const requested = Array.from(new Set(ips));
  const publicIps = requested.filter(shouldLookupIp);
  const limit = options?.limit ?? DEFAULT_LOOKUP_LIMIT;
  const queue = publicIps.slice(0, limit);
  const concurrency = options?.concurrency ?? DEFAULT_LOOKUP_CONCURRENCY;
  let cursor = 0;
  let queried = 0;
  let stoppedByRateLimit = false;

  async function runWorker() {
    while (cursor < queue.length) {
      if (stoppedByRateLimit) return;
      const ip = queue[cursor++];
      const result = await lookupIpViaProxy(ip, options?.proxyUrl);
      queried += 1;
      onResult(ip, result);
      if (shouldStopByRateLimit(result)) {
        stoppedByRateLimit = true;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, runWorker));

  return {
    requested: requested.length,
    skipped: requested.length - publicIps.length,
    queued: queue.length,
    queried,
    stoppedByRateLimit,
  };
}

export function resetIpLookupBudgetForTest() {
  requestTimestamps.splice(0, requestTimestamps.length);
}
