import { EVENT_TYPES, SOURCE_TYPES, PHASE, getNetErrorDescription, isHttp2Goaway } from './constants';
import { classifySslIssueCategory } from './errorClassifier';
import { truncateUrl } from '../../utils/format';
import { SLOW_REQUEST_MS } from '../../constants/analysisThresholds';
import { assertNoCompetingRootFormat } from '../shared/rootFormatGuard';
import { hashStableValue, netlogEventIdentity } from './stableFingerprint';
import { createRequestAccumulator } from './requestAccumulator';
import {
  buildCleanAssessmentIssue,
  buildConnectionFailureIssue,
  buildHttp2GoawaySummary,
  buildHttp2GoawayIssue,
  buildNetworkErrorIssues,
  buildProxySummary,
  buildQuicEventIssue,
  buildSslDiagnosticIssue,
} from './diagnosticRules';

export interface ParsedEvent {
  time: number;
  type: number;
  typeName: string;
  source: {
    id: number;
    type: number;
    typeName: string;
  };
  phase: number;
  phaseName: string;
  params: Record<string, any>;
}

export interface URLRequest {
  id: number;
  url: string;
  method: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: string;
  statusCode?: number;
  error?: number;
  errorDesc?: string;       // ERR_FAILED format description
  resolvedIp?: string | null;  // x-response-cinfo / x-tt-cip / x-lsc-source-ip
  remoteIp?: string | null;    // x-response-sinfo
  protocol?: 'HTTP/1.1' | 'HTTP/2' | 'QUIC';
  events: ParsedEvent[];
  eventCount?: number;
  eventSequenceFingerprint?: string;
  relatedSourceIds?: number[];
  relatedSourceTypeNames?: string[];
  lifecycleStageDurations?: Record<string, number>;
  timeline: RequestTimeline;
}

export interface RequestTimeline {
  dns?: PhaseInfo;
  connect?: PhaseInfo;
  ssl?: PhaseInfo;
  send?: PhaseInfo;
  wait?: PhaseInfo;
  download?: PhaseInfo;
}

export interface PhaseInfo {
  start: number;
  end: number;
  duration: number;
}

export interface ProxyInfo {
  hasProxy: boolean;
  proxyType: string | null;
  proxySettings: any;
  effectiveProxy: any;
  originalProxy: any;
  pacUrl: string | null;
  proxyList: string[];
  proxyFallback: string | null;
  isVPN: boolean;
  vpnHints: string[];
}

export interface FailedDomain {
  domain: string;
  urls: string[];
  errors: { code: number; desc: string; time: number }[];
  errorCodes: number[];
  ips: string[];
  resolvedIp: string | null;      // x-response-cinfo / x-tt-cip / x-lsc-source-ip
  remoteIp: string | null;        // x-response-sinfo
  count: number;
  firstTime: number;
  lastTime: number;
}

export interface DiagnosisIssue {
  severity: 'error' | 'warning' | 'info' | 'ok' | 'critical';
  category: string;
  message: string;
  detail: string;
  time: number;
}

export interface SslIssue {
  event: ParsedEvent;
  error: number;
  host: string;
  category: 'cert' | 'timeout' | 'protocol' | 'connection' | 'other';
}

export interface DnsRecord {
  host: string;
  ips: string[];
  source: 'dns_cache' | 'dns_event' | 'socket_event' | 'unknown';
  time?: number;
}

export interface DohCandidate {
  value: string;
  source: 'polledData' | 'dns_event' | 'unknown';
}

export interface NetlogClockContext {
  kind: 'time-tick-offset' | 'epoch' | 'relative-only' | 'unknown';
  unit: 'ms';
  originMs?: number;
  confidence: 'verified' | 'low' | 'none';
  evidence: string;
}

export type NetlogEventCategory =
  | 'dns'
  | 'connect'
  | 'ssl'
  | 'proxy'
  | 'quic'
  | 'http2'
  | 'cache'
  | 'networkChange';

export interface NetlogEventCategoryStat {
  count: number;
  sequenceFingerprint: string;
  errorCount: number;
  errorEvidence: Array<{
    time: number;
    typeName: string;
    sourceId: number;
    error: number;
  }>;
  hitCount: number;
  missCount: number;
  goawayCount: number;
  suggestionGoawayCount: number;
}

export interface NetlogDiagnosticContextEvent {
  category: NetlogEventCategory;
  time: number;
  typeName: string;
  sourceId: number;
}

export interface NetlogDiagnosticContextIndex {
  count: number;
  chunkSize: number;
  categoryChunks: readonly Uint8Array[];
  timeChunks: readonly Float64Array[];
  typeNameChunks: readonly Uint32Array[];
  sourceIdChunks: readonly Uint32Array[];
  typeNames: readonly string[];
  sortedOrder?: Uint32Array;
}

export interface AnalysisResult {
  totalEvents: number;
  timeTickOffset?: number;
  netlogClockContext?: NetlogClockContext;
  uniqueSources: number;
  peakConcurrency: number;
  urlRequests: URLRequest[];
  sslEvents: ParsedEvent[];
  quicEvents: ParsedEvent[];
  http2Events: ParsedEvent[];
  dnsEvents: ParsedEvent[];
  connectEvents: ParsedEvent[];
  proxyEvents: ParsedEvent[];
  errors: DiagnosisIssue[];
  warnings: DiagnosisIssue[];
  info: DiagnosisIssue[];
  timeRange: { start: number; end: number };
  protocols: Record<string, number>;
  hosts: Record<string, string>;
  dnsServers: string[];
  dnsRecords: DnsRecord[];
  dohCandidates?: DohCandidate[];
  errorSources: Record<string, number>;
  certIssues: SslIssue[];
  sslIssues: SslIssue[];
  connectionFailures: { requestId?: number; url: string; error: number; time: number }[];
  stalledRequests: URLRequest[];
  slowRequests: URLRequest[];
  cacheEvents: ParsedEvent[];
  networkChanges: ParsedEvent[];
  eventCategoryStats?: Record<NetlogEventCategory, NetlogEventCategoryStat>;
  diagnosticContextEvents?: NetlogDiagnosticContextEvent[];
  diagnosticContextIndex?: NetlogDiagnosticContextIndex;
  proxyInfo: ProxyInfo;
  failedDomains: FailedDomain[];
  systemInfo: {
    os: string | null;
    browser: string | null;
    netLogVersion: string | null;
    commandLine: string | null;
  };
  largeFileMode?: {
    enabled: true;
    fileSize: number;
    bytesRead: number;
    parsedEvents: number;
    skippedEvents: number;
    truncatedEventsPreview: boolean;
    reachedEventsEnd: boolean;
  };
}



