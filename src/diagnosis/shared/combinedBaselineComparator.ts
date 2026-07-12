import type { HarAnalysisResult } from '../../harParser';
import type { AnalysisResult } from '../../parsers/netlog/parser';
import type { DiagnosticCard } from './types';
import type { FinalDiagnosisSummary } from './finalSummaryTypes';
import { buildTimeAlignmentContext } from './timeAlignment';
import { correlateHarRequestsToNetlog, summarizeRequestCorrelations } from './requestCorrelation';

export interface CombinedBaselineInput {
  har: HarAnalysisResult;
  netlog: AnalysisResult;
  finalSummary?: FinalDiagnosisSummary;
}

function safeHostPath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname || '/'}`;
  } catch {
    return undefined;
  }
}

function requestKeySet(har: HarAnalysisResult): Set<string> {
  return new Set(har.entries.map(entry => `${entry.method.toUpperCase()} ${safeHostPath(entry.url) || entry.domain || ''}`).filter(Boolean));
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const common = [...a].filter(item => b.has(item)).length;
  return common / Math.min(a.size, b.size);
}

function relationStats(input: CombinedBaselineInput) {
  const context = buildTimeAlignmentContext(input.har.entries, input.netlog.urlRequests, input.netlog.netlogClockContext);
  return summarizeRequestCorrelations(correlateHarRequestsToNetlog(input.har.entries, input.netlog.urlRequests, context));
}

function episodeCount(input: CombinedBaselineInput): number {
  return input.finalSummary?.rootCauseClusters.length || 0;
}

function topConclusionKeys(input: CombinedBaselineInput): string[] {
  return (input.finalSummary?.headline || []).map(item => {
    const safeTitle = item.title.replace(/https?:\/\/[^\s，。；]+/g, value => {
      try {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname || '/'}`;
      } catch {
        return value.split(/[?#]/, 1)[0];
      }
    });
    return `${item.category}:${item.kind}:${safeTitle}`;
  });
}

function incomplete(input: CombinedBaselineInput): boolean {
  return Boolean(input.netlog.largeFileMode?.truncatedEventsPreview || input.netlog.largeFileMode?.reachedEventsEnd === false);
}

