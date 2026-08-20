// ============================================================
// 正常 / 异常样本 A-B 对比
// 用户上传两个同源文件（baseline + current），自动 diff 并生成对比诊断卡片
// ============================================================

import { getHarResponseStatus, type HarAnalysisResult, type HarRequestEntry } from '../../harParser';
import type {
  DiagnosticCard,
  DiagnosticAction,
  DiagnosticEvidence,
  DiagnosisSummary,
  CollectionQuality,
} from './types';
import { buildHarNavigationTarget } from './navigation';
import { getHarTimingPhase, normalizeHarTiming, type HarDisplayTimingPhaseKey } from './harTimingNormalization';

// ========== 对比维度 ==========

type DiffCategory = 'dns' | 'connect' | 'tls' | 'server' | 'performance' | 'unknown';
type PhaseKey = HarDisplayTimingPhaseKey;

interface RequestShape {
  host: string;
  path: string;
  method: string;
  statusClass: string;
  protocol: string;
  cacheSource: string;
  requestIds: number[];
}

const COMPARED_PHASES: { key: PhaseKey; category: DiffCategory; label: string }[] = [
  { key: 'dns', category: 'dns', label: 'DNS' },
  { key: 'tcp', category: 'connect', label: 'TCP 连接' },
  { key: 'ssl', category: 'tls', label: 'TLS 握手' },
  { key: 'wait', category: 'server', label: 'Waiting（浏览器侧等待响应）' },
  { key: 'receive', category: 'performance', label: '下载接收' },
  { key: 'queueing', category: 'performance', label: '浏览器排队' },
  { key: 'stalled', category: 'performance', label: '连接等待' },
];

interface PhaseDiff {
  key: PhaseKey;
  label: string;
  category: DiffCategory;
  baselineAvg: number;
  currentAvg: number;
  deltaMs: number;
}

interface DomainDiff {
  host: string;
  baselineAvgTime: number;
  currentAvgTime: number;
  deltaMs: number;
  deltaPercent: number;
  baselineCount: number;
  currentCount: number;
  baselineFailedCount: number;
  currentFailedCount: number;
  currentRequestIds: number[];
  phaseDiffs: PhaseDiff[];
  category: DiffCategory;
  severity: 'critical' | 'warning' | 'info';
}

function groupByHost(entries: HarRequestEntry[]): Map<string, HarRequestEntry[]> {
  const map = new Map<string, HarRequestEntry[]>();
  for (const entry of entries) {
    let host = entry.domain;
    if (!host || host === '-') {
      try { host = new URL(entry.url).hostname; } catch { continue; }
    }
    if (!map.has(host)) map.set(host, []);
    map.get(host)!.push(entry);
  }
  return map;
}

function safeRequestShape(entry: HarRequestEntry): RequestShape {
  let host = entry.domain;
  let path = '/';
  try {
    const parsed = new URL(entry.url);
    host = host || parsed.hostname;
    path = parsed.pathname || '/';
  } catch {
    path = entry.name || '/';
  }
  const status = getHarResponseStatus(entry);
  const statusClass = status === undefined
    ? 'status-unavailable'
    : status === 0
      ? 'status-0'
      : `${Math.floor(status / 100)}xx`;
  const cacheInfo = entry.cacheInfo;
  const cacheSource = cacheInfo?.source || (cacheInfo?.fromCache ? 'cache' : 'network');
  return {
    host: host || '',
    path,
    method: (entry.method || 'GET').toUpperCase(),
    statusClass,
    protocol: entry.protocol || entry.connectionInfo?.protocol || 'unknown',
    cacheSource,
    requestIds: [entry.id],
  };
}

function groupByRequestKey(entries: HarRequestEntry[]): Map<string, RequestShape[]> {
  const map = new Map<string, RequestShape[]>();
  entries.forEach(entry => {
    const shape = safeRequestShape(entry);
    if (!shape.host) return;
    const key = `${shape.method} ${shape.host}${shape.path}`;
    map.set(key, [...(map.get(key) || []), shape]);
  });
  return map;
}