export function parseLog(
  logData: any,
  onEventProgress?: (completed: number, total: number) => void,
): { events: ParsedEvent[]; result: AnalysisResult } {
  assertNoCompetingRootFormat(logData, 'netlog');
  const result: AnalysisResult = {
    totalEvents: 0,
    uniqueSources: 0,
    peakConcurrency: 0,
    urlRequests: [],
    sslEvents: [],
    quicEvents: [],
    http2Events: [],
    dnsEvents: [],
    connectEvents: [],
    proxyEvents: [],
    errors: [],
    warnings: [],
    info: [],
    timeRange: { start: Infinity, end: 0 },
    protocols: {},
    hosts: {},
    errorSources: {},
    certIssues: [],
    sslIssues: [],
    connectionFailures: [],
    stalledRequests: [],
    slowRequests: [],
    cacheEvents: [],
    networkChanges: [],
    proxyInfo: {
      hasProxy: false,
      proxyType: null,
      proxySettings: null,
      effectiveProxy: null,
      originalProxy: null,
      pacUrl: null,
      proxyList: [],
      proxyFallback: null,
      isVPN: false,
      vpnHints: [],
    },
    failedDomains: [],
    systemInfo: { os: null, browser: null, netLogVersion: null, commandLine: null },
    dnsServers: [],
    dnsRecords: [],
    dohCandidates: [],
  };

  // Extract events
  let events: any[] = [];
  if (logData.events) events = logData.events;
  else if (logData.logEvents) events = logData.logEvents;
  else if (Array.isArray(logData)) events = logData;
  else {
    for (const key of Object.keys(logData)) {
      if (Array.isArray(logData[key]) && logData[key].length > 0 && logData[key][0].type !== undefined) {
        events = logData[key];
        break;
      }
    }
  }

  if (!events.length) throw new Error('未找到有效的网络事件数据');

  const constants = logData.constants || {};
  const timeTickOffset = Number(constants.timeTickOffset);
  if (Number.isFinite(timeTickOffset)) {
    result.timeTickOffset = timeTickOffset;
    result.netlogClockContext = {
      kind: 'time-tick-offset',
      unit: 'ms',
      originMs: timeTickOffset,
      confidence: 'verified',
      evidence: 'constants.timeTickOffset',
    };
  } else {
    result.netlogClockContext = {
      kind: 'relative-only',
      unit: 'ms',
      confidence: 'none',
      evidence: 'NetLog constants did not include a verified time origin',
    };
  }

  // Build NUMBER→STRING reverse maps from file's constants (STRING→NUMBER in the file)
  const eventNamesRaw = constants.logEventTypes || constants.eventTypes || {};
  const eventNames: Record<number, string> = {};
  for (const [name, id] of Object.entries(eventNamesRaw)) {
    if (typeof id === 'number') {
      eventNames[id] = name;
    }
  }

  const sourceNamesRaw = constants.logSourceType || constants.sourceTypes || {};
  const sourceNames: Record<number, string> = {};
  for (const [name, id] of Object.entries(sourceNamesRaw)) {
    if (typeof id === 'number') {
      sourceNames[id] = name;
    }
  }

  // System info
  if (logData.systemInfo) {
    result.systemInfo.os = logData.systemInfo.os || logData.systemInfo.operating_system;
    result.systemInfo.browser = logData.systemInfo.product;
    result.systemInfo.commandLine = logData.systemInfo.command_line;
  }
  if (logData.clientInfo) {
    result.systemInfo.os = logData.clientInfo.os || result.systemInfo.os;
    result.systemInfo.browser = logData.clientInfo.product || result.systemInfo.browser;
    result.systemInfo.commandLine = logData.clientInfo.command_line || result.systemInfo.commandLine;
  }
  if (logData.netLogInfo) {
    result.systemInfo.netLogVersion = logData.netLogInfo.version;
  }

  // Parse polledData for proxy/DNS/network info
  if (logData.polledData) {
    parsePolledData(logData.polledData, result);
  }

  const parsedEvents: ParsedEvent[] = [];
  const requestAccumulator = createRequestAccumulator({
    requestEventPreviewLimit: 0,
    onRequestEvent: (request, eventIndex) => {
      request.events.push(parsedEvents[eventIndex]);
    },
  });

  let processedEventCount = 0;
  let lastProgressAt = 0;
  for (const evt of events) {
    const sourceType = evt.source?.type || evt.source_type || 0;
    const sourceId = evt.source?.id || evt.source_id || 0;

    const parsed: ParsedEvent = {
      time: parseFloat(evt.time) || 0,
      type: evt.type,
      typeName: eventNames[evt.type] || EVENT_TYPES[evt.type] || ("UNKNOWN_" + evt.type),
      source: {
        id: sourceId,
        type: sourceType,
        typeName: sourceNames[sourceType] || SOURCE_TYPES[sourceType] || "UNKNOWN_SRC",
      },
      phase: evt.phase,
      phaseName: PHASE[evt.phase] || `PHASE_${evt.phase}`,
      params: evt.params || {},
    };

    parsedEvents.push(parsed);
    result.totalEvents++;

    if (parsed.time < result.timeRange.start) result.timeRange.start = parsed.time;
    if (parsed.time > result.timeRange.end) result.timeRange.end = parsed.time;

    requestAccumulator.accept(parsed);
    processedEventCount += 1;
    const now = Date.now();
    if (
      onEventProgress
      && (
        processedEventCount === events.length
        || (
          processedEventCount % 250 === 0
          && now - lastProgressAt >= 100
        )
      )
    ) {
      lastProgressAt = now;
      onEventProgress(processedEventCount, events.length);
    }
  }

  const requestOutput = requestAccumulator.finish();
  result.urlRequests = requestOutput.requests;
  result.connectionFailures = requestOutput.connectionFailures;

  for (const evt of parsedEvents) {
    categorizeEvent(evt, result);
  }

  // Calculate unique sources and peak concurrency
  const sourceIds = new Set(parsedEvents.map(e => e.source.id));
  result.uniqueSources = sourceIds.size;
  result.peakConcurrency = calculatePeakConcurrency(parsedEvents);

  extractFailedDomains(result);
  runDiagnostics(result);
    result.eventCategoryStats = {
      dns: categoryStat(result.dnsEvents),
      connect: categoryStat(result.connectEvents),
      ssl: categoryStat(result.sslEvents),
      proxy: categoryStat(result.proxyEvents),
      quic: categoryStat(result.quicEvents),
      http2: categoryStat(result.http2Events),
      cache: categoryStat(result.cacheEvents),
      networkChange: categoryStat(result.networkChanges),
    };
    result.diagnosticContextEvents = buildDiagnosticContextEvents(result);

  return { events: parsedEvents, result };
}

