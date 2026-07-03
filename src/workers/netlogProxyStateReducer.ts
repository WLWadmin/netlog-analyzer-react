import type { ProxyStateView } from './netlogDatasetViews';

const PROXY_CONTEXT_KEYS = ['proxy', 'pac', 'proxies'];
const PAC_KEYS = ['pac', 'pacurl', 'pac_url', 'pacscript', 'pacscripturl'];
const BYPASS_KEYS = ['bypass', 'exclusion', 'exclude'];
const SERVER_KEYS = ['server', 'servers', 'proxyserver', 'proxyservers', 'singleproxy'];

interface EventSeed {
  eventId: number;
  byteStart: number;
  byteEnd: number;
  time: number;
  typeName: string;
  sourceId: number;
  sourceTypeName: string;
  phase: number;
  params?: Record<string, unknown>;
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function hasProxyContext(path: string[]): boolean {
  return path.map(normalizeKey).some(part => PROXY_CONTEXT_KEYS.some(context => part.includes(context)));
}

function stringifyPrimitive(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function addUnique(target: Set<string>, value?: string) {
  const trimmed = value?.trim();
  if (trimmed) target.add(trimmed);
}

function collectStrings(value: unknown, output: Set<string>) {
  const primitive = stringifyPrimitive(value);
  if (primitive !== undefined) {
    addUnique(output, primitive);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.values(value as Record<string, unknown>).forEach(item => collectStrings(item, output));
}

function classifyConfig(key: string, value: unknown, pacUrls: Set<string>, proxyServers: Set<string>, bypassRules: Set<string>) {
  const normalized = normalizeKey(key);
  const strings = new Set<string>();
  collectStrings(value, strings);
  if (PAC_KEYS.some(part => normalized.includes(part))) {
    strings.forEach(item => addUnique(pacUrls, item));
  }
  if (BYPASS_KEYS.some(part => normalized.includes(part))) {
    strings.forEach(item => addUnique(bypassRules, item));
  }
  if (SERVER_KEYS.some(part => normalized.includes(part)) || normalized.includes('proxy')) {
    strings.forEach(item => {
      if (/^(https?:\/\/|socks|quic|direct|[a-z0-9.-]+:\d+)/i.test(item)) addUnique(proxyServers, item);
    });
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstError(params: Record<string, unknown>): number | string | undefined {
  const value = params.net_error ?? params.error ?? params.error_code ?? params.result;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function proxyEventKind(typeName: string): ProxyStateView['proxyEvents'][number]['kind'] | undefined {
  if (!/PROXY|PAC|TUNNEL/i.test(typeName)) return undefined;
  if (/BAD_PROXY/i.test(typeName)) return 'bad-proxy';
  if (/FALLBACK/i.test(typeName)) return 'fallback';
  if (/PAC/i.test(typeName)) return 'pac';
  if (/TUNNEL/i.test(typeName)) return 'tunnel-failure';
  if (/DECISION|RESOLVE|CONFIG/i.test(typeName)) return 'decision';
  return 'proxy-event';
}

function traceFromSeed(seed: EventSeed) {
  return {
    sourceId: seed.sourceId,
    eventId: seed.eventId,
    byteStart: seed.byteStart,
    byteEnd: seed.byteEnd,
    time: seed.time,
    typeName: seed.typeName,
  };
}

export function createNetlogProxyStateReducer() {
  const proxyConfigs = new Map<string, ProxyStateView['proxyConfigs'][number]>();
  const pacUrls = new Set<string>();
  const proxyServers = new Set<string>();
  const bypassRules = new Set<string>();
  const proxyEvents = new Map<string, ProxyStateView['proxyEvents'][number]>();
  const requestScopedErrors = new Map<string, ProxyStateView['requestScopedErrors'][number]>();

  const acceptTopLevelConfig = (source: 'polledData' | 'systemInfo' | 'unknown', key: string, value: unknown) => {
    const visit = (node: unknown, path: string[]) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((item, index) => visit(item, [...path, String(index)]));
        return;
      }
      for (const [childKey, childValue] of Object.entries(node as Record<string, unknown>)) {
        const nextPath = [...path, childKey];
        if (hasProxyContext(nextPath)) {
          const primitive = stringifyPrimitive(childValue);
          if (primitive !== undefined) {
            const configKey = nextPath.join('.');
            proxyConfigs.set(`${source}-${configKey}-${primitive}`, { key: configKey, value: primitive, source });
          }
          classifyConfig(childKey, childValue, pacUrls, proxyServers, bypassRules);
        }
        visit(childValue, nextPath);
      }
    };
    visit(value, [key]);
  };

  const accept = (seed: EventSeed) => {
    const kind = proxyEventKind(seed.typeName);
    if (!kind) return;
    const params = seed.params || {};
    const proxyServer = firstString(
      params.proxy_server,
      params.proxyServer,
      params.proxy,
      params.effective_proxy,
      params.effectiveProxy,
      params.bad_proxy,
      params.badProxy,
      params.server
    );
    const pacUrl = firstString(params.pac_url, params.pacUrl, params.pac_script_url, params.pacScriptUrl);
    const bypass = firstString(params.bypass, params.bypass_rule, params.bypassRule);
    const url = firstString(params.url, params.request_url, params.requestUrl, params.destination);
    const error = firstError(params);
    addUnique(proxyServers, proxyServer);
    addUnique(pacUrls, pacUrl);
    addUnique(bypassRules, bypass);
    const summary = [
      seed.typeName,
      proxyServer ? `proxy=${proxyServer}` : undefined,
      pacUrl ? `pac=${pacUrl}` : undefined,
      bypass ? `bypass=${bypass}` : undefined,
      error !== undefined ? `error=${error}` : undefined,
    ].filter(Boolean).join('；');
    proxyEvents.set(`${seed.eventId}-${kind}`, {
      ...traceFromSeed(seed),
      kind,
      summary,
      proxyServer,
      url,
      error,
    });
    if (error !== undefined && (seed.sourceTypeName === 'URL_REQUEST' || /URL_REQUEST/i.test(seed.typeName))) {
      requestScopedErrors.set(`${seed.eventId}-${error}`, {
        ...traceFromSeed(seed),
        url,
        proxyServer,
        error,
        reason: '代理事件携带错误码且 source 语义指向 URL_REQUEST；可作为请求级代理错误候选，但仍需结合请求详情确认。',
      });
    }
  };

  const finish = (): ProxyStateView => {
    const view: ProxyStateView = {
      proxyConfigs: Array.from(proxyConfigs.values()),
      proxyEvents: Array.from(proxyEvents.values()),
      requestScopedErrors: Array.from(requestScopedErrors.values()),
      pacUrls: Array.from(pacUrls),
      proxyServers: Array.from(proxyServers),
      bypassRules: Array.from(bypassRules),
      hasProxyEvidence: proxyConfigs.size > 0 || proxyEvents.size > 0 || pacUrls.size > 0 || proxyServers.size > 0 || bypassRules.size > 0,
      evidenceGaps: [],
    };
    if (!view.hasProxyEvidence) {
      view.evidenceGaps.push('未发现代理配置快照；不代表当前环境没有代理，只表示 Dataset 未捕获相关配置。');
    }
    if (view.hasProxyEvidence) {
      view.evidenceGaps.push('代理配置是环境事实，不能单独作为请求失败或慢请求根因。');
    }
    if (view.pacUrls.length > 0) {
      view.evidenceGaps.push('发现 PAC 线索，但未解析 PAC 规则命中结果；仍需结合代理事件或直连对比。');
    }
    if (view.proxyEvents.length > 0 && view.requestScopedErrors.length === 0) {
      view.evidenceGaps.push('发现代理事件，但未发现可安全关联到 URL_REQUEST 的代理错误；不能推断具体请求失败原因。');
    }
    return view;
  };

  return { acceptTopLevelConfig, accept, finish };
}
