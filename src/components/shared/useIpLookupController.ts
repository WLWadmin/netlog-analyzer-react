import { useCallback, useState } from 'react';
import {
  lookupCurrentClientIp,
  lookupIpsWithLimit,
  parseManualIps,
  shouldLookupIp,
  type IpLookupResult,
} from '../../diagnosis/ipEvidence';

interface LookupControllerNotify {
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

interface UseIpLookupControllerOptions {
  manualIpInput: string;
  notify: LookupControllerNotify;
  scrollToLookupResults(): void;
}

export function useIpLookupController({
  manualIpInput,
  notify,
  scrollToLookupResults,
}: UseIpLookupControllerOptions) {
  const [lookupMap, setLookupMap] = useState<Map<string, IpLookupResult>>(new Map());
  const [manualLookupIps, setManualLookupIps] = useState<Set<string>>(new Set());
  const [activeLookupRowId, setActiveLookupRowId] = useState<string | null>(null);
  const [bulkLookupLoading, setBulkLookupLoading] = useState(false);
  const [manualLookupLoading, setManualLookupLoading] = useState(false);
  const [selfLookup, setSelfLookup] = useState<IpLookupResult | undefined>();
  const [selfLookupLoading, setSelfLookupLoading] = useState(false);

  const queryIps = useCallback(async (
    rawIps: string[],
    options?: { rowId?: string; mode?: 'bulk' | 'manual' | 'row' }
  ) => {
    const uniqueIps = Array.from(new Set(rawIps)).filter(Boolean);
    const publicIps = uniqueIps.filter(shouldLookupIp);
    const filteredPrivateIps = uniqueIps.length - publicIps.length;
    const missingIps = publicIps.filter(ip => !lookupMap.has(ip));
    const mode = options?.mode;

    if (publicIps.length === 0) {
      notify.info('没有可查询的公网 IP，内网 / 保留地址不会外发。');
      return;
    }
    if (missingIps.length === 0) {
      notify.info('这些公网 IP 已有查询结果');
      scrollToLookupResults();
      return;
    }

    const limitedIps = missingIps.slice(0, 20);
    notify.info(`将通过 Cloudflare Worker 代理查询 ${limitedIps.length} 个公网 IP，内网 IP 不会外发。`);
    if (mode === 'row') setActiveLookupRowId(options?.rowId || null);
    if (mode === 'bulk') setBulkLookupLoading(true);
    if (mode === 'manual') setManualLookupLoading(true);

    try {
      const summaryResult = await lookupIpsWithLimit(limitedIps, (ip, result) => {
        setLookupMap(prev => {
          const next = new Map(prev);
          next.set(ip, result);
          return next;
        });
      }, { concurrency: 3, limit: 20 });

      if (summaryResult.stoppedByRateLimit) {
        notify.warning('上游或本地查询频率已触发保护，本轮剩余 IP 已停止查询。');
      } else if (filteredPrivateIps > 0) {
        notify.info(`已过滤 ${filteredPrivateIps} 个内网 / 保留地址。`);
      }
      notify.success('查询完成，已跳转到 IP 归属查询结果');
      scrollToLookupResults();
    } finally {
      if (mode === 'row') setActiveLookupRowId(null);
      if (mode === 'bulk') setBulkLookupLoading(false);
      if (mode === 'manual') setManualLookupLoading(false);
    }
  }, [lookupMap, notify, scrollToLookupResults]);

  const queryManualIps = useCallback(async () => {
    const ips = parseManualIps(manualIpInput);
    if (ips.length === 0) {
      notify.info('请输入要查询的 IP，支持逗号、空格或换行分隔。');
      return;
    }
    setManualLookupIps(prev => new Set([...Array.from(prev), ...ips]));
    await queryIps(ips, { mode: 'manual' });
  }, [manualIpInput, notify, queryIps]);

  const querySelfIp = useCallback(async () => {
    setSelfLookupLoading(true);
    try {
      const result = await lookupCurrentClientIp();
      setSelfLookup(result);
      if (result.ip) {
        setLookupMap(prev => {
          const next = new Map(prev);
          next.set(result.ip, result);
          return next;
        });
      }
      if (result.status === 'success') {
        notify.success('当前出口 IP 查询完成');
      } else {
        notify.warning(result.message || '当前出口 IP 查询失败');
      }
      scrollToLookupResults();
    } catch (err) {
      setSelfLookup({
        ip: '',
        status: 'fail',
        message: err instanceof Error ? err.message : '当前出口 IP 查询失败',
        self: true,
      });
      notify.warning(err instanceof Error ? err.message : '当前出口 IP 查询失败');
    } finally {
      setSelfLookupLoading(false);
    }
  }, [notify, scrollToLookupResults]);

  return {
    lookupMap,
    manualLookupIps,
    activeLookupRowId,
    bulkLookupLoading,
    manualLookupLoading,
    selfLookup,
    selfLookupLoading,
    queryIps,
    queryManualIps,
    querySelfIp,
  };
}