function categoryStat(events: ParsedEvent[]): NetlogEventCategoryStat {
  let errorCount = 0;
  const errorEvidence: NetlogEventCategoryStat['errorEvidence'] = [];
  let hitCount = 0;
  let missCount = 0;
  let goawayCount = 0;
  let suggestionGoawayCount = 0;
  for (const event of events) {
    if (event.params?.net_error !== undefined && event.params.net_error !== 0) {
      errorCount += 1;
      if (errorEvidence.length < 4) {
        errorEvidence.push({
          time: event.time,
          typeName: event.typeName,
          sourceId: event.source.id,
          error: Number(event.params.net_error),
        });
      }
    }
    const text = `${event.typeName} ${JSON.stringify(event.params || {})}`.toLowerCase();
    if (text.includes('hit')) hitCount += 1;
    if (text.includes('miss') || text.includes('create') || text.includes('doom')) {
      missCount += 1;
    }
    if (event.typeName.includes('GOAWAY')) goawayCount += 1;
    if (event.type === 212 || event.type === 213) suggestionGoawayCount += 1;
  }
  return {
    count: events.length,
    sequenceFingerprint: hashStableValue(events.map(netlogEventIdentity)),
    errorCount,
    errorEvidence,
    hitCount,
    missCount,
    goawayCount,
    suggestionGoawayCount,
  };
}

function buildDiagnosticContextEvents(
  result: AnalysisResult,
): NetlogDiagnosticContextEvent[] {
  const groups: Array<[NetlogEventCategory, ParsedEvent[]]> = [
    ['networkChange', result.networkChanges],
    ['proxy', result.proxyEvents],
    ['cache', result.cacheEvents],
    ['ssl', result.sslEvents],
    ['quic', result.quicEvents],
    ['http2', result.http2Events],
  ];
  return groups.flatMap(([category, events]) => events.map(event => ({
    category,
    time: event.time,
    typeName: event.typeName,
    sourceId: event.source.id,
  })));
}

// ============================================================
// DNS 解析工具函数
// ============================================================

function stripIpWrapper(value: string): string {
  const trimmed = value.trim();

  // [IPv6]:port 或 [IPv6]
  const bracketMatch = trimmed.match(/^\[([0-9a-fA-F:.]+)\](?::\d+)?$/);
  if (bracketMatch) {
    return bracketMatch[1];
  }

  // IPv4:port
  if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(trimmed)) {
    return trimmed.replace(/:\d+$/, '');
  }

  return trimmed;
}

