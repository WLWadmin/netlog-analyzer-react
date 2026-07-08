import { SLOW_REQUEST_MS } from '../../constants/analysisThresholds';
import { EVENT_TYPES, SOURCE_TYPES, PHASE, getNetErrorDescription } from './constants';
import { classifySslIssueCategory } from './errorClassifier';
import { extractDnsAnswerCandidates as extractSharedDnsAnswerCandidates } from './dnsAnswerCandidates';
import type { AnalysisResult, DiagnosisIssue, DnsRecord, DohCandidate, ParsedEvent, URLRequest } from './parser';

const MAX_EVENTS_PREVIEW = 20_000;
const MAX_REQUEST_EVENTS = 30;
const MAX_CATEGORY_EVENTS = 5_000;

export interface StreamingAnalyzerMeta {
  parsedEvents: number;
  fullyParsedEvents: number;
  lightweightCountedEvents: number;
  lightweightEventTypes: CountEntry[];
  skippedEvents: number;
  truncatedEventsPreview: boolean;
  unknownEventTypes: number[];
  unknownSourceTypes: number[];
  diagnostics: StreamingAnalyzerDiagnostics;
}

export interface CountEntry {
  name: string;
  count: number;
}

export interface StreamingAnalyzerDiagnostics {
  topEventTypes: CountEntry[];
  topSourceTypes: CountEntry[];
  dnsCandidateEvents: number;
  hostResolverCandidateEvents: number;
  urlRequestEvents: number;
  urlRequestsCreated: number;
  eventsWithHeaders: number;
  responseHeaderKeys: CountEntry[];
  eventsWithIpLikeParams: number;
  ipCandidateEventTypes: CountEntry[];
  dnsCandidateParamKeys: CountEntry[];
}

export interface StreamingAnalyzerOutput {
  result: AnalysisResult;
  eventsPreview: ParsedEvent[];
  meta: StreamingAnalyzerMeta;
}

export interface NetlogStreamingMetadata {
  constants?: any;
  polledData?: any;
  systemInfo?: any;
  clientInfo?: any;
  netLogInfo?: any;
}

export interface NetlogStreamingAnalyzerOptions extends NetlogStreamingMetadata {
  eventNames?: Record<number, string>;
  sourceNames?: Record<number, string>;
}

function createEmptyResult(): AnalysisResult {
  return {
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
    dnsServers: [],
    dnsRecords: [],
    dohCandidates: [],
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
  };
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
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

function stripIpWrapper(value: string): string {
  const trimmed = value.trim();
  const endpointMatch = trimmed.match(/^(?:[a-z]+:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/i);
  if (endpointMatch) return endpointMatch[1];
  const bracketMatch = trimmed.match(/^\[([0-9a-fA-F:.]+)\](?::\d+)?$/);
  if (bracketMatch) return bracketMatch[1];
  if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(trimmed)) return trimmed.replace(/:\d+$/, '');
  return trimmed;
}

function isValidIpv4(value: string): boolean {
  const ip = stripIpWrapper(value);
  const parts = ip.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isValidIpv6(value: string): boolean {
  const ip = stripIpWrapper(value);
  if (!ip.includes(':') || !/^[0-9a-fA-F:.]+$/.test(ip) || (ip.match(/::/g) || []).length > 1) return false;
  return ip.split(':').length <= 8;
}

function isIpLike(value: unknown): boolean {
  return typeof value === 'string' && (isValidIpv4(value) || isValidIpv6(value));
}

function normalizeIp(value: string): string {
  return stripIpWrapper(value);
}

function extractIpStringsFromText(value: string): string[] {
  const matches = value.match(/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|\[[0-9a-fA-F:.]+\](?::\d+)?/g) || [];
  return Array.from(new Set(matches.map(normalizeIp).filter(ip => isIpLike(ip))));
}

function normalizeHostCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || isIpLike(trimmed)) return null;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return new URL(trimmed).hostname;
  } catch {}
  if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) return trimmed.replace(/:\d+$/, '');
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed) || trimmed.includes('.')) return trimmed;
  return null;
}

