export interface NetlogStateTrace {
  sourceId?: number;
  eventId?: number;
  byteStart?: number;
  byteEnd?: number;
  time?: number;
  typeName?: string;
}

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
    sourceId?: number;
    eventId?: number;
    byteStart?: number;
    byteEnd?: number;
    time?: number;
    typeName?: string;
  }>;
  proxyEvents: Array<NetlogStateTrace & {
    kind: 'decision' | 'pac' | 'bad-proxy' | 'fallback' | 'tunnel-failure' | 'proxy-event';
    summary: string;
    proxyServer?: string;
    url?: string;
    error?: number | string;
  }>;
  requestScopedErrors: Array<NetlogStateTrace & {
    url?: string;
    proxyServer?: string;
    error?: number | string;
    reason: string;
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
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
    handshakeEventCount?: number;
    versionNegotiationEventCount?: number;
    migrationEventCount?: number;
  }>;
  stateEvents: Array<NetlogStateTrace & {
    kind: 'handshake' | 'version-negotiation' | 'migration';
    summary: string;
    version?: string;
    peerAddress?: string;
  }>;
  errors: Array<{
    eventId: number;
    sourceId: number;
    typeName: string;
    error?: number | string;
    details?: string;
    byteStart?: number;
    byteEnd?: number;
    time?: number;
  }>;
  eventCount: number;
  http3EventCount: number;
  quicEventCount: number;
  evidenceGaps: string[];
}

export interface Http2StateView {
  sessions: Array<{
    sourceId: number;
    eventCount: number;
    streamCount: number;
    hosts: string[];
    protocols: string[];
    goawayCount: number;
    rstStreamCount: number;
    windowUpdateCount: number;
    errorCount: number;
    firstEventId?: number;
    lastEventId?: number;
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
    sourceDependencyIds?: number[];
  }>;
  streams: Array<{
    sourceId: number;
    sessionSourceId?: number;
    streamId?: number;
    eventCount: number;
    hosts: string[];
    errorCount: number;
    firstEventId?: number;
    lastEventId?: number;
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
    sourceDependencyIds?: number[];
  }>;
  sourceLinks: Array<NetlogStateTrace & {
    fromSourceId: number;
    toSourceId: number;
    kind: 'source-dependency' | 'stream-session';
  }>;
  errors: Array<{
    eventId: number;
    sourceId: number;
    sessionSourceId?: number;
    streamId?: number;
    typeName: string;
    error?: number | string;
    details?: string;
    byteStart?: number;
    byteEnd?: number;
    time?: number;
    sourceDependencyIds?: number[];
  }>;
  impactSummaries: Array<{
    sessionSourceId?: number;
    streamSourceId?: number;
    streamId?: number;
    kind: 'goaway' | 'rst-stream' | 'error';
    eventId: number;
    byteStart?: number;
    byteEnd?: number;
    time?: number;
    summary: string;
    requestScoped: boolean;
    unresolvedReason?: string;
  }>;
  unlinkedStreamCount: number;
  requestScopedCandidateCount: number;
  eventCount: number;
  goawayCount: number;
  rstStreamCount: number;
  windowUpdateCount: number;
  evidenceGaps: string[];
}

export interface SocketsStateView {
  sockets: Array<{
    sourceId: number;
    sourceTypeName: string;
    eventCount: number;
    connectCount: number;
    tlsCount: number;
    stallCount: number;
    errorCount: number;
    peerAddresses: string[];
    socketPools: string[];
    firstEventId?: number;
    lastEventId?: number;
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
    sourceDependencyIds?: number[];
  }>;
  sourceLinks: Array<NetlogStateTrace & {
    fromSourceId: number;
    toSourceId: number;
    kind: 'source-dependency';
  }>;
  errors: Array<{
    eventId: number;
    sourceId: number;
    typeName: string;
    error?: number | string;
    details?: string;
    peerAddress?: string;
    byteStart?: number;
    byteEnd?: number;
    time?: number;
    sourceDependencyIds?: number[];
  }>;
  eventCount: number;
  connectCount: number;
  tlsCount: number;
  stallCount: number;
  socketPoolCount: number;
  evidenceGaps: string[];
}

export interface NetlogSourceChainNodeView {
  id: number;
  type: string;
  url?: string;
  startTime: number;
  endTime: number;
  eventCount: number;
  hasError: boolean;
  errorCode?: number;
}

export interface NetlogSourceChainView {
  roots: number[];
  chains: Array<{
    rootId: number;
    url: string;
    path: NetlogSourceChainNodeView[];
    depth: number;
    hasError: boolean;
    duration: number;
  }>;
}

export interface NetlogRawEvidenceStructureView {
  topLevelNodes: Array<{
    key: 'constants' | 'polledData' | 'systemInfo' | 'clientInfo' | 'netLogInfo' | 'events';
    label: string;
    available: boolean;
    kind: 'metadata' | 'virtual-events';
    description: string;
    eventCount?: number;
  }>;
  evidenceGaps: string[];
}