function isValidIpv4(value: string): boolean {
  const ip = stripIpWrapper(value);
  const parts = ip.split('.');

  if (parts.length !== 4) return false;

  return parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function isValidIpv6(value: string): boolean {
  const ip = stripIpWrapper(value);

  // 避免把 abcdef、123abc 这类纯十六进制字符串误判为 IPv6
  if (!ip.includes(':')) return false;

  // IPv6 只允许十六进制字符、冒号，以及 IPv4-mapped 地址中的点
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return false;

  // :: 最多出现一次
  if ((ip.match(/::/g) || []).length > 1) return false;

  const segments = ip.split(':');

  // 普通 IPv6 最多 8 段；带 :: 压缩时允许空段
  if (segments.length > 8) return false;

  return segments.every(segment => {
    if (segment === '') return true;

    // 兼容 IPv4-mapped IPv6，例如 ::ffff:192.168.1.1
    if (segment.includes('.')) {
      return isValidIpv4(segment);
    }

    return /^[0-9a-fA-F]{1,4}$/.test(segment);
  });
}

function isIpLike(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return isValidIpv4(value) || isValidIpv6(value);
}

function normalizeIp(value: string): string {
  return stripIpWrapper(value);
}

const DNS_SERVER_KEYS = new Set([
  'nameservers',
  'nameserver',
  'nameserveraddresses',
  'nameserveraddress',
  'nameserverips',
  'nameserverip',
  'dnsservers',
  'dnsserver',
  'dnsserveraddresses',
  'dnsserveraddress',
  'dnsserverips',
  'dnsserverip',
  'resolverservers',
  'resolvernameservers',
  'systemdnsservers',
  'systemnameservers',
  'configurednameservers',
  'effectivenameservers',
]);

const DOH_CANDIDATE_KEYS = new Set([
  'dohservers',
  'dohserver',
  'dnsoverhttpsservers',
  'dnsoverhttpsserver',
  'securednsservers',
  'securednsserver',
  'templates',
  'servertemplates',
]);

const DNS_CONFIG_CONTAINER_KEYS = new Set([
  'dnsconfig',
  'dnsconfiguration',
  'dnsconfigs',
  'hostresolverconfig',
  'hostresolverinfo',
  'hostresolverinformation',
  'resolverconfig',
  'resolverinformation',
  'networkconfig',
  'networkconfiguration',
  'securednsconfig',
  'securednsconfiguration',
  'dohconfig',
  'dnsoverhttpsconfig',
]);

const DNS_ANSWER_KEYS = new Set([
  'address',
  'addresses',
  'addresslist',
  'addresslists',
  'ip',
  'ips',
  'ipaddress',
  'ipaddresses',
  'endpoint',
  'endpoints',
  'ipendpoint',
  'ipendpoints',
  'endpointresult',
  'endpointresults',
  'hostresolverendpointresults',
  'results',
  'result',
]);

function extractIpsFromValue(value: unknown): string[] {
  const ips = new Set<string>();
  const walk = (v: unknown) => {
    if (!v) return;
    if (typeof v === 'string') {
      if (isIpLike(v)) ips.add(normalizeIp(v));
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') {
      Object.entries(v as Record<string, unknown>).forEach(([key, child]) => {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('address') ||
          lowerKey.includes('ip') ||
          lowerKey.includes('endpoint') ||
          lowerKey.includes('nameserver') ||
          lowerKey.includes('server')
        ) {
          walk(child);
        } else if (Array.isArray(child) || typeof child === 'object') {
          walk(child);
        }
      });
    }
  };
  walk(value);
  return Array.from(ips);
}

function normalizeHostCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return new URL(trimmed).hostname;
    }
  } catch {
    // ignore
  }

  if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) {
    return trimmed.replace(/:\d+$/, '');
  }

  if (isIpLike(trimmed)) return null;

  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed) || trimmed.includes('.')) {
    return trimmed;
  }

  return null;
}

function findHostLikeValue(value: unknown, depth = 0): string | null {
  if (!value || depth > 4) return null;

  if (typeof value === 'string') {
    return normalizeHostCandidate(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findHostLikeValue(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    for (const [key, child] of entries) {
      const normalized = normalizeKey(key);
      if (
        normalized.includes('host') ||
        normalized.includes('hostname') ||
        normalized.includes('query') ||
        normalized.includes('domain') ||
        normalized.includes('name')
      ) {
        const hit = findHostLikeValue(child, depth + 1);
        if (hit) return hit;
      }
    }
  }

  return null;
}

function extractHostFromParams(params: any): string | null {
  const candidates = [
    params?.host,
    params?.hostname,
    params?.host_name,
    params?.domain,
    params?.query,
    params?.dns_query,
    params?.dns_query_name,
    params?.request_hostname,
    params?.requested_hostname,
    params?.url,
    params?.host_port_pair?.host,
    params?.host_resolver_request?.host,
    params?.resolve_host_request?.host,
  ];

  for (const candidate of candidates) {
    const host = normalizeHostCandidate(candidate);
    if (host) return host;
  }

  return findHostLikeValue(params);
}

function normalizeHost(hostOrUrl: string | null): string | null {
  if (!hostOrUrl) return null;
  try {
    if (hostOrUrl.startsWith('http://') || hostOrUrl.startsWith('https://')) {
      return new URL(hostOrUrl).hostname;
    }
  } catch { /* ignore */ }
  return hostOrUrl;
}

function addDnsRecord(
  result: AnalysisResult,
  host: string | null,
  ips: string[],
  source: DnsRecord['source'],
  time?: number
) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost || ips.length === 0) return;
  const cleanIps = Array.from(new Set(ips.map(normalizeIp).filter(Boolean)));
  if (cleanIps.length === 0) return;

  // 兼容旧 hosts 字段：取第一个 IP
  if (!result.hosts[normalizedHost] && cleanIps[0]) {
    result.hosts[normalizedHost] = cleanIps[0];
  }

  const existing = result.dnsRecords.find(r => r.host === normalizedHost);
  if (existing) {
    existing.ips = Array.from(new Set([...existing.ips, ...cleanIps]));
    return;
  }

  result.dnsRecords.push({ host: normalizedHost, ips: cleanIps, source, time });
}

function addDnsServers(result: AnalysisResult, ips: string[]) {
  const next = new Set(result.dnsServers);
  ips.forEach(ip => {
    const normalized = normalizeIp(ip);
    if (normalized) next.add(normalized);
  });
  result.dnsServers = Array.from(next);
}

function addDohCandidates(result: AnalysisResult, values: unknown[], source: DohCandidate['source']) {
  const next = new Map((result.dohCandidates || []).map(item => [item.value, item]));
  const collect = (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) next.set(trimmed, { value: trimmed, source });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(collect);
    }
  };
  values.forEach(collect);
  result.dohCandidates = Array.from(next.values());
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

function isDnsServerConfigKey(key: string): boolean {
  return DNS_SERVER_KEYS.has(normalizeKey(key));
}

function isDohCandidateKey(key: string): boolean {
  return DOH_CANDIDATE_KEYS.has(normalizeKey(key));
}

