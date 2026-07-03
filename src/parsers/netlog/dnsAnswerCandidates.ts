export type DnsAnswerSourceKind =
  | 'hostResolverCache'
  | 'dnsTaskResult'
  | 'genericDnsEvent'
  | 'summaryOnlyCandidate';

export interface DnsAnswerCandidateTrace {
  eventId?: number;
  sourceId?: number;
  byteStart?: number;
  byteEnd?: number;
  typeName?: string;
  sourceTypeName?: string;
  time?: number;
}

export interface DnsAnswerCandidate extends DnsAnswerCandidateTrace {
  host?: string;
  ips: string[];
  aliases?: string[];
  queryType?: string;
  error?: number;
  sourceKind: DnsAnswerSourceKind;
}

export interface DnsAnswerCandidateStats {
  candidateCount: number;
  uniqueHostIpPairs: number;
  missingTraceCount: number;
  bySourceKind: Record<string, number>;
  byTypeName: Record<string, number>;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

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

export function normalizeDnsIp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ip = stripIpWrapper(value);
  return isIpLike(ip) ? ip : undefined;
}

function extractIpStringsFromText(value: string): string[] {
  const matches = value.match(/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|\[[0-9a-fA-F:.]+\](?::\d+)?/g) || [];
  return Array.from(new Set(matches.map(normalizeDnsIp).filter((ip): ip is string => Boolean(ip))));
}

export function extractDnsIpsFromValue(value: unknown, depth = 0): string[] {
  const ips = new Set<string>();
  const walk = (node: unknown, d: number) => {
    if (!node || d > 6) return;
    const normalizedIp = normalizeDnsIp(node);
    if (normalizedIp) {
      ips.add(normalizedIp);
      return;
    }
    if (typeof node === 'string') {
      extractIpStringsFromText(node).forEach(ip => ips.add(ip));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(item => walk(item, d + 1));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const normalized = normalizeKey(key);
        if (
          normalized.includes('address') ||
          normalized.includes('ip') ||
          normalized.includes('endpoint') ||
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

export function normalizeDnsHostCandidate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || normalizeDnsIp(trimmed)) return undefined;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return new URL(trimmed).hostname;
  } catch {}
  if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) return trimmed.replace(/:\d+$/, '');
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed) || trimmed.includes('.')) return trimmed;
  return undefined;
}

function firstHostCandidate(values: unknown[]): string | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const hit = firstHostCandidate(value);
      if (hit) return hit;
      continue;
    }
    const host = normalizeDnsHostCandidate(value);
    if (host) return host;
  }
  return undefined;
}

function findHostLikeValue(value: unknown, depth = 0): string | undefined {
  if (!value || depth > 4) return undefined;
  if (typeof value === 'string') return normalizeDnsHostCandidate(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findHostLikeValue(item, depth + 1);
      if (hit) return hit;
    }
    return undefined;
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
  return undefined;
}

export function extractDnsHostFromParams(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  const candidates = [
    params.host,
    params.hostname,
    params.domain,
    params.domain_name,
    params.query,
    params.qname,
    params.dns_query,
    params.url,
    (params.host_port_pair as Record<string, unknown> | undefined)?.host,
    (params.host_resolver_request as Record<string, unknown> | undefined)?.host,
  ];
  for (const candidate of candidates) {
    const host = normalizeDnsHostCandidate(candidate);
    if (host) return host;
  }
  return findHostLikeValue(params);
}

function sourceKindForType(typeName?: string): DnsAnswerSourceKind {
  if (typeName === 'HOST_RESOLVER_MANAGER_CACHE_HIT') return 'hostResolverCache';
  if (typeName === 'HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS') return 'dnsTaskResult';
  return typeName && /DNS|HOST_RESOLVER/i.test(typeName) ? 'genericDnsEvent' : 'summaryOnlyCandidate';
}

function cleanIps(values: unknown): string[] {
  return Array.from(new Set(extractDnsIpsFromValue(values)));
}

