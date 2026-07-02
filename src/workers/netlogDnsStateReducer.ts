import { normalizeIp } from '../diagnosis/ipEvidence';
import type { DnsStateView } from './netlogDatasetViews';

interface EventSeed {
  eventId: number;
  time: number;
  typeName: string;
  sourceId: number;
  sourceTypeName: string;
  phase: number;
  params?: Record<string, unknown>;
}

function extractSocketIpValues(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object') return [raw];
  const value = raw as Record<string, unknown>;
  return [
    value.ip,
    value.address,
    value.ip_address,
    value.endpoint,
    value.ip_endpoint,
    value.endpoint_address,
  ].filter(Boolean);
}

function normalizeIpList(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalizeIp).filter((ip): ip is string => Boolean(ip))));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

export function createNetlogDnsStateReducer() {
  const hostResolverCache = new Map<string, DnsStateView['hostResolverCache'][number]>();
  const taskResults = new Map<string, DnsStateView['taskResults'][number]>();
  const ipv6ReachabilityChecks: DnsStateView['ipv6ReachabilityChecks'] = [];

  const accept = (seed: EventSeed) => {
    const params = seed.params || {};
    if (seed.typeName === 'HOST_RESOLVER_MANAGER_CACHE_HIT') {
      const results = params.results;
      if (results && typeof results === 'object' && !Array.isArray(results)) {
        const value = results as Record<string, unknown>;
        const aliases = stringList(value.aliases);
        const host = aliases[0] || firstString(params.host, params.hostname, params.domain_name) || `source:${seed.sourceId}`;
        const ips = normalizeIpList((Array.isArray(value.ip_endpoints) ? value.ip_endpoints : []).flatMap(extractSocketIpValues));
        if (ips.length > 0 || aliases.length > 0) {
          hostResolverCache.set(`${host}-${seed.eventId}`, {
            host,
            ips,
            aliases,
            expires: value.expiration as string | number | undefined,
            sourceId: seed.sourceId,
            eventId: seed.eventId,
          });
        }
      }
    }

    if (seed.typeName === 'HOST_RESOLVER_DNS_TASK_EXTRACTION_RESULTS') {
      const results = Array.isArray(params.results) ? params.results : [];
      for (const item of results) {
        if (!item || typeof item !== 'object') continue;
        const value = item as Record<string, unknown>;
        const host = firstString(value.domain_name, value.alias_target, params.host, params.hostname) || `source:${seed.sourceId}`;
        const endpoints = Array.isArray(value.endpoints) ? value.endpoints : [];
        const ips = normalizeIpList(endpoints.flatMap(extractSocketIpValues));
        const aliases = [value.alias_target].filter((entry): entry is string => typeof entry === 'string');
        const error = typeof value.error === 'number' ? value.error : undefined;
        if (ips.length > 0 || aliases.length > 0 || error !== undefined) {
          taskResults.set(`${host}-${value.query_type || ''}-${seed.eventId}`, {
            host,
            queryType: typeof value.query_type === 'string' ? value.query_type : undefined,
            ips,
            aliases,
            error,
            sourceId: seed.sourceId,
            eventId: seed.eventId,
          });
        }
      }
    }

    if (seed.typeName === 'HOST_RESOLVER_MANAGER_IPV6_REACHABILITY_CHECK') {
      ipv6ReachabilityChecks.push({
        available: typeof params.ipv6_available === 'boolean' ? params.ipv6_available : undefined,
        sourceId: seed.sourceId,
        eventId: seed.eventId,
      });
    }
  };

  const finish = (): DnsStateView => {
    const view: DnsStateView = {
      configServers: [],
      hostResolverCache: Array.from(hostResolverCache.values()),
      taskResults: Array.from(taskResults.values()),
      dohCandidates: [],
      ipv6ReachabilityChecks,
      evidenceGaps: [],
    };
    if (view.configServers.length === 0) {
      view.evidenceGaps.push('未发现 DNS server 配置记录，不代表用户没有配置 DNS。');
    }
    if (view.hostResolverCache.length === 0 && view.taskResults.length === 0) {
      view.evidenceGaps.push('未发现 Host Resolver cache 或 DNS task result，DNS answer 可能只能从 summary fallback 查看。');
    }
    return view;
  };

  return { accept, finish };
}
