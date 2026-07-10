import type { HarAnalysisResult } from '../../harParser';
import type { DiagnosticAction } from './types';
import { buildHarIssueClusters, getHarEvidenceLevelLabel, getHarRoleLabel, type HarEvidenceLevel, type HarIssueCategory, type HarIssueCluster } from './harIssueClusters';

export interface HarNoviceDiagnosis {
  headline: string;
  summary: string;
  evidenceLevel: HarEvidenceLevel;
  impact: string;
  primaryCluster?: HarIssueCluster;
  secondaryClusters: HarIssueCluster[];
  immediateActions: DiagnosticAction[];
  handoffRoles: Array<{
    role: 'user' | 'it' | 'frontend' | 'backend';
    reason: string;
  }>;
  evidenceGap?: string;
  relatedRequestIds: number[];
}

function categoryAction(category: HarIssueCategory, cluster: HarIssueCluster): DiagnosticAction[] {
  switch (category) {
    case 'dns':
      return [
        { role: 'user', title: '切换网络对比', detail: '切换手机热点或其他网络复现，确认是否只在当前网络出现。' },
        { role: 'it', title: '检查 DNS / VPN / PAC', detail: '检查企业 DNS、VPN 或 PAC 是否接管该域名解析。' },
        { role: 'user', title: '补充 NetLog', detail: '如果需要确认系统网络栈原因，补充同次 NetLog 的 DNS events。' },
      ];
    case 'connection':
      return [
        { role: 'user', title: '切换网络复现', detail: '确认是否只有特定域名不可访问，或当前网络普遍连接慢。' },
        { role: 'it', title: '检查出口链路', detail: '检查防火墙、网关、NAT、代理和出口链路。' },
      ];
    case 'tls':
      return [
        { role: 'user', title: '检查证书提示', detail: '查看浏览器是否有证书异常，必要时对比关闭安全代理或切换网络后的现象。' },
        { role: 'it', title: '检查 HTTPS inspection', detail: '检查证书替换、企业信任链和安全代理策略。' },
      ];
    case 'proxy':
      return [
        { role: 'user', title: '确认代理登录状态', detail: '确认 VPN / 代理账号是否登录，是否被要求重新认证。' },
        { role: 'it', title: '检查 PAC 和代理认证', detail: '检查 PAC 命中、代理认证和 CONNECT 隧道。' },
      ];
    case 'queueing':
      return [
        { role: 'frontend', title: '检查同域并发', detail: '检查同域请求并发、资源优先级和重复请求。' },
      ];
    case 'stalled':
      return [
        { role: 'frontend', title: '检查请求调度', detail: '检查是否有大量同域请求、阻塞资源或重复请求。' },
        { role: 'it', title: '结合代理线索检查调度', detail: '如果 Stalled 集中且存在代理线索，检查代理调度和连接建立。' },
      ];
    case 'ttfb':
    case 'server-error':
      return [
        { role: 'backend', title: '查询服务端日志', detail: '使用 x-tt-logid / trace-id 查询网关、应用、DB 和下游依赖。' },
        { role: 'backend', title: '查看 Server-Timing', detail: '如响应包含 Server-Timing，优先确认服务端阶段耗时。' },
      ];
    case 'download':
      return [
        { role: 'frontend', title: '检查资源大小和缓存', detail: '检查资源大小、压缩、缓存策略和 CDN 节点。' },
        { role: 'it', title: '多域名同时慢时检查链路', detail: '只有多域名同时下载慢时，再检查当前链路带宽或丢包。' },
      ];
    case 'cors':
      return [
        { role: 'frontend', title: '检查 CORS 预检', detail: '检查跨域配置、预检响应和鉴权头约定；该结论必须按“疑似”处理。' },
        { role: 'backend', title: '核对接口跨域策略', detail: '核对后端 CORS 响应头和 OPTIONS 处理。' },
      ];
    case 'auth':
      return [
        { role: 'user', title: '确认登录态和权限', detail: '重新登录或确认当前账号是否有访问权限。' },
        { role: 'frontend', title: '检查鉴权约定', detail: '检查请求是否按约定携带鉴权信息。' },
      ];
    case 'browser-block':
      return [
        { role: 'frontend', title: '检查安全策略', detail: '检查 CSP、CORS、浏览器策略或插件拦截。' },
        { role: 'it', title: '检查企业安全策略', detail: '如果 blockedReason 指向企业策略或网关，优先由 IT 检查。' },
      ];
    case 'http-error':
      return [
        { role: 'frontend', title: '检查请求路径和参数', detail: '检查请求路径、参数、权限或接口约定。' },
        { role: 'backend', title: '核对接口返回', detail: '确认接口是否按约定返回 4xx。' },
      ];
    case 'unknown-failure':
      return [
        { role: 'user', title: '补充同次 NetLog', detail: '浏览器没有拿到 HTTP 响应，不是服务端返回了 0；HAR 缺少更底层错误。' },
      ];
  }
}