export function extractDnsAnswerCandidates(
  params: Record<string, unknown> | undefined,
  trace: DnsAnswerCandidateTrace = {}
): DnsAnswerCandidate[] {
  if (!params) return [];
  const sourceKind = sourceKindForType(trace.typeName);
  const candidates: DnsAnswerCandidate[] = [];
  const directHost = extractDnsHostFromParams(params);

  const add = (
    host: unknown,
    ips: unknown,
    patch: Partial<Omit<DnsAnswerCandidate, 'ips' | 'sourceKind'>> = {}
  ) => {
    const normalizedHost = normalizeDnsHostCandidate(host) || directHost;
    const clean = cleanIps(ips);
    if (!normalizedHost || clean.length === 0) return;
    candidates.push({
      ...trace,
      ...patch,
      host: normalizedHost,
      ips: clean,
      sourceKind,
    });
  };

  const results = params.results;
  if (Array.isArray(results)) {
    const ipsByDomain = new Map<string, string[]>();
    const aliasToDomain = new Map<string, string>();
    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const value = item as Record<string, unknown>;
      const domainName = normalizeDnsHostCandidate(value.domain_name);
      const aliasTarget = normalizeDnsHostCandidate(value.alias_target);
      if (domainName && aliasTarget) aliasToDomain.set(domainName, aliasTarget);
      const ips = cleanIps([value.endpoints, value.hosts, value.address, value.addresses, value.ip_endpoints, value.endpoint_results]);
      if (domainName && ips.length > 0) ipsByDomain.set(domainName, ips);
      add(domainName, ips, {
        aliases: aliasTarget ? [aliasTarget] : undefined,
        queryType: typeof value.query_type === 'string' ? value.query_type : undefined,
        error: typeof value.error === 'number' ? value.error : typeof value.error_code === 'number' ? value.error_code : typeof value.net_error === 'number' ? value.net_error : undefined,
      });
    }
    for (const [aliasHost, targetHost] of aliasToDomain.entries()) {
      const targetIps = ipsByDomain.get(targetHost);
      if (targetIps) add(aliasHost, targetIps, { aliases: [targetHost] });
    }
  } else if (results && typeof results === 'object') {
    const value = results as Record<string, unknown>;
    const aliases = Array.isArray(value.aliases) ? value.aliases.filter((item): item is string => typeof item === 'string') : [];
    const resultHost =
      normalizeDnsHostCandidate(value.host) ||
      normalizeDnsHostCandidate(value.hostname) ||
      normalizeDnsHostCandidate(value.domain_name) ||
      normalizeDnsHostCandidate(value.qname) ||
      firstHostCandidate([value.aliases, value.canonical_names]) ||
      directHost;
    add(resultHost, [
      value.ip_endpoints,
      value.endpoint_address,
      value.endpoints,
      value.addresses,
      value.address_list,
      value.hostname_results,
    ], { aliases });
  }

  add(directHost, [
    params.address,
    params.address_list,
    params.endpoint_results,
    params.ip_endpoints,
    params.endpoints,
  ]);

  const hostPorts = params.host_ports || params.hosts;
  const ipEndpoints = params.ip_endpoints || params.endpoints || params.endpoint_results;
  if (hostPorts && ipEndpoints) {
    const hosts = Array.isArray(hostPorts) ? hostPorts : [hostPorts];
    const endpoints = Array.isArray(ipEndpoints) ? ipEndpoints : [ipEndpoints];
    hosts.forEach((hostValue, index) => {
      const host = typeof hostValue === 'object' && hostValue
        ? normalizeDnsHostCandidate((hostValue as Record<string, unknown>).host || (hostValue as Record<string, unknown>).hostname || (hostValue as Record<string, unknown>).name)
        : normalizeDnsHostCandidate(hostValue);
      add(host, endpoints[index] ?? endpoints);
    });
  }

  const hostnameResults = params.hostname_results;
  if (hostnameResults && typeof hostnameResults === 'object') {
    for (const [hostKey, value] of Object.entries(hostnameResults as Record<string, unknown>)) {
      add(normalizeDnsHostCandidate(hostKey) || extractDnsHostFromParams(value as Record<string, unknown>), value);
    }
  }

  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.sourceKind}|${candidate.host}|${[...candidate.ips].sort().join(',')}|${candidate.eventId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeDnsAnswerCandidates(candidates: DnsAnswerCandidate[]): DnsAnswerCandidateStats {
  const hostIpPairs = new Set<string>();
  const bySourceKind: Record<string, number> = {};
  const byTypeName: Record<string, number> = {};
  let missingTraceCount = 0;
  for (const candidate of candidates) {
    bySourceKind[candidate.sourceKind] = (bySourceKind[candidate.sourceKind] || 0) + 1;
    if (candidate.typeName) byTypeName[candidate.typeName] = (byTypeName[candidate.typeName] || 0) + 1;
    if (candidate.eventId === undefined || candidate.sourceId === undefined || candidate.byteStart === undefined || candidate.byteEnd === undefined) {
      missingTraceCount += 1;
    }
    for (const ip of candidate.ips) {
      hostIpPairs.add(`${candidate.host || '-'}|${ip}`);
    }
  }
  return {
    candidateCount: candidates.length,
    uniqueHostIpPairs: hostIpPairs.size,
    missingTraceCount,
    bySourceKind,
    byTypeName,
  };
}
