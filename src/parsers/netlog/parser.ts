import { EVENT_TYPES, SOURCE_TYPES, PHASE, getNetErrorDescription, isHttp2Goaway, isHttp2GoawayRecv } from './constants';
import { formatTime, truncateUrl } from '../../utils/format';
import { SLOW_REQUEST_MS } from '../../constants/analysisThresholds';

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

export interface AnalysisResult {
  totalEvents: number;
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
  errorSources: Record<string, number>;
  certIssues: { event: ParsedEvent; error: number; host: string }[];
  connectionFailures: { url: string; error: number; time: number }[];
  stalledRequests: URLRequest[];
  slowRequests: URLRequest[];
  cacheEvents: ParsedEvent[];
  networkChanges: ParsedEvent[];
  proxyInfo: ProxyInfo;
  failedDomains: FailedDomain[];
  systemInfo: {
    os: string | null;
    browser: string | null;
    netLogVersion: string | null;
    commandLine: string | null;
  };
}



export function parseLog(logData: any): { events: ParsedEvent[]; result: AnalysisResult } {
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
  // O(1) URL request lookup map
  const requestIndex = new Map<number, URLRequest>();

  for (const evt of events) {
    const sourceType = evt.source?.type || evt.source_type || 0;
    const sourceId = evt.source?.id || evt.source_id || 0;

    const parsed: ParsedEvent = {
      time: parseFloat(evt.time) || 0,
      type: evt.type,
      typeName: eventNames[evt.type] || EVENT_TYPES[evt.type] || `UNKNOWN_${evt.type}`,
      source: {
        id: sourceId,
        type: sourceType,
        typeName: sourceNames[sourceType] || SOURCE_TYPES[sourceType] || 'UNKNOWN_SRC',
      },
      phase: evt.phase,
      phaseName: PHASE[evt.phase] || `PHASE_${evt.phase}`,
      params: evt.params || {},
    };

    parsedEvents.push(parsed);
    result.totalEvents++;

    if (parsed.time < result.timeRange.start) result.timeRange.start = parsed.time;
    if (parsed.time > result.timeRange.end) result.timeRange.end = parsed.time;

    categorizeEvent(parsed, result, requestIndex);
  }

  // Calculate unique sources and peak concurrency
  const sourceIds = new Set(parsedEvents.map(e => e.source.id));
  result.uniqueSources = sourceIds.size;
  result.peakConcurrency = calculatePeakConcurrency(parsedEvents);

  buildTimelines(result);
  inferProtocols(result);
  extractFailedDomains(result);
  runDiagnostics(result);

  return { events: parsedEvents, result };
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

  // DNS cache info
  if (polledData.dns_cache) {
    for (const entry of polledData.dns_cache) {
      if (entry.hostname && entry.address) {
        r.hosts[entry.hostname] = entry.address;
      }
    }
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

    if (evt.phaseName === 'BEGIN' && !wasActive) {
      sourceStates.set(sid, true);
      current++;
      if (current > peak) peak = current;
    } else if (evt.phaseName === 'END' && wasActive) {
      sourceStates.set(sid, false);
      current--;
    }
  }

  return peak;
}