function isDnsConfigContainerKey(key: string): boolean {
  return DNS_CONFIG_CONTAINER_KEYS.has(normalizeKey(key));
}

function extractDnsAnswerIps(params: unknown): string[] {
  const ips = new Set<string>();

  const collect = (value: unknown, depth = 0) => {
    if (!value || depth > 6) return;

    if (typeof value === 'string') {
      if (isIpLike(value)) ips.add(normalizeIp(value));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(item => collect(item, depth + 1));
      return;
    }

    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const normalized = normalizeKey(key);
        if (DNS_ANSWER_KEYS.has(normalized)) {
          collect(child, depth + 1);
          continue;
        }

        if (
          normalized.includes('address') ||
          normalized.includes('endpoint') ||
          normalized === 'ip' ||
          normalized === 'ips'
        ) {
          collect(child, depth + 1);
          continue;
        }

        if (Array.isArray(child) || typeof child === 'object') {
          collect(child, depth + 1);
        }
      }
    }
  };

  collect(params);
  return Array.from(ips);
}

export function addDnsRecordsFromEvent(
  result: AnalysisResult,
  event: ParsedEvent,
): void {
  const host = extractHostFromParams(event.params);
  const ips = extractDnsAnswerIps(event.params);
  addDnsRecord(result, host, ips, 'dns_event', event.time);
}

function isDnsRelatedEvent(evt: ParsedEvent): boolean {
  const tn = evt.typeName || '';
  const stn = evt.source?.typeName || '';

  return (
    stn.includes('HOST_RESOLVER') ||
    stn.includes('DNS') ||
    tn.includes('HOST_RESOLVER') ||
    tn.includes('DNS') ||
    tn.includes('SECURE_DNS') ||
    tn.includes('DOH')
  );
}

function collectDnsCacheEntries(polledData: any): any[] {
  const entries: any[] = [];
  const candidates = [
    polledData?.dns_cache,
    polledData?.dnsCache,
    polledData?.host_resolver_cache,
    polledData?.hostResolverCache,
    polledData?.hostResolverInfo?.cache,
    polledData?.host_resolver_info?.cache,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      entries.push(...candidate);
    } else if (candidate && typeof candidate === 'object') {
      entries.push(...Object.values(candidate as Record<string, unknown>));
    }
  }

  return entries;
}

function parseDnsServersFromPolledData(result: AnalysisResult, polledData: any) {
  if (!polledData || typeof polledData !== 'object') return;

  const dnsServerIps = new Set<string>();
  const dohCandidateValues: unknown[] = [];

  const collectFromConfigValue = (value: unknown) => {
    extractIpsFromValue(value).forEach(ip => {
      if (isIpLike(ip)) {
        dnsServerIps.add(normalizeIp(ip));
      }
    });
  };

  const walkConfigOnly = (obj: unknown, insideDnsConfig = false) => {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const isServerKey = isDnsServerConfigKey(key);
      const isDohKey = isDohCandidateKey(key);
      const isConfigContainer = isDnsConfigContainerKey(key);

      // 只在明确 DNS 配置字段中提取 nameservers / dns_servers
      if (isServerKey) {
        collectFromConfigValue(value);
        continue;
      }

      if (isDohKey) {
        dohCandidateValues.push(value);
        continue;
      }

      // 进入明确 DNS 配置容器继续查找
      if (isConfigContainer) {
        walkConfigOnly(value, true);
        continue;
      }

      // 已经在 dns_config / resolver_config 容器内时，允许继续向下找 nameservers
      if (insideDnsConfig && value && typeof value === 'object') {
        walkConfigOnly(value, true);
      }
    }
  };

  walkConfigOnly(polledData);

  addDnsServers(result, Array.from(dnsServerIps));
  addDohCandidates(result, dohCandidateValues, 'polledData');
}

function parsePolledData(polledData: any, r: AnalysisResult) {
  if (!polledData) return;
  const pi = r.proxyInfo;

  // Proxy config from polledData
  if (polledData.proxy_settings) {
    pi.hasProxy = true;
    pi.proxySettings = polledData.proxy_settings;
    const cfg = polledData.proxy_settings;
    if (cfg.mode) {
      pi.proxyType = cfg.mode;
    }
    if (cfg.proxy_rules) {
      const rules = cfg.proxy_rules;
      if (rules.single_proxy && !pi.proxyList.includes(rules.single_proxy)) pi.proxyList.push(rules.single_proxy);
      if (rules.http && !pi.proxyList.includes(rules.http)) pi.proxyList.push(rules.http);
      if (rules.https && !pi.proxyList.includes(rules.https)) pi.proxyList.push(rules.https);
      if (rules.ftp && !pi.proxyList.includes(rules.ftp)) pi.proxyList.push(rules.ftp);
      if (rules.fallback_proxy && !pi.proxyList.includes(rules.fallback_proxy)) {
        pi.proxyList.push(rules.fallback_proxy);
        pi.proxyFallback = rules.fallback_proxy;
      }
    }
  }

  // DNS Server IP extraction
  parseDnsServersFromPolledData(r, polledData);

  // DNS cache info
  for (const entry of collectDnsCacheEntries(polledData)) {
    const host = extractHostFromParams(entry);
    const ips = extractDnsAnswerIps(entry);
    addDnsRecord(r, host, ips, 'dns_cache');
  }

  // Network info
  if (polledData.network_info) {
    const ni = polledData.network_info;
    if (ni.network_change_count) {
      r.warnings.push({
        severity: 'warning',
        category: '网络变更',
        message: `会话期间检测到 ${ni.network_change_count} 次网络变更`,
        detail: '网络环境发生变化可能导致连接中断或请求重试。',
        time: 0,
      });
    }
  }
}

