/**
 * NetLog 诊断结果 → DiagnosticCard 适配层
 * 将 NetLog 分析结果转换为统一 DiagnosticCard 结构
 */

import type { AnalysisResult, FailedDomain, ProxyInfo, ParsedEvent, URLRequest } from '../../parsers/netlog/parser';
import type { Suggestion } from '../../parsers/netlog/diagnosis';
import { classifyNetError } from '../../parsers/netlog/errorClassifier';
import { netlogLifecycleToCards } from './fromNetlogLifecycle';
import { getCachedEventsBySourceId, getCachedSourceGraph } from '../../parsers/netlog/sourceGraphCache';
import type {
  DiagnosticCard,
  DiagnosticCategory,
  DiagnosticEvidence,
  DiagnosticAction,
  DiagnosticConfidenceFactor,
  DiagnosticScope,
  DiagnosticRole,
  CollectionQuality,
  DiagnosisSummary,
} from './types';

type ContextEventKind = '网络切换' | '代理决策' | '缓存事件' | 'TLS 事件' | 'QUIC 事件' | 'HTTP/2 事件';

interface ContextEventItem {
  kind: ContextEventKind;
  event: ParsedEvent;
  time: number;
}

interface ContextEventWithDelta extends ContextEventItem {
  delta: number;
}

interface ContextEventIndex {
  items: ContextEventItem[];
  times: number[];
}

interface RequestLookup {
  byId: Map<number, URLRequest>;
  idsByUrl: Map<string, number[]>;
}

const contextEventIndexCache = new WeakMap<AnalysisResult, ContextEventIndex>();
const requestLookupCache = new WeakMap<AnalysisResult, RequestLookup>();
const eventBySourceIdCache = new WeakMap<AnalysisResult, Map<number, ParsedEvent>>();
const DIAGNOSIS_TIMING_DEBUG_KEY = 'diagnosis_debug_timing';

interface TimingRow {
  stage: string;
  durationMs: number;
  meta?: Record<string, string | number | boolean | undefined>;
}

function isDiagnosisTimingDebugEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(DIAGNOSIS_TIMING_DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

function recordTiming(
  enabled: boolean,
  rows: TimingRow[],
  stage: string,
  start: number,
  end: number = performance.now(),
  meta?: TimingRow['meta']
) {
  if (!enabled) return;
  rows.push({ stage, durationMs: Math.round((end - start) * 10) / 10, meta });
}

function emitTimingJson(
  enabled: boolean,
  label: string,
  rows: TimingRow[],
  extra?: Record<string, string | number | boolean | undefined>
) {
  if (!enabled) return;
  console.info('[diagnosis timing json]', JSON.stringify({ label, rows, extra }));
}

function generateId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Date.now().toString(36)}`;
}

function mapErrorCategoryToDiagnostic(errorCat: string): DiagnosticCategory {
  const map: Record<string, DiagnosticCategory> = {
    'DNS': 'dns',
    '证书': 'tls',
    '代理': 'proxy',
    '网络变更': 'network-change',
    '阻止': 'security',
    '协议': 'protocol',
    '连接': 'connect',
    '应用层': 'server',
    '缓存': 'cache',
    '其他': 'unknown',
  };
  return map[errorCat] || 'unknown';
}

function buildScope(
  affectedCount: number,
  domainCount?: number,
  type?: DiagnosticScope['type']
): DiagnosticScope {
  if (affectedCount === 1) {
    return { type: type || 'single-request', summary: '影响 1 个请求', affectedRequestCount: 1 };
  }
  if (domainCount && domainCount > 1) {
    return {
      type: type || 'multi-domain',
      summary: `影响 ${affectedCount} 个请求，涉及 ${domainCount} 个域名`,
      affectedRequestCount: affectedCount,
      affectedDomainCount: domainCount,
    };
  }
  return {
    type: type || 'global',
    summary: `影响 ${affectedCount} 个请求`,
    affectedRequestCount: affectedCount,
  };
}

function formatNetlogTime(time: number): string {
  if (!Number.isFinite(time)) return '未知时间';
  if (time > 1_000_000_000_000) return new Date(time).toLocaleString();
  return `${time.toFixed(0)}ms`;
}

function compactValue(value: unknown, maxLength = 120): string {
  if (value === undefined || value === null || value === '') return '未记录';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

function addUniqueEvidence(target: DiagnosticEvidence[], evidence: DiagnosticEvidence) {
  if (!target.some(ev => ev.label === evidence.label && ev.value === evidence.value)) {
    target.push(evidence);
  }
}

function addConfidenceDetails(
  card: DiagnosticCard,
  positives: DiagnosticConfidenceFactor[],
  negatives: DiagnosticConfidenceFactor[] = [],
  neutrals: DiagnosticConfidenceFactor[] = []
): DiagnosticCard {
  const score = positives.length * 2 + neutrals.length - negatives.length * 2;
  const confidence: DiagnosticCard['confidence'] = score >= 4 ? 'high' : score >= 1 ? 'medium' : 'low';
  return {
    ...card,
    confidence,
    confidenceFactors: [...positives, ...negatives, ...neutrals].slice(0, 6),
  };
}

function hostFromUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function extractCertDetails(params: Record<string, any>): string[] {
  const fields: [string, unknown][] = [
    ['subject', params.subject || params.cert_subject || params.server_cert_subject],
    ['common_name', params.common_name || params.cert_common_name || params.server_cert_common_name],
    ['san', params.san || params.subject_alt_names || params.dns_names],
    ['issuer', params.issuer || params.cert_issuer || params.issuer_common_name],
    ['valid_from', params.valid_from || params.not_before],
    ['valid_to', params.valid_to || params.not_after || params.valid_expiry],
    ['cert_status', params.cert_status || params.cert_status_flags],
    ['verify_result', params.verify_result || params.cert_verify_result],
  ];
  return fields
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${compactValue(value, 80)}`)
    .slice(0, 6);
}

function getContextEventIndex(result: AnalysisResult): ContextEventIndex {
  const cached = contextEventIndexCache.get(result);
  if (cached) return cached;

  const items: ContextEventItem[] = [
    ...result.networkChanges.map(event => ({ kind: '网络切换' as const, event, time: event.time })),
    ...result.proxyEvents.map(event => ({ kind: '代理决策' as const, event, time: event.time })),
    ...result.cacheEvents.map(event => ({ kind: '缓存事件' as const, event, time: event.time })),
    ...result.sslEvents.map(event => ({ kind: 'TLS 事件' as const, event, time: event.time })),
    ...result.quicEvents.map(event => ({ kind: 'QUIC 事件' as const, event, time: event.time })),
    ...result.http2Events.map(event => ({ kind: 'HTTP/2 事件' as const, event, time: event.time })),
  ]
    .filter(item => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time);

  const index = {
    items,
    times: items.map(item => item.time),
  };
  contextEventIndexCache.set(result, index);
  return index;
}

function lowerBound(values: number[], target: number): number {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (values[mid] < target) left = mid + 1;
    else right = mid;
  }
  return left;
}

function upperBound(values: number[], target: number): number {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (values[mid] <= target) left = mid + 1;
    else right = mid;
  }
  return left;
}

function getRequestLookup(result: AnalysisResult): RequestLookup {
  const cached = requestLookupCache.get(result);
  if (cached) return cached;

  const byId = new Map<number, URLRequest>();
  const idsByUrl = new Map<string, number[]>();

  result.urlRequests.forEach(request => {
    byId.set(request.id, request);
    const ids = idsByUrl.get(request.url);
    if (ids) ids.push(request.id);
    else idsByUrl.set(request.url, [request.id]);
  });

  const lookup = { byId, idsByUrl };
  requestLookupCache.set(result, lookup);
  return lookup;
}

function getEventBySourceId(result: AnalysisResult): Map<number, ParsedEvent> {
  const cached = eventBySourceIdCache.get(result);
  if (cached) return cached;

  const map = new Map<number, ParsedEvent>();
  getContextEventIndex(result).items.forEach(item => {
    if (!map.has(item.event.source.id)) {
      map.set(item.event.source.id, item.event);
    }
  });

  eventBySourceIdCache.set(result, map);
  return map;
}

function findEventsAround(result: AnalysisResult, time: number, windowMs = 3000): ContextEventWithDelta[] {
  const index = getContextEventIndex(result);
  if (index.items.length === 0) return [];

  const start = lowerBound(index.times, time - windowMs);
  const end = upperBound(index.times, time + windowMs);

  return index.items
    .slice(start, end)
    .map(item => ({
      ...item,
      delta: Math.abs(item.time - time),
    }))
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 8);
}