function dominant<T extends string>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function avgTiming(entries: HarRequestEntry[], phase: PhaseKey): number {
  const values = entries
    .map(entry => getHarTimingPhase(normalizeHarTiming(entry), phase))
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.available && item.durationMs > 0))
    .map(item => item.durationMs);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function avgTotal(entries: HarRequestEntry[]): number {
  if (entries.length === 0) return 0;
  return entries.reduce((sum, entry) => sum + Math.max(entry.time, 0), 0) / entries.length;
}

function computePhaseDiffs(
  baselineEntries: HarRequestEntry[],
  currentEntries: HarRequestEntry[]
): PhaseDiff[] {
  return COMPARED_PHASES
    .map(phase => {
      const baselineAvg = avgTiming(baselineEntries, phase.key);
      const currentAvg = avgTiming(currentEntries, phase.key);
      return {
        key: phase.key,
        label: phase.label,
        category: phase.category,
        baselineAvg: Math.round(baselineAvg),
        currentAvg: Math.round(currentAvg),
        deltaMs: Math.round(currentAvg - baselineAvg),
      };
    })
    .sort((a, b) => b.deltaMs - a.deltaMs);
}

function classifyDiff(phaseDiffs: PhaseDiff[]): DiffCategory {
  const positive = phaseDiffs.filter(p => p.deltaMs > 0);
  if (positive.length === 0) return 'unknown';
  return positive[0].category;
}

function computeSeverity(deltaPercent: number, deltaMs: number, newFailures: number): DomainDiff['severity'] {
  if (newFailures > 0 || deltaPercent >= 200 || deltaMs >= 3000) return 'critical';
  if (deltaPercent >= 50 || deltaMs >= 800) return 'warning';
  return 'info';
}

function categoryLabel(cat: DiffCategory): string {
  const map: Record<DiffCategory, string> = {
    dns: 'DNS 解析',
    connect: 'TCP 连接',
    tls: 'TLS 握手',
    server: '服务端响应',
    performance: '前端/传输性能',
    unknown: '综合',
  };
  return map[cat];
}

function buildPhaseEvidence(diff: DomainDiff): DiagnosticEvidence[] {
  const topPhases = diff.phaseDiffs.filter(p => p.deltaMs > 50).slice(0, 4);
  if (topPhases.length === 0) return [];
  return topPhases.map((phase, i) => ({
    label: `阶段退化 ${i + 1}`,
    value: `${phase.label}: ${phase.baselineAvg}ms → ${phase.currentAvg}ms（+${phase.deltaMs}ms）`,
    source: 'derived' as const,
  }));
}

function buildDiffActions(diff: DomainDiff): DiagnosticAction[] {
  const actions: DiagnosticAction[] = [];

  switch (diff.category) {
    case 'dns':
      actions.push({
        role: 'user',
        title: 'DNS 解析验证',
        detail: '对比正常/异常环境下的 DNS 解析结果',
        command: `nslookup ${diff.host}`,
        expectedResult: '异常环境应与正常环境解析到相同或同段 IP',
        nextIfFailed: '尝试切换 DNS 后重新解析',
      });
      break;
    case 'connect':
      actions.push({
        role: 'user',
        title: '连接耗时对比',
        detail: '用 curl 分别在正常/异常环境测试 TCP 连接耗时',
        command: `curl -v -o /dev/null -s -w "connect=%{time_connect}\\n" https://${diff.host}`,
        expectedResult: '异常环境 connect 耗时不应显著高于正常环境',
      });
      break;
    case 'tls':
      actions.push({
        role: 'it',
        title: 'TLS 链路检查',
        detail: '检查是否有 TLS Inspection、代理或中间人证书介入',
        command: `openssl s_client -connect ${diff.host}:443 -servername ${diff.host}`,
      });
      break;
    case 'server':
      actions.push({
        role: 'backend',
        title: '服务端日志查询',
        detail: '结合 HAR 中的 x-tt-logid、接口路径和异常时间段查询服务端处理耗时',
      });
      break;
    case 'performance':
      actions.push({
        role: 'frontend',
        title: '检查资源体积和缓存策略',
        detail: '对比异常样本中资源大小、压缩、缓存命中和重复请求，确认是否由前端资源或下载阶段造成退化',
      });
      break;
    default:
      actions.push({
        role: 'user',
        title: '综合排查',
        detail: '建议结合 DNS、连接、TLS、服务端和下载阶段多个维度综合排查',
      });
  }

  if (diff.currentFailedCount > diff.baselineFailedCount) {
    actions.push({
      role: 'backend',
      title: '优先排查新增失败请求',
      detail: `异常样本比正常样本多 ${diff.currentFailedCount - diff.baselineFailedCount} 个失败请求，应优先核对状态码、错误响应和服务端日志`,
    });
  }

  return actions;
}