function categorizeEvent(evt: ParsedEvent, r: AnalysisResult, requestIndex: Map<number, URLRequest>) {
  const p = evt.params;
  const tn = evt.typeName;
  const stn = evt.source.typeName;

  // ---- SSL/TLS events ----
  if (stn === 'SSL_CONNECT_JOB' || stn === 'SSL_CONNECT' || tn.includes('SSL_') || tn.includes('TLS_')) {
    r.sslEvents.push(evt);
    if (p.error_code || p.net_error) {
      r.certIssues.push({
        event: evt,
        error: p.error_code || p.net_error,
        host: p.host || p.server_info || 'unknown',
      });
    }
    if (p.encrypted_protocol || p.version) {
      const key = 'TLS_' + (p.encrypted_protocol || p.version);
      r.protocols[key] = (r.protocols[key] || 0) + 1;
    }
  }

  // ---- QUIC events ----
  if (tn.includes('QUIC_')) {
    r.quicEvents.push(evt);
    r.protocols['QUIC'] = (r.protocols['QUIC'] || 0) + 1;
    if (p.error_code || p.net_error) {
      r.errors.push({
        severity: 'error',
        category: 'QUIC',
        message: `QUIC 连接错误: ${p.error_code || p.net_error}`,
        detail: JSON.stringify(p, null, 2),
        time: evt.time,
      });
    }
  }

  // ---- HTTP/2 events ----
  if (stn === 'HTTP2_SESSION' || tn.includes('HTTP2_') || tn.includes('HTTP/2_')) {
    r.http2Events.push(evt);
    r.protocols['HTTP/2'] = (r.protocols['HTTP/2'] || 0) + 1;
    if (isHttp2Goaway(evt)) {
      r.errors.push({
        severity: 'warning',
        category: 'HTTP/2',
        message: `HTTP/2 ${isHttp2GoawayRecv(evt) ? '接收' : '发送'} GOAWAY 帧`,
        detail: `Last Stream ID: ${p.last_stream_id}, Error: ${p.error_code || p.status}`,
        time: evt.time,
      });
    }
  }

  // ---- DNS events ----
  if (stn === 'HOST_RESOLVER_IMPL_JOB' || stn === 'HOST_RESOLVER_MANAGER_JOB' || tn.includes('DNS_')) {
    r.dnsEvents.push(evt);
    if (p.address) {
      r.hosts[p.host || p.hostname || 'unknown'] = p.address;
    }
  }

  // ---- URL_REQUEST events ----
  if (stn === 'URL_REQUEST') {
    // Create new URLRequest when we see a URL
    if (p.url) {
      if (!requestIndex.has(evt.source.id)) {
        const newReq: URLRequest = {
          id: evt.source.id,
          url: p.url,
          method: p.method || 'GET',
          startTime: evt.time,
          events: [evt],
          status: 'pending',
          timeline: {},
          resolvedIp: null,
          remoteIp: null,
          errorDesc: undefined,
        };
        r.urlRequests.push(newReq);
        requestIndex.set(evt.source.id, newReq);
      }
    }
    // Associate event with existing request by source.id (O(1) lookup)
    const req = requestIndex.get(evt.source.id);
    if (req) {
      // Avoid duplicate events (same type+phase+time)
      const isDuplicate = req.events.some(
        e => e.type === evt.type && e.phase === evt.phase && e.time === evt.time
      );
      if (!isDuplicate) {
        req.events.push(evt);
      }
      // Detect response received
      if (tn === 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS') {
        req.status = p.status_code ? `${p.status_code}` : 'completed';
        req.statusCode = p.status_code;
      }
      // Extract IP info from response headers
      if ((tn === 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS' || tn === 'HTTP_TRANSACTION_READ_HEADERS') && p.headers) {
        const headers = parseHeaders(p.headers);
        if (!req.resolvedIp) {
          req.resolvedIp = headers['x-response-cinfo'] || headers['x-tt-cip'] || headers['x-lsc-source-ip'] || null;
        }
        if (!req.remoteIp) {
          req.remoteIp = headers['x-response-sinfo'] || null;
        }
      }
      // Detect request end
      if (evt.phaseName === 'END') {
        if (!req.endTime || evt.time > req.endTime) {
          req.endTime = evt.time;
        }
        req.duration = (req.endTime || evt.time) - req.startTime;
      }
      // Detect errors
      if (p.net_error || p.error_code) {
        const errCode = p.net_error || p.error_code;
        req.error = errCode;
        req.errorDesc = getNetErrorDescription(errCode);
        req.status = 'error';
        r.connectionFailures.push({
          url: req.url,
          error: errCode,
          time: evt.time,
        });
      }
    }
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

function shouldAnalyzeProxyEvent(evt: ParsedEvent): boolean {
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

function addProxyEvent(evt: ParsedEvent, r: AnalysisResult) {
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

function buildTimelines(r: AnalysisResult) {
  for (const req of r.urlRequests) {
    let dnsStart: number | null = null, dnsEnd: number | null = null;
    let connectStart: number | null = null, connectEnd: number | null = null;
    let sslStart: number | null = null, sslEnd: number | null = null;
    let sendStart: number | null = null, sendEnd: number | null = null;
    let headersStart: number | null = null, headersEnd: number | null = null;
    let bodyEnd: number | null = null;

    for (const evt of req.events) {
      const tn = evt.typeName;
      const ph = evt.phaseName;
      const stn = evt.source.typeName;

      // DNS
      if (stn === 'HOST_RESOLVER_IMPL_JOB' || stn === 'HOST_RESOLVER_MANAGER_JOB' || tn.includes('DNS_')) {
        if (ph === 'BEGIN') dnsStart = evt.time;
        if (ph === 'END') dnsEnd = evt.time;
      }
      // Connect
      if (tn.includes('TCP_') || tn.includes('SOCKET_') || tn.includes('TRANSPORT_CONNECT_')) {
        if (ph === 'BEGIN') connectStart = evt.time;
        if (ph === 'END') connectEnd = evt.time;
      }
      // SSL
      if (tn.includes('SSL_') || tn.includes('TLS_')) {
        if (ph === 'BEGIN') sslStart = evt.time;
        if (ph === 'END') sslEnd = evt.time;
      }
      // Send
      if (tn.includes('SEND_REQUEST_') || tn.includes('HTTP_TRANSACTION_SEND_')) {
        if (ph === 'BEGIN') sendStart = evt.time;
        if (ph === 'END') sendEnd = evt.time;
      }
      // Headers
      if (tn.includes('READ_RESPONSE_HEADERS') || tn.includes('READ_HEADERS')) {
        if (ph === 'BEGIN') headersStart = evt.time;
        if (ph === 'END') headersEnd = evt.time;
      }
      // Body
      if (tn.includes('READ_BODY') || tn.includes('READ_DATA')) {
        if (ph === 'END') bodyEnd = evt.time;
      }
    }

    if (dnsStart !== null && dnsEnd !== null) {
      req.timeline.dns = { start: dnsStart, end: dnsEnd, duration: dnsEnd - dnsStart };
    }
    if (connectStart !== null && connectEnd !== null) {
      req.timeline.connect = { start: connectStart, end: connectEnd, duration: connectEnd - connectStart };
    }
    if (sslStart !== null && sslEnd !== null) {
      req.timeline.ssl = { start: sslStart, end: sslEnd, duration: sslEnd - sslStart };
    }

    const sStart = sendStart || req.startTime;
    const sEnd = sendEnd || headersStart || connectEnd || sslEnd;
    if (sStart !== null && sEnd !== null) {
      req.timeline.send = { start: sStart, end: sEnd, duration: sEnd - sStart };
    }

    const wStart = sEnd || connectEnd || sslEnd;
    const wEnd = headersEnd || headersStart;
    if (wStart !== null && wEnd !== null && wEnd > wStart) {
      req.timeline.wait = { start: wStart, end: wEnd, duration: wEnd - wStart };
    }

    const dStart = headersEnd || headersStart;
    const dEnd = bodyEnd || req.endTime;
    if (dStart !== null && dEnd !== undefined && dEnd !== null && dStart !== undefined && dEnd > dStart) {
      req.timeline.download = { start: dStart, end: dEnd, duration: dEnd - dStart };
    }
  }
}

function inferProtocols(r: AnalysisResult) {
  for (const req of r.urlRequests) {
    const hasQuic = req.events.some(e =>
      e.typeName.includes('QUIC_') || e.source.typeName.includes('QUIC')
    );
    const hasHttp2 = req.events.some(e =>
      e.source.typeName === 'HTTP2_SESSION' || e.typeName.includes('HTTP2_') || e.typeName.includes('HTTP/2_')
    );
    const hasSsl = req.events.some(e =>
      e.typeName.includes('SSL_') || e.typeName.includes('TLS_') ||
      e.source.typeName === 'SSL_CONNECT_JOB' || e.source.typeName === 'SSL_CONNECT'
    );

    if (hasQuic) {
      req.protocol = 'QUIC';
    } else if (hasHttp2) {
      req.protocol = 'HTTP/2';
    } else if (hasSsl || req.url.startsWith('https://')) {
      req.protocol = 'HTTP/1.1';
    } else {
      req.protocol = 'HTTP/1.1';
    }
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
    .map(entry => ({ ...entry, urls: [...new Set(entry.urls)] }))
    .sort((a, b) => b.count - a.count);
}

function runDiagnostics(r: AnalysisResult) {
  for (const fail of r.connectionFailures) {
    const netErr = getNetErrorDescription(fail.error);
    r.errors.push({
      severity: 'error',
      category: '连接失败',
      message: `请求失败: ${fail.url}`,
      detail: `错误码: ${fail.error} (${netErr})\n时间: ${formatTime(fail.time)}`,
      time: fail.time,
    });
  }

  for (const cert of r.certIssues) {
    r.errors.push({
      severity: 'error',
      category: 'SSL/TLS',
      message: `SSL/TLS 握手失败: ${cert.host}`,
      detail: `错误码: ${cert.error}\n事件: ${cert.event.typeName}`,
      time: cert.event.time,
    });
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
  if (goaways.length > 0) {
    r.warnings.push({
      severity: 'warning',
      category: 'HTTP/2',
      message: `检测到 ${goaways.length} 个 HTTP/2 GOAWAY 帧`,
      detail: '服务器主动关闭了 HTTP/2 连接，可能存在连接复用问题或服务器重启。',
      time: goaways[0].time,
    });
  }

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

  // Proxy detection: check if proxy is actually being used (not just DIRECT events)
  if (r.proxyInfo.hasProxy && r.proxyInfo.proxyList.length > 0) {
    const pi = r.proxyInfo;
    let detail = `代理模式: ${pi.proxyType || '未知'}\n`;
    detail += `代理服务器: ${pi.proxyList.join(', ')}\n`;
    if (pi.pacUrl) {
      detail += `PAC 地址: ${pi.pacUrl}\n`;
    }
    if (pi.proxySettings && pi.proxySettings.bypass_list) {
      const bypassList = pi.proxySettings.bypass_list;
      if (Array.isArray(bypassList) && bypassList.length > 0) {
        detail += `\nBypass 列表 (${bypassList.length} 项):\n`;
        detail += bypassList.map((item: string) => `  - ${item}`).join('\n');
      }
    }
    if (pi.vpnHints.length > 0) {
      detail += `\nVPN 检测线索:\n`;
      detail += pi.vpnHints.map((h: string) => `  - ${h}`).join('\n');
    }

    r.warnings.push({
      severity: 'warning',
      category: '代理',
      message: `检测到代理配置: ${pi.proxyList.join(', ')}`,
      detail,
      time: r.proxyEvents[0]?.time || 0,
    });
  } else if (r.proxyEvents.length > 0) {
    // Only DIRECT proxy events found
    r.info.push({
      severity: 'ok',
      category: '代理',
      message: '未检测到代理配置',
      detail: '所有请求均为直连模式，未经过代理服务器。',
      time: r.proxyEvents[0]?.time || 0,
    });
  }

  for (const [errCode, count] of Object.entries(r.errorSources)) {
    const code = parseInt(errCode);
    const desc = getNetErrorDescription(code);
    if (code !== 0) {
      r.errors.push({
        severity: 'error',
        category: '网络错误',
        message: `${desc} (出现 ${count} 次)`,
        detail: `错误码: ${errCode}`,
        time: 0,
      });
    }
  }

  if (r.errors.length === 0 && r.warnings.length === 0) {
    r.info.push({
      severity: 'ok',
      category: '总体评估',
      message: '未检测到明显网络问题',
      detail: '所有请求均正常完成，无错误或异常延迟。',
      time: 0,
    });
  }
}

// Re-export format utilities from shared utils for backward compatibility
export { formatDuration, formatTime, truncateUrl } from '../../utils/format';

export function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)] || 0;
}

// Parse headers from various formats (string, array, object) into a key-value map
function parseHeaders(headers: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  if (Array.isArray(headers)) {
    // Array of "key: value" strings
    for (const line of headers) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.substring(0, idx).trim().toLowerCase();
        const val = line.substring(idx + 1).trim();
        result[key] = val;
      }
    }
  } else if (typeof headers === 'string') {
    // CRLF-separated string
    const lines = headers.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.substring(0, idx).trim().toLowerCase();
        const val = line.substring(idx + 1).trim();
        result[key] = val;
      }
    }
  } else if (typeof headers === 'object') {
    // Already an object
    for (const [key, val] of Object.entries(headers)) {
      result[key.toLowerCase()] = String(val);
    }
  }
  return result;
}
