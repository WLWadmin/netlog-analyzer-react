/**
 * NetLog 生命周期 → DiagnosticCard
 *
 * 说明：
 * - 生命周期用于把“证据链”结构化，帮助定位慢在 DNS/TCP/TLS/代理等哪一段
 * - 这里给出的是启发式诊断卡：更偏“现象 + 证据 + 下一步动作”，避免过度定因
 */

import type { AnalysisResult, URLRequest, ParsedEvent } from '../../parsers/netlog/parser';
import type { DiagnosticCard, DiagnosticCategory, DiagnosticEvidence, DiagnosticAction } from './types';
import { buildRequestLifecycle, getDominantStage, LifecycleStageName, collectRelatedSourceIdsFromGraph } from '../../parsers/netlog/requestLifecycle';
import type { SourceGraph } from '../../parsers/netlog/sourceGraph';
import { getCachedEventsBySourceId, getCachedSourceGraph } from '../../parsers/netlog/sourceGraphCache';

interface LifecycleMeasure {
  <T>(label: string, fn: () => T): T;
}

const identityMeasure: LifecycleMeasure = (_label, fn) => fn();

function generateId(prefix: string, seed: string | number) {
  return `${prefix}-${seed}-${Date.now().toString(36)}`;
}

function stageToCategory(stage: LifecycleStageName): DiagnosticCategory {
  switch (stage) {
    case 'dns':
      return 'dns';
    case 'proxy':
      return 'proxy';
    case 'tls':
      return 'tls';
    case 'tcp':
    case 'socket':
      return 'connect';
    case 'http2':
    case 'quic':
      return 'protocol';
    case 'response':
      return 'server';
    case 'request':
    case 'cache':
    case 'unknown':
    default:
      return 'performance';
  }
}

function stageLabel(stage: LifecycleStageName): string {
  const map: Record<LifecycleStageName, string> = {
    dns: 'DNS',
    proxy: '代理',
    socket: 'Socket/连接池',
    tcp: 'TCP 建连',
    tls: 'TLS 握手',
    http2: 'HTTP/2',
    quic: 'QUIC',
    cache: '缓存',
    request: '请求发送',
    response: '响应接收/TTFB',
    unknown: '其他',
  };
  return map[stage] || stage;
}

function buildStageBreakdownEvidence(req: URLRequest): DiagnosticEvidence[] {
  const tl = req.timeline || {};
  const items: Array<[string, number | undefined]> = [
    ['DNS', tl.dns?.duration],
    ['Connect', tl.connect?.duration],
    ['SSL', tl.ssl?.duration],
    ['Send', tl.send?.duration],
    ['Wait', tl.wait?.duration],
    ['Download', tl.download?.duration],
  ];
  return items
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)
    .map(([k, v]) => ({ label: `阶段：${k}`, value: `${v!.toFixed(0)}ms`, source: 'netlog' as const }));
}

function buildActionsForStage(stage: LifecycleStageName, host: string): DiagnosticAction[] {
  switch (stage) {
    case 'dns':
      return [
        { role: 'user', title: '验证 DNS 解析', detail: '对异常域名做当前网络解析验证', command: `nslookup ${host || 'example.com'}`, platform: 'all' },
        { role: 'it', title: '检查企业 DNS / VPN / PAC', detail: '确认 DNS 与代理接管策略是否影响该域名解析' },
      ];
    case 'proxy':
      return [
        { role: 'user', title: '绕过代理对比', detail: '临时关闭代理或切换网络，观察是否仍慢', command: "curl -v --noproxy '*' https://example.com", platform: 'all' },
        { role: 'it', title: '检查 PAC/代理服务器负载', detail: '确认 PAC 命中与代理认证/隧道建立是否变慢' },
      ];
    case 'tls':
      return [
        { role: 'user', title: '检查证书链', detail: '确认是否存在 HTTPS inspection/证书替换' },
        { role: 'it', title: '验证 TLS 握手', detail: '使用 openssl 检查证书链与协议协商', command: `openssl s_client -connect ${host || 'example.com'}:443 -servername ${host || 'example.com'}`, platform: 'macos' },
      ];
    case 'tcp':
    case 'socket':
      return [
        { role: 'user', title: '检查网络质量', detail: '查看丢包/RTT 是否异常', command: `ping ${host || 'example.com'} -c 20`, platform: 'all' },
        { role: 'it', title: '检查出口链路', detail: '确认防火墙/NAT/网关是否拥塞或限流' },
      ];
    case 'http2':
    case 'quic':
      return [
        { role: 'frontend', title: '验证协议回退', detail: '必要时禁用 QUIC/HTTP2 对比，确认是否协议层异常' },
      ];
    case 'response':
      return [
        { role: 'backend', title: '查询服务端耗时', detail: '结合请求标识（如 x-tt-logid）查询网关/应用/DB 耗时' },
        { role: 'user', title: '补采 Server-Timing/HAR', detail: '若服务端支持 Server-Timing，可辅助定位慢在服务端哪个阶段' },
      ];
    default:
      return [
        { role: 'user', title: '补采同次复现数据', detail: '建议同时采集 HAR + NetLog，提升定位确定性' },
      ];
  }
}

function hostFromUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function sanitizeLifecycleUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname || '/'}`;
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}

export function netlogLifecycleToCards(
  result: AnalysisResult,
  events: ParsedEvent[],
  opts?: {
    maxCards?: number;
    graph?: SourceGraph;
    eventsBySourceId?: Map<number, ParsedEvent[]>;
    measure?: LifecycleMeasure;
  }
): DiagnosticCard[] {
  const maxCards = opts?.maxCards ?? 5;
  const candidates = (result.slowRequests || []).slice(0, maxCards);
  if (candidates.length === 0) return [];

  const measure: LifecycleMeasure = opts?.measure ?? identityMeasure;
  const graph = opts?.graph || getCachedSourceGraph(events, result.urlRequests);
  const eventsBySourceId = opts?.eventsBySourceId || getCachedEventsBySourceId(events);

  return measure('Diagnosis/lifecycle/netlogLifecycleToCards', () => {
    const cards: DiagnosticCard[] = [];
    for (const req of candidates) {
      const relatedSourceIds = collectRelatedSourceIdsFromGraph(graph, req.id);
      const lifecycle = measure(`Diagnosis/lifecycle/buildRequestLifecycle/${req.id}`, () =>
        buildRequestLifecycle(events, result.urlRequests, req, {
          relatedSourceIds,
          eventsBySourceId,
        })
      );

      const dominantTimelineStage = (() => {
        const tl = req.timeline || {};
        const stageList: Array<[LifecycleStageName, number | undefined]> = [
          ['dns', tl.dns?.duration],
          ['tcp', tl.connect?.duration],
          ['tls', tl.ssl?.duration],
          ['request', tl.send?.duration],
          ['response', tl.wait?.duration],
          ['response', tl.download?.duration],
        ];
        const filtered = stageList.filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && (v as number) > 0) as Array<[LifecycleStageName, number]>;
        if (filtered.length === 0) return null;
        filtered.sort((a, b) => b[1] - a[1]);
        return { stage: filtered[0][0], duration: filtered[0][1] };
      })();

      const dominantLifecycleStage = dominantTimelineStage || (() => {
        const dominant = getDominantStage(lifecycle);
        return dominant ? { stage: dominant.name, duration: dominant.duration || 0 } : null;
      })();
      const dominantStage = dominantLifecycleStage?.stage || 'unknown';
      const dominantDuration = dominantLifecycleStage?.duration || 0;

      const host = hostFromUrl(req.url);
      const category = stageToCategory(dominantStage);
      const evidence: DiagnosticEvidence[] = [
        { label: 'URL', value: sanitizeLifecycleUrl(req.url), source: 'netlog' },
        { label: '总耗时', value: `${(req.duration || 0).toFixed(0)}ms`, source: 'netlog' },
        { label: '主要阶段', value: `${stageLabel(dominantStage)}（约 ${dominantDuration.toFixed(0)}ms）`, source: 'derived' },
        ...buildStageBreakdownEvidence(req),
        {
          label: 'source 链路',
          value: lifecycle.relatedSourceTypes.slice(0, 8).join(' → ') || '未记录',
          source: 'derived',
          detail: `涉及 ${lifecycle.relatedSourceIds.length} 个 source`,
        },
      ];

      cards.push({
        id: generateId('netlog-lifecycle', req.id),
        source: 'netlog',
        category,
        severity: req.error ? 'warning' : 'info',
        confidence: 'medium',
        title: `请求生命周期：${stageLabel(dominantStage)} 阶段耗时偏高`,
        conclusion: `${stageLabel(dominantStage)} 阶段耗时占比偏高，建议优先围绕该阶段补充证据与排查。该结论为启发式推断，需结合事件列表进一步确认。`,
        scope: { type: 'single-request', summary: '影响 1 个请求', affectedRequestCount: 1 },
        evidence,
        actions: buildActionsForStage(dominantStage, host),
        limitations: [
          '生命周期分段为启发式规则，可能需要结合事件列表人工复核',
          '生命周期基于 source_dependency 关系追踪；如果 NetLog 缺失依赖边，底层证据可能不完整',
        ],
        relatedRequestIds: [req.id],
        relatedSourceIds: lifecycle.relatedSourceIds.slice(0, 15),
        navigationTarget: { tab: 'requests', requestIds: [req.id], keyword: host },
      });
    }

    return cards;
  });
}
