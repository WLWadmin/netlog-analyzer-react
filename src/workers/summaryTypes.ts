import type { ProxyInfo } from '../parsers/netlog/parser';

export interface NetlogRequestPreview {
  id: number;
  url: string;
  method: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: string;
  statusCode?: number;
  error?: number;
  errorDesc?: string;
  resolvedIp?: string | null;
  remoteIp?: string | null;
  protocol?: 'HTTP/1.1' | 'HTTP/2' | 'QUIC';
  timeline?: {
    dns?: number;
    connect?: number;
    ssl?: number;
    send?: number;
    wait?: number;
    download?: number;
  };
}

export interface IssueCounts {
  error: number;
  warning: number;
  info: number;
}

/**
 * 主线程安全的 NetLog 摘要类型：
 * - 只包含统计与少量 TopN 预览
 * - 不包含全量 events/urlRequests，也不包含任何 ParsedEvent[] 派生大数组
 */
export interface NetlogSummary {
  kind: 'netlog';
  totalEvents: number;
  uniqueSources: number;
  peakConcurrency: number;
  timeRange: { start: number; end: number };
  protocols: Record<string, number>;
  issueCounts: IssueCounts;
  proxyInfo: ProxyInfo;
  systemInfo: {
    os: string | null;
    browser: string | null;
    netLogVersion: string | null;
    commandLine: string | null;
  };
  requestCount: number;
  slowRequestPreviews: NetlogRequestPreview[];
  failedDomainPreviews: Array<{
    domain: string;
    count: number;
    errorCodes: number[];
    firstTime: number;
    lastTime: number;
  }>;
}

export interface HarEntryPreview {
  id: number;
  url: string;
  method: string;
  status: number;
  time: number;
  startMs: number;
  domain: string;
  /** URL pathname（或近似展示字段） */
  path: string;
  isSlow: boolean;
  isFailed: boolean;
  xTtLogid?: string;
}

/**
 * 主线程安全的 HAR 摘要类型：
 * - 不包含 entries 全量列表
 * - 只包含统计与 TopN 预览
 */
export interface HarSummary {
  kind: 'har';
  totalRequests: number;
  failedRequests: number;
  slowRequests: number;
  domainCount: number;
  slowEntryPreviews: HarEntryPreview[];
  repairInfo?: unknown;
}