function calculatePeakConcurrency(events: ParsedEvent[]): number {
  // Track active sources by their BEGIN/END phases
  const sourceStates = new Map<number, boolean>();
  let peak = 0;
  let current = 0;

  // Sort events by time
  const sorted = [...events].sort((a, b) => a.time - b.time);

  for (const evt of sorted) {
    const sid = evt.source.id;
    const wasActive = sourceStates.get(sid) || false;

    if (evt.phaseName === "BEGIN" && !wasActive) {
      sourceStates.set(sid, true);
      current++;
      if (current > peak) peak = current;
    } else if (evt.phaseName === "END" && wasActive) {
      sourceStates.set(sid, false);
      current--;
    }
  }

  return peak;
}

function categorizeEvent(evt: ParsedEvent, r: AnalysisResult) {
  const p = evt.params;
  const tn = evt.typeName;
  const stn = evt.source.typeName;

  // ---- SSL/TLS events ----
  if (stn === "SSL_CONNECT_JOB" || stn === "SSL_CONNECT" || tn.includes("SSL_") || tn.includes("TLS_")) {
    r.sslEvents.push(evt);
    const sslError = p.error_code ?? p.net_error;
    if (sslError !== undefined && sslError !== 0) {
      const issue: SslIssue = {
        event: evt,
        error: Number(sslError),
        host: p.host || p.server_info || "unknown",
        category: classifySslIssueCategory(sslError),
      };
      r.sslIssues.push(issue);
      if (issue.category === "cert") {
        r.certIssues.push(issue);
      }
    }
    if (p.encrypted_protocol || p.version) {
      const key = "TLS_" + (p.encrypted_protocol || p.version);
      r.protocols[key] = (r.protocols[key] || 0) + 1;
    }
  }

  // ---- QUIC events ----
  if (tn.includes("QUIC_")) {
    r.quicEvents.push(evt);
    r.protocols["QUIC"] = (r.protocols["QUIC"] || 0) + 1;
      const issue = buildQuicEventIssue(evt);
      if (issue) r.errors.push(issue);
  }

  // ---- HTTP/2 events ----
  if (stn === "HTTP2_SESSION" || tn.includes("HTTP2_") || tn.includes("HTTP/2_")) {
    r.http2Events.push(evt);
    r.protocols["HTTP/2"] = (r.protocols["HTTP/2"] || 0) + 1;
      const issue = buildHttp2GoawayIssue(evt);
      if (issue) r.errors.push(issue);
  }

  // ---- DNS events ----
  if (isDnsRelatedEvent(evt)) {
    r.dnsEvents.push(evt);
    addDnsRecordsFromEvent(r, evt);
  }

  // ---- Connection events ----
  if (tn.includes('TCP_') || tn.includes('SOCKET_') || tn.includes('TRANSPORT_CONNECT_')) {
    r.connectEvents.push(evt);
  }

  // ---- Proxy events ----
  if (shouldAnalyzeProxyEvent(evt)) {
    addProxyEvent(evt, r);
  }

  // ---- Cache events ----
  if (tn.includes('HTTP_CACHE_') || tn.includes('DISK_CACHE_') || tn.includes('SIMPLE_CACHE_') || tn.includes('ENTRY_')) {
    r.cacheEvents.push(evt);
  }

  // ---- Network change events ----
  if (tn.includes('NETWORK_CHANGE_')) {
    r.networkChanges.push(evt);
  }

  // ---- Collect error sources ----
  if (p.net_error && p.net_error !== 0) {
    r.errorSources[p.net_error] = (r.errorSources[p.net_error] || 0) + 1;
  }
}

export function shouldAnalyzeProxyEvent(evt: ParsedEvent): boolean {
  const p = evt.params;
  return evt.typeName.includes('PROXY') ||
    Boolean(
      p.proxy_config ||
      p.proxy_list ||
      p.fallback_proxy ||
      p.proxy_server ||
      p.proxy_info ||
      p.proxy_chain ||
      p.pac_string ||
      p.tunnel_host
    );
}

export function addProxyEvent(evt: ParsedEvent, r: AnalysisResult) {
  const exists = r.proxyEvents.some(e =>
    e.source.id === evt.source.id &&
    e.type === evt.type &&
    e.phase === evt.phase &&
    e.time === evt.time
  );
  if (!exists) {
    r.proxyEvents.push(evt);
  }
  analyzeProxyEvent(evt, r.proxyInfo);
}