function enrichCardWithP1Evidence(card: DiagnosticCard, result: AnalysisResult): DiagnosticCard {
  const evidence = [...card.evidence];
  const positives: DiagnosticConfidenceFactor[] = [];
  const negatives: DiagnosticConfidenceFactor[] = [];
  const neutrals: DiagnosticConfidenceFactor[] = [];
  const requestLookup = getRequestLookup(result);
  const eventBySourceId = getEventBySourceId(result);

  if (evidence.length > 0) {
    positives.push({ label: '结构化证据', impact: 'positive', detail: `卡片包含 ${evidence.length} 条 NetLog/推导证据` });
  }
  if (card.relatedRequestIds && card.relatedRequestIds.length > 0) {
    positives.push({ label: '请求关联', impact: 'positive', detail: `已定位 ${card.relatedRequestIds.length} 个相关 URL_REQUEST` });
  }

  if (card.category === 'dns' && result.dnsEvents.length > 0) {
    positives.push({ label: 'DNS 事件佐证', impact: 'positive', detail: `采集到 ${result.dnsEvents.length} 条 DNS/HostResolver 事件` });
  }
  if (card.category === 'tls' && result.sslEvents.length > 0) {
    positives.push({ label: 'TLS 事件佐证', impact: 'positive', detail: `采集到 ${result.sslEvents.length} 条 SSL/TLS 事件` });
  }
  if (card.category === 'proxy' && (result.proxyEvents.length > 0 || result.proxyInfo.hasProxy)) {
    positives.push({ label: '代理链路佐证', impact: 'positive', detail: `代理事件 ${result.proxyEvents.length} 条，代理配置=${result.proxyInfo.hasProxy ? '已识别' : '未识别'}` });
  }

  if (card.category === 'tls' && result.sslEvents.length === 0) {
    negatives.push({ label: 'TLS 采集不足', impact: 'negative', detail: 'HTTPS 请求存在但缺少 SSL/TLS 事件，证书判断可能不完整' });
  }
  if (card.category === 'dns' && result.dnsEvents.length === 0) {
    negatives.push({ label: 'DNS 采集不足', impact: 'negative', detail: '缺少 DNS/HostResolver 事件，无法完整还原解析链路' });
  }
  if (card.category === 'proxy' && result.proxyEvents.length === 0) {
    negatives.push({ label: '代理事件不足', impact: 'negative', detail: '缺少代理解析过程事件，只能依据配置或请求现象推断' });
  }

  const relatedTimes = new Set<number>();
  (card.relatedRequestIds || []).forEach(id => {
    const req = requestLookup.byId.get(id);
    if (req) relatedTimes.add(req.startTime);
  });
  (card.relatedEventIds || []).forEach(id => {
    const numeric = Number(id);
    const evt = eventBySourceId.get(numeric);
    if (evt) relatedTimes.add(evt.time);
  });

  const correlations = Array.from(relatedTimes)
    .flatMap(time => findEventsAround(result, time, 3000).map(item => ({ ...item, anchorTime: time })))
    .slice(0, 5);
  if (correlations.length > 0) {
    positives.push({ label: '时间相关性', impact: 'positive', detail: `相关请求 ±3s 内发现 ${correlations.length} 条网络/代理/TLS/协议事件` });
    addUniqueEvidence(evidence, {
      label: '时间窗口相关事件',
      value: correlations.map(c => `${formatNetlogTime(c.anchorTime)} 附近 ${c.kind}:${c.event.typeName} (Δ${c.delta.toFixed(0)}ms)`).join('；'),
      source: 'derived',
      detail: '用于区分单点请求失败与网络状态、代理、TLS、协议层事件的同步波动',
    });
  }

  if (!card.relatedRequestIds?.length && !card.relatedEventIds?.length && evidence.length <= 1) {
    negatives.push({ label: '定位粒度不足', impact: 'negative', detail: '尚未关联到具体请求或事件，建议打开原始证据继续核验' });
  }

  const next = addConfidenceDetails({ ...card, evidence }, result.totalEvents < 50 ? positives : positives, result.totalEvents < 50
    ? [...negatives, { label: '采集样本偏少', impact: 'negative', detail: `仅 ${result.totalEvents} 条事件，根因置信度会下降` }]
    : negatives, neutrals);

  return next;
}

// ========== 从 Suggestion 构建 Card ==========

function suggestionToCard(suggestion: Suggestion, index: number, result: AnalysisResult): DiagnosticCard {
  // ========== 结构化字段优先策略 ==========
  // 1. 优先使用 Suggestion 结构化字段（errorCode / category / severity）
  // 2. 次选从 title 正则提取错误码，再用 errorClassifier 映射
  // 3. 最后兜底：从 title 关键词推断

  const errorCode: number | null = suggestion.errorCode ?? extractErrorCodeFromTitle(suggestion.title);

  // category 优先级：结构化字段 > errorClassifier > title 关键词兜底
  let category: DiagnosticCategory;
  if (suggestion.category) {
    category = mapErrorCategoryToDiagnostic(suggestion.category);
  } else if (errorCode) {
    category = mapErrorCategoryToDiagnostic(classifyNetError(errorCode).catName);
  } else {
    category = inferCategoryFromTitle(suggestion.title);
  }

  // severity 优先级：结构化字段 > icon/title 启发式
  let severity: DiagnosticCard['severity'];
  if (suggestion.severity) {
    severity = suggestion.severity;
  } else if (suggestion.icon === '🚨' || suggestion.title.includes('劫持') || suggestion.title.includes('VPN')) {
    severity = 'critical';
  } else if (suggestion.icon === '❌' || suggestion.title.includes('失败')) {
    severity = 'warning';
  } else if (suggestion.icon === '⚠️') {
    severity = 'warning';
  } else {
    severity = 'info';
  }

  const evidence: DiagnosticEvidence[] = [];

  // 从 detail 中提取证据
  if (suggestion.detail) {
    const lines = suggestion.detail.split('\n').filter(l => l.trim());
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
        evidence.push({
          label: `证据 ${i + 1}`,
          value: trimmed.replace(/^[-•]\s*/, ''),
          source: 'netlog',
        });
      } else if (trimmed.includes('影响范围')) {
        evidence.push({
          label: '影响范围',
          value: trimmed.replace(/.*影响范围[:：]\s*/, ''),
          source: 'derived',
        });
      }
    });
  }

  // 关联请求
  const relatedRequestIds = findRelatedRequests(suggestion, result);
  if (relatedRequestIds.length > 0) {
    evidence.push({
      label: '相关请求',
      value: `${relatedRequestIds.length} 个请求`,
      source: 'netlog',
      requestIds: relatedRequestIds,
    });
  }

  // 构建 actions
  const actions = buildActionsFromSuggestion(suggestion, category);

  // 确定置信度
  let confidence: DiagnosticCard['confidence'] = 'medium';
  if (errorCode && result.connectionFailures.some(f => f.error === errorCode)) {
    confidence = 'high';
  }

  // 影响范围
  const affectedCount = relatedRequestIds.length || result.connectionFailures.length || 1;
  const domainCount = new Set(relatedRequestIds.map(id => {
    const req = result.urlRequests.find(r => r.id === id);
    if (!req || !req.url) return '';
    try { return new URL(req.url).hostname; } catch { return ''; }
  }).filter(Boolean)).size;

  const limitations: string[] = [];
  if (!errorCode) {
    limitations.push('NetLog 未包含明确的错误码，当前判断为启发式推测');
  }
  if (result.dnsServers.length === 0 && category === 'dns') {
    limitations.push('当前 NetLog 未包含 DNS 配置数据，无法判断 DNS 服务器地址');
  }

  return {
    id: generateId('netlog', index),
    source: 'netlog',
    category,
    severity,
    confidence,
    title: suggestion.title,
    conclusion: suggestion.conclusion,
    scope: buildScope(affectedCount, domainCount || undefined, domainCount > 1 ? 'multi-domain' : 'global'),
    evidence,
    actions,
    limitations: limitations.length > 0 ? limitations : undefined,
    relatedRequestIds: relatedRequestIds.length > 0 ? relatedRequestIds : undefined,
  };
}

