import type { DiagnosticAction, DiagnosticCard, DiagnosticCategory, DiagnosticRole } from './types';

export interface PlaybookAction extends DiagnosticAction {
  id: string;
  category: DiagnosticCategory;
}

const HOST_PLACEHOLDER = '<host>';

function action(
  category: DiagnosticCategory,
  role: DiagnosticRole,
  id: string,
  title: string,
  detail: string,
  expectedResult: string,
  nextIfFailed: string,
  risk: DiagnosticAction['risk'] = 'safe',
  effort: DiagnosticAction['effort'] = 'low',
  command?: string,
  rerunRequired: DiagnosticAction['rerunRequired'] = ['both'],
  resultImprovesMeaning = '如果结果改善，说明该方向与问题相关；如果无变化，继续下一步验证，不直接生成新的确定根因。'
): PlaybookAction {
  return {
    id,
    category,
    role,
    title,
    detail,
    expectedResult,
    nextIfFailed,
    risk,
    effort,
    command,
    platform: command ? 'all' : undefined,
    rerunRequired,
    resultImprovesMeaning,
  };
}

const PLAYBOOK: Record<DiagnosticCategory, PlaybookAction[]> = {
  dns: [
    action('dns', 'user', 'dns-switch-network', '切换网络验证 DNS', '切到手机热点或另一条网络后重新访问问题域名。', '同一页面或接口恢复访问，DNS/网络出口方向置信度上升。', '继续执行 nslookup/dig，并把结果交给 IT 检查 DNS 策略。'),
    action('dns', 'it', 'dns-lookup', '查询域名解析结果', `使用 nslookup/dig 查询 ${HOST_PLACEHOLDER}，对比公司 DNS 与公共 DNS 返回。`, '应返回稳定且可达的 IP。', '检查企业 DNS、DoH、Split DNS、代理/VPN DNS 策略。', 'safe', 'low', `nslookup ${HOST_PLACEHOLDER}`),
  ],
  connect: [
    action('connect', 'user', 'connect-network-compare', '切换网络对比连接', '换网络后复现同一操作，观察连接失败是否消失。', '切换网络后连接恢复，说明本机出口、运营商或网络策略方向值得继续查。', '检查防火墙、代理、安全软件和目标端口。'),
    action('connect', 'it', 'connect-port-policy', '检查出口和目标端口策略', `核对 ${HOST_PLACEHOLDER} 的防火墙、网关、目标端口和安全设备日志。`, '目标端口应允许访问，网关没有拒绝或重置记录。', '升级到网络团队排查路由、ACL 或安全策略。', 'needs-approval', 'medium'),
  ],
  tls: [
    action('tls', 'user', 'tls-cert-view', '查看证书链和系统时间', '打开浏览器证书详情，确认颁发者、有效期、系统时间是否正常。', '证书链可信且系统时间正确。', '继续检查 HTTPS inspection、安全代理或企业根证书。'),
    action('tls', 'it', 'tls-inspection-check', '检查 HTTPS inspection', `确认安全网关、VPN、代理或终端安全软件是否对 ${HOST_PLACEHOLDER} 做 TLS 解密。`, '可信业务域名不应被错误替换证书或阻断握手。', '按策略加入绕过或修复根证书下发。', 'needs-approval', 'medium'),
  ],
  proxy: [
    action('proxy', 'user', 'proxy-login-compare', '确认代理/VPN 登录状态', '确认代理、VPN、企业网关登录有效；必要时重新登录后复现。', '重新登录后 407/CONNECT/代理相关失败消失。', '检查 PAC、代理服务器和白名单策略。'),
    action('proxy', 'it', 'proxy-pac-check', '检查 PAC 和 CONNECT 隧道', `核对 PAC 对 ${HOST_PLACEHOLDER} 的返回、代理认证、CONNECT tunnel 和白名单。`, 'PAC 返回符合预期，代理允许目标域名和端口。', '修复 PAC 或代理策略后重新采集 HAR/NetLog。', 'needs-approval', 'medium'),
  ],
  'network-change': [
    action('network-change', 'user', 'network-change-stability', '确认网络切换时机', '确认问题发生时是否切换 Wi-Fi、VPN、休眠唤醒或弱网重连。', '复现时避免网络切换后问题消失，说明网络切换是关键变量。', '继续采集稳定网络下的 HAR/NetLog 对照。'),
  ],
  server: [
    action('server', 'backend', 'server-logid-check', '查询服务端日志和耗时', '使用 logid、Server-Timing 或请求时间点查询网关、应用和下游依赖耗时。', '服务端日志能解释 5xx 或 TTFB 慢。', '如果服务端无异常，继续用同时间 NetLog 排查网络层反证。', 'safe', 'low', undefined, ['har']),
  ],
  cors: [
    action('cors', 'frontend', 'cors-preflight-check', '检查预检和跨域策略', '核对 OPTIONS 预检、Access-Control-Allow-* 响应头、登录态和接口约定。', '预检通过且响应头符合浏览器策略。', '与后端确认跨域配置、Cookie SameSite 和鉴权约定。'),
  ],
  client: [
    action('client', 'frontend', 'client-auth-contract', '检查请求参数和鉴权约定', '核对 4xx、401/403 的接口约定、登录态和前端调用方式。', '请求符合接口契约，登录态有效。', '继续由后端确认鉴权策略或错误响应。'),
  ],
  performance: [
    action('performance', 'backend', 'download-ttfb-cdn', '区分 TTFB、下载和 CDN', '查看 Server-Timing、资源大小、缓存命中和 CDN 回源情况。', '能区分是服务端处理慢、资源过大还是 CDN/缓存问题。', '跨网络对比并重新采集 HAR。'),
  ],
  'browser-queue': [
    action('browser-queue', 'user', 'queue-browser-retry', '减少并发后复现', '关闭其他标签页和扩展，重新加载页面观察队列等待是否下降。', '队列等待下降，说明浏览器并发或扩展影响较大。', '继续查看连接池、Service Worker 或扩展影响。'),
  ],
  protocol: [
    action('protocol', 'it', 'protocol-gateway-check', '检查 HTTP/2、QUIC 或 WebSocket 兼容性', '核对代理、网关、防火墙是否支持对应协议和 Upgrade/ALPN。', '协议降级或放通后问题改善。', '继续按网关或代理策略排查。', 'needs-approval', 'medium'),
  ],
  security: [
    action('security', 'it', 'security-policy-check', '检查安全策略拦截', '检查终端安全软件、浏览器策略、私有网络访问和 URL block list。', '放通可信业务域名后请求恢复。', '继续定位具体策略命中项。', 'needs-approval', 'medium'),
  ],
  cache: [
    action('cache', 'user', 'cache-bypass-reload', '绕过缓存重新加载', '使用无痕窗口或禁用缓存刷新页面。', '绕过缓存后问题消失，说明缓存状态相关。', '继续检查 Cache-Control、Service Worker 或缓存污染。'),
  ],
  compression: [
    action('compression', 'backend', 'compression-check', '检查压缩和资源大小', '确认大资源是否启用 gzip/br，静态资源是否可拆分或缓存。', '压缩后下载耗时下降。', '继续检查 CDN 和资源拆分。'),
  ],
  redirect: [
    action('redirect', 'frontend', 'redirect-chain-check', '检查重定向链路', '确认登录、地域、协议跳转是否形成过长链路。', '重定向次数下降且页面恢复。', '继续定位跳转规则或鉴权状态。'),
  ],
  quality: [
    action('quality', 'user', 'quality-recollect', '重新同时采集 HAR 和 NetLog', '从开始复现前启动采集，问题结束后立即停止，并记录时间点。', '新文件包含完整复现窗口和可关联证据。', '如果仍无结论，补充网络环境、代理/VPN 状态和复现步骤。'),
  ],
  unknown: [
    action('unknown', 'user', 'unknown-recollect-with-context', '补充复现上下文', '记录复现时间、网络环境、是否代理/VPN，并重新同时采集 HAR/NetLog。', '新证据能把 unknown 收敛到 DNS/TLS/Proxy/服务端等具体类别。', '如果仍未知，转人工查看 Raw Evidence。'),
  ],
};

export function getPlaybookActions(category: DiagnosticCategory): PlaybookAction[] {
  return PLAYBOOK[category] || PLAYBOOK.unknown;
}

function actionKey(action: DiagnosticAction): string {
  return `${action.role}:${action.title}`;
}

export function enrichActionsWithPlaybook(card: DiagnosticCard): DiagnosticAction[] {
  const existing = card.actions.map(actionItem => ({
    effort: 'low' as const,
    risk: 'safe' as const,
    rerunRequired: ['both'] as Array<'har' | 'netlog' | 'both'>,
    resultImprovesMeaning: '如果结果改善，说明该方向与问题相关；如果无变化，继续下一步验证，不直接生成新的确定根因。',
    ...actionItem,
    expectedResult: actionItem.expectedResult || '执行后应能观察到问题是否改善或证据是否更明确。',
    nextIfFailed: actionItem.nextIfFailed || '继续执行下一条低风险验证，并重新采集必要证据。',
  }));
  const merged = [...existing, ...getPlaybookActions(card.category)];
  const seen = new Set<string>();
  return merged.filter(item => {
    const key = actionKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