function analyzeProxyEvent(evt: ParsedEvent, pi: ProxyInfo) {
  const p = evt.params;

  if (p.proxy_config) {
    pi.hasProxy = true;
    pi.proxySettings = p.proxy_config;
    const cfg = p.proxy_config;

    if (cfg.mode) {
      pi.proxyType = cfg.mode;
      if (cfg.mode === 'direct') {
        pi.hasProxy = false;
        pi.proxyType = 'direct (无代理)';
      } else if (cfg.mode === 'auto_detect') {
        pi.proxyType = 'auto_detect (自动检测)';
      } else if (cfg.mode === 'pac_script') {
        pi.proxyType = 'pac_script (PAC脚本)';
        if (cfg.pac_url) pi.pacUrl = cfg.pac_url;
      } else if (cfg.mode === 'fixed_servers') {
        pi.proxyType = 'fixed_servers (固定代理服务器)';
      } else if (cfg.mode === 'system') {
        pi.proxyType = 'system (系统代理)';
      }
    }

    if (cfg.proxy_rules) {
      const rules = cfg.proxy_rules;
      if (rules.single_proxy) pi.proxyList.push(rules.single_proxy);
      if (rules.http) pi.proxyList.push(rules.http);
      if (rules.https) pi.proxyList.push(rules.https);
      if (rules.ftp) pi.proxyList.push(rules.ftp);
      if (rules.fallback_proxy) {
        pi.proxyList.push(rules.fallback_proxy);
        pi.proxyFallback = rules.fallback_proxy;
      }
    }

    if (cfg.bypass_list && Array.isArray(cfg.bypass_list)) {
      for (const item of cfg.bypass_list) {
        if (item.includes('vpn') || item.includes('tunnel') || item.includes('corp')) {
          pi.vpnHints.push(item);
        }
      }
    }
  }

  if (p.proxy_list) {
    pi.hasProxy = true;
    const proxyList = Array.isArray(p.proxy_list) ? p.proxy_list : [p.proxy_list];
    for (const proxy of proxyList) {
      if (proxy && !pi.proxyList.includes(proxy)) {
        pi.proxyList.push(proxy);
      }
    }
  }

  if (p.fallback_proxy) {
    pi.proxyFallback = p.fallback_proxy;
    if (!pi.proxyList.includes(p.fallback_proxy)) {
      pi.proxyList.push(p.fallback_proxy);
    }
  }

  // Handle proxy_server param
  if (p.proxy_server) {
    const server = p.proxy_server;
    if (typeof server === 'string') {
      if (server === 'DIRECT') {
        // direct connection, ignore
      } else {
        pi.hasProxy = true;
        const match = server.match(/^(?:PROXY|SOCKS|SOCKS5|HTTPS)\s+(.+)$/i);
        const proxyAddr = match ? match[1] : server;
        if (!pi.proxyList.includes(proxyAddr)) {
          pi.proxyList.push(proxyAddr);
        }
        if (!pi.proxyType) pi.proxyType = 'pac_script (PAC脚本)';
      }
    } else if (server.host && server.port) {
      pi.hasProxy = true;
      const addr = `${server.host}:${server.port}`;
      if (!pi.proxyList.includes(addr)) pi.proxyList.push(addr);
    }
  }

  // Handle proxy_info param
  if (p.proxy_info) {
    const info = String(p.proxy_info);
    if (info !== 'DIRECT') {
      pi.hasProxy = true;
      const match = info.match(/^(?:PROXY|SOCKS|SOCKS5|HTTPS)\s+(.+)$/i);
      const proxyAddr = match ? match[1] : info;
      if (!pi.proxyList.includes(proxyAddr)) {
        pi.proxyList.push(proxyAddr);
      }
      if (!pi.proxyType) pi.proxyType = 'fixed_servers (固定代理服务器)';
    }
  }

  // Handle proxy_chain param
  if (p.proxy_chain) {
    const chain = String(p.proxy_chain);
    const bracketMatch = chain.match(/\[([^\]]+)\]/);
    if (bracketMatch) {
      const inner = bracketMatch[1];
      if (inner !== 'direct://' && inner !== 'DIRECT') {
        pi.hasProxy = true;
        const proxies = inner.split(',').map(s => s.trim()).filter(Boolean);
        for (const proxy of proxies) {
          if (!pi.proxyList.includes(proxy)) {
            pi.proxyList.push(proxy);
          }
        }
        if (!pi.proxyType) pi.proxyType = 'fixed_servers (固定代理服务器)';
      }
    } else if (chain !== 'DIRECT' && chain !== 'direct://') {
      pi.hasProxy = true;
      if (!pi.proxyList.includes(chain)) {
        pi.proxyList.push(chain);
      }
    }
  }

  // Handle pac_string param
  if (p.pac_string) {
    const pacStr = String(p.pac_string);
    if (pacStr !== 'DIRECT') {
      pi.hasProxy = true;
      const match = pacStr.match(/^(?:PROXY|SOCKS|SOCKS5|HTTPS)\s+(.+)$/i);
      const proxyAddr = match ? match[1] : pacStr;
      if (!pi.proxyList.includes(proxyAddr)) {
        pi.proxyList.push(proxyAddr);
      }
      if (!pi.proxyType) pi.proxyType = 'pac_script (PAC脚本)';
    }
  }

  for (const proxy of pi.proxyList) {
    const proxyStr = String(proxy).toLowerCase();
    if (proxyStr.includes('vpn') || proxyStr.includes('tunnel') ||
        proxyStr.includes('shadowsocks') || proxyStr.includes('v2ray') ||
        proxyStr.includes('trojan') || proxyStr.includes('wireguard') ||
        proxyStr.includes('openvpn') || proxyStr.includes('anyconnect') ||
        proxyStr.includes('socks5://127.0.0.1') || proxyStr.includes('socks://127.0.0.1') ||
        proxyStr.includes('http://127.0.0.1') || proxyStr.includes('https://127.0.0.1')) {
      pi.isVPN = true;
      pi.vpnHints.push(`代理地址含VPN特征: ${proxy}`);
    }
  }

  if (evt.typeName === 'PROXY_DECIDED' && p.tunnel_host) {
    pi.isVPN = true;
    pi.vpnHints.push(`检测到隧道连接: ${p.tunnel_host}`);
  }
}