/**
 * 集中封装的错误码提取逻辑
 * 优先级：结构化字段 > title 正则提取
 * 注意：下游应优先使用 Suggestion.errorCode 结构化字段
 */
function extractErrorCodeFromTitle(title: string): number | null {
  const match = title.match(/\((-?\d+)\)/);
  return match ? Number(match[1]) : null;
}

function inferCategoryFromTitle(title: string): DiagnosticCategory {
  if (title.includes('DNS') || title.includes('域名解析')) return 'dns';
  if (title.includes('证书') || title.includes('SSL') || title.includes('TLS')) return 'tls';
  if (title.includes('代理') || title.includes('VPN') || title.includes('PAC')) return 'proxy';
  if (title.includes('连接') || title.includes('超时') || title.includes('RESET')) return 'connect';
  if (title.includes('HTTP/2') || title.includes('QUIC') || title.includes('协议')) return 'protocol';
  if (title.includes('网络变更')) return 'network-change';
  if (title.includes('阻止') || title.includes('拦截')) return 'security';
  if (title.includes('慢请求')) return 'performance';
  if (title.includes('缓存')) return 'cache';
  return 'unknown';
}

function findRelatedRequests(suggestion: Suggestion, result: AnalysisResult): number[] {
  const ids: number[] = [];
  // 优先使用结构化 errorCode，其次从 title 提取
  const errorCode = suggestion.errorCode ?? extractErrorCodeFromTitle(suggestion.title);

  if (errorCode) {
    result.connectionFailures
      .filter(f => f.error === errorCode)
      .forEach(f => {
        const req = result.urlRequests.find(r => r.url === f.url);
        if (req && !ids.includes(req.id)) ids.push(req.id);
      });
  }

  // 根据标题关键词匹配
  if (suggestion.title.includes('DNS')) {
    result.urlRequests
      .filter(r => r.error && classifyNetError(r.error).catName === 'DNS')
      .forEach(r => { if (!ids.includes(r.id)) ids.push(r.id); });
  }
  if (suggestion.title.includes('代理') || suggestion.title.includes('VPN')) {
    result.urlRequests.forEach(r => { if (!ids.includes(r.id)) ids.push(r.id); });
  }

  return ids.slice(0, 10);
}

function buildActionsFromSuggestion(suggestion: Suggestion, category: DiagnosticCategory): DiagnosticAction[] {
  const actions: DiagnosticAction[] = [];

  if (suggestion.actions && suggestion.actions.length > 0) {
    suggestion.actions.forEach(actionText => {
      const role = inferRoleFromAction(actionText);
      actions.push({
        role,
        title: actionText.slice(0, 50),
        detail: actionText,
      });
    });
  }

  // 根据类别添加标准动作
  switch (category) {
    case 'dns':
      if (!actions.some(a => a.title.includes('nslookup'))) {
        actions.push({
          role: 'user',
          title: 'DNS 解析测试',
          detail: '使用 nslookup 测试域名解析',
          command: 'nslookup example.com',
          platform: 'all',
          expectedResult: '应返回正确的 IP 地址',
        });
      }
      break;
    case 'tls':
      if (!actions.some(a => a.title.includes('openssl'))) {
        actions.push({
          role: 'user',
          title: 'TLS 握手测试',
          detail: '使用 openssl 检查 TLS 握手',
          command: 'openssl s_client -connect example.com:443 -servername example.com',
          platform: 'all',
          expectedResult: '应成功建立 TLS 连接',
        });
      }
      break;
    case 'proxy':
      if (!actions.some(a => a.title.includes('curl'))) {
        actions.push({
          role: 'user',
          title: '绕过代理测试',
          detail: '在公司安全策略允许的情况下，使用 curl 绕过代理测试',
          command: 'curl -v --noproxy \'*\' https://example.com',
          platform: 'all',
          expectedResult: '应能正常访问目标地址',
        });
      }
      break;
    case 'connect':
      if (!actions.some(a => a.title.includes('ping'))) {
        actions.push({
          role: 'user',
          title: '网络连通性测试',
          detail: '使用 ping 测试网络连通性',
          command: 'ping example.com -n 20',
          platform: 'all',
          expectedResult: '丢包率应 < 5%，延迟应 < 200ms',
        });
      }
      break;
  }

  return actions;
}

/**
 * 从 action 文本推断角色
 * 优先级规则：按关键词匹配，第一个匹配到的角色胜出
 * 注意：这是一个启发式推断，上游 Suggestion 应尽量提供结构化 role
 */
function inferRoleFromAction(actionText: string): DiagnosticRole {
  const text = actionText.toLowerCase();
  // 优先级 1：IT 相关
  if (text.includes('it') || text.includes('防火墙') || text.includes('代理') || text.includes('dns') || text.includes('vpn')) return 'it';
  // 优先级 2：后端相关
  if (text.includes('后端') || text.includes('服务端') || text.includes('数据库') || text.includes('服务器') || text.includes('证书')) return 'backend';
  // 优先级 3：前端相关
  if (text.includes('前端') || text.includes('缓存策略') || text.includes('资源加载') || text.includes('页面')) return 'frontend';
  // 默认：用户
  return 'user';
}

// ========== 主转换函数 ==========