function buildRequestShapeDiffCards(
  baseline: HarAnalysisResult,
  current: HarAnalysisResult
): DiagnosticCard[] {
  const baselineByKey = groupByRequestKey(baseline.entries);
  const currentByKey = groupByRequestKey(current.entries);
  const commonKeys = [...baselineByKey.keys()].filter(key => currentByKey.has(key));
  if (commonKeys.length === 0) return [];

  const cards: DiagnosticCard[] = [];
  const statusChanges: Array<{ key: string; baseline: string; current: string; ids: number[] }> = [];
  const protocolChanges: Array<{ key: string; baseline: string; current: string; ids: number[] }> = [];
  const cacheChanges: Array<{ key: string; baseline: string; current: string; ids: number[] }> = [];

  commonKeys.forEach(key => {
    const baselineShapes = baselineByKey.get(key)!;
    const currentShapes = currentByKey.get(key)!;
    const ids = currentShapes.flatMap(item => item.requestIds);
    const baselineStatus = dominant(baselineShapes.map(item => item.statusClass));
    const currentStatus = dominant(currentShapes.map(item => item.statusClass));
    const baselineProtocol = dominant(baselineShapes.map(item => item.protocol));
    const currentProtocol = dominant(currentShapes.map(item => item.protocol));
    const baselineCache = dominant(baselineShapes.map(item => item.cacheSource));
    const currentCache = dominant(currentShapes.map(item => item.cacheSource));

    if (baselineStatus && currentStatus && baselineStatus !== currentStatus) {
      statusChanges.push({ key, baseline: baselineStatus, current: currentStatus, ids });
    }
    if (baselineProtocol && currentProtocol && baselineProtocol !== currentProtocol) {
      protocolChanges.push({ key, baseline: baselineProtocol, current: currentProtocol, ids });
    }
    if (baselineCache && currentCache && baselineCache !== currentCache) {
      cacheChanges.push({ key, baseline: baselineCache, current: currentCache, ids });
    }
  });

  if (statusChanges.length > 0) {
    cards.push({
      id: 'baseline-status-class-changes',
      source: 'har',
      category: statusChanges.some(item => item.current === '5xx') ? 'server' : 'client',
      severity: statusChanges.some(item => item.current === '5xx' || item.current === 'status-0') ? 'critical' : 'warning',
      confidence: 'high',
      confidenceFactors: [{ label: '共同请求状态变化', impact: 'positive', detail: `${statusChanges.length} 个共同 method+host+path 状态类别变化` }],
      title: '异常样本出现共同请求状态变化',
      conclusion: '相同 method/host/path 在异常样本中的 HTTP 状态类别发生变化，这是新增差异，不等同于自动根因。',
      scope: { type: 'multi-domain', summary: `${statusChanges.length} 个共同请求状态变化`, affectedRequestCount: statusChanges.length },
      evidence: statusChanges.slice(0, 10).map((item, index) => ({
        label: `状态变化 ${index + 1}`,
        value: `${item.key}: ${item.baseline} → ${item.current}`,
        source: 'derived',
        requestIds: item.ids.slice(0, 5),
      })),
      limitations: ['差异本身不是根因，需要结合响应体、服务端日志或 NetLog 网络层证据判断。'],
      actions: [{
        role: 'backend',
        title: '核对状态变化请求',
        detail: '按共同请求 path、状态码和时间点查询服务端/网关日志。',
      }],
      relatedRequestIds: statusChanges.flatMap(item => item.ids).slice(0, 30),
    });
  }

  if (protocolChanges.length > 0) {
    cards.push({
      id: 'baseline-protocol-changes',
      source: 'har',
      category: 'protocol',
      severity: 'warning',
      confidence: 'medium',
      confidenceFactors: [{ label: '共同请求协议变化', impact: 'positive', detail: `${protocolChanges.length} 个共同请求协议不同` }],
      title: '异常样本出现协议变化',
      conclusion: '共同请求在异常样本中协议不同，可能是 HTTP/2、HTTP/3、QUIC 或代理/CDN 路径变化的线索。',
      scope: { type: 'multi-domain', summary: `${protocolChanges.length} 个共同请求协议变化`, affectedRequestCount: protocolChanges.length },
      evidence: protocolChanges.slice(0, 10).map((item, index) => ({
        label: `协议变化 ${index + 1}`,
        value: `${item.key}: ${item.baseline} → ${item.current}`,
        source: 'derived',
        requestIds: item.ids.slice(0, 5),
      })),
      limitations: ['协议变化是路径差异线索，不单独证明协议故障。'],
      actions: [{
        role: 'it',
        title: '核对协议和代理/CDN 路径',
        detail: '检查异常环境是否经过不同代理、CDN、HTTP/2/HTTP/3/QUIC 策略。',
      }],
      relatedRequestIds: protocolChanges.flatMap(item => item.ids).slice(0, 30),
    });
  }

  if (cacheChanges.length > 0) {
    cards.push({
      id: 'baseline-cache-source-changes',
      source: 'har',
      category: 'cache',
      severity: 'info',
      confidence: 'medium',
      confidenceFactors: [{ label: '共同请求缓存来源变化', impact: 'neutral', detail: `${cacheChanges.length} 个共同请求缓存来源不同` }],
      title: '异常样本出现缓存来源变化',
      conclusion: '共同请求在正常/异常样本中的缓存来源不同，这可能解释耗时变化，但缓存命中本身不是性能问题。',
      scope: { type: 'multi-domain', summary: `${cacheChanges.length} 个共同请求缓存来源变化`, affectedRequestCount: cacheChanges.length },
      evidence: cacheChanges.slice(0, 10).map((item, index) => ({
        label: `缓存变化 ${index + 1}`,
        value: `${item.key}: ${item.baseline} → ${item.current}`,
        source: 'derived',
        requestIds: item.ids.slice(0, 5),
      })),
      limitations: ['缓存差异可能来自正常缓存状态变化或采集步骤不同，不能直接作为根因。'],
      actions: [{
        role: 'frontend',
        title: '核对缓存策略',
        detail: '对比 Cache-Control、Service Worker、CDN 缓存命中和刷新方式。',
      }],
      relatedRequestIds: cacheChanges.flatMap(item => item.ids).slice(0, 30),
    });
  }

  return cards;
}

