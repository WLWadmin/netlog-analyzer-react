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

export interface ProxyStateView {
  proxyConfigs: Array<{
    key: string;
    value: string;
    source: 'polledData' | 'systemInfo' | 'unknown';
  }>;
  pacUrls: string[];
  proxyServers: string[];
  bypassRules: string[];
  hasProxyEvidence: boolean;
  evidenceGaps: string[];
}

export interface QuicStateView {
  sessions: Array<{
    sourceId: number;
    eventCount: number;
    hosts: string[];
    peerAddresses: string[];
    versions: string[];
    errorCount: number;
    firstEventId?: number;
    lastEventId?: number;
  }>;
  errors: Array<{
    eventId: number;
    sourceId: number;
    typeName: string;
    error?: number | string;
    details?: string;
    byteStart?: number;
    byteEnd?: number;
  }>;
  eventCount: number;
  http3EventCount: number;
  quicEventCount: number;
  evidenceGaps: string[];
}