export function netlogToCards(
  result: AnalysisResult,
  suggestions: Suggestion[],
  events?: ParsedEvent[]
): DiagnosticCard[] {
  const debugTiming = isDiagnosisTimingDebugEnabled();
  const timingRows: TimingRow[] = [];
  const totalStart = performance.now();
  const suggestionStart = performance.now();
  const cards = suggestions.map((s, i) => suggestionToCard(s, i, result));
  recordTiming(debugTiming, timingRows, 'suggestionToCard map', suggestionStart, undefined, { suggestions: suggestions.length, cards: cards.length });

  const basicEnhancementStart = performance.now();
  const proxyHijackStart = performance.now();
  // 添加代理/VPN 环境卡片（如果检测到但未生成）
  if (result.proxyInfo.hasProxy && !cards.some(c => c.category === 'proxy')) {
    const proxyCard = buildProxyCard(result.proxyInfo, result);
    cards.push(proxyCard);
  }

  // 添加 DNS 劫持卡片（如果检测到但未生成）
  const hijackedDomains = result.failedDomains.filter(d =>
    d.ips.some(ip => ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1')
  );
  if (hijackedDomains.length > 0 && !cards.some(c => c.title.includes('劫持'))) {
    const dnsHijackCard = buildDnsHijackCard(hijackedDomains);
    cards.push(dnsHijackCard);
  }
  recordTiming(debugTiming, timingRows, 'proxy/dnsHijack cards', proxyHijackStart, undefined, { hijackedDomains: hijackedDomains.length, cards: cards.length });

  const dnsDetailStart = performance.now();
  // ========== 批次 C 增强：DNS 解析诊断卡片 ==========
  if (result.failedDomains.length > 0 && !cards.some(c => c.category === 'dns' && c.severity === 'critical')) {
    const dnsErrors = result.failedDomains.filter(d => d.errorCodes.some(ec => ec === -105 || ec === -137 || ec === -139));
    if (dnsErrors.length > 0) {
      cards.push({
        id: generateId('netlog-dns-detail', 0),
        source: 'netlog',
        category: 'dns',
        severity: 'critical',
        confidence: 'high',
        title: `DNS 解析失败 (${dnsErrors.length} 个域名)`,
        conclusion: `${dnsErrors.length} 个域名出现 DNS 解析失败（ERR_NAME_NOT_RESOLVED / ERR_NAME_RESOLUTION_FAILED），所有相关请求均无法完成`,
        scope: buildScope(
          dnsErrors.reduce((s, d) => s + d.count, 0),
          dnsErrors.length,
          dnsErrors.length > 1 ? 'multi-domain' : 'single-domain'
        ),
        evidence: dnsErrors.slice(0, 5).map((d, i) => ({
          label: `失败域名 ${i + 1}`,
          value: `${d.domain} — 错误码: ${d.errorCodes.join(', ')}，失败 ${d.count} 次`,
          source: 'netlog',
        })),
        actions: [
          {
            role: 'user',
            title: '更换 DNS 测试',
            detail: '国内用户修改 DNS 为 223.5.5.5 或 119.29.29.29；海外用户修改为 8.8.8.8 或 1.1.1.1',
            command: 'nslookup example.com 223.5.5.5',
            platform: 'all',
            expectedResult: '应返回正确的 IP 地址',
          },
          {
            role: 'it',
            title: '检查企业 DNS 配置',
            detail: '确认企业 DNS 服务器是否正常工作，检查 DHCP 分配的 DNS 地址',
          },
        ],
        limitations: result.dnsServers.length === 0
          ? ['当前 NetLog 未包含 DNS 配置数据，无法判断使用的 DNS 服务器地址']
          : undefined,
      });
    }
  }
  recordTiming(debugTiming, timingRows, 'dns detail cards', dnsDetailStart, undefined, { failedDomains: result.failedDomains.length, cards: cards.length });

  const tlsDetailStart = performance.now();
  // ========== 批次 C 增强：TLS/证书诊断卡片 ==========
  if (result.certIssues.length > 0 && !cards.some(c => c.category === 'tls')) {
    const certHosts = [...new Set(result.certIssues.map(si => si.host))].slice(0, 10);
    const timeoutCerts = result.certIssues.filter(si => si.category === 'timeout');
    const certCerts = result.certIssues.filter(si => si.category === 'cert');
    const protocolCerts = result.certIssues.filter(si => si.category === 'protocol');

    let conclusion = `${result.certIssues.length} 个 SSL/TLS 问题涉及 ${certHosts.length} 个主机`;
    if (timeoutCerts.length > 0) {
      conclusion += `，其中 ${timeoutCerts.length} 个为握手超时（可能是网络问题而非证书问题）`;
    }
    if (certCerts.length > 0) {
      conclusion += `，${certCerts.length} 个为证书验证失败`;
    }

    cards.push({
      id: generateId('netlog-tls-detail', 0),
      source: 'netlog',
      category: 'tls',
      severity: certCerts.length > 0 ? 'critical' : 'warning',
      confidence: 'high',
      title: `TLS/证书问题 (${result.certIssues.length} 个)`,
      conclusion,
      scope: buildScope(result.certIssues.length, certHosts.length, certHosts.length > 1 ? 'multi-domain' : 'single-domain'),
      evidence: [
        {
          label: '涉及主机',
          value: certHosts.join('、'),
          source: 'netlog',
        },
        {
          label: '超时类',
          value: `${timeoutCerts.length} 个`,
          source: 'netlog',
        },
        {
          label: '证书类',
          value: `${certCerts.length} 个`,
          source: 'netlog',
        },
        {
          label: '协议类',
          value: `${protocolCerts.length} 个`,
          source: 'netlog',
        },
      ],
      actions: [
        {
          role: 'user',
          title: 'TLS 握手测试',
          detail: '使用 openssl 检查目标主机的 TLS 握手是否正常',
          command: 'openssl s_client -connect example.com:443 -servername example.com',
          platform: 'all',
          expectedResult: '应成功建立 TLS 连接并显示证书信息',
        },
        ...(certCerts.length > 0 ? [{
          role: 'backend' as const,
          title: '检查证书有效性',
          detail: '确认服务器证书是否过期、域名是否匹配、证书链是否完整',
        }] : []),
        ...(timeoutCerts.length > 0 ? [{
          role: 'user' as const,
          title: '区分超时与证书问题',
          detail: 'TLS 超时（如 -118）通常是网络问题导致握手未完成，而非证书本身有问题。建议先排查网络连通性',
        }] : []),
      ],
      limitations: [
        'NetLog 的 SSL 事件可能不包含完整的证书链信息',
        '-118 (ERR_SSL_PROTOCOL_ERROR) 在 NetLog 中常被误归为证书问题，实际可能是握手超时',
      ],
    });
  }
  recordTiming(debugTiming, timingRows, 'tls detail cards', tlsDetailStart, undefined, { certIssues: result.certIssues.length, cards: cards.length });

  const stalledStart = performance.now();
  // ========== 批次 C 增强：连接池/排队诊断卡片 ==========
  if (result.stalledRequests.length > 0 && !cards.some(c => c.category === 'browser-queue')) {
    const stalledDomains = [...new Set(result.stalledRequests.map(r => {
      try { return new URL(r.url).hostname; } catch { return ''; }
    }).filter(Boolean))];
    cards.push({
      id: generateId('netlog-stalled', 0),
      source: 'netlog',
      category: 'browser-queue',
      severity: 'warning',
      confidence: 'high',
      title: `请求排队/停滞 (${result.stalledRequests.length} 个)`,
      conclusion: `${result.stalledRequests.length} 个请求出现停滞（stalled），浏览器可能因连接池耗尽或并发限制导致请求排队`,
      scope: buildScope(result.stalledRequests.length, stalledDomains.length, stalledDomains.length > 1 ? 'multi-domain' : 'global'),
      evidence: [
        {
          label: '停滞请求数',
          value: `${result.stalledRequests.length} 个`,
          source: 'netlog',
        },
        {
          label: '涉及域名',
          value: stalledDomains.slice(0, 5).join('、') + (stalledDomains.length > 5 ? ` 等 ${stalledDomains.length} 个` : ''),
          source: 'derived',
        },
      ],
      actions: [
        {
          role: 'frontend',
          title: '优化请求调度',
          detail: '减少页面加载时的并发请求数量，使用资源预加载、懒加载、优先级调度',
        },
        {
          role: 'frontend',
          title: '启用 HTTP/2',
          detail: 'HTTP/2 支持多路复用，可消除浏览器对同一域名的连接数限制（Chrome 限制 6 个）',
        },
      ],
    });
  }
  recordTiming(debugTiming, timingRows, 'stalled cards', stalledStart, undefined, { stalledRequests: result.stalledRequests.length, cards: cards.length });

  const protocolStart = performance.now();
  // ========== 批次 C 增强：HTTP/2 与 QUIC 诊断卡片 ==========
  const protocolCounts = result.protocols;
  const h2Count = (protocolCounts['HTTP/2'] || 0) + (protocolCounts['h2'] || 0);
  const quicCount = (protocolCounts['QUIC'] || 0) + (protocolCounts['h3'] || 0);
  const h11Count = (protocolCounts['HTTP/1.1'] || 0) + (protocolCounts['http/1.1'] || 0);
  const totalWithProtocol = h2Count + quicCount + h11Count;

  if (totalWithProtocol > 10 && h11Count > totalWithProtocol * 0.5) {
    cards.push({
      id: generateId('netlog-protocol', 0),
      source: 'netlog',
      category: 'protocol',
      severity: 'info',
      confidence: 'high',
      title: 'HTTP/2 协议覆盖率偏低',
      conclusion: `${h11Count} 个请求 (${((h11Count / totalWithProtocol) * 100).toFixed(0)}%) 仍使用 HTTP/1.1，建议启用 HTTP/2 以利用多路复用减少连接开销`,
      scope: buildScope(h11Count, undefined, 'global'),
      evidence: [
        { label: 'HTTP/1.1', value: `${h11Count} 个`, source: 'netlog' },
        { label: 'HTTP/2', value: `${h2Count} 个`, source: 'netlog' },
        { label: 'QUIC/HTTP3', value: `${quicCount} 个`, source: 'netlog' },
      ],
      actions: [
        {
          role: 'backend',
          title: '启用 HTTP/2',
          detail: '在服务端配置 HTTP/2 支持（Nginx: listen 443 http2; Node.js: 使用 http2 模块）',
        },
        {
          role: 'backend',
          title: '考虑启用 QUIC',
          detail: 'QUIC (HTTP/3) 可进一步减少连接建立延迟，尤其对高延迟网络效果显著',
        },
      ],
    });
  }

  if (quicCount > 0 && !cards.some(c => c.category === 'protocol')) {
    cards.push({
      id: generateId('netlog-quic', 0),
      source: 'netlog',
      category: 'protocol',
      severity: 'info',
      confidence: 'high',
      title: `QUIC/HTTP3 协议使用 (${quicCount} 个请求)`,
      conclusion: `${quicCount} 个请求使用 QUIC 协议，可享受 0-RTT 连接建立和多路复用优势`,
      scope: buildScope(quicCount, undefined, 'global'),
      evidence: [
        { label: 'QUIC 请求', value: `${quicCount} 个`, source: 'netlog' },
        { label: 'HTTP/2 请求', value: `${h2Count} 个`, source: 'netlog' },
        { label: 'HTTP/1.1 请求', value: `${h11Count} 个`, source: 'netlog' },
      ],
      actions: [],
    });
  }
  recordTiming(debugTiming, timingRows, 'protocol cards', protocolStart, undefined, { h2Count, quicCount, h11Count, cards: cards.length });

  const networkChangeStart = performance.now();
  // ========== 批次 C 增强：网络切换诊断卡片 ==========
  if (result.networkChanges.length > 0 && !cards.some(c => c.category === 'network-change')) {
    const changeTimes = result.networkChanges.map(e => ({
      time: new Date(e.time).toLocaleString(),
      type: e.params?.change_type || e.params?.type || e.phaseName || '未知',
    }));
    cards.push({
      id: generateId('netlog-netchange', 0),
      source: 'netlog',
      category: 'network-change',
      severity: result.networkChanges.length > 3 ? 'warning' : 'info',
      confidence: 'high',
      title: `检测到网络切换 (${result.networkChanges.length} 次)`,
      conclusion: result.networkChanges.length > 3
        ? `采集期间发生 ${result.networkChanges.length} 次网络切换，频繁切换可能导致请求失败或超时`
        : `采集期间发生 ${result.networkChanges.length} 次网络切换，部分请求失败可能与网络切换有关`,
      scope: buildScope(result.networkChanges.length, undefined, 'global'),
      evidence: changeTimes.slice(0, 5).map((c, i) => ({
        label: `切换 ${i + 1}`,
        value: `${c.time} — ${c.type}`,
        source: 'netlog',
      })),
      actions: [
        {
          role: 'user',
          title: '稳定网络环境后重试',
          detail: '网络切换期间产生的错误可能是暂时性的，建议在稳定网络环境下重新采集',
        },
        {
          role: 'it',
          title: '排查网络切换原因',
          detail: '检查 WiFi/有线网络切换策略、VPN 连接稳定性、网络设备配置',
        },
      ],
    });
  }
  recordTiming(debugTiming, timingRows, 'network change cards', networkChangeStart, undefined, { networkChanges: result.networkChanges.length, cards: cards.length });
  recordTiming(debugTiming, timingRows, 'basic enhancement cards total', basicEnhancementStart, undefined, { cards: cards.length });

  const temporalStart = performance.now();
  // ========== P1 增强：时间相关性 + 决策链路 ==========
  // 历史主瓶颈回归指标：用于观察时间相关性构建是否再次膨胀。
  cards.push(...buildTemporalCorrelationCards(result));
  recordTiming(debugTiming, timingRows, 'buildTemporalCorrelationCards', temporalStart, undefined, { connectionFailures: result.connectionFailures.length, cards: cards.length });

  const cacheDecisionStart = performance.now();
  const cacheDecisionCard = buildCacheDecisionCard(result);
  if (cacheDecisionCard && !cards.some(c => c.id.startsWith('netlog-cache-decision'))) {
    cards.push(cacheDecisionCard);
  }
  recordTiming(debugTiming, timingRows, 'buildCacheDecisionCard', cacheDecisionStart, undefined, { cards: cards.length });

  const proxyDecisionStart = performance.now();
  const proxyDecisionCard = buildProxyDecisionCard(result);
  if (proxyDecisionCard && !cards.some(c => c.id.startsWith('netlog-proxy-decision'))) {
    cards.push(proxyDecisionCard);
  }
  recordTiming(debugTiming, timingRows, 'buildProxyDecisionCard', proxyDecisionStart, undefined, { cards: cards.length });

  const protocolDecisionStart = performance.now();
  const protocolDecisionCard = buildProtocolDecisionCard(result);
  if (protocolDecisionCard && !cards.some(c => c.id.startsWith('netlog-protocol-decision'))) {
    cards.push(protocolDecisionCard);
  }
  recordTiming(debugTiming, timingRows, 'buildProtocolDecisionCard', protocolDecisionStart, undefined, { cards: cards.length });

  const tlsCertificateStart = performance.now();
  const tlsCertificateCard = buildTlsCertificateEvidenceCard(result);
  if (tlsCertificateCard && !cards.some(c => c.id.startsWith('netlog-tls-cert-fields'))) {
    cards.push(tlsCertificateCard);
  }
  recordTiming(debugTiming, timingRows, 'buildTlsCertificateEvidenceCard', tlsCertificateStart, undefined, { cards: cards.length });

  const lifecycleStart = performance.now();
  // ========== Phase 3 增强：请求生命周期证据 ==========
  if (events && events.length > 0) {
    const sourceGraphStart = performance.now();
    const graph = getCachedSourceGraph(events, result.urlRequests);
    recordTiming(debugTiming, timingRows, 'getCachedSourceGraph', sourceGraphStart, undefined, { events: events.length, urlRequests: result.urlRequests.length });

    const sourceIdCacheStart = performance.now();
    const eventsBySourceId = getCachedEventsBySourceId(events);
    recordTiming(debugTiming, timingRows, 'getCachedEventsBySourceId', sourceIdCacheStart, undefined, { sourceIds: eventsBySourceId.size });

    const lifecycleCardsStart = performance.now();
    const lifecycleCards = netlogLifecycleToCards(result, events, {
      maxCards: 5,
      graph,
      eventsBySourceId,
    });
    lifecycleCards.forEach(c => cards.push(c));
    recordTiming(debugTiming, timingRows, 'netlogLifecycleToCards', lifecycleCardsStart, undefined, { lifecycleCards: lifecycleCards.length, cards: cards.length });
  }
  recordTiming(debugTiming, timingRows, 'lifecycle section total', lifecycleStart, undefined, { cards: cards.length });

  const enrichmentStart = performance.now();
  // 历史次瓶颈回归指标：用于观察诊断证据补全是否再次退化。
  const enrichCardRows: TimingRow[] = [];
  const enrichedCards = cards.map(card => {
    const cardStart = performance.now();
    const nextCard = enrichCardWithP1Evidence(card, result);
    recordTiming(debugTiming, enrichCardRows, card.title, cardStart, undefined, {
      id: card.id,
      category: card.category,
      severity: card.severity,
      evidence: card.evidence.length,
      relatedRequestIds: card.relatedRequestIds?.length ?? 0,
      relatedEventIds: card.relatedEventIds?.length ?? 0,
    });
    return nextCard;
  });
  recordTiming(debugTiming, timingRows, 'enrichCardWithP1Evidence map', enrichmentStart, undefined, { cards: cards.length });

  const sortStart = performance.now();
  // 按严重程度排序
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  enrichedCards.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  recordTiming(debugTiming, timingRows, 'sort enriched cards', sortStart, undefined, { cards: enrichedCards.length });
  recordTiming(debugTiming, timingRows, 'netlogToCards total', totalStart, undefined, { cards: enrichedCards.length });
  emitTimingJson(debugTiming, 'netlogToCards internals', timingRows, {
    suggestions: suggestions.length,
    cards: enrichedCards.length,
    events: events?.length ?? 0,
    urlRequests: result.urlRequests.length,
    totalEvents: result.totalEvents,
    connectionFailures: result.connectionFailures.length,
    failedDomains: result.failedDomains.length,
    certIssues: result.certIssues.length,
  });
  emitTimingJson(
    debugTiming,
    'enrichCardWithP1Evidence per-card',
    enrichCardRows.sort((a, b) => b.durationMs - a.durationMs),
    { cards: enrichCardRows.length }
  );

  return enrichedCards;
}

function buildTemporalCorrelationCards(result: AnalysisResult): DiagnosticCard[] {
  const debugTiming = isDiagnosisTimingDebugEnabled();
  const timingRows: TimingRow[] = [];
  const totalStart = performance.now();

  const lookupStart = performance.now();
  const requestLookup = getRequestLookup(result);
  recordTiming(debugTiming, timingRows, 'getRequestLookup', lookupStart, undefined, { urlRequests: result.urlRequests.length });

  const contextStart = performance.now();
  const failuresWithContext = result.connectionFailures
    .map(failure => ({ failure, context: findEventsAround(result, failure.time, 3000) }))
    .filter(item => item.context.length > 0);
  recordTiming(debugTiming, timingRows, 'findEventsAround all failures', contextStart, undefined, {
    connectionFailures: result.connectionFailures.length,
    failuresWithContext: failuresWithContext.length,
  });

  if (failuresWithContext.length < 2) {
    recordTiming(debugTiming, timingRows, 'buildTemporalCorrelationCards total', totalStart, undefined, { emittedCards: 0 });
    emitTimingJson(debugTiming, 'buildTemporalCorrelationCards internals', timingRows, {
      connectionFailures: result.connectionFailures.length,
      failuresWithContext: failuresWithContext.length,
    });
    return [];
  }

  const aggregateStart = performance.now();
  const relatedRequestIds = failuresWithContext
    .flatMap(item => requestLookup.idsByUrl.get(item.failure.url) || [])
    .slice(0, 30);
  const kindCounts = failuresWithContext.reduce<Record<string, number>>((acc, item) => {
    item.context.forEach(ctx => { acc[ctx.kind] = (acc[ctx.kind] || 0) + 1; });
    return acc;
  }, {});
  const dominantKind = Object.entries(kindCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '网络上下文';
  recordTiming(debugTiming, timingRows, 'aggregate related ids and kinds', aggregateStart, undefined, {
    relatedRequestIds: relatedRequestIds.length,
    contextKinds: Object.keys(kindCounts).length,
  });

  const cardStart = performance.now();
  const resultCards = [addConfidenceDetails({
    id: generateId('netlog-time-correlation', 0),
    source: 'netlog',
    category: dominantKind.includes('代理') ? 'proxy' : dominantKind.includes('TLS') ? 'tls' : dominantKind.includes('缓存') ? 'cache' : dominantKind.includes('HTTP') || dominantKind.includes('QUIC') ? 'protocol' : 'network-change',
    severity: failuresWithContext.length >= 5 ? 'warning' : 'info',
    confidence: 'medium',
    title: `异常时间窗口相关性 (${failuresWithContext.length} 个失败点)`,
    conclusion: `${failuresWithContext.length} 个连接失败在 ±3s 内伴随 ${dominantKind} 等底层事件，问题更可能来自同一时间窗口内的网络状态/代理/TLS/协议变化，而不是孤立 URL 问题`,
    scope: buildScope(failuresWithContext.length, new Set(failuresWithContext.map(item => hostFromUrl(item.failure.url)).filter(Boolean)).size, 'global'),
    evidence: failuresWithContext.slice(0, 6).map((item, i) => ({
      label: `相关失败 ${i + 1}`,
      value: `${hostFromUrl(item.failure.url) || item.failure.url} · 错误 ${item.failure.error} · ${item.context.map(ctx => `${ctx.kind}/${ctx.event.typeName}(Δ${ctx.delta.toFixed(0)}ms)`).join('、')}`,
      source: 'derived' as const,
      requestIds: requestLookup.idsByUrl.get(item.failure.url) || [],
    })),
    actions: [
      {
        role: 'it',
        title: '按时间窗口排查网络/代理变更',
        detail: '优先核对失败发生时段内是否存在网络切换、代理策略更新、VPN 重连或 TLS 拦截策略变更',
      },
      {
        role: 'user',
        title: '复现时保持网络环境稳定',
        detail: '重新采集时避免 Wi-Fi/有线/VPN 切换，以确认失败是否仍在同一时间窗口聚集',
      },
    ],
    relatedRequestIds: relatedRequestIds.length > 0 ? relatedRequestIds : undefined,
    navigationTarget: { tab: 'events', keyword: 'net_error', errorOnly: true },
  }, [
    { label: '时间聚集', impact: 'positive', detail: `${failuresWithContext.length} 个失败点存在 ±3s 上下文事件` },
    { label: '跨层佐证', impact: 'positive', detail: Object.entries(kindCounts).map(([k, v]) => `${k} ${v}`).join('，') },
  ], relatedRequestIds.length === 0 ? [{ label: '请求映射不足', impact: 'negative', detail: '部分失败未映射到 URL_REQUEST，只能从时间维度推断' }] : [])];
  recordTiming(debugTiming, timingRows, 'create temporal card', cardStart, undefined, { emittedCards: resultCards.length });
  recordTiming(debugTiming, timingRows, 'buildTemporalCorrelationCards total', totalStart, undefined, { emittedCards: resultCards.length });
  emitTimingJson(debugTiming, 'buildTemporalCorrelationCards internals', timingRows, {
    connectionFailures: result.connectionFailures.length,
    failuresWithContext: failuresWithContext.length,
    relatedRequestIds: relatedRequestIds.length,
  });
  return resultCards;
}

function buildCacheDecisionCard(result: AnalysisResult): DiagnosticCard | null {
  if (result.cacheEvents.length === 0) return null;

  const cacheText = result.cacheEvents.map(e => `${e.typeName} ${JSON.stringify(e.params || {})}`.toLowerCase());
  const hitCount = cacheText.filter(t => t.includes('hit')).length;
  const missCount = cacheText.filter(t => t.includes('miss') || t.includes('create') || t.includes('doom')).length;
  const errorCount = result.cacheEvents.filter(e => e.params?.net_error !== undefined && e.params.net_error !== 0).length;

  return addConfidenceDetails({
    id: generateId('netlog-cache-decision', 0),
    source: 'netlog',
    category: 'cache',
    severity: errorCount > 0 || result.slowRequests.length > 0 ? 'warning' : 'info',
    confidence: 'medium',
    title: `缓存决策链路 (${result.cacheEvents.length} 条事件)`,
    conclusion: `NetLog 记录到 ${result.cacheEvents.length} 条缓存相关事件，命中线索 ${hitCount} 条、未命中/重建线索 ${missCount} 条、错误线索 ${errorCount} 条，可用于判断慢请求是否受缓存重建或缓存绕过影响`,
    scope: buildScope(result.cacheEvents.length, undefined, 'global'),
    evidence: result.cacheEvents.slice(0, 6).map((e, i) => ({
      label: `缓存事件 ${i + 1}`,
      value: `${formatNetlogTime(e.time)} · ${e.typeName} · source#${e.source.id}`,
      source: 'netlog' as const,
      fieldPath: `events[source.id=${e.source.id}].params`,
      detail: Object.keys(e.params || {}).slice(0, 8).join(', ') || '无 params 字段',
      eventIds: [String(e.source.id)],
    })),
    actions: [
      {
        role: 'frontend',
        title: '核对缓存策略与资源版本',
        detail: '检查 Cache-Control、ETag、Service Worker、资源 hash 是否导致频繁绕过缓存或缓存重建',
      },
      {
        role: 'backend',
        title: '确认静态资源缓存头',
        detail: '对静态资源设置稳定的 max-age/immutable，对接口响应避免错误缓存',
      },
    ],
    relatedEventIds: result.cacheEvents.slice(0, 20).map(e => String(e.source.id)),
    navigationTarget: { tab: 'events', keyword: 'cache' },
  }, [
    { label: '缓存事件', impact: 'positive', detail: `采集到 ${result.cacheEvents.length} 条缓存事件` },
    ...(errorCount > 0 ? [{ label: '缓存错误', impact: 'positive' as const, detail: `${errorCount} 条缓存事件包含 net_error` }] : []),
  ]);
}

function buildProxyDecisionCard(result: AnalysisResult): DiagnosticCard | null {
  if (result.proxyEvents.length === 0 && !result.proxyInfo.hasProxy) return null;

  const relatedFailures = result.connectionFailures.filter(failure =>
    result.proxyEvents.some(evt => Math.abs(evt.time - failure.time) <= 3000)
  );

  return addConfidenceDetails({
    id: generateId('netlog-proxy-decision', 0),
    source: 'netlog',
    category: 'proxy',
    severity: relatedFailures.length > 0 ? 'warning' : 'info',
    confidence: 'medium',
    title: `代理决策链路 (${result.proxyEvents.length} 条事件)`,
    conclusion: result.proxyInfo.hasProxy
      ? `当前存在代理配置（${result.proxyInfo.proxyType || '未知模式'}），并采集到 ${result.proxyEvents.length} 条代理决策事件；如失败与这些事件时间接近，应优先排查 PAC、代理可达性和 VPN 策略`
      : `采集到 ${result.proxyEvents.length} 条代理相关事件，但未解析出稳定代理配置，建议进一步核验代理自动探测和 PAC 解析结果`,
    scope: buildScope(Math.max(result.proxyEvents.length, relatedFailures.length || 1), undefined, 'global'),
    evidence: [
      { label: '代理模式', value: result.proxyInfo.proxyType || '未识别', source: 'netlog' as const },
      ...(result.proxyInfo.proxyList.length > 0 ? [{ label: '代理列表', value: result.proxyInfo.proxyList.slice(0, 5).join(', '), source: 'netlog' as const }] : []),
      ...(result.proxyInfo.pacUrl ? [{ label: 'PAC 地址', value: result.proxyInfo.pacUrl, source: 'netlog' as const }] : []),
      ...result.proxyEvents.slice(0, 5).map((e, i) => ({
        label: `代理事件 ${i + 1}`,
        value: `${formatNetlogTime(e.time)} · ${e.typeName} · source#${e.source.id}`,
        source: 'netlog' as const,
        detail: Object.keys(e.params || {}).slice(0, 8).join(', ') || '无 params 字段',
        eventIds: [String(e.source.id)],
      })),
    ],
    actions: [
      {
        role: 'it',
        title: '核验 PAC 与代理服务器',
        detail: '检查 PAC 返回结果、代理服务器健康状态、认证策略和目标域名分流规则',
      },
      {
        role: 'user',
        title: '对比代理开关状态',
        detail: '在符合安全策略的前提下，对比开启/关闭代理或 VPN 后同一 URL 的访问结果',
      },
    ],
    relatedRequestIds: relatedFailures.flatMap(f => result.urlRequests.filter(r => r.url === f.url).map(r => r.id)).slice(0, 20),
    relatedEventIds: result.proxyEvents.slice(0, 20).map(e => String(e.source.id)),
    navigationTarget: { tab: 'events', keyword: 'proxy' },
  }, [
    ...(result.proxyInfo.hasProxy ? [{ label: '代理配置', impact: 'positive' as const, detail: '已解析到有效代理配置' }] : []),
    ...(result.proxyEvents.length > 0 ? [{ label: '代理事件', impact: 'positive' as const, detail: `采集到 ${result.proxyEvents.length} 条代理相关事件` }] : []),
    ...(relatedFailures.length > 0 ? [{ label: '失败时间相关', impact: 'positive' as const, detail: `${relatedFailures.length} 个连接失败靠近代理事件` }] : []),
  ], result.proxyEvents.length === 0 ? [{ label: '缺少过程事件', impact: 'negative', detail: '仅能依据代理配置判断，缺少代理解析过程' }] : []);
}

function buildProtocolDecisionCard(result: AnalysisResult): DiagnosticCard | null {
  if (result.http2Events.length === 0 && result.quicEvents.length === 0 && Object.keys(result.protocols).length === 0) return null;

  const protocolSummary = Object.entries(result.protocols)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}:${count}`)
    .join('，') || '请求未记录明确协议';
  const protocolErrors = [...result.http2Events, ...result.quicEvents].filter(e =>
    e.params?.net_error !== undefined && e.params.net_error !== 0
  );
  const goawayEvents = result.http2Events.filter(e => e.typeName.includes('GOAWAY'));

  return addConfidenceDetails({
    id: generateId('netlog-protocol-decision', 0),
    source: 'netlog',
    category: 'protocol',
    severity: protocolErrors.length > 0 || goawayEvents.length > 0 ? 'warning' : 'info',
    confidence: 'medium',
    title: '协议选择与降级线索',
    conclusion: `协议分布为 ${protocolSummary}；HTTP/2 事件 ${result.http2Events.length} 条，QUIC 事件 ${result.quicEvents.length} 条，协议错误 ${protocolErrors.length} 条，可用于判断是否存在 H2/QUIC 降级、GOAWAY 或代理阻断`,
    scope: buildScope(result.urlRequests.length || result.http2Events.length + result.quicEvents.length, undefined, 'global'),
    evidence: [
      { label: '协议分布', value: protocolSummary, source: 'netlog' as const },
      { label: 'HTTP/2 事件', value: `${result.http2Events.length} 条，GOAWAY ${goawayEvents.length} 条`, source: 'netlog' as const },
      { label: 'QUIC 事件', value: `${result.quicEvents.length} 条`, source: 'netlog' as const },
      ...(result.proxyInfo.hasProxy ? [{ label: '代理影响', value: '检测到代理/VPN，可能影响 QUIC 或 HTTP/2 协议协商', source: 'derived' as const }] : []),
      ...protocolErrors.slice(0, 4).map((e, i) => ({
        label: `协议错误 ${i + 1}`,
        value: `${formatNetlogTime(e.time)} · ${e.typeName} · net_error=${e.params.net_error}`,
        source: 'netlog' as const,
        eventIds: [String(e.source.id)],
      })),
    ],
    actions: [
      {
        role: 'backend',
        title: '核对 ALPN 与 HTTP/2/3 配置',
        detail: '检查服务端 ALPN、TLS 配置、HTTP/2 GOAWAY 原因和 QUIC/UDP 443 可达性',
      },
      {
        role: 'it',
        title: '核对代理对协议的影响',
        detail: '企业代理或 VPN 可能阻断 QUIC/UDP 或终止 TLS，导致协议回退到 HTTP/1.1',
      },
    ],
    relatedEventIds: [...result.http2Events, ...result.quicEvents].slice(0, 20).map(e => String(e.source.id)),
    navigationTarget: { tab: 'ssl-protocol', keyword: 'protocol' },
  }, [
    { label: '协议事件', impact: 'positive', detail: `HTTP/2 ${result.http2Events.length} 条，QUIC ${result.quicEvents.length} 条` },
    ...(Object.keys(result.protocols).length > 0 ? [{ label: '请求协议分布', impact: 'positive' as const, detail: protocolSummary }] : []),
    ...(protocolErrors.length > 0 ? [{ label: '协议错误', impact: 'positive' as const, detail: `${protocolErrors.length} 条协议事件包含 net_error` }] : []),
  ]);
}

function buildTlsCertificateEvidenceCard(result: AnalysisResult): DiagnosticCard | null {
  if (result.certIssues.length === 0) return null;

  const detailedIssues = result.certIssues
    .map(issue => ({ issue, details: extractCertDetails(issue.event.params || {}) }))
    .filter(item => item.details.length > 0);

  if (detailedIssues.length === 0) return null;

  const hosts = Array.from(new Set(result.certIssues.map(issue => issue.host).filter(Boolean)));
  return addConfidenceDetails({
    id: generateId('netlog-tls-cert-fields', 0),
    source: 'netlog',
    category: 'tls',
    severity: result.certIssues.some(issue => issue.category === 'cert') ? 'warning' : 'info',
    confidence: 'medium',
    title: `TLS 证书字段证据 (${detailedIssues.length} 条)`,
    conclusion: `NetLog 中有 ${detailedIssues.length} 条 TLS/证书异常携带证书字段，可进一步核验证书主体、SAN、颁发者、有效期和验证状态`,
    scope: buildScope(result.certIssues.length, hosts.length || undefined, hosts.length > 1 ? 'multi-domain' : 'single-domain'),
    evidence: detailedIssues.slice(0, 6).map((item, i) => ({
      label: `证书字段 ${i + 1}`,
      value: `${item.issue.host || '未知主机'} · 错误 ${item.issue.error} · ${item.details.join('；')}`,
      source: 'netlog' as const,
      fieldPath: `events[source.id=${item.issue.event.source.id}].params`,
      eventIds: [String(item.issue.event.source.id)],
    })),
    actions: [
      {
        role: 'backend',
        title: '核验证书链与域名匹配',
        detail: '对照证书 subject/SAN、issuer、有效期和浏览器错误码，确认服务器证书链是否完整且覆盖访问域名',
      },
    ],
    relatedEventIds: detailedIssues.slice(0, 20).map(item => String(item.issue.event.source.id)),
    navigationTarget: { tab: 'ssl-protocol', keyword: 'certificate' },
  }, [
    { label: '证书字段', impact: 'positive', detail: `${detailedIssues.length} 条异常包含可读证书字段` },
    { label: 'TLS 异常', impact: 'positive', detail: `总计 ${result.certIssues.length} 条证书/TLS 异常` },
  ]);
}

function buildProxyCard(proxyInfo: ProxyInfo, result: AnalysisResult): DiagnosticCard {
  const evidence: DiagnosticEvidence[] = [
    {
      label: '代理模式',
      value: proxyInfo.proxyType || '未知',
      source: 'netlog',
    },
  ];
  if (proxyInfo.proxyList.length > 0) {
    evidence.push({
      label: '代理服务器',
      value: proxyInfo.proxyList.join(', '),
      source: 'netlog',
    });
  }
  if (proxyInfo.pacUrl) {
    evidence.push({
      label: 'PAC 地址',
      value: proxyInfo.pacUrl,
      source: 'netlog',
    });
  }

  return {
    id: generateId('netlog-proxy', 0),
    source: 'netlog',
    category: 'proxy',
    severity: 'info',
    confidence: 'high',
    title: proxyInfo.isVPN ? '检测到 VPN 环境' : '检测到代理服务器配置',
    conclusion: proxyInfo.isVPN
      ? '日志中检测到 VPN 使用迹象，VPN 可能导致网络延迟增加或 DNS 被接管'
      : `当前配置了代理（模式: ${proxyInfo.proxyType}），代理可能导致请求被拦截或延迟增加`,
    scope: buildScope(result.urlRequests.length, undefined, 'global'),
    evidence,
    actions: [
      {
        role: 'user',
        title: '临时关闭代理对比',
        detail: '在公司安全策略允许的情况下，临时关闭代理/VPN 后对比测试',
      },
      {
        role: 'it',
        title: '检查代理配置',
        detail: '确认代理服务器是否正常运行，PAC 脚本是否正确配置',
      },
    ],
  };
}

function buildDnsHijackCard(hijackedDomains: FailedDomain[]): DiagnosticCard {
  return {
    id: generateId('netlog-hijack', 0),
    source: 'netlog',
    category: 'dns',
    severity: 'critical',
    confidence: 'high',
    title: `检测到 DNS 劫持 (${hijackedDomains.length} 个域名)`,
    conclusion: 'DNS 劫持是严重的网络故障，通常是运营商 LOCAL DNS 故障导致，需要立即更换 DNS',
    scope: buildScope(hijackedDomains.reduce((s, d) => s + d.count, 0), hijackedDomains.length, 'multi-domain'),
    evidence: hijackedDomains.map((d, i) => ({
      label: `劫持域名 ${i + 1}`,
      value: `${d.domain} → ${d.ips.filter(ip => ip === '127.0.0.1' || ip === '0.0.0.0').join(', ')}`,
      source: 'netlog',
    })),
    actions: [
      {
        role: 'user',
        title: '紧急更换 DNS',
        detail: '国内用户立即将 DNS 更改为 223.5.5.5 或 119.29.29.29；海外用户更改为 8.8.8.8 或 1.1.1.1',
        command: 'nslookup example.com 223.5.5.5',
        platform: 'all',
        expectedResult: '应返回正确的公网 IP 地址',
      },
      {
        role: 'it',
        title: '修改企业 DNS 配置',
        detail: '联系公司 IT 修改 DHCP 出口 DNS，避免使用问题 DNS 服务器',
      },
    ],
    limitations: [
      '解析到私网 IP 不一定异常，企业内网服务、Split DNS、内网域名都可能解析到私网 IP',
    ],
  };
}

// ========== 采集质量检测 ==========

export function checkNetlogQuality(result: AnalysisResult): CollectionQuality {
  const issues: CollectionQuality['issues'] = [];
  const missingFields: string[] = [];
  const recommendations: string[] = [];

  // 检查事件数量
  if (result.totalEvents < 50) {
    issues.push({
      type: 'insufficient_data',
      severity: 'warning',
      message: '事件数量过少',
      detail: `仅 ${result.totalEvents} 个事件，可能无法完整反映网络状况`,
    });
    recommendations.push('建议在更多场景下采集 NetLog，确保包含完整的网络交互过程');
  }

  // 检查是否包含 constants
  if (result.totalEvents > 0 && !result.systemInfo.browser) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '未包含系统信息',
      detail: 'NetLog 未包含浏览器/操作系统信息，可能影响部分诊断',
    });
    missingFields.push('systemInfo');
  }

  // 检查 DNS 事件
  if (result.dnsEvents.length === 0) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '未包含 DNS 事件',
      detail: '当前 NetLog 未包含 DNS 配置数据，因此无法判断 DNS 服务器地址',
    });
    missingFields.push('dnsEvents');
    recommendations.push('采集 NetLog 时确保勾选 "Include raw bytes" 选项');
  }

  // 检查 Proxy 事件
  if (result.proxyEvents.length === 0 && !result.proxyInfo.hasProxy) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '未包含代理事件',
      detail: '当前 NetLog 未包含代理相关事件，无法判断代理配置',
    });
    missingFields.push('proxyEvents');
  }

  // 检查 SSL 事件
  if (result.sslEvents.length === 0 && result.urlRequests.some(r => r.url?.startsWith('https:'))) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '未包含 SSL 事件',
      detail: '存在 HTTPS 请求但未记录 SSL 事件，无法分析 TLS 握手细节',
    });
    missingFields.push('sslEvents');
  }

  // 检查 URL_REQUEST
  if (result.urlRequests.length === 0) {
    issues.push({
      type: 'insufficient_data',
      severity: 'warning',
      message: '未包含 URL 请求',
      detail: 'NetLog 中未找到 URL_REQUEST 事件，无法进行请求级分析',
    });
  }

  // 检查采集时间跨度
  const timeSpan = result.timeRange.end - result.timeRange.start;
  if (timeSpan > 0 && timeSpan < 5000) {
    issues.push({
      type: 'suspicious_pattern',
      severity: 'info',
      message: '采集时间跨度过短',
      detail: `仅 ${(timeSpan / 1000).toFixed(1)} 秒，可能未完整记录网络交互`,
    });
    recommendations.push('建议在完整复现问题后再停止 NetLog 采集');
  }

  // ===== 新增：检查 polledData =====
  if (!result.systemInfo.browser && result.totalEvents > 100) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '可能缺少 polledData',
      detail: 'NetLog 可能缺少轮询数据（polledData），影响实时状态分析',
    });
    missingFields.push('polledData');
  }

  // ===== 新增：检查 socket 事件 =====
  const hasHttpsRequests = result.urlRequests.some(r => r.url?.startsWith('https:'));
  const hasSocketEvents = result.sslEvents.length > 0 || result.urlRequests.some(r => r.error !== undefined && r.error !== 0);
  if (hasHttpsRequests && !hasSocketEvents && result.totalEvents > 50) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '可能缺少 socket 层事件',
      detail: '存在 HTTPS 请求但未检测到 socket/SSL 连接事件，可能影响连接层分析',
    });
    missingFields.push('socketEvents');
  }

  // ===== 新增：检查 URL_REQUEST 深度 =====
  if (result.urlRequests.length > 0 && result.urlRequests.length < 5 && result.totalEvents > 50) {
    issues.push({
      type: 'insufficient_data',
      severity: 'info',
      message: 'URL 请求数量过少',
      detail: `仅 ${result.urlRequests.length} 个 URL_REQUEST，可能未完整记录网络请求`,
    });
    recommendations.push('确保采集时勾选了 "Include raw bytes" 且复现了完整操作');
  }

  return {
    source: 'netlog',
    isDiagnosable: result.totalEvents >= 20 && result.urlRequests.length > 0,
    issues,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
  };
}

// ========== 汇总函数 ==========

export function buildNetlogDiagnosisSummary(
  result: AnalysisResult,
  suggestions: Suggestion[],
  events?: ParsedEvent[]
): DiagnosisSummary {
  const debugTiming = isDiagnosisTimingDebugEnabled();
  const timingRows: TimingRow[] = [];
  const totalStart = performance.now();
  const cardsStart = performance.now();
  const cards = netlogToCards(result, suggestions, events);
  recordTiming(debugTiming, timingRows, 'netlogToCards', cardsStart, undefined, { cards: cards.length });

  const qualityStart = performance.now();
  const quality = checkNetlogQuality(result);
  recordTiming(debugTiming, timingRows, 'checkNetlogQuality', qualityStart, undefined, { qualityIssues: quality.issues.length });

  const severityStart = performance.now();
  const overallSeverity = (
    cards.some(c => c.severity === 'critical') ? 'critical' :
    cards.some(c => c.severity === 'warning') ? 'warning' : 'info'
  ) as DiagnosisSummary['overallSeverity'];
  recordTiming(debugTiming, timingRows, 'overallSeverity scan', severityStart, undefined, { cards: cards.length, overallSeverity });
  recordTiming(debugTiming, timingRows, 'buildNetlogDiagnosisSummary total', totalStart, undefined, { cards: cards.length });
  emitTimingJson(debugTiming, 'buildNetlogDiagnosisSummary internals', timingRows, {
    suggestions: suggestions.length,
    cards: cards.length,
    events: events?.length ?? 0,
    urlRequests: result.urlRequests.length,
    totalEvents: result.totalEvents,
    errors: result.errors.length,
    warnings: result.warnings.length,
    info: result.info.length,
  });

  return {
    cards,
    quality,
    overallSeverity,
  };
}