function findHostLikeValue(value: unknown, depth = 0): string | null {
  if (!value || depth > 4) return null;
  if (typeof value === 'string') return normalizeHostCandidate(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findHostLikeValue(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeKey(key);
      if (normalized.includes('host') || normalized.includes('query') || normalized.includes('domain') || normalized.includes('name')) {
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
    params?.domain,
    params?.query,
    params?.dns_query,
    params?.url,
    params?.host_port_pair?.host,
    params?.host_resolver_request?.host,
  ];
  for (const candidate of candidates) {
    const host = normalizeHostCandidate(candidate);
    if (host) return host;
  }
  return findHostLikeValue(params);
}

export function extractIpsFromValue(value: unknown, depth = 0): string[] {
  const ips = new Set<string>();
  const walk = (v: unknown, d: number) => {
    if (!v || d > 6) return;
    if (isIpLike(v)) {
      ips.add(normalizeIp(String(v)));
      return;
    }
    if (typeof v === 'string') {
      extractIpStringsFromText(v).forEach(ip => ips.add(ip));
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(item => walk(item, d + 1));
      return;
    }
    if (typeof v === 'object') {
      for (const [key, child] of Object.entries(v as Record<string, unknown>)) {
        const normalized = normalizeKey(key);
        if (
          normalized.includes('address') ||
          normalized.includes('ip') ||
          normalized.includes('endpoint') ||
          normalized.includes('nameserver') ||
          normalized.includes('server') ||
          Array.isArray(child) ||
          typeof child === 'object'
        ) {
          walk(child, d + 1);
        }
      }
    }
  };
  walk(value, depth);
  return Array.from(ips);
}

function addBounded<T>(items: T[], item: T, max = MAX_CATEGORY_EVENTS) {
  if (items.length < max) items.push(item);
}

function parseHeaders(raw: string | string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = Array.isArray(raw) ? raw : String(raw).split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function incrementCounter(map: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function topCounts(map: Map<string, number>, limit = 20): CountEntry[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function getHeaderCandidate(params: any): string | string[] | null {
  return params?.headers || params?.response_headers || params?.headers_text || params?.raw_headers || null;
}

function isIpCandidateEvent(evt: ParsedEvent): boolean {
  const text = `${evt.typeName} ${evt.source.typeName}`;
  return /DNS|HOST_RESOLVER|SOCKET|CONNECT|URL_REQUEST|HTTP|SSL|TLS|QUIC/i.test(text);
}

function collectDiagnosticParamKeys(value: unknown, keys: Set<string>, depth = 0) {
  if (!value || depth > 3 || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach(item => collectDiagnosticParamKeys(item, keys, depth + 1));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (
      normalized.includes('host') ||
      normalized.includes('query') ||
      normalized.includes('domain') ||
      normalized.includes('name') ||
      normalized.includes('address') ||
      normalized.includes('ip') ||
      normalized.includes('endpoint') ||
      normalized.includes('result')
    ) {
      keys.add(key);
    }
    if (child && typeof child === 'object') {
      collectDiagnosticParamKeys(child, keys, depth + 1);
    }
  }
}

function addDnsRecord(result: AnalysisResult, host: string | null, ips: string[], source: DnsRecord['source'], time?: number) {
  if (!host || ips.length === 0) return;
  const cleanIps = Array.from(new Set(ips.map(normalizeIp).filter(Boolean)));
  if (!result.hosts[host] && cleanIps[0]) result.hosts[host] = cleanIps[0];
  const existing = result.dnsRecords.find(record => record.host === host);
  if (existing) {
    existing.ips = Array.from(new Set([...existing.ips, ...cleanIps]));
    return;
  }
  result.dnsRecords.push({ host, ips: cleanIps, source, time });
}

function extractDnsRecordCandidates(evt: ParsedEvent): Array<{ host: string | null; ips: string[] }> {
  return extractSharedDnsAnswerCandidates(evt.params, {
    eventId: undefined,
    sourceId: evt.source.id,
    time: evt.time,
    typeName: evt.typeName,
    sourceTypeName: evt.source.typeName,
  }).map(candidate => ({ host: candidate.host || null, ips: candidate.ips }));
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

function buildReverseNameMap(raw: unknown): Record<number, string> {
  const result: Record<number, string> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number') {
      result[value] = key;
    } else if (/^\d+$/.test(key) && typeof value === 'string') {
      result[Number(key)] = value;
    }
  }
  return result;
}

function extractNameMapsFromConstants(constants: any) {
  const eventNames = buildReverseNameMap(constants?.logEventTypes || constants?.eventTypes || {});
  const sourceNames = buildReverseNameMap(constants?.logSourceType || constants?.sourceTypes || {});
  return { eventNames, sourceNames };
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

function parseDnsServersFromPolledData(result: AnalysisResult, polledData: any) {
  if (!polledData || typeof polledData !== 'object') return;

  const dnsServerIps = new Set<string>();
  const dohCandidateValues: unknown[] = [];
  const collectFromConfigValue = (value: unknown) => {
    extractIpsFromValue(value).forEach(ip => {
      if (isIpLike(ip)) dnsServerIps.add(normalizeIp(ip));
    });
  };
  const walkConfigOnly = (obj: unknown, insideDnsConfig = false) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (isDnsServerConfigKey(key)) {
        collectFromConfigValue(value);
        continue;
      }
      if (isDohCandidateKey(key)) {
        dohCandidateValues.push(value);
        continue;
      }
      if (isDnsConfigContainerKey(key)) {
        walkConfigOnly(value, true);
        continue;
      }
      if (insideDnsConfig && value && typeof value === 'object') {
        walkConfigOnly(value, true);
      }
    }
  };

  walkConfigOnly(polledData);
  addDnsServers(result, Array.from(dnsServerIps));
  addDohCandidates(result, dohCandidateValues, 'polledData');
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

function parsePolledData(polledData: any, result: AnalysisResult) {
  if (!polledData) return;
  const pi = result.proxyInfo;
  if (polledData.proxy_settings) {
    pi.hasProxy = true;
    pi.proxySettings = polledData.proxy_settings;
    const cfg = polledData.proxy_settings;
    if (cfg.mode) pi.proxyType = cfg.mode;
    if (cfg.proxy_rules) {
      const rules = cfg.proxy_rules;
      [rules.single_proxy, rules.http, rules.https, rules.ftp, rules.fallback_proxy].filter(Boolean).forEach(proxy => {
        if (!pi.proxyList.includes(proxy)) pi.proxyList.push(proxy);
      });
      if (rules.fallback_proxy) pi.proxyFallback = rules.fallback_proxy;
    }
  }

  parseDnsServersFromPolledData(result, polledData);
  for (const entry of collectDnsCacheEntries(polledData)) {
    addDnsRecord(result, extractHostFromParams(entry), extractIpsFromValue(entry), 'dns_cache');
  }
}

function isDnsRelatedEvent(evt: ParsedEvent): boolean {
  const tn = evt.typeName || '';
  const stn = evt.source?.typeName || '';
  return stn.includes('HOST_RESOLVER') || stn.includes('DNS') || tn.includes('HOST_RESOLVER') || tn.includes('DNS') || tn.includes('SECURE_DNS') || tn.includes('DOH');
}

function shouldAnalyzeProxyEvent(evt: ParsedEvent): boolean {
  const p = evt.params || {};
  return evt.typeName.includes('PROXY') || Boolean(p.proxy_config || p.proxy_list || p.fallback_proxy || p.proxy_server || p.proxy_info || p.proxy_chain || p.pac_string || p.tunnel_host);
}

function analyzeProxyEvent(evt: ParsedEvent, result: AnalysisResult) {
  addBounded(result.proxyEvents, evt);
  const p = evt.params || {};
  const pi = result.proxyInfo;
  if (p.proxy_config) {
    pi.hasProxy = true;
    pi.proxySettings = p.proxy_config;
    if (p.proxy_config.mode) pi.proxyType = p.proxy_config.mode === 'direct' ? 'direct (无代理)' : p.proxy_config.mode;
  }
  const proxyValues = [p.proxy_list, p.fallback_proxy, p.proxy_server, p.proxy_info, p.proxy_chain, p.pac_string].flat().filter(Boolean);
  for (const proxy of proxyValues) {
    const value = String(proxy);
    if (value !== 'DIRECT' && value !== 'direct://') {
      pi.hasProxy = true;
      if (!pi.proxyList.includes(value)) pi.proxyList.push(value);
    }
  }
  for (const proxy of pi.proxyList) {
    const lower = String(proxy).toLowerCase();
    if (lower.includes('vpn') || lower.includes('tunnel') || lower.includes('socks') || lower.includes('127.0.0.1')) {
      pi.isVPN = true;
      pi.vpnHints.push(`代理地址含VPN特征: ${proxy}`);
    }
  }
}

function isKeyEvent(evt: ParsedEvent): boolean {
  return evt.source.typeName === 'URL_REQUEST' ||
    isDnsRelatedEvent(evt) ||
    shouldAnalyzeProxyEvent(evt) ||
    evt.typeName.includes('SSL_') ||
    evt.typeName.includes('TLS_') ||
    evt.typeName.includes('QUIC_') ||
    evt.typeName.includes('HTTP2_') ||
    Boolean(evt.params?.net_error || evt.params?.error_code);
}

export function createNetlogStreamingAnalyzer(options: NetlogStreamingAnalyzerOptions = {}) {
  const result = createEmptyResult();
  let eventNames: Record<number, string> = { ...(options.eventNames || {}) };
  let sourceNames: Record<number, string> = { ...(options.sourceNames || {}) };
  const requestIndex = new Map<number, URLRequest>();
  const sourceIds = new Set<number>();
  const activeSources = new Set<number>();
  const eventsPreview: ParsedEvent[] = [];
  const unknownEventTypes = new Set<number>();
  const unknownSourceTypes = new Set<number>();
  const lightweightEventTypeCounts = new Map<string, number>();
  const eventTypeCounts = new Map<string, number>();
  const sourceTypeCounts = new Map<string, number>();
  const responseHeaderKeyCounts = new Map<string, number>();
  const ipCandidateEventTypeCounts = new Map<string, number>();
  const dnsCandidateParamKeyCounts = new Map<string, number>();
  const diagnosticsCounters = {
    dnsCandidateEvents: 0,
    hostResolverCandidateEvents: 0,
    urlRequestEvents: 0,
    eventsWithHeaders: 0,
    eventsWithIpLikeParams: 0,
  };
  const emptyDiagnostics: StreamingAnalyzerDiagnostics = {
    topEventTypes: [],
    topSourceTypes: [],
    dnsCandidateEvents: 0,
    hostResolverCandidateEvents: 0,
    urlRequestEvents: 0,
    urlRequestsCreated: 0,
    eventsWithHeaders: 0,
    responseHeaderKeys: [],
    eventsWithIpLikeParams: 0,
    ipCandidateEventTypes: [],
    dnsCandidateParamKeys: [],
  };
  const meta: StreamingAnalyzerMeta = {
    parsedEvents: 0,
    fullyParsedEvents: 0,
    lightweightCountedEvents: 0,
    lightweightEventTypes: [],
    skippedEvents: 0,
    truncatedEventsPreview: false,
    unknownEventTypes: [],
    unknownSourceTypes: [],
    diagnostics: emptyDiagnostics,
  };

  const applyMetadata = (metadata: NetlogStreamingMetadata) => {
    if (metadata.constants) {
      const timeTickOffset = Number(metadata.constants.timeTickOffset);
      if (Number.isFinite(timeTickOffset)) result.timeTickOffset = timeTickOffset;
      const maps = extractNameMapsFromConstants(metadata.constants);
      eventNames = { ...eventNames, ...maps.eventNames };
      sourceNames = { ...sourceNames, ...maps.sourceNames };
    }
    if (metadata.systemInfo) {
      result.systemInfo = {
        os: metadata.systemInfo.os || result.systemInfo.os,
        browser: metadata.systemInfo.browser || result.systemInfo.browser,
        netLogVersion: metadata.systemInfo.netLogVersion || metadata.systemInfo.net_log_version || result.systemInfo.netLogVersion,
        commandLine: metadata.systemInfo.commandLine || metadata.systemInfo.command_line || result.systemInfo.commandLine,
      };
    }
    if (metadata.polledData) parsePolledData(metadata.polledData, result);
  };

  applyMetadata(options);

  const recordCommonEventStats = (rawType: number, rawSourceType: number | undefined, typeName: string, sourceTypeName: string) => {
    meta.parsedEvents++;
    result.totalEvents++;
    incrementCounter(eventTypeCounts, typeName);
    incrementCounter(sourceTypeCounts, sourceTypeName);
    if (typeName.startsWith('UNKNOWN_')) unknownEventTypes.add(rawType);
    if (sourceTypeName === 'UNKNOWN_SRC' && rawSourceType !== undefined) unknownSourceTypes.add(rawSourceType);
  };

  const recordLightweightEvent = (rawType: number, rawSourceType?: number) => {
    const typeName = eventNames[rawType] || EVENT_TYPES[rawType] || `UNKNOWN_${rawType}`;
    const sourceTypeName = rawSourceType !== undefined
      ? (sourceNames[rawSourceType] || SOURCE_TYPES[rawSourceType] || 'UNKNOWN_SRC')
      : 'UNKNOWN_SRC';
    recordCommonEventStats(rawType, rawSourceType, typeName, sourceTypeName);
    meta.lightweightCountedEvents++;
    incrementCounter(lightweightEventTypeCounts, typeName);
  };

  const accept = (rawEvent: any) => {
    const sourceType = rawEvent.source?.type || rawEvent.source_type || 0;
    const sourceId = rawEvent.source?.id || rawEvent.source_id || 0;
    const typeName = eventNames[rawEvent.type] || EVENT_TYPES[rawEvent.type] || `UNKNOWN_${rawEvent.type}`;
    const sourceTypeName = sourceNames[sourceType] || SOURCE_TYPES[sourceType] || 'UNKNOWN_SRC';
    const parsed: ParsedEvent = {
      time: parseFloat(rawEvent.time) || 0,
      type: rawEvent.type,
      typeName,
      source: {
        id: sourceId,
        type: sourceType,
        typeName: sourceTypeName,
      },
      phase: rawEvent.phase,
      phaseName: PHASE[rawEvent.phase] || `PHASE_${rawEvent.phase}`,
      params: rawEvent.params || {},
    };

    recordCommonEventStats(rawEvent.type, sourceType, parsed.typeName, parsed.source.typeName);
    meta.fullyParsedEvents++;
    if (parsed.source.typeName === 'URL_REQUEST') diagnosticsCounters.urlRequestEvents++;
    if (isDnsRelatedEvent(parsed)) diagnosticsCounters.dnsCandidateEvents++;
    if (`${parsed.typeName} ${parsed.source.typeName}`.includes('HOST_RESOLVER')) diagnosticsCounters.hostResolverCandidateEvents++;

    const headerCandidate = getHeaderCandidate(parsed.params);
    if (headerCandidate) {
      diagnosticsCounters.eventsWithHeaders++;
      Object.keys(parseHeaders(headerCandidate)).forEach(key => incrementCounter(responseHeaderKeyCounts, key));
    }

    if (isIpCandidateEvent(parsed)) {
      const ips = extractIpsFromValue(parsed.params);
      if (ips.length > 0) {
        diagnosticsCounters.eventsWithIpLikeParams++;
        incrementCounter(ipCandidateEventTypeCounts, parsed.typeName);
      }
    }

    if (isDnsRelatedEvent(parsed)) {
      const keys = new Set<string>();
      collectDiagnosticParamKeys(parsed.params, keys);
      keys.forEach(key => incrementCounter(dnsCandidateParamKeyCounts, key));
    }

    sourceIds.add(sourceId);
    if (parsed.time < result.timeRange.start) result.timeRange.start = parsed.time;
    if (parsed.time > result.timeRange.end) result.timeRange.end = parsed.time;
    if (parsed.phaseName === 'BEGIN') activeSources.add(sourceId);
    if (parsed.phaseName === 'END') activeSources.delete(sourceId);
    result.peakConcurrency = Math.max(result.peakConcurrency, activeSources.size);

    if (isKeyEvent(parsed) && eventsPreview.length < MAX_EVENTS_PREVIEW) {
      eventsPreview.push(parsed);
    } else if (isKeyEvent(parsed)) {
      meta.truncatedEventsPreview = true;
    }

    if (parsed.source.typeName === 'URL_REQUEST' && parsed.params.url && !requestIndex.has(sourceId)) {
      const req: URLRequest = {
        id: sourceId,
        url: parsed.params.url,
        method: parsed.params.method || 'GET',
        startTime: parsed.time,
        status: 'pending',
        timeline: {},
        events: [parsed],
        resolvedIp: null,
        remoteIp: null,
      };
      requestIndex.set(sourceId, req);
      result.urlRequests.push(req);
    }

    const req = requestIndex.get(sourceId);
    if (req) {
      if (req.events.length < MAX_REQUEST_EVENTS && req.events[req.events.length - 1] !== parsed) req.events.push(parsed);
      if (parsed.params.method) req.method = parsed.params.method;
      if (parsed.phaseName === 'END') {
        req.endTime = parsed.time;
        req.duration = parsed.time - req.startTime;
      }
      if (parsed.typeName.includes('READ_RESPONSE_HEADERS') || parsed.typeName.includes('READ_HEADERS')) {
        req.status = parsed.params.status_code ? `${parsed.params.status_code}` : 'completed';
        req.statusCode = parsed.params.status_code ?? req.statusCode;
        if (parsed.params.headers) {
          const headers = parseHeaders(parsed.params.headers);
          req.resolvedIp = req.resolvedIp || headers['x-response-cinfo'] || headers['x-tt-cip'] || headers['x-lsc-source-ip'] || null;
          req.remoteIp = req.remoteIp || headers['x-response-sinfo'] || null;
        }
      }
      const err = parsed.params.net_error ?? parsed.params.error_code;
      if (err !== undefined && err !== 0) {
        const errCode = Number(err);
        req.error = errCode;
        req.errorDesc = getNetErrorDescription(errCode);
        req.status = 'error';
        result.connectionFailures.push({ url: req.url, error: errCode, time: parsed.time });
      }
    }

    if (isDnsRelatedEvent(parsed)) {
      addBounded(result.dnsEvents, parsed);
      extractDnsRecordCandidates(parsed).forEach(candidate => {
        addDnsRecord(result, candidate.host, candidate.ips, 'dns_event', parsed.time);
      });
    }
    if (parsed.typeName.includes('TCP_') || parsed.typeName.includes('SOCKET_') || parsed.typeName.includes('TRANSPORT_CONNECT_')) addBounded(result.connectEvents, parsed);
    if (parsed.typeName.includes('SSL_') || parsed.typeName.includes('TLS_') || parsed.source.typeName.includes('SSL')) {
      addBounded(result.sslEvents, parsed);
      const sslError = parsed.params.error_code ?? parsed.params.net_error;
      if (sslError !== undefined && sslError !== 0) {
        const issue = { event: parsed, error: Number(sslError), host: parsed.params.host || parsed.params.server_info || 'unknown', category: classifySslIssueCategory(sslError) };
        addBounded(result.sslIssues, issue);
        if (issue.category === 'cert') addBounded(result.certIssues, issue);
      }
    }
    if (parsed.typeName.includes('QUIC_')) {
      addBounded(result.quicEvents, parsed);
      result.protocols.QUIC = (result.protocols.QUIC || 0) + 1;
    }
    if (parsed.source.typeName === 'HTTP2_SESSION' || parsed.typeName.includes('HTTP2_') || parsed.typeName.includes('HTTP/2_')) {
      addBounded(result.http2Events, parsed);
      result.protocols['HTTP/2'] = (result.protocols['HTTP/2'] || 0) + 1;
    }
    if (shouldAnalyzeProxyEvent(parsed)) analyzeProxyEvent(parsed, result);
    if (parsed.typeName.includes('HTTP_CACHE_') || parsed.typeName.includes('DISK_CACHE_')) addBounded(result.cacheEvents, parsed);
    if (parsed.typeName.includes('NETWORK_CHANGE_')) addBounded(result.networkChanges, parsed);
    if (parsed.params.net_error && parsed.params.net_error !== 0) {
      result.errorSources[parsed.params.net_error] = (result.errorSources[parsed.params.net_error] || 0) + 1;
    }
  };

  const finish = (): StreamingAnalyzerOutput => {
    result.uniqueSources = sourceIds.size;
    meta.unknownEventTypes = Array.from(unknownEventTypes).sort((a, b) => a - b);
    meta.unknownSourceTypes = Array.from(unknownSourceTypes).sort((a, b) => a - b);
    meta.lightweightEventTypes = topCounts(lightweightEventTypeCounts, 30);
    meta.diagnostics = {
      topEventTypes: topCounts(eventTypeCounts, 30),
      topSourceTypes: topCounts(sourceTypeCounts, 30),
      dnsCandidateEvents: diagnosticsCounters.dnsCandidateEvents,
      hostResolverCandidateEvents: diagnosticsCounters.hostResolverCandidateEvents,
      urlRequestEvents: diagnosticsCounters.urlRequestEvents,
      urlRequestsCreated: result.urlRequests.length,
      eventsWithHeaders: diagnosticsCounters.eventsWithHeaders,
      responseHeaderKeys: topCounts(responseHeaderKeyCounts, 40),
      eventsWithIpLikeParams: diagnosticsCounters.eventsWithIpLikeParams,
      ipCandidateEventTypes: topCounts(ipCandidateEventTypeCounts, 30),
      dnsCandidateParamKeys: topCounts(dnsCandidateParamKeyCounts, 50),
    };
    if (result.timeRange.start === Infinity) result.timeRange.start = 0;

    for (const req of result.urlRequests) {
      if (req.duration && req.duration > SLOW_REQUEST_MS) {
        result.slowRequests.push(req);
        result.warnings.push({
          severity: 'warning',
          category: '慢请求',
          message: `慢请求 (${(req.duration / 1000).toFixed(1)}s): ${req.url}`,
          detail: `URL: ${req.url}\n耗时: ${(req.duration / 1000).toFixed(2)}s\n方法: ${req.method}`,
          time: req.startTime,
        });
      }
      if (req.url.startsWith('https://')) req.protocol = req.protocol || 'HTTP/1.1';
    }

    const domainMap = new Map<string, any>();
    for (const req of result.urlRequests) {
      try {
        const domain = new URL(req.url).hostname;
        if (!domainMap.has(domain)) {
          domainMap.set(domain, { domain, urls: [], errors: [], errorCodes: [], ips: [], resolvedIp: null, remoteIp: null, count: 0, firstTime: req.startTime, lastTime: req.startTime });
        }
        const entry = domainMap.get(domain);
        entry.urls.push(req.url);
        entry.count++;
        entry.firstTime = Math.min(entry.firstTime, req.startTime);
        entry.lastTime = Math.max(entry.lastTime, req.startTime);
        entry.resolvedIp = entry.resolvedIp || req.resolvedIp;
        entry.remoteIp = entry.remoteIp || req.remoteIp;
        if (req.error !== undefined) {
          entry.errors.push({ code: req.error, desc: req.errorDesc || getNetErrorDescription(req.error), time: req.startTime });
          if (!entry.errorCodes.includes(req.error)) entry.errorCodes.push(req.error);
        }
      } catch {}
    }
    result.failedDomains = Array.from(domainMap.values())
      .filter(entry => entry.errors.length > 0)
      .map(entry => ({ ...entry, urls: Array.from(new Set(entry.urls)) }))
      .sort((a, b) => b.count - a.count);

    for (const fail of result.connectionFailures) {
      const issue: DiagnosisIssue = {
        severity: 'error',
        category: '连接失败',
        message: `请求失败: ${fail.url}`,
        detail: `错误码: ${fail.error} (${getNetErrorDescription(fail.error)})`,
        time: fail.time,
      };
      result.errors.push(issue);
    }
    for (const issue of result.sslIssues) {
      result.errors.push({
        severity: 'error',
        category: 'SSL/TLS',
        message: `TLS/SSL 错误: ${issue.host}`,
        detail: `错误码: ${issue.error} (${getNetErrorDescription(issue.error)})`,
        time: issue.event.time,
      });
    }

    return { result, eventsPreview, meta };
  };

  return { accept, finish, applyMetadata, recordLightweightEvent };
}
