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
  resolutionChains: Array<{
    sourceId: number;
    eventCount: number;
    kinds: string[];
    proxyServers: string[];
    pacUrls: string[];
    errors: Array<number | string>;
    firstEventId?: number;
    lastEventId?: number;
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
    summary: string;
  }>;
  impactSummaries: Array<NetlogStateTrace & {
    kind: 'bad-proxy' | 'fallback' | 'tunnel-failure' | 'request-scoped-error' | 'pac' | 'decision' | 'proxy-event';
    proxyServer?: string;
    url?: string;
    error?: number | string;
    requestScoped: boolean;
    summary: string;
    unresolvedReason?: string;
  }>;
  requestScopedCandidateCount: number;
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
  impactSummaries: Array<NetlogStateTrace & {
    kind: 'handshake' | 'version-negotiation' | 'migration' | 'error';
    sessionSourceId: number;
    host?: string;
    peerAddress?: string;
    version?: string;
    error?: number | string;
    details?: string;
    requestScoped: boolean;
    summary: string;
    unresolvedReason?: string;
  }>;
  requestScopedCandidateCount: number;
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
  impactSummaries: Array<NetlogStateTrace & {
    kind: 'connect' | 'tls' | 'stall' | 'error' | 'pool' | 'socket-event';
    peerAddress?: string;
    socketPools?: string[];
    error?: number | string;
    details?: string;
    sourceDependencyIds?: number[];
    requestScoped: boolean;
    summary: string;
    unresolvedReason?: string;
  }>;
  requestScopedCandidateCount: number;
  lazyParamsStats: {
    probeAttemptedEvents: number;
    probeSatisfiedEvents: number;
    fallbackParamEvents: number;
  };
  eventCount: number;
  connectCount: number;
  tlsCount: number;
  stallCount: number;
  socketPoolCount: number;
  evidenceGaps: string[];
}

export interface CacheStateView {
  entries: Array<{
    sourceId: number;
    sourceTypeName: string;
    eventCount: number;
    operationKinds: string[];
    urls: string[];
    cacheKeys: string[];
    errorCount: number;
    firstEventId?: number;
    lastEventId?: number;
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
    sourceDependencyIds?: number[];
  }>;
  operations: Array<NetlogStateTrace & {
    kind: 'open' | 'create' | 'read' | 'write' | 'doom' | 'validation' | 'bypass' | 'network' | 'cache-event';
    url?: string;
    cacheKey?: string;
    error?: number | string;
    summary: string;
  }>;
  impactSummaries: Array<NetlogStateTrace & {
    kind: 'miss' | 'error' | 'doom' | 'bypass' | 'validation' | 'cache-event';
    url?: string;
    cacheKey?: string;
    error?: number | string;
    requestScoped: boolean;
    summary: string;
    unresolvedReason?: string;
  }>;
  eventCount: number;
  openCount: number;
  createCount: number;
  readCount: number;
  writeCount: number;
  doomCount: number;
  bypassCount: number;
  validationCount: number;
  errorCount: number;
  requestScopedCandidateCount: number;
  evidenceGaps: string[];
}

export interface AltSvcStateView {
  alternatives: Array<{
    key: string;
    host?: string;
    origin?: string;
    protocol?: string;
    alternativeService?: string;
    port?: number | string;
    expiration?: string | number;
    eventCount: number;
    brokenCount: number;
    firstEventId?: number;
    lastEventId?: number;
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
  }>;
  events: Array<NetlogStateTrace & {
    kind: 'found' | 'used' | 'broken' | 'cleared' | 'mapped' | 'alt-svc-event';
    host?: string;
    origin?: string;
    protocol?: string;
    alternativeService?: string;
    port?: number | string;
    error?: number | string;
    summary: string;
  }>;
  impactSummaries: Array<NetlogStateTrace & {
    kind: 'broken' | 'fallback' | 'mapped' | 'alt-svc-event';
    host?: string;
    origin?: string;
    protocol?: string;
    alternativeService?: string;
    error?: number | string;
    requestScoped: boolean;
    summary: string;
    unresolvedReason?: string;
  }>;
  eventCount: number;
  foundCount: number;
  usedCount: number;
  brokenCount: number;
  clearedCount: number;
  requestScopedCandidateCount: number;
  evidenceGaps: string[];
}

export interface StreamPoolStateView {
  jobs: Array<{
    sourceId: number;
    sourceTypeName: string;
    eventCount: number;
    waitCount: number;
    stalledCount: number;
    reusedSocketCount: number;
    boundSocketCount: number;
    connectJobCount: number;
    errors: Array<number | string>;
    groups: string[];
    urls: string[];
    firstEventId?: number;
    lastEventId?: number;
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
    sourceDependencyIds?: number[];
  }>;
  events: Array<NetlogStateTrace & {
    kind: 'waiting' | 'stalled' | 'reused-socket' | 'bound-socket' | 'connect-job' | 'bound-request' | 'orphaned' | 'delayed' | 'pool-event';
    group?: string;
    url?: string;
    error?: number | string;
    summary: string;
  }>;
  impactSummaries: Array<NetlogStateTrace & {
    kind: 'stalled' | 'waiting' | 'orphaned' | 'delayed' | 'error' | 'pool-event';
    group?: string;
    url?: string;
    error?: number | string;
    requestScoped: boolean;
    summary: string;
    unresolvedReason?: string;
  }>;
  sourceLinks: Array<NetlogStateTrace & {
    fromSourceId: number;
    toSourceId: number;
    kind: 'source-dependency';
  }>;
  eventCount: number;
  waitCount: number;
  stalledCount: number;
  reusedSocketCount: number;
  boundSocketCount: number;
  connectJobCount: number;
  errorCount: number;
  requestScopedCandidateCount: number;
  evidenceGaps: string[];
}

export interface ReportingStateView {
  endpoints: Array<{
    key: string;
    origin?: string;
    group?: string;
    url?: string;
    priority?: number | string;
    weight?: number | string;
    expires?: string | number;
    eventCount: number;
    uploadCount: number;
    failureCount: number;
    firstEventId?: number;
    lastEventId?: number;
    firstByteStart?: number;
    lastByteEnd?: number;
    firstTime?: number;
    lastTime?: number;
  }>;
  events: Array<NetlogStateTrace & {
    kind: 'queued' | 'uploaded' | 'succeeded' | 'failed' | 'endpoint-config' | 'cache' | 'reporting-event';
    origin?: string;
    group?: string;
    url?: string;
    endpointUrl?: string;
    reportType?: string;
    statusCode?: number | string;
    error?: number | string;
    summary: string;
  }>;
  impactSummaries: Array<NetlogStateTrace & {
    kind: 'upload-failure' | 'endpoint-config' | 'queued' | 'cache' | 'reporting-event';
    origin?: string;
    group?: string;
    url?: string;
    endpointUrl?: string;
    reportType?: string;
    statusCode?: number | string;
    error?: number | string;
    requestScoped: boolean;
    summary: string;
    unresolvedReason?: string;
  }>;
  eventCount: number;
  endpointCount: number;
  queuedCount: number;
  uploadCount: number;
  successCount: number;
  failureCount: number;
  cacheCount: number;
  requestScopedCandidateCount: number;
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
