import { normalizeIp } from '../diagnosis/ipEvidence';
import { extractDnsAnswerCandidates } from '../parsers/netlog/dnsAnswerCandidates';
import type { DnsStateView } from './netlogDatasetViews';

interface EventSeed {
  eventId: number;
  byteStart?: number;
  byteEnd?: number;
  time: number;
  typeName: string;
  sourceId: number;
  sourceTypeName: string;
  phase: number;
  params?: Record<string, unknown>;
}

function normalizeIpList(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalizeIp).filter((ip): ip is string => Boolean(ip))));
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function normalizeKey(key: string): string {
  return key.replace(/[_\-\s]/g, '').toLowerCase();
}

const DNS_SERVER_KEYS = new Set([
  'nameservers',
  'nameserver',
  'dnsservers',
  'dnsserver',
  'dnsserveraddresses',
  'dnsserveraddress',
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
]);

const DOH_TEMPLATE_KEYS = new Set([
  'templates',
  'servertemplates',
]);

const DOH_PATH_CONTEXT_KEYS = ['dns', 'securedns', 'doh', 'dnsoverhttps', 'hostresolver'];

function isDnsServerKey(key: string): boolean {
  return DNS_SERVER_KEYS.has(normalizeKey(key));
}

function isDohCandidateKey(key: string): boolean {
  return DOH_CANDIDATE_KEYS.has(normalizeKey(key));
}

function isDohTemplateKey(key: string): boolean {
  return DOH_TEMPLATE_KEYS.has(normalizeKey(key));
}

function hasDohPathContext(path: string[]): boolean {
  return path.map(normalizeKey).some(part => DOH_PATH_CONTEXT_KEYS.some(context => part.includes(context)));
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(item => collectStrings(item, output));
  }
  return output;
}

