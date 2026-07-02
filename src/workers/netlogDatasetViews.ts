export interface DataLoadedView {
  fileName: string;
  fileSize: number;
  eventCount: number;
  hasConstants: boolean;
  hasPolledData: boolean;
  hasSystemInfo: boolean;
  hasClientInfo: boolean;
  hasNetLogInfo: boolean;
  eventTypeCount: number;
  sourceTypeCount: number;
  topEventTypes: Array<{ name: string; count: number }>;
  topSourceTypes: Array<{ name: string; count: number }>;
  evidenceGaps: string[];
}

export interface DnsStateView {
  configServers: Array<{
    ip: string;
    source: 'polledData' | 'systemInfo' | 'unknown';
    sourceKey?: string;
    sourceId?: number;
    eventId?: number;
    byteStart?: number;
    byteEnd?: number;
  }>;
  hostResolverCache: Array<{
    host: string;
    ips: string[];
    aliases: string[];
    ttl?: string | number;
    expires?: string | number;
    sourceId?: number;
    eventId?: number;
    byteStart?: number;
    byteEnd?: number;
  }>;
  taskResults: Array<{
    host: string;
    queryType?: string;
    ips: string[];
    aliases: string[];
    error?: number;
    sourceId?: number;
    eventId?: number;
    byteStart?: number;
    byteEnd?: number;
  }>;
  dnsErrors: Array<{
    host: string;
    queryType?: string;
    error: number;
    sourceId?: number;
    eventId?: number;
    byteStart?: number;
    byteEnd?: number;
  }>;
  dohCandidates: Array<{
    value: string;
    source: 'polledData' | 'dns_event' | 'unknown';
    sourceKey?: string;
    sourceId?: number;
    eventId?: number;
    byteStart?: number;
    byteEnd?: number;
  }>;
  ipv6ReachabilityChecks: Array<{
    available?: boolean;
    eventId?: number;
    sourceId?: number;
    byteStart?: number;
    byteEnd?: number;
  }>;
  evidenceGaps: string[];
}