function uniqueActions(actions: DiagnosticAction[]): DiagnosticAction[] {
  const seen = new Set<string>();
  return actions.filter(action => {
    const key = `${action.role}:${action.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function roleReason(role: HarIssueCluster['roleHints'][number], cluster: HarIssueCluster): string {
  const label = getHarRoleLabel(role);
  if (role === 'backend') return `${cluster.title}，需要 ${label} 结合服务端日志或链路追踪确认。`;
  if (role === 'it') return `${cluster.title}，需要 ${label} 结合 DNS、代理、TLS 或网络出口证据确认。`;
  if (role === 'frontend') return `${cluster.title}，需要 ${label} 检查请求调度、CORS、鉴权或资源加载策略。`;
  return `${cluster.title}，用户可先做低成本复现或补充证据。`;
}

function buildNoIssueDiagnosis(result: HarAnalysisResult): HarNoviceDiagnosis {
  return {
    headline: '当前 HAR 未发现明确失败或集中慢阶段',
    summary: '当前 HAR 未发现明确失败或集中慢阶段。HAR 只能覆盖本次已记录请求；若用户仍感知异常，请确认是否复现到问题并补充 NetLog。',
    evidenceLevel: 'insufficient',
    impact: `${result.totalRequests} 个请求中未发现可升级为全局问题的问题组`,
    secondaryClusters: [],
    immediateActions: [
      { role: 'user', title: '确认 HAR 覆盖问题时段', detail: '确认导出 HAR 时问题已经复现，并覆盖用户感知异常的时间段。' },
      { role: 'user', title: '补充 NetLog', detail: '如果仍感知异常，补充同次 NetLog 用于确认底层网络栈事件。' },
    ],
    handoffRoles: [{ role: 'user', reason: '当前 HAR 没有足够证据指向具体协作方，先确认采集是否覆盖问题。' }],
    evidenceGap: 'HAR 只能覆盖本次已记录请求，无法证明未记录阶段没有异常。',
    relatedRequestIds: [],
  };
}

export function buildHarNoviceDiagnosis(result: HarAnalysisResult): HarNoviceDiagnosis {
  const clusters = buildHarIssueClusters(result.entries);
  const primaryCluster = clusters[0];
  if (!primaryCluster) return buildNoIssueDiagnosis(result);
  const secondaryClusters = clusters.slice(1, 5);
  const impact = `${primaryCluster.affectedRequestCount} 个请求 / ${primaryCluster.affectedDomainCount} 个域名${primaryCluster.maxDurationMs ? ` / 最慢 ${Math.round(primaryCluster.maxDurationMs)}ms` : ''}`;
  const immediateActions = uniqueActions([
    ...categoryAction(primaryCluster.category, primaryCluster),
    ...secondaryClusters.flatMap(cluster => categoryAction(cluster.category, cluster).slice(0, 1)),
  ]);
  const handoffRoles = Array.from(new Set(primaryCluster.roleHints)).map(role => ({
    role,
    reason: roleReason(role, primaryCluster),
  }));
  const evidenceGap = primaryCluster.requiresNetLog
    ? `${getHarEvidenceLevelLabel(primaryCluster.evidenceLevel)}：HAR 已记录请求现象，但要确认 DNS、TLS、代理或系统网络栈原因，需要补充同次 NetLog。`
    : undefined;

  return {
    headline: primaryCluster.title,
    summary: primaryCluster.userFacingSummary,
    evidenceLevel: primaryCluster.evidenceLevel,
    impact,
    primaryCluster,
    secondaryClusters,
    immediateActions,
    handoffRoles,
    evidenceGap,
    relatedRequestIds: primaryCluster.representativeRequestIds,
  };
}
