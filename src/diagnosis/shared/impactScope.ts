import type { DiagnosticCard, DiagnosticScopeType } from './types';
import type { RequestImportance } from './requestImportance';

export interface ImpactScopeResult {
  type: DiagnosticScopeType;
  summary: string;
  affectedRequestCount: number;
  /** False only when neither affected IDs nor an explicit scope count exists. */
  requestCountIsKnown: boolean;
  affectedDomainCount: number;
  /** Partial card IDs cannot establish an exact deduplicated total. */
  requestCountIsLowerBound: boolean;
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
  const affectedRequestIds = uniq(cards.flatMap(getAffectedRequestIds));
  const requestSources = new Set(cards.flatMap(card => card.source === 'combined'
    ? card.evidence.flatMap(item => item.originalSource || (item.source === 'derived' ? [] : [item.source]))
    : [card.source]));
  const hasUnalignedSources = requestSources.size > 1;
  // Numeric HAR ordinals and NetLog source IDs are independent. Without alignment,
  // neither their union nor their sum proves the unique physical request total.
  const knownIdCount = hasUnalignedSources
    ? Math.max(
      ...(['har', 'netlog'] as const).map(source =>
        uniq(cards.filter(card => card.source === source).flatMap(getAffectedRequestIds)).length),
      ...cards.filter(card => card.source === 'combined').map(card => getAffectedRequestIds(card).length),
      0,
    )
    : affectedRequestIds.length;
  // Card scopes can overlap; a representative ID list must not replace a known total.
  const affectedRequestCount = Math.max(knownIdCount, ...cards.map(card => card.scope.affectedRequestCount || 0), 0);
  const hasUncountedCard = cards.some(card => card.scope.affectedRequestCount === undefined && getAffectedRequestIds(card).length === 0);
  const requestCountIsKnown = affectedRequestCount > 0 || (cards.length > 0 && !hasUncountedCard);
  const requestCountIsLowerBound = affectedRequestCount > 0 && (hasUnalignedSources || hasUncountedCard || cards.some(card => (card.scope.affectedRequestCount || 0) > getAffectedRequestIds(card).length));
  const domains = uniq(cards.flatMap(cardDomains));
  const affectedDomainCount = Math.max(domains.length, ...cards.map(card => card.scope.affectedDomainCount || 0), 0);
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
    counterEvidenceSummary.push('HTTP 5xx/Waiting 异常集中在单服务域名，不归为客户端全局网络问题；具体处理阶段仍需服务端证据。');
  } else if (hasHttpsOnlyEvidence(cards)) {
    type = 'https-only';
  } else if (requestCountIsKnown && !requestCountIsLowerBound && affectedRequestCount === 1 && hasCounterSuccess) {
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

  const summary = !requestCountIsKnown
    ? '影响请求数无可用数据'
    : affectedRequestCount === 0
    ? '影响 0 个请求'
    : type === 'global'
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
    summary: requestCountIsLowerBound ? summary.replace(/(\d+) 个请求/, hasUnalignedSources
      ? '至少 $1 个请求（跨来源 ID 尚未对齐）'
      : '至少 $1 个请求（关联 ID 不完整）') : summary,
    affectedRequestCount,
    requestCountIsKnown,
    affectedDomainCount,
    requestCountIsLowerBound,
    counterEvidenceSummary: uniq(counterEvidenceSummary),
    rankingReasons: uniq(rankingReasons),
    allowGlobal: type === 'global',
  };
}

export function formatAffectedRequestCount(
  count: number,
  isKnown: boolean | undefined,
  isLowerBound: boolean | undefined,
  unit = '个请求',
): string {
  return isKnown === false ? '请求数无可用数据' : `${isLowerBound ? '至少 ' : ''}${count} ${unit}`;
}

// relatedRequestIds is the full affected set; evidence can also contain successful counterexamples.
export function getAffectedRequestIds(card: DiagnosticCard): number[] {
  return uniq(card.relatedRequestIds ?? card.evidence
    .filter(item => !/反证|成功|successful|counter/i.test(item.label))
    .flatMap(item => item.requestIds || []));
}
