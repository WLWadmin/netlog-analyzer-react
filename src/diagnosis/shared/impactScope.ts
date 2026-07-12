import type { DiagnosticCard, DiagnosticScopeType } from './types';
import type { RequestImportance } from './requestImportance';

export interface ImpactScopeResult {
  type: DiagnosticScopeType;
  summary: string;
  affectedRequestCount: number;
  affectedDomainCount: number;
  counterEvidenceSummary: string[];
  rankingReasons: string[];
  allowGlobal: boolean;
}

const NETWORK_GLOBAL_CATEGORIES = new Set(['network-change', 'proxy']);

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function cardDomains(card: DiagnosticCard): string[] {
  const text = [
    card.title,
    card.conclusion,
    ...card.evidence.flatMap(item => [item.value, item.detail || '']),
  ].join(' ');
  return uniq((text.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/gi) || []).map(item => item.toLowerCase()));
}

function hasGlobalEvidence(cards: DiagnosticCard[]): boolean {
  return cards.some(card =>
    NETWORK_GLOBAL_CATEGORIES.has(card.category) ||
    /network change|offline|代理全局|proxy config|vpn|pac/i.test([
      card.title,
      card.conclusion,
      ...card.evidence.flatMap(item => [item.label, item.value, item.detail || '']),
    ].join(' '))
  );
}

function hasHttpsOnlyEvidence(cards: DiagnosticCard[]): boolean {
  const text = cards.map(card => [
    card.title,
    card.conclusion,
    ...card.evidence.flatMap(item => [item.value, item.detail || '']),
  ].join(' ')).join('\n');
  return /https|tls|ssl/i.test(text) && /http\s*正常|非\s*https\s*正常|other protocols? normal/i.test(text);
}

function hasSuccessCounterEvidence(cards: DiagnosticCard[]): boolean {
  return cards.some(card => /同域.*成功|其他域.*成功|大量成功|status[:：=]?200|2xx/i.test([
    card.title,
    card.conclusion,
    ...card.evidence.flatMap(item => [item.label, item.value, item.detail || '']),
  ].join(' ')));
}

export function calculateImpactScope(input: {
  cards: DiagnosticCard[];
  requestImportances?: RequestImportance[];
}): ImpactScopeResult {
  const { cards, requestImportances = [] } = input;
  const affectedRequestIds = uniq(cards.flatMap(card => card.relatedRequestIds || []).concat(cards.flatMap(card => card.evidence.flatMap(e => e.requestIds || []))));
  const affectedRequestCount = affectedRequestIds.length || cards.reduce((sum, card) => sum + (card.scope.affectedRequestCount || 0), 0) || cards.length;
  const domains = uniq(cards.flatMap(cardDomains));
  const affectedDomainCount = domains.length || Math.max(...cards.map(card => card.scope.affectedDomainCount || 0), 1);
  const hasGlobal = hasGlobalEvidence(cards);
  const hasCounterSuccess = hasSuccessCounterEvidence(cards);
  const categories = new Set(cards.map(card => card.category));
  const highImportanceCount = requestImportances.filter(item => item.level === 'high').length;
  const maxImportanceScore = requestImportances.length ? Math.max(...requestImportances.map(item => item.score)) : 0;
  const counterEvidenceSummary: string[] = [];
  const rankingReasons: string[] = [];

  if (hasCounterSuccess) counterEvidenceSummary.push('存在同域或其他域成功请求，需避免把局部异常升级为全局问题。');
  if (highImportanceCount > 0) rankingReasons.push(`${highImportanceCount} 个高重要性业务请求受影响。`);
  if (maxImportanceScore > 0) rankingReasons.push(`最高请求重要性分 ${maxImportanceScore}。`);
  if (hasGlobal) rankingReasons.push('存在 Network change、offline、代理或 VPN 等底层全局证据。');

  let type: DiagnosticScopeType;
  if (categories.size === 1 && categories.has('server') && affectedDomainCount <= 1) {
    type = 'server-side';
    counterEvidenceSummary.push('HTTP 5xx/TTFB 集中在单服务域名，不归为客户端全局网络问题。');
  } else if (hasHttpsOnlyEvidence(cards)) {
    type = 'https-only';
  } else if (affectedRequestCount <= 1 && hasCounterSuccess) {
    type = 'single-request';
  } else if (affectedDomainCount <= 1) {
    type = 'single-domain';
  } else if (affectedDomainCount > 1 && hasGlobal) {
    type = 'global';
  } else {
    type = 'multi-domain';
    if (affectedDomainCount > 1 && !hasGlobal) {
      counterEvidenceSummary.push('多域异常缺少 Network change/offline/代理全局证据，不能升级为 global。');
    }
  }

  const summary = type === 'global'
    ? `全局影响：${affectedDomainCount} 个域名 / ${affectedRequestCount} 个请求`
    : type === 'single-request'
      ? '单请求影响'
      : type === 'single-domain'
        ? `单域名影响：${affectedRequestCount} 个请求`
        : type === 'server-side'
          ? `服务端侧影响：${affectedDomainCount} 个服务域名 / ${affectedRequestCount} 个请求`
          : type === 'https-only'
            ? `HTTPS/TLS 专属影响：${affectedDomainCount} 个域名`
            : `多域名影响：${affectedDomainCount} 个域名 / ${affectedRequestCount} 个请求`;

  return {
    type,
    summary,
    affectedRequestCount,
    affectedDomainCount,
    counterEvidenceSummary: uniq(counterEvidenceSummary),
    rankingReasons: uniq(rankingReasons),
    allowGlobal: type === 'global',
  };
}
