import type {
  CollectionQuality,
  DiagnosticAction,
  DiagnosticCard,
  DiagnosticCategory,
  DiagnosticConfidenceLevel,
  DiagnosticEvidence,
  DiagnosticRole,
  DiagnosisSummary,
} from './types';
import type {
  ActionGroup,
  FinalAction,
  FinalConclusion,
  FinalConclusionKind,
  FinalDiagnosisMode,
  FinalDiagnosisSummary,
  FinalEvidence,
  MissingInfoItem,
  RootCauseCluster,
} from './finalSummaryTypes';
import { buildNetErrorKnowledgeActionGroups } from './netErrorActionKnowledge';

const CATEGORY_LABELS: Record<DiagnosticCategory, string> = {
  dns: 'DNS',
  proxy: '代理 / VPN',
  tls: 'TLS / 证书',
  connect: '连接',
  protocol: '协议',
  server: '服务端',
  client: '客户端',
  performance: '性能',
  cache: '缓存',
  compression: '压缩',
  security: '安全',
  cors: 'CORS',
  redirect: '重定向',
  'network-change': '网络变更',
  'browser-queue': '浏览器队列',
  quality: '采集质量',
  unknown: '未知',
};

const ROLE_LABELS: Record<DiagnosticRole | 'collect', string> = {
  user: '用户先做',
  it: 'IT / 网络管理员处理',
  backend: '后端 / 服务端处理',
  frontend: '前端处理',
  collect: '必要时补充信息',
};

const ROLE_PRIORITY: Record<DiagnosticRole | 'collect', number> = {
  user: 1,
  it: 2,
  backend: 3,
  frontend: 4,
  collect: 9,
};

const SEVERITY_WEIGHT: Record<DiagnosticCard['severity'], number> = {
  critical: 40,
  warning: 24,
  info: 8,
};

const CONFIDENCE_WEIGHT: Record<DiagnosticConfidenceLevel, number> = {
  high: 24,
  medium: 14,
  low: 4,
};

const CONFIDENCE_TEXT: Record<DiagnosticConfidenceLevel, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function hasDirectEvidence(card: DiagnosticCard): boolean {
  const directText = [
    card.title,
    card.conclusion,
    ...card.evidence.flatMap(e => [e.label, e.value, e.detail || '']),
  ].join(' ');
  return /ERR_|net_error|错误码|DNS|TLS|SSL|PROXY|代理|握手|连接失败|超时|reset|refused|name_not_resolved/i.test(directText);
}

function hasExplicitFailureEvidence(card: DiagnosticCard): boolean {
  const text = [
    card.title,
    card.conclusion,
    ...card.evidence.flatMap(e => [e.label, e.value, e.detail || '']),
  ].join(' ');
  return /ERR_[A-Z0-9_]+|name_not_resolved|net_error\s*[:：=]?\s*-?\d+|error_code\s*[:：=]?\s*-?\d+|错误码\s*[:：=]?\s*-?\d+|\b-\d{2,4}\b|连接失败|握手失败|reset|refused|timed?\s*out|超时/i.test(text);
}

function isOnlyDerivedEvidence(card: DiagnosticCard): boolean {
  return card.evidence.length > 0 && card.evidence.every(e => e.source === 'derived');
}

function isPureProtocolFact(card: DiagnosticCard): boolean {
  if (card.category !== 'protocol') return false;
  return !hasExplicitFailureEvidence(card);
}

function isProxyConfigOnly(card: DiagnosticCard): boolean {
  if (card.category !== 'proxy') return false;
  if (hasExplicitFailureEvidence(card)) return false;
  const text = [
    card.title,
    card.conclusion,
    ...card.evidence.flatMap(e => [e.label, e.value, e.detail || '']),
  ].join(' ');
  return /代理|proxy|PAC|VPN|配置|模式|服务器/i.test(text);
}

