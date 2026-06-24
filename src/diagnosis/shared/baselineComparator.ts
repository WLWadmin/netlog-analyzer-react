/**
 * 正常 / 异常样本 A-B 对比
 * 用户上传两个同源文件（baseline + current），自动 diff 并生成对比诊断卡片
 */

import type { HarAnalysisResult, HarRequestEntry } from '../../harParser';
import type {
  DiagnosticCard,
  DiagnosticAction,
  DiagnosisSummary,
} from './types';

// ========== 对比维度 ==========

interface DomainDiff {
  host: string;
  baselineAvgTime: number;
  currentAvgTime: number;
  deltaMs: number;
  deltaPercent: number;
  baselineCount: number;
  currentCount: number;
  category: 'dns' | 'connect' | 'tls' | 'server' | 'performance' | 'unknown';
  severity: 'critical' | 'warning' | 'info';
}

function groupByHost(entries: HarRequestEntry[]): Map<string, HarRequestEntry[]> {
  const map = new Map<string, HarRequestEntry[]>();
  for (const entry of entries) {
    let host = '';
    try { host = new URL(entry.url).hostname; } catch { continue; }
    if (!map.has(host)) map.set(host, []);
    map.get(host)!.push(entry);
  }
  return map;
}

function avgTiming(entries: HarRequestEntry[], phase: keyof HarRequestEntry['timings']): number {
  const values = entries.map(e => Math.max(e.timings[phase], 0)).filter(v => v > 0);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function classifyDiff(
  baselineEntries: HarRequestEntry[],
  currentEntries: HarRequestEntry[]
): DomainDiff['category'] {
  const bDns = avgTiming(currentEntries, 'dns');
  const bConn = avgTiming(currentEntries, 'connect');
  const bSsl = avgTiming(currentEntries, 'ssl');
  const bWait = avgTiming(currentEntries, 'wait');
  const bRecv = avgTiming(currentEntries, 'receive');

  const phases: [DomainDiff['category'], number][] = [
    ['dns', bDns],
    ['connect', bConn],
    ['tls', bSsl],
    ['server', bWait],
    ['performance', bRecv],
  ];
  phases.sort((a, b) => b[1] - a[1]);
  return phases[0][0];
}

function computeSeverity(deltaPercent: number): DomainDiff['severity'] {
  if (deltaPercent >= 200) return 'critical';
  if (deltaPercent >= 50) return 'warning';
  return 'info';
}

// ========== 核心对比函数 ==========

export function compareBaselines(
  baseline: HarAnalysisResult,
  current: HarAnalysisResult
): DiagnosticCard[] {
  const cards: DiagnosticCard[] = [];
  const baselineByHost = groupByHost(baseline.entries);
  const currentByHost = groupByHost(current.entries);

  // 找共同 host
  const commonHosts = [...baselineByHost.keys()].filter(h => currentByHost.has(h));

  if (commonHosts.length === 0) {
    return [{
      id: 'baseline-no-overlap',
      source: 'har',
      category: 'unknown',
      severity: 'info',
      confidence: 'low',
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

  // 逐 host 对比
  const diffs: DomainDiff[] = [];
  for (const host of commonHosts) {
    const bEntries = baselineByHost.get(host)!;
    const cEntries = currentByHost.get(host)!;
    const bAvg = bEntries.reduce((a, e) => a + e.time, 0) / bEntries.length;
    const cAvg = cEntries.reduce((a, e) => a + e.time, 0) / cEntries.length;
    const deltaMs = cAvg - bAvg;
    const deltaPercent = bAvg > 0 ? (deltaMs / bAvg) * 100 : 0;

    if (deltaMs > 200) { // 只关注变慢 > 200ms 的情况
      const category = classifyDiff(bEntries, cEntries);
      diffs.push({
        host,
        baselineAvgTime: Math.round(bAvg),
        currentAvgTime: Math.round(cAvg),
        deltaMs: Math.round(deltaMs),
        deltaPercent: Math.round(deltaPercent),
        baselineCount: bEntries.length,
        currentCount: cEntries.length,
        category,
        severity: computeSeverity(deltaPercent),
      });
    }
  }

  if (diffs.length === 0) {
    return [{
      id: 'baseline-no-regression',
      source: 'har',
      category: 'performance',
      severity: 'info',
      confidence: 'high',
      title: '正常/异常样本对比无明显退化',
      conclusion: `${commonHosts.length} 个共同域名中，未发现平均耗时退化超过 200ms 的情况`,
      scope: { type: 'multi-domain', summary: `对比了 ${commonHosts.length} 个域名` },
      evidence: [
        { label: '共同域名数', value: String(commonHosts.length), source: 'derived' },
      ],
      actions: [],
    }];
  }

  // 按退化幅度排序，生成卡片
  diffs.sort((a, b) => b.deltaMs - a.deltaMs);

  for (const diff of diffs.slice(0, 10)) {
    cards.push({
      id: `baseline-diff-${diff.host}`,
      source: 'har',
      category: diff.category,
      severity: diff.severity,
      confidence: 'high',
      title: `${diff.host} 耗时退化 ${diff.deltaPercent}%`,
      conclusion: `该域名平均耗时从 ${diff.baselineAvgTime}ms 退化到 ${diff.currentAvgTime}ms（+${diff.deltaMs}ms），主因可能是 ${categoryLabel(diff.category)}`,
      scope: { type: 'single-domain', summary: `影响 ${diff.host}`, affectedRequestCount: diff.currentCount },
      evidence: [
        { label: '正常样本平均耗时', value: `${diff.baselineAvgTime}ms`, source: 'har' },
        { label: '异常样本平均耗时', value: `${diff.currentAvgTime}ms`, source: 'har' },
        { label: '退化幅度', value: `+${diff.deltaMs}ms (+${diff.deltaPercent}%)`, source: 'derived' },
        { label: '疑似慢因阶段', value: categoryLabel(diff.category), source: 'derived' },
      ],
      actions: buildDiffActions(diff),
      limitations: ['基于域名粒度对比，不排除单请求偶发慢的可能性'],
    });
  }

  return cards;
}

function categoryLabel(cat: DomainDiff['category']): string {
  const map: Record<DomainDiff['category'], string> = {
    dns: 'DNS 解析',
    connect: 'TCP 连接',
    tls: 'TLS 握手',
    server: '服务端响应',
    performance: '资源下载',
    unknown: '综合',
  };
  return map[cat];
}

function buildDiffActions(diff: DomainDiff): DiagnosticAction[] {
  const actions: DiagnosticAction[] = [];

  switch (diff.category) {
    case 'dns':
      actions.push({
        role: 'user',
        title: 'DNS 解析验证',
        detail: `对比正常/异常环境下的 DNS 解析结果`,
        command: `nslookup ${diff.host}`,
        expectedResult: '异常环境应与正常环境解析到相同或同段 IP',
        nextIfFailed: '尝试切换 DNS 后重新解析',
      });
      break;
    case 'connect':
      actions.push({
        role: 'user',
        title: '连接耗时对比',
        detail: `用 curl 分别在正常/异常环境测试连接耗时`,
        command: `curl -v -o /dev/null -s -w "connect=%{time_connect}\\n" https://${diff.host}`,
        expectedResult: '异常环境 connect 耗时不应显著高于正常环境',
      });
      break;
    case 'tls':
      actions.push({
        role: 'it',
        title: 'TLS 链路检查',
        detail: `检查是否有 TLS Inspection / 代理 / 中间人证书介入`,
        command: `openssl s_client -connect ${diff.host}:443 -servername ${diff.host}`,
      });
      break;
    case 'server':
      actions.push({
        role: 'backend',
        title: '服务端日志查询',
        detail: `使用 x-tt-logid 或接口路径查询服务端处理耗时`,
      });
      break;
    default:
      actions.push({
        role: 'user',
        title: '综合排查',
        detail: '建议结合 DNS、连接、TLS、服务端多个维度综合排查',
      });
  }

  return actions;
}

// ========== 对比汇总 ==========

export function buildBaselineCompareSummary(
  baseline: HarAnalysisResult,
  current: HarAnalysisResult
): DiagnosisSummary {
  const cards = compareBaselines(baseline, current);
  const criticalCount = cards.filter(c => c.severity === 'critical').length;
  const warningCount = cards.filter(c => c.severity === 'warning').length;

  return {
    cards,
    quality: {
      source: 'har',
      isDiagnosable: true,
      issues: [],
    },
    overallSeverity: criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'info',
  };
}