function extractFailedDomains(r: AnalysisResult) {
  const domainMap = new Map<string, FailedDomain>();

  // Build domain map from all URL requests (not just failures)
  for (const req of r.urlRequests) {
    try {
      const url = new URL(req.url);
      const domain = url.hostname;

      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          domain,
          urls: [],
          errors: [],
          errorCodes: [],
          ips: [],
          resolvedIp: null,
          remoteIp: null,
          firstTime: req.startTime,
          lastTime: req.startTime,
          count: 0,
        });
      }

      const entry = domainMap.get(domain)!;
      entry.urls.push(req.url);
      entry.count++;
      if (req.startTime < entry.firstTime) entry.firstTime = req.startTime;
      if (req.startTime > entry.lastTime) entry.lastTime = req.startTime;

      // Extract resolved IP from request (priority: x-response-cinfo > x-tt-cip > x-lsc-source-ip)
      if (req.resolvedIp && !entry.resolvedIp) {
        entry.resolvedIp = req.resolvedIp;
      }
      // Extract remote IP from request
      if (req.remoteIp && !entry.remoteIp) {
        entry.remoteIp = req.remoteIp;
      }

      // Collect errors from request
      if (req.error !== undefined) {
        const errCode = req.error;
        const errDesc = req.errorDesc || getNetErrorDescription(errCode);
        entry.errors.push({
          code: errCode,
          desc: errDesc,
          time: req.startTime,
        });
        if (!entry.errorCodes.includes(errCode)) {
          entry.errorCodes.push(errCode);
        }
      }
    } catch {
      // Invalid URL
    }
  }

  // Also process connection failures for any domains not in urlRequests
  for (const fail of r.connectionFailures) {
    try {
      const url = new URL(fail.url);
      const domain = url.hostname;
      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          domain,
          urls: [fail.url],
          errors: [{
            code: fail.error,
            desc: getNetErrorDescription(fail.error),
            time: fail.time,
          }],
          errorCodes: [fail.error],
          ips: [],
          resolvedIp: null,
          remoteIp: null,
          firstTime: fail.time,
          lastTime: fail.time,
          count: 1,
        });
      }
    } catch {
      // Invalid URL
    }
  }

  // Extract IPs from DNS events
  for (const dnsEvt of r.dnsEvents) {
    const p = dnsEvt.params;
    const host = p.host || p.hostname;
    const address = p.address;
    if (host && address && domainMap.has(host)) {
      const entry = domainMap.get(host)!;
      if (!entry.ips.includes(address)) entry.ips.push(address);
    }
  }

  // Extract IPs from connect events for failed requests
  for (const req of r.urlRequests) {
    if (req.status === 'error') {
      for (const evt of req.events) {
        if ((evt.typeName.includes('TCP_') || evt.typeName.includes('SOCKET_')) && evt.params.address) {
          try {
            const domain = new URL(req.url).hostname;
            if (domainMap.has(domain)) {
              const entry = domainMap.get(domain)!;
              if (!entry.ips.includes(evt.params.address)) {
                entry.ips.push(evt.params.address);
              }
            }
          } catch {}
        }
      }
    }
  }

  r.failedDomains = Array.from(domainMap.values())
    .filter(entry => entry.errors.length > 0)
    .map(entry => ({ ...entry, urls: [...new Set(entry.urls)] }))
    .sort((a, b) => b.count - a.count);
}

function runDiagnostics(r: AnalysisResult) {
  for (const fail of r.connectionFailures) {
      r.errors.push(buildConnectionFailureIssue(fail, r.timeTickOffset));
  }

  for (const issue of r.sslIssues) {
      r.errors.push(buildSslDiagnosticIssue(issue));
  }

  for (const req of r.urlRequests) {
    if (req.duration && req.duration > SLOW_REQUEST_MS) {
      r.slowRequests.push(req);
      r.warnings.push({
        severity: 'warning',
        category: '慢请求',
        message: `慢请求 (${(req.duration / 1000).toFixed(1)}s): ${truncateUrl(req.url, 80)}`,
        detail: `URL: ${req.url}\n耗时: ${(req.duration / 1000).toFixed(2)}s\n方法: ${req.method}`,
        time: req.startTime,
      });
    }
  }

  const slowDns = r.dnsEvents.filter(e => {
    if (e.phaseName === 'END' && e.params.duration_ms) return parseFloat(e.params.duration_ms) > 500;
    return false;
  });
  if (slowDns.length > 0) {
    r.warnings.push({
      severity: 'warning',
      category: 'DNS',
      message: `检测到 ${slowDns.length} 个慢 DNS 解析 (>500ms)`,
      detail: slowDns.map(e => `  ${e.params.host || 'unknown'}: ${e.params.duration_ms}ms`).join('\n'),
      time: slowDns[0].time,
    });
  }

  const goaways = r.http2Events.filter(isHttp2Goaway);
    const goawaySummary = buildHttp2GoawaySummary(
      goaways.length,
      goaways[0]?.time || 0,
    );
    if (goawaySummary) r.warnings.push(goawaySummary);

  const quicErrors = r.quicEvents.filter(e => e.params.error_code || e.params.net_error);
  if (quicErrors.length > 0) {
    r.errors.push({
      severity: 'error',
      category: 'QUIC',
      message: `QUIC 协议错误 (${quicErrors.length} 个)`,
      detail: quicErrors.map(e => `  错误码: ${e.params.error_code || e.params.net_error}`).join('\n'),
      time: quicErrors[0].time,
    });
  }

  if (r.networkChanges.length > 0) {
    r.warnings.push({
      severity: 'warning',
      category: '网络变更',
      message: `会话期间检测到 ${r.networkChanges.length} 次网络变更`,
      detail: '网络环境发生变化可能导致连接中断或请求重试。',
      time: r.networkChanges[0].time,
    });
  }

    const proxySummary = buildProxySummary(
      r.proxyInfo,
      r.proxyEvents.length,
      r.proxyEvents[0]?.time || 0,
    );
    if (proxySummary?.severity === 'ok') r.info.push(proxySummary);
    else if (proxySummary) r.warnings.push(proxySummary);

    r.errors.push(...buildNetworkErrorIssues(r.errorSources));

  if (r.errors.length === 0 && r.warnings.length === 0) {
    r.info.push(buildCleanAssessmentIssue());
  }
}

// Re-export format utilities from shared utils for backward compatibility
export { formatDuration, formatTime, truncateUrl } from '../../utils/format';

export function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)] || 0;
}