function isDnsAnswerSpecialIpOnly(card: DiagnosticCard): boolean {
  if (card.category !== 'dns') return false;
  if (hasExplicitFailureEvidence(card)) return false;
  const text = [
    card.title,
    card.conclusion,
    ...card.evidence.flatMap(e => [e.label, e.value, e.detail || '']),
  ].join(' ');
  return /(DNS answer|DNS 解析|解析结果|dnsRecords).*(127\.0\.0\.1|0\.0\.0\.0|::1)|(127\.0\.0\.1|0\.0\.0\.0|::1).*(DNS answer|DNS 解析|解析结果|dnsRecords)/i.test(text);
}

function canBeConfirmedRootCause(card: DiagnosticCard): boolean {
  if (card.severity === 'info') return false;
  if (isOnlyDerivedEvidence(card)) return false;
  if (isPureProtocolFact(card)) return false;
  if (isProxyConfigOnly(card)) return false;
  if (isDnsAnswerSpecialIpOnly(card)) return false;
  return hasExplicitFailureEvidence(card);
}

function evidenceStrength(card: DiagnosticCard): number {
  let score = 0;
  if (hasDirectEvidence(card)) score += 12;
  if (card.evidence.length >= 3) score += 8;
  if (card.evidence.some(e => e.source !== 'derived')) score += 6;
  if (card.evidence.every(e => e.source === 'derived')) score += 2;
  if (card.navigationTarget || card.relatedRequestIds?.length || card.relatedSourceIds?.length || card.relatedEventIds?.length) score += 4;
  return Math.min(score, 22);
}

function affectedScopeScore(card: DiagnosticCard): number {
  const requestCount = card.scope.affectedRequestCount || card.relatedRequestIds?.length || 0;
  const domainCount = card.scope.affectedDomainCount || 0;
  const requestScore = requestCount >= 20 ? 12 : requestCount >= 10 ? 9 : requestCount >= 3 ? 6 : requestCount > 0 ? 3 : 0;
  const domainScore = domainCount >= 5 ? 8 : domainCount >= 2 ? 5 : domainCount === 1 ? 2 : 0;
  return requestScore + domainScore;
}

function dualSourceScore(card: DiagnosticCard, summary: DiagnosisSummary): number {
  const hasMergedSources = card.mergedSources && card.mergedSources.includes('har') && card.mergedSources.includes('netlog');
  const hasOriginalSources = new Set(card.evidence.map(e => e.originalSource).filter(Boolean));
  if (hasMergedSources || (hasOriginalSources.has('har') && hasOriginalSources.has('netlog'))) return 18;
  if (card.source === 'combined' || summary.combinedConfidence) return 8;
  return 0;
}

function actionabilityScore(card: DiagnosticCard): number {
  if (card.actions.some(action => action.role === 'user')) return 10;
  if (card.actions.length > 0) return 5;
  return 0;
}

function limitationPenalty(card: DiagnosticCard): number {
  let penalty = 0;
  if (card.limitations && card.limitations.length > 0) penalty += 12;
  if (card.confidence === 'low' && !hasDirectEvidence(card)) penalty += 10;
  if (card.category === 'quality' && card.severity !== 'critical') penalty += 4;
  return penalty;
}

function scoreCard(card: DiagnosticCard, summary: DiagnosisSummary): number {
  return (
    SEVERITY_WEIGHT[card.severity] +
    CONFIDENCE_WEIGHT[card.confidence] +
    evidenceStrength(card) +
    affectedScopeScore(card) +
    dualSourceScore(card, summary) +
    actionabilityScore(card) -
    limitationPenalty(card)
  );
}

function compareConfidence(a: DiagnosticConfidenceLevel, b: DiagnosticConfidenceLevel): number {
  const order: Record<DiagnosticConfidenceLevel, number> = { high: 3, medium: 2, low: 1 };
  return order[a] - order[b];
}

function highestConfidence(cards: DiagnosticCard[]): DiagnosticConfidenceLevel {
  return cards.reduce<DiagnosticConfidenceLevel>((best, card) => (
    compareConfidence(card.confidence, best) > 0 ? card.confidence : best
  ), 'low');
}