export function compareCombinedBaselines(baseline: CombinedBaselineInput, current: CombinedBaselineInput): DiagnosticCard[] {
  const baselineKeys = requestKeySet(baseline.har);
  const currentKeys = requestKeySet(current.har);
  const overlap = overlapRatio(baselineKeys, currentKeys);
  const isIncomplete = incomplete(baseline) || incomplete(current);

  if (overlap === 0) {
    return [{
      id: 'combined-baseline-no-common-requests',
      source: 'combined',
      category: 'unknown',
      severity: 'info',
      confidence: 'low',
      title: '正常/异常联合对比无共同请求',
      conclusion: 'HAR 请求集合没有共同 method+host+path，不能直接比较关联率、覆盖率或 Top 结论。',
      scope: { type: 'unknown', summary: '无共同请求' },
      evidence: [
        { label: 'baseline 请求 key 数', value: String(baselineKeys.size), source: 'derived' },
        { label: 'current 请求 key 数', value: String(currentKeys.size), source: 'derived' },
      ],
      limitations: ['无共同请求/域名时不伪造对比。'],
      actions: [{ role: 'user', title: '重新采集可比样本', detail: '请按相同账号、页面和操作路径重新同时采集 HAR 与 NetLog。' }],
    }];
  }

  const baselineRelation = relationStats(baseline);
  const currentRelation = relationStats(current);
  const baselineEpisodes = episodeCount(baseline);
  const currentEpisodes = episodeCount(current);
  const newTopConclusions = topConclusionKeys(current).filter(item => !topConclusionKeys(baseline).includes(item));
  const cards: DiagnosticCard[] = [];

  if (currentRelation.strongRate + 0.2 < baselineRelation.strongRate) {
    cards.push({
      id: 'combined-baseline-correlation-regression',
      source: 'combined',
      category: 'quality',
      severity: isIncomplete ? 'info' : 'warning',
      confidence: isIncomplete ? 'low' : 'medium',
      title: '异常样本 HAR/NetLog 关联率下降',
      conclusion: '异常环境的 HAR 与 NetLog 强关联率低于正常环境，联合诊断需要降级看待。',
      scope: { type: 'unknown', summary: '关联率下降' },
      evidence: [
        { label: 'baseline 强关联率', value: `${Math.round(baselineRelation.strongRate * 100)}%`, source: 'derived' },
        { label: 'current 强关联率', value: `${Math.round(currentRelation.strongRate * 100)}%`, source: 'derived' },
        { label: '共同请求覆盖', value: `${Math.round(overlap * 100)}%`, source: 'derived' },
      ],
      limitations: isIncomplete ? ['NetLog 采集不完整，关联率下降不能生成高置信退化结论。'] : ['关联率下降是证据质量变化，不是根因。'],
      actions: [{ role: 'user', title: '重新同时采集', detail: '确保 HAR 与 NetLog 在同一次复现窗口内开始和结束。' }],
    });
  }

  if (currentEpisodes > baselineEpisodes) {
    cards.push({
      id: 'combined-baseline-new-episodes',
      source: 'combined',
      category: 'unknown',
      severity: isIncomplete ? 'info' : 'warning',
      confidence: isIncomplete ? 'low' : 'medium',
      title: '异常样本新增故障 episode',
      conclusion: '异常环境的 Top episode 数量高于正常环境，说明异常样本新增了聚集性问题事件。',
      scope: { type: 'multi-domain', summary: `episode ${baselineEpisodes} → ${currentEpisodes}` },
      evidence: [
        { label: 'baseline episode 数', value: String(baselineEpisodes), source: 'derived' },
        { label: 'current episode 数', value: String(currentEpisodes), source: 'derived' },
      ],
      limitations: isIncomplete ? ['基线采集不完整时不生成高置信退化结论。'] : ['episode 增加表示异常环境新增现象，不直接等同根因。'],
      actions: [{ role: 'user', title: '打开异常样本 Top episode', detail: '优先查看异常样本第一屏的主 episode 和关键证据链。' }],
    });
  }

  if (newTopConclusions.length > 0) {
    cards.push({
      id: 'combined-baseline-new-top-conclusions',
      source: 'combined',
      category: 'unknown',
      severity: isIncomplete ? 'info' : 'warning',
      confidence: isIncomplete ? 'low' : 'medium',
      title: '异常样本新增 Top 结论',
      conclusion: '异常环境出现正常环境没有的 Top 结论。',
      scope: { type: 'unknown', summary: `${newTopConclusions.length} 个新增 Top 结论` },
      evidence: newTopConclusions.slice(0, 5).map((item, index) => ({ label: `新增结论 ${index + 1}`, value: item, source: 'derived' })),
      limitations: ['Top 结论变化是诊断输出差异，需要回到两侧证据确认。'],
      actions: [{ role: 'user', title: '对照两侧证据', detail: '打开正常/异常两侧的 Top 结论、episode 和原始证据链进行比对。' }],
    });
  }

  if (cards.length === 0) {
    return [{
      id: 'combined-baseline-no-regression',
      source: 'combined',
      category: 'unknown',
      severity: 'info',
      confidence: isIncomplete ? 'low' : 'medium',
      title: '联合对比未发现新增退化',
      conclusion: '关联率、episode 数量和 Top 结论未出现明显新增差异。',
      scope: { type: 'unknown', summary: '未发现联合退化' },
      evidence: [
        { label: '共同请求覆盖', value: `${Math.round(overlap * 100)}%`, source: 'derived' },
        { label: 'baseline 强关联率', value: `${Math.round(baselineRelation.strongRate * 100)}%`, source: 'derived' },
        { label: 'current 强关联率', value: `${Math.round(currentRelation.strongRate * 100)}%`, source: 'derived' },
      ],
      limitations: isIncomplete ? ['采集不完整，不能把“未发现差异”作为强反证。'] : ['无联合退化不代表无问题，需要结合单源 HAR/NetLog 对比。'],
      actions: [],
    }];
  }

  return cards;
}