export function createNetlogDnsStateReducer() {
  const configServers = new Map<string, DnsStateView['configServers'][number]>();
  const dohCandidates = new Map<string, DnsStateView['dohCandidates'][number]>();
  const hostResolverCache = new Map<string, DnsStateView['hostResolverCache'][number]>();
  const taskResults = new Map<string, DnsStateView['taskResults'][number]>();
  const dnsErrors = new Map<string, DnsStateView['dnsErrors'][number]>();
  const ipv6ReachabilityChecks: DnsStateView['ipv6ReachabilityChecks'] = [];

  const acceptTopLevelConfig = (rootKey: string, value: unknown) => {
    const source: 'polledData' | 'systemInfo' | 'unknown' =
      rootKey === 'polledData' ? 'polledData' : rootKey === 'systemInfo' ? 'systemInfo' : 'unknown';
    const walk = (node: unknown, path: string[]) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, [...path, String(index)]));
        return;
      }
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const sourceKey = [...path, key].join('.');
        if (isDnsServerKey(key)) {
          normalizeIpList(collectStrings(child)).forEach(ip => {
            configServers.set(`${source}-${sourceKey}-${ip}`, { ip, source, sourceKey });
          });
          continue;
        }
        if (isDohCandidateKey(key) || (isDohTemplateKey(key) && hasDohPathContext(path))) {
          collectStrings(child).forEach(candidate => {
            dohCandidates.set(`${source}-${sourceKey}-${candidate}`, { value: candidate, source: source === 'systemInfo' ? 'unknown' : source, sourceKey });
          });
          continue;
        }
        walk(child, [...path, key]);
      }
    };
    walk(value, [rootKey]);
  };

  const accept = (seed: EventSeed) => {
    const params = seed.params || {};
    const dnsAnswerCandidates = extractDnsAnswerCandidates(params, seed);
    for (const candidate of dnsAnswerCandidates) {
      if (!candidate.host) continue;
      if (candidate.sourceKind === 'hostResolverCache') {
        const results = params.results && typeof params.results === 'object' && !Array.isArray(params.results)
          ? params.results as Record<string, unknown>
          : {};
        hostResolverCache.set(`${candidate.host}-${seed.eventId}`, {
          host: candidate.host,
          ips: candidate.ips,
          aliases: candidate.aliases || [],
          expires: results.expiration as string | number | undefined,
          sourceId: seed.sourceId,
          eventId: seed.eventId,
          byteStart: seed.byteStart,
          byteEnd: seed.byteEnd,
        });
      }
      if (candidate.sourceKind === 'dnsTaskResult') {
        taskResults.set(`${candidate.host}-${candidate.queryType || ''}-${seed.eventId}`, {
          host: candidate.host,
          queryType: candidate.queryType,
          ips: candidate.ips,
          aliases: candidate.aliases || [],
          error: candidate.error,
          sourceId: seed.sourceId,
          eventId: seed.eventId,
          byteStart: seed.byteStart,
          byteEnd: seed.byteEnd,
        });
        if (candidate.error !== undefined) {
          dnsErrors.set(`${candidate.host}-${candidate.queryType || ''}-${candidate.error}-${seed.eventId}`, {
            host: candidate.host,
            queryType: candidate.queryType,
            error: candidate.error,
            sourceId: seed.sourceId,
            eventId: seed.eventId,
            byteStart: seed.byteStart,
            byteEnd: seed.byteEnd,
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
        const error = typeof value.error === 'number'
          ? value.error
          : typeof value.error_code === 'number'
            ? value.error_code
            : typeof value.net_error === 'number'
              ? value.net_error
              : undefined;
        if (error !== undefined) {
          taskResults.set(`${host}-${value.query_type || ''}-${seed.eventId}`, {
            host,
            queryType: typeof value.query_type === 'string' ? value.query_type : undefined,
            ips: [],
            aliases: [],
            error,
            sourceId: seed.sourceId,
            eventId: seed.eventId,
            byteStart: seed.byteStart,
            byteEnd: seed.byteEnd,
          });
          dnsErrors.set(`${host}-${value.query_type || ''}-${error}-${seed.eventId}`, {
            host,
            queryType: typeof value.query_type === 'string' ? value.query_type : undefined,
            error,
            sourceId: seed.sourceId,
            eventId: seed.eventId,
            byteStart: seed.byteStart,
            byteEnd: seed.byteEnd,
          });
        }
      }
    }

    if (seed.typeName === 'HOST_RESOLVER_MANAGER_IPV6_REACHABILITY_CHECK') {
      ipv6ReachabilityChecks.push({
        available: typeof params.ipv6_available === 'boolean' ? params.ipv6_available : undefined,
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
      });
    }
  };

  const finish = (): DnsStateView => {
    const view: DnsStateView = {
      configServers: Array.from(configServers.values()),
      hostResolverCache: Array.from(hostResolverCache.values()),
      taskResults: Array.from(taskResults.values()),
      dnsErrors: Array.from(dnsErrors.values()),
      dohCandidates: Array.from(dohCandidates.values()),
      ipv6ReachabilityChecks,
      evidenceGaps: [],
    };
    const dnsAnswerCount = view.hostResolverCache.length + view.taskResults.filter(item => item.ips.length > 0 || item.aliases.length > 0).length;
    if (view.configServers.length === 0) {
      view.evidenceGaps.push('未发现 DNS server 配置记录，不代表用户没有配置 DNS。');
    }
    if (view.configServers.length === 0 && dnsAnswerCount > 0) {
      view.evidenceGaps.push('未发现 DNS server 配置记录，但发现 DNS answer / Host Resolver 结果；DNS answer 不能反推 DNS server。');
    }
    if (view.dnsErrors.length > 0) {
      view.evidenceGaps.push('发现 DNS task error，请结合对应 event detail 判断是否为 DNS 根因。');
    }
    if (view.hostResolverCache.length === 0 && view.taskResults.length === 0) {
      view.evidenceGaps.push('未发现 Host Resolver cache 或 DNS task result，DNS answer 可能只能从 summary fallback 查看。');
    }
    if (view.dohCandidates.length > 0 && view.configServers.length === 0) {
      view.evidenceGaps.push('发现 Secure DNS/DoH 线索，但不能据此推断当前 DNS server 配置。');
    }
    return view;
  };

  return { accept, acceptTopLevelConfig, finish };
}