function determineConclusionKind(
  card: DiagnosticCard,
  mode: FinalDiagnosisMode,
  summary: DiagnosisSummary
): FinalConclusionKind {
  if (card.category === 'quality' && (!summary.quality.isDiagnosable || card.severity === 'critical')) {
    return 'needs-more-data';
  }
  if (mode === 'har') {
    return 'symptom-only';
  }
  if (mode === 'combined') {
    const hasHarEvidence = card.evidence.some(e => e.originalSource === 'har');
    const hasNetlogEvidence = card.evidence.some(e => e.originalSource === 'netlog');
    const strongCombined = card.confidence === 'high' && (
      card.mergedSources?.length === 2 ||
      summary.combinedConfidence === 'high' ||
      (hasHarEvidence && hasNetlogEvidence)
    );
    return strongCombined ? 'confirmed' : card.confidence === 'low' ? 'needs-more-data' : 'highly-likely';
  }
  if (mode === 'netlog') {
    if (card.confidence === 'high' && canBeConfirmedRootCause(card)) return 'confirmed';
    if (card.confidence !== 'low') return 'highly-likely';
  }
  return card.confidence === 'low' ? 'needs-more-data' : 'highly-likely';
}

function buildImpact(card: DiagnosticCard): string {
  const parts = [card.scope.summary];
  if (card.scope.affectedDomainCount) parts.push(`涉及 ${card.scope.affectedDomainCount} 个域名`);
  if (card.scope.affectedRequestCount) parts.push(`影响 ${card.scope.affectedRequestCount} 个请求`);
  return uniq(parts).join('，') || '影响范围未记录';
}

function toFinalEvidence(evidence: DiagnosticEvidence): FinalEvidence {
  return {
    label: evidence.label,
    value: evidence.value,
    source: evidence.source,
    originalSource: evidence.originalSource,
    detail: evidence.detail,
    requestIds: evidence.requestIds,
    eventIds: evidence.eventIds,
  };
}

function toFinalAction(action: DiagnosticAction, sourceCardId: string, priority: number): FinalAction {
  return {
    id: `${sourceCardId}-action-${priority}`,
    title: action.title,
    detail: action.detail,
    command: action.command,
    expectedResult: action.expectedResult,
    nextIfFailed: action.nextIfFailed,
    sourceCardId,
    priority,
    effort: action.role === 'user' ? 'low' : 'medium',
    risk: /Include raw bytes|Cookie|Authorization|Token|请求体|敏感/i.test(`${action.title} ${action.detail}`)
      ? 'sensitive'
      : 'safe',
  };
}

function isCollectionAction(action: DiagnosticAction): boolean {
  const text = `${action.title} ${action.detail} ${action.command || ''}`;
  return /(重新采集|补充采集|重新导出|导出\s*(HAR|NetLog)|采集\s*(HAR|NetLog)|Include raw bytes|chrome:\/\/net-export|net-export)/i.test(text);
}

function buildMissingInfoFromQuality(quality: CollectionQuality): MissingInfoItem[] {
  const items: MissingInfoItem[] = [];
  quality.issues.forEach((issue, index) => {
    items.push({
      id: `quality-${issue.type}-${index}`,
      title: issue.message,
      reason: issue.detail || '当前采集质量可能影响诊断置信度',
      recommendation: quality.recommendations?.[index] || '先基于当前结论执行可操作排查；如果排查后仍无法确认，再补充同一次复现的 HAR 与 NetLog，并保留问题发生时间点',
      sensitivity: 'low',
      optional: issue.severity !== 'warning',
    });
  });
  return items;
}

function buildModeMissingInfo(mode: FinalDiagnosisMode, headline: FinalConclusion[]): MissingInfoItem[] {
  const items: MissingInfoItem[] = [];
  if (mode === 'har' && headline.some(item => item.kind === 'symptom-only')) {
    items.push({
      id: 'har-needs-netlog',
      title: '缺少浏览器网络栈证据',
      reason: 'HAR 能说明请求失败、慢在哪里或 HTTP 状态码异常，但不能可靠证明 DNS、TLS、代理或 TCP 根因',
      recommendation: '建议补充同一次复现的 NetLog；如果担心敏感信息，可以先采普通 NetLog，不必强制勾选 Include raw bytes',
      sensitivity: 'medium',
      optional: true,
    });
  }
  if (mode === 'netlog') {
    items.push({
      id: 'netlog-needs-har',
      title: '可补充页面请求表现',
      reason: 'NetLog 能说明网络栈事件，但不一定能直接对应页面中哪些接口失败、慢在哪里或 HTTP 状态码是什么',
      recommendation: '当前不必马上重新采集；如果需要和业务接口、状态码或瀑布耗时对齐，再补充同一次复现导出的 HAR',
      sensitivity: 'low',
      optional: true,
    });
  }
  return items;
}