// ========== 核心对比函数 ==========

export function compareBaselines(
  baseline: HarAnalysisResult,
  current: HarAnalysisResult
): DiagnosticCard[] {
  const cards: DiagnosticCard[] = [];
  const baselineByHost = groupByHost(baseline.entries);
  const currentByHost = groupByHost(current.entries);
  const requestShapeCards = buildRequestShapeDiffCards(baseline, current);

  const commonHosts = [...baselineByHost.keys()].filter(h => currentByHost.has(h));
  const currentOnlyHosts = [...currentByHost.keys()].filter(h => !baselineByHost.has(h));
  const baselineOnlyHosts = [...baselineByHost.keys()].filter(h => !currentByHost.has(h));

  if (commonHosts.length === 0) {
    return [{
      id: 'baseline-no-overlap',
      source: 'har',
      category: 'unknown',
      severity: 'info',
      confidence: 'low',
      confidenceFactors: [
        { label: '无共同域名', impact: 'negative', detail: '两个样本没有可直接对比的 host，A-B 结论不可用' },
      ],
      title: '正常/异常样本无共同域名',
      conclusion: '两个文件的请求域名完全不重叠，无法进行有效对比',
      scope: { type: 'unknown', summary: '无共同域名' },
      evidence: [
        { label: 'baseline 域名数', value: String(baselineByHost.size), source: 'har' },
        { label: 'current 域名数', value: String(currentByHost.size), source: 'har' },
      ],
      actions: [{
        role: 'user',
        title: '确认文件来源',
        detail: '请确保两个文件采集自同一应用/页面，且操作步骤一致',
      }],
    }];
  }

  const currentOnlyProblemHosts = currentOnlyHosts
    .map(host => ({ host, entries: currentByHost.get(host)! }))
    .filter(item => item.entries.some(e => e.isFailed || e.isSlow || e.status >= 400))
    .slice(0, 10);

  if (currentOnlyProblemHosts.length > 0) {
    const affectedRequestIds = currentOnlyProblemHosts.flatMap(item => item.entries.map(e => e.id)).slice(0, 30);
    cards.push({
      id: 'baseline-current-only-hosts',
      source: 'har',
      category: 'performance',
      severity: currentOnlyProblemHosts.some(item => item.entries.some(e => e.isFailed || e.status >= 500)) ? 'warning' : 'info',
      confidence: 'medium',
      confidenceFactors: [
        { label: '异常样本新增域名', impact: 'positive', detail: `${currentOnlyProblemHosts.length} 个只在异常样本出现的异常/慢域名` },
        { label: '场景一致性限制', impact: 'negative', detail: '新增域名可能来自不同操作路径，需确认两次采集步骤一致' },
      ],
      title: `异常样本新增问题域名 (${currentOnlyProblemHosts.length} 个)`,
      conclusion: '异常样本中出现了正常样本没有覆盖的慢请求或失败域名，这可能代表异常路径新增依赖、降级链路或采集步骤不一致',
      scope: { type: 'multi-domain', summary: `新增 ${currentOnlyProblemHosts.length} 个问题域名`, affectedDomainCount: currentOnlyProblemHosts.length },
      evidence: currentOnlyProblemHosts.map((item, i) => ({
        label: `新增域名 ${i + 1}`,
        value: `${item.host} · ${item.entries.length} 个请求 · 失败 ${item.entries.filter(e => e.isFailed || e.status >= 400).length} 个 · 慢请求 ${item.entries.filter(e => e.isSlow).length} 个`,
        source: 'derived',
        requestIds: item.entries.map(e => e.id).slice(0, 5),
      })),
      actions: [
        {
          role: 'frontend',
          title: '核对异常路径新增依赖',
          detail: '确认异常环境是否加载了额外 SDK、埋点、CDN、灰度资源或降级域名',
        },
        {
          role: 'user',
          title: '确认 A-B 操作步骤一致',
          detail: '重新按完全相同步骤采集正常/异常样本，避免不同页面路径造成误判',
        },
      ],
      relatedRequestIds: affectedRequestIds,
      navigationTarget: buildHarNavigationTarget('performance', { requestIds: affectedRequestIds }),
    });
  }

  const diffs: DomainDiff[] = [];
  for (const host of commonHosts) {
    const bEntries = baselineByHost.get(host)!;
    const cEntries = currentByHost.get(host)!;
    const bAvg = avgTotal(bEntries);
    const cAvg = avgTotal(cEntries);
    const deltaMs = cAvg - bAvg;
    const deltaPercent = bAvg > 0 ? (deltaMs / bAvg) * 100 : 0;
    const baselineFailedCount = bEntries.filter(e => e.isFailed || e.status >= 400).length;
    const currentFailedCount = cEntries.filter(e => e.isFailed || e.status >= 400).length;
    const newFailures = Math.max(0, currentFailedCount - baselineFailedCount);

    if (deltaMs > 200 || newFailures > 0) {
      const phaseDiffs = computePhaseDiffs(bEntries, cEntries);
      const category = classifyDiff(phaseDiffs);
      diffs.push({
        host,
        baselineAvgTime: Math.round(bAvg),
        currentAvgTime: Math.round(cAvg),
        deltaMs: Math.round(deltaMs),
        deltaPercent: Math.round(deltaPercent),
        baselineCount: bEntries.length,
        currentCount: cEntries.length,
        baselineFailedCount,
        currentFailedCount,
        currentRequestIds: cEntries.map(e => e.id),
        phaseDiffs,
        category,
        severity: computeSeverity(deltaPercent, deltaMs, newFailures),
      });
    }
  }

  if (diffs.length === 0) {
    if (requestShapeCards.length > 0) return cards.concat(requestShapeCards);
    return [{
      id: 'baseline-no-regression',
      source: 'har',
      category: 'performance',
      severity: 'info',
      confidence: 'high',
      confidenceFactors: [
        { label: '共同域名覆盖', impact: 'positive', detail: `已对比 ${commonHosts.length} 个共同域名` },
        ...(currentOnlyHosts.length === 0 ? [{ label: '域名集合一致', impact: 'positive' as const, detail: '异常样本没有新增域名' }] : []),
      ],
      title: '正常/异常样本对比无明显退化',
      conclusion: `${commonHosts.length} 个共同域名中，未发现平均耗时退化超过 200ms 或新增失败的情况`,
      scope: { type: 'multi-domain', summary: `对比了 ${commonHosts.length} 个域名` },
      evidence: [
        { label: '共同域名数', value: String(commonHosts.length), source: 'derived' },
        { label: '异常样本新增域名', value: String(currentOnlyHosts.length), source: 'derived' },
        { label: '正常样本独有域名', value: String(baselineOnlyHosts.length), source: 'derived' },
      ],
      actions: [],
    }];
  }

  diffs.sort((a, b) => {
    const severityWeight = { critical: 3, warning: 2, info: 1 };
    return severityWeight[b.severity] - severityWeight[a.severity] || b.deltaMs - a.deltaMs;
  });

  for (const diff of diffs.slice(0, 10)) {
    const newFailureCount = Math.max(0, diff.currentFailedCount - diff.baselineFailedCount);
    const relatedRequestIds = diff.currentRequestIds.slice(0, 30);
    cards.push({
      id: `baseline-diff-${diff.host}`,
      source: 'har',
      category: diff.category,
      severity: diff.severity,
      confidence: newFailureCount > 0 || diff.phaseDiffs.some(p => p.deltaMs > 300) ? 'high' : 'medium',
      confidenceFactors: [
        { label: '同域名直接对比', impact: 'positive', detail: `正常 ${diff.baselineCount} 个请求，异常 ${diff.currentCount} 个请求` },
        ...(diff.phaseDiffs.some(p => p.deltaMs > 300) ? [{ label: '阶段退化明显', impact: 'positive' as const, detail: `最大阶段退化 ${diff.phaseDiffs[0].label} +${diff.phaseDiffs[0].deltaMs}ms` }] : []),
        ...(newFailureCount > 0 ? [{ label: '新增失败', impact: 'positive' as const, detail: `异常样本新增 ${newFailureCount} 个失败请求` }] : []),
      ],
      title: `${diff.host} 耗时退化 ${diff.deltaPercent}%`,
      conclusion: `该域名平均耗时从 ${diff.baselineAvgTime}ms 退化到 ${diff.currentAvgTime}ms（+${diff.deltaMs}ms），主因可能是 ${categoryLabel(diff.category)}`,
      scope: { type: 'single-domain', summary: `影响 ${diff.host}`, affectedRequestCount: diff.currentCount },
      evidence: [
        { label: '正常样本平均耗时', value: `${diff.baselineAvgTime}ms`, source: 'har' },
        { label: '异常样本平均耗时', value: `${diff.currentAvgTime}ms`, source: 'har', requestIds: relatedRequestIds },
        { label: '退化幅度', value: `+${diff.deltaMs}ms (+${diff.deltaPercent}%)`, source: 'derived' },
        { label: '疑似慢因阶段', value: categoryLabel(diff.category), source: 'derived' },
        ...(newFailureCount > 0 ? [{ label: '新增失败请求', value: `${newFailureCount} 个`, source: 'har' as const, requestIds: relatedRequestIds }] : []),
        ...buildPhaseEvidence(diff),
      ],
      actions: buildDiffActions(diff),
      limitations: ['基于域名粒度对比；若两次操作路径不同，新增请求或域名可能造成误判'],
      relatedRequestIds,
      navigationTarget: buildHarNavigationTarget(diff.category, { requestIds: relatedRequestIds }),
    });
  }

  return cards.concat(requestShapeCards);
}

