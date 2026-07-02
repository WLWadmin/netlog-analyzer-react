import type { ProxyStateView } from './netlogDatasetViews';

const PROXY_CONTEXT_KEYS = ['proxy', 'pac', 'proxies'];
const PAC_KEYS = ['pac', 'pacurl', 'pac_url', 'pacscript', 'pacscripturl'];
const BYPASS_KEYS = ['bypass', 'exclusion', 'exclude'];
const SERVER_KEYS = ['server', 'servers', 'proxyserver', 'proxyservers', 'singleproxy'];

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

export function createNetlogProxyStateReducer() {
  const proxyConfigs = new Map<string, ProxyStateView['proxyConfigs'][number]>();
  const pacUrls = new Set<string>();
  const proxyServers = new Set<string>();
  const bypassRules = new Set<string>();

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

  const finish = (): ProxyStateView => {
    const view: ProxyStateView = {
      proxyConfigs: Array.from(proxyConfigs.values()),
      pacUrls: Array.from(pacUrls),
      proxyServers: Array.from(proxyServers),
      bypassRules: Array.from(bypassRules),
      hasProxyEvidence: proxyConfigs.size > 0 || pacUrls.size > 0 || proxyServers.size > 0 || bypassRules.size > 0,
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
    return view;
  };

  return { acceptTopLevelConfig, finish };
}