function buildLimitationMissingInfo(cards: DiagnosticCard[]): MissingInfoItem[] {
  const items: MissingInfoItem[] = [];
  cards.forEach(card => {
    card.limitations?.slice(0, 2).forEach((limitation, index) => {
      items.push({
        id: `${card.id}-limitation-${index}`,
        title: '诊断限制',
        reason: limitation,
        recommendation: '先按行动清单验证；如果验证后仍无法确认，再补充 HAR、NetLog、问题时间点、logid 和网络环境说明',
        sensitivity: 'low',
        optional: true,
      });
    });
  });
  return items;
}

function buildConflictMissingInfo(summary: DiagnosisSummary): MissingInfoItem[] {
  return (summary.fusionConflicts || []).map((conflict, index) => ({
    id: `fusion-conflict-${index}`,
    title: '联合证据存在冲突',
    reason: conflict,
    recommendation: '先确认 HAR 与 NetLog 是否来自同一次复现；只有无法确认来源或时间窗口不一致时，再重新同时采集两份文件',
    sensitivity: 'low' as const,
    optional: false,
  }));
}

function buildCommonNetworkInfoMissingInfo(): MissingInfoItem[] {
  return [
    {
      id: 'common-network-info',
      title: '常规网络排查信息',
      reason: '如果需要继续协同 IT、客服或后端排查，仅靠错误码通常不够，需要补充基础网络环境信息',
      recommendation: '收集客户端 IP / DNS 出口、明确打不开或请求慢的域名、域名对应的 DNS / IP 连通性 / 丢包率 / 路由信息，以及上网方式和环境信息',
      detailGroups: [
        {
          title: 'IP / DNS 出口',
          items: [
            '访问 `https://ip.skk.moe/` 并提供截图。',
          ],
        },
        {
          title: '打不开或请求慢的 URL 如何获取',
          items: [
            '打不开的域名或慢请求，请复制浏览器地址栏中 URL 的域名。',
            '打开控制台 Network 面板，按 Time 排序，复制耗时长请求 URL 的域名。',
          ],
        },
        {
          title: '域名解析与链路信息',
          items: [
            'Windows：打开终端，执行 `nslookup [问题域名]`、`ping [问题域名]`、`tracert [问题域名]`。',
            'Mac：打开终端，执行 `dig [问题域名]`、`ping [问题域名]`、`traceroute [问题域名]`。',
            '详情可见文档：[网络信息收集说明](https://bytedance.larkoffice.com/docx/FOmKdpdCfoIl4WxV8eqc37BOnO1)',
          ],
        },
        {
          title: 'Wireshark 抓包文件',
          items: [
            '打开 Wireshark，选择当前正在使用的网络网卡开始抓包。',
            '复现打不开或请求慢的问题后停止抓包。',
            '保存为 `.pcapng` 文件，并和问题域名、复现时间点一起提供。',
          ],
        },
      ],
      sensitivity: 'medium',
      optional: true,
    },
  ];
}