function buildBaselineQuality(
  baseline: HarAnalysisResult,
  current: HarAnalysisResult,
  commonHosts: number,
  baselineHostCount: number,
  currentHostCount: number
): CollectionQuality {
  const issues: CollectionQuality['issues'] = [];
  const recommendations: string[] = [];
  const overlapRatio = Math.min(
    baselineHostCount > 0 ? commonHosts / baselineHostCount : 0,
    currentHostCount > 0 ? commonHosts / currentHostCount : 0
  );

  if (baseline.totalRequests < 5 || current.totalRequests < 5) {
    issues.push({
      type: 'insufficient_data',
      severity: 'warning',
      message: 'A-B 样本请求数偏少',
      detail: `baseline ${baseline.totalRequests} 个请求，current ${current.totalRequests} 个请求，可能不足以代表完整页面链路`,
    });
    recommendations.push('建议重新采集完整页面加载或完整问题复现流程');
  }

  if (overlapRatio > 0 && overlapRatio < 0.5) {
    issues.push({
      type: 'suspicious_pattern',
      severity: 'warning',
      message: '两份样本域名重叠率偏低',
      detail: `共同域名 ${commonHosts} 个，baseline 域名 ${baselineHostCount} 个，current 域名 ${currentHostCount} 个`,
    });
    recommendations.push('确认正常/异常样本来自同一页面、同一账号状态和同一操作路径');
  }

  if (baseline.repairInfo?.repaired || current.repairInfo?.repaired) {
    issues.push({
      type: 'suspicious_pattern',
      severity: 'info',
      message: '存在自动修复后的 HAR 样本',
      detail: '部分 HAR entry 可能被修复或丢弃，A-B 对比结论需结合修复率判断',
    });
  }

  return {
    source: 'har',
    isDiagnosable: baseline.totalRequests >= 3 && current.totalRequests >= 3 && commonHosts > 0,
    issues,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
  };
}

// ========== 对比汇总 ==========

export function buildBaselineCompareSummary(
  baseline: HarAnalysisResult,
  current: HarAnalysisResult
): DiagnosisSummary {
  const baselineByHost = groupByHost(baseline.entries);
  const currentByHost = groupByHost(current.entries);
  const commonHosts = [...baselineByHost.keys()].filter(h => currentByHost.has(h));
  const cards = compareBaselines(baseline, current);
  const quality = buildBaselineQuality(
    baseline,
    current,
    commonHosts.length,
    baselineByHost.size,
    currentByHost.size
  );
  const criticalCount = cards.filter(c => c.severity === 'critical').length;
  const warningCount = cards.filter(c => c.severity === 'warning').length;

  return {
    cards,
    quality,
    overallSeverity: criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'info',
    combinedConfidence: quality.isDiagnosable && quality.issues.length === 0 ? 'high' : quality.isDiagnosable ? 'medium' : 'low',
  };
}