function dedupeMissingInfo(items: MissingInfoItem[], limit = 6): MissingInfoItem[] {
  const seen = new Set<string>();
  const result: MissingInfoItem[] = [];
  for (const item of items) {
    const key = `${item.title}|${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function buildActionGroups(cards: DiagnosticCard[], _missingInfo: MissingInfoItem[]): ActionGroup[] {
  const grouped = new Map<DiagnosticRole | 'collect', FinalAction[]>();
  buildNetErrorKnowledgeActionGroups(cards).forEach(group => {
    grouped.set(group.role, group.actions);
  });

  cards.forEach(card => {
    card.actions.forEach((action, index) => {
      if (isCollectionAction(action)) return;
      const list = grouped.get(action.role) || [];
      const next = toFinalAction(action, card.id, list.length + index + 1);
      if (!list.some(item => item.title === next.title && item.command === next.command)) {
        list.push(next);
      }
      grouped.set(action.role, list);
    });
  });

  return Array.from(grouped.entries())
    .map(([role, actions]) => ({
      role,
      title: ROLE_LABELS[role],
      actions: actions.slice(0, 5),
      priority: ROLE_PRIORITY[role],
    }))
    .filter(group => group.actions.length > 0)
    .sort((a, b) => a.priority - b.priority);
}

function buildCluster(
  category: DiagnosticCategory,
  cards: DiagnosticCard[],
  mode: FinalDiagnosisMode,
  summary: DiagnosisSummary
): RootCauseCluster {
  const sortedCards = [...cards].sort((a, b) => scoreCard(b, summary) - scoreCard(a, summary));
  const primary = sortedCards[0];
  const score = sortedCards.reduce((max, card) => Math.max(max, scoreCard(card, summary)), 0);
  const actions = sortedCards.flatMap((card, cardIndex) =>
    card.actions.map((action, actionIndex) => toFinalAction(action, card.id, cardIndex * 10 + actionIndex + 1))
  );
  const keyEvidence = sortedCards.flatMap(card => card.evidence.map(toFinalEvidence)).slice(0, 5);

  return {
    id: `cluster-${category}`,
    category,
    title: `${CATEGORY_LABELS[category]}类线索`,
    kind: determineConclusionKind(primary, mode, summary),
    summary: primary.conclusion,
    cards: sortedCards,
    keyEvidence,
    actions,
    affectedRequestCount: sortedCards.reduce((sum, card) => sum + (card.scope.affectedRequestCount || 0), 0),
    affectedDomainCount: uniq(sortedCards.map(card => card.scope.affectedDomainCount || 0).filter(Boolean)).reduce((sum, count) => sum + count, 0),
    confidence: highestConfidence(sortedCards),
    score,
  };
}

function buildConclusion(
  cluster: RootCauseCluster,
  mode: FinalDiagnosisMode,
  summary: DiagnosisSummary,
  displayRank: number,
  missingInfo: MissingInfoItem[]
): FinalConclusion {
  const primary = cluster.cards[0];
  const relatedMissing = missingInfo
    .filter(item => item.id.includes(primary.id) || item.id.startsWith(mode) || item.id.startsWith(primary.source))
    .slice(0, 3);
  const primaryAction = cluster.actions.find(action => action.sourceCardId === primary.id) || cluster.actions[0];

  return {
    id: `final-${mode}-${primary.id}`,
    kind: cluster.kind,
    source: primary.source,
    category: cluster.category,
    title: primary.title,
    problem: primary.conclusion,
    reason: primary.evidence.length > 0
      ? primary.evidence.slice(0, 3).map(e => `${e.label}：${e.value}`).join('；')
      : primary.conclusion,
    impact: buildImpact(primary),
    confidence: primary.confidence,
    confidenceText: CONFIDENCE_TEXT[primary.confidence],
    primaryAction,
    keyEvidence: primary.evidence.slice(0, 3).map(toFinalEvidence),
    missingInfo: relatedMissing,
    relatedCardIds: cluster.cards.map(card => card.id),
    score: cluster.score,
    displayRank,
    userFacingSummary: buildUserFacingSummary(primary, cluster.kind, mode),
  };
}

function buildUserFacingSummary(
  card: DiagnosticCard,
  kind: FinalConclusionKind,
  mode: FinalDiagnosisMode
): string {
  if (kind === 'confirmed') return `已确认：${card.title}`;
  if (kind === 'highly-likely') return `高度疑似：${card.title}`;
  if (kind === 'needs-more-data') return `需要补充采集：${card.title}`;
  if (mode === 'har') return `仅现象：${card.title}`;
  return card.title;
}

function buildExecutiveSummary(summary: FinalDiagnosisSummary): string {
  if (summary.headline.length === 0) return '当前文件没有生成明确诊断结论，请查看采集质量和完整报告。';
  const first = summary.headline[0];
  const action = first.primaryAction ? `建议先做：${first.primaryAction.title}。` : '';
  return `${first.userFacingSummary}。${first.impact}。置信度：${first.confidenceText}。${action}`;
}

export function buildFinalDiagnosisSummary(
  diagnosisSummary: DiagnosisSummary,
  mode: FinalDiagnosisMode
): FinalDiagnosisSummary {
  const cards = diagnosisSummary.cards || [];
  const qualityMissing = buildMissingInfoFromQuality(diagnosisSummary.quality);

  if (cards.length === 0) {
    const missingInfo = dedupeMissingInfo([
      ...qualityMissing,
      {
        id: `${mode}-empty-cards`,
        title: '未生成明确诊断卡',
        reason: '当前文件没有检测到足够明确的异常线索，或采集内容不足以支持结论',
        recommendation: '如问题仍可复现，建议同时采集 HAR 与 NetLog，并记录问题时间点、网络环境、是否开启代理/VPN',
        sensitivity: 'low',
        optional: false,
      },
    ]);
    const emptySummary: FinalDiagnosisSummary = {
      mode,
      status: 'insufficient-data',
      headline: [],
      rootCauseClusters: [],
      actionPlan: buildActionGroups([], missingInfo),
      missingInfo,
      expertCards: [],
      executiveSummary: '',
      fallbackReason: '没有可聚合的诊断卡',
    };
    return { ...emptySummary, executiveSummary: buildExecutiveSummary(emptySummary) };
  }

  const sortedExpertCards = [...cards].sort((a, b) => scoreCard(b, diagnosisSummary) - scoreCard(a, diagnosisSummary));
  const preliminaryMissing = dedupeMissingInfo([
    ...qualityMissing,
    ...buildLimitationMissingInfo(sortedExpertCards.slice(0, 6)),
    ...buildConflictMissingInfo(diagnosisSummary),
    ...buildCommonNetworkInfoMissingInfo(),
  ]);

  const byCategory = new Map<DiagnosticCategory, DiagnosticCard[]>();
  sortedExpertCards.forEach(card => {
    const list = byCategory.get(card.category) || [];
    list.push(card);
    byCategory.set(card.category, list);
  });

  const clusters = Array.from(byCategory.entries())
    .map(([category, clusterCards]) => buildCluster(category, clusterCards, mode, diagnosisSummary))
    .sort((a, b) => b.score - a.score);

  const modeMissing = buildModeMissingInfo(mode, []);
  const missingInfo = dedupeMissingInfo([...preliminaryMissing, ...modeMissing]);
  const headline = clusters
    .filter((cluster, index) => index === 0 || cluster.kind !== clusters[0].kind || cluster.category !== clusters[0].category)
    .slice(0, 3)
    .map((cluster, index) => buildConclusion(cluster, mode, diagnosisSummary, index + 1, missingInfo));

  const finalMissingInfo = dedupeMissingInfo([
    ...preliminaryMissing,
    ...buildModeMissingInfo(mode, headline),
    ...buildCommonNetworkInfoMissingInfo(),
  ]);

  const status: FinalDiagnosisSummary['status'] = headline.some(item => item.kind === 'confirmed' || item.kind === 'highly-likely')
    ? 'has-conclusion'
    : headline.some(item => item.kind === 'symptom-only')
      ? 'limited-conclusion'
      : 'insufficient-data';

  const finalSummary: FinalDiagnosisSummary = {
    mode,
    status,
    headline: headline.map(item => ({
      ...item,
      missingInfo: finalMissingInfo
        .filter(info => info.id.includes(item.category) || info.id.startsWith(mode) || item.kind !== 'confirmed')
        .slice(0, 3),
    })),
    rootCauseClusters: clusters,
    actionPlan: buildActionGroups(sortedExpertCards, finalMissingInfo),
    missingInfo: finalMissingInfo,
    expertCards: sortedExpertCards,
    executiveSummary: '',
  };

  return {
    ...finalSummary,
    executiveSummary: buildExecutiveSummary(finalSummary),
  };
}

export const __finalSummaryTestUtils = {
  scoreCard,
  determineConclusionKind,
};
