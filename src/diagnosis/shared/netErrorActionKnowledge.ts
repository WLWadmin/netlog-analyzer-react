import { getNetErrorDescription } from '../../parsers/netlog/constants';
import { classifyNetError, type NetErrorCategoryName } from '../../parsers/netlog/errorClassifier';
import type { DiagnosticCard, DiagnosticRole } from './types';
import type { ActionGroup, FinalAction } from './finalSummaryTypes';

interface KnowledgeAction extends FinalAction {
  role: DiagnosticRole;
  rank: number;
}

interface ErrorContext {
  codes: number[];
  codesByCategory: Map<NetErrorCategoryName, number[]>;
  hosts: string[];
  sourceCardId: string;
  hasConfirmedProxy: boolean;
}

const ROLE_TITLES: Record<DiagnosticRole, string> = {
  user: '用户先做',
  it: 'IT / 网络管理员处理',
  backend: '后端 / 服务端处理',
  frontend: '前端处理',
};

const ROLE_PRIORITY: Record<DiagnosticRole, number> = {
  user: 1,
  it: 2,
  backend: 3,
  frontend: 4,
};

function cardText(card: DiagnosticCard): string {
  return [
    card.title,
    card.conclusion,
    card.scope.summary,
    ...(card.limitations || []),
    ...card.evidence.flatMap(e => [e.label, e.value, e.detail || '']),
  ].join(' ');
}

export function extractNetErrorCodesFromCards(cards: DiagnosticCard[]): number[] {
  const codes = new Set<number>();
  cards.forEach(card => {
    const text = cardText(card);
    const patterns = [
      /(?:net_error|错误码|code|Code)[:：=\s-]*(-\d+)/gi,
      /错误码\s*(-\d+)/gi,
      /\b(-(?:[1-9]\d{0,2}))\b/g,
    ];
    patterns.forEach(pattern => {
      let match = pattern.exec(text);
      while (match) {
        const code = Number(match[1]);
        if (Number.isFinite(code)) codes.add(code);
        match = pattern.exec(text);
      }
    });
  });
  return Array.from(codes);
}

function extractHosts(cards: DiagnosticCard[]): string[] {
  const hosts = new Set<string>();
  cards.forEach(card => {
    card.evidence.forEach(evidence => {
      if (/PAC|代理服务器|代理列表|代理配置|ProxyServer|ProxyPac/i.test(evidence.label)) return;
      const candidates = evidence.value.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi) || [];
      candidates
        .filter(host => !/\.pac$/i.test(host))
        .forEach(host => hosts.add(host));
    });
  });
  return Array.from(hosts).slice(0, 6);
}

function hasConfirmedProxySignal(cards: DiagnosticCard[]): boolean {
  return cards.some(card => {
    if (card.category !== 'proxy') return false;
    const text = cardText(card);
    const negativePattern = /未检测到代理|没有代理|未包含代理事件|未识别代理|未解析出稳定代理配置|未配置代理|代理事件不足|缺少代理解析过程/;
    if (negativePattern.test(text)) return false;

    const positiveEvidence = card.evidence.some(evidence => {
      const { label, value } = evidence;
      if (/代理模式|代理服务器|代理列表|PAC 地址|PAC|VPN|代理配置/.test(label) && !/未识别|未知|无|false|未记录|未包含/.test(value)) {
        return true;
      }
      return /\b(pac_script|fixed_servers|proxy|socks|http:\/\/|https:\/\/)\b/i.test(value);
    });

    return positiveEvidence || /检测到代理|检测到 VPN|当前存在代理配置|当前配置了代理|代理服务器配置|PAC 地址|代理决策链路/.test(text);
  });
}

function createContext(cards: DiagnosticCard[]): ErrorContext {
  const codes = extractNetErrorCodesFromCards(cards);
  const codesByCategory = new Map<NetErrorCategoryName, number[]>();
  codes.forEach(code => {
    const category = classifyNetError(code).catName;
    const list = codesByCategory.get(category) || [];
    list.push(code);
    codesByCategory.set(category, list);
  });
  return {
    codes,
    codesByCategory,
    hosts: extractHosts(cards),
    sourceCardId: cards[0]?.id || 'net-error-knowledge',
    hasConfirmedProxy: hasConfirmedProxySignal(cards),
  };
}

function formatCodes(codes: number[]): string {
  return codes.map(code => `${code} ${getNetErrorDescription(code)}`).join('、');
}

function hostText(ctx: ErrorContext): string {
  return ctx.hosts.length > 0 ? ctx.hosts.join('、') : '问题域名';
}

function hostDisplayParts(host: string): { base: string; prefix?: string; raw: string } {
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 3) return { base: host, raw: host };
  const base = parts.slice(-2).join('.');
  const prefix = parts.slice(0, -2).join('.');
  return { base: `*.${base}`, prefix: prefix && prefix !== 'www' ? prefix : undefined, raw: host };
}

function displayHostText(ctx: ErrorContext): string {
  if (ctx.hosts.length === 0) return '问题域名';
  const seenBase = new Set<string>();
  const displayItems: string[] = [];

  ctx.hosts.forEach(host => {
    const item = hostDisplayParts(host);
    if (seenBase.has(item.base)) return;
    seenBase.add(item.base);
    displayItems.push(displayItems.length === 0 && item.prefix ? `${item.base}（${item.raw}）` : item.base);
  });

  return displayItems.join('、');
}

function sortCodesByTroubleshootingPriority(codes: number[]): number[] {
  const rankCode = (code: number) => {
    if (code === -105 || code === -137 || (code <= -800 && code >= -899)) return 10;
    if (code <= -100 && code >= -109) return 20;
    if (code === -118) return 21;
    if (code <= -120 && code >= -139) return 30;
    if (code <= -200 && code >= -220) return 40;
    if (code === -173) return 90;
    return 50;
  };
  return [...codes].sort((a, b) => rankCode(a) - rankCode(b) || Math.abs(a) - Math.abs(b));
}

function action(
  ctx: ErrorContext,
  role: DiagnosticRole,
  key: string,
  title: string,
  detail: string,
  rank: number,
  risk: FinalAction['risk'] = 'safe',
  effort: FinalAction['effort'] = 'low'
): KnowledgeAction {
  return {
    id: `${ctx.sourceCardId}-${key}`,
    role,
    title,
    detail,
    priority: rank,
    rank,
    risk,
    effort,
    sourceCardId: ctx.sourceCardId,
  };
}

function addExactCodeActions(ctx: ErrorContext, actions: KnowledgeAction[]) {
  const codes = new Set(ctx.codes);
  const hosts = displayHostText(ctx);

  if (codes.has(-202)) {
    actions.push(
      action(ctx, 'user', 'cert-authority-network-compare', '切换网络判断是否为企业证书替换', `检测到 -202 ${getNetErrorDescription(-202)}。先用手机热点或非公司网络访问 ${hosts}；如果换网络后正常，优先怀疑公司网关、代理、VPN、防火墙或安全软件做了 HTTPS 解密/证书替换。`, 40),
      action(ctx, 'user', 'cert-authority-view-cert', '查看证书颁发者和证书链', '打开浏览器证书详情，记录证书颁发者、证书链、有效期和证书指纹。若颁发者是企业 CA、安全软件或异常 CA，说明客户端信任链或 HTTPS 解密策略需要 IT 介入。', 41),
      action(ctx, 'it', 'cert-authority-it-inspection', '检查 HTTPS 解密和企业根证书策略', `核对防火墙、VPN、代理、终端安全软件是否对 ${hosts} 启用了 TLS inspection / HTTPS inspection；如是可信业务域名，评估加入 HTTPS 解密绕过或证书信任策略。`, 1, 'needs-approval', 'medium'),
      action(ctx, 'backend', 'cert-authority-server-chain', '核验服务端证书链和 CA 信任', `确认 ${hosts} 使用公开可信 CA 签发的证书，服务端返回完整中间证书链，证书未使用自签名或未被客户端信任的私有 CA。`, 1, 'safe', 'medium')
    );
  }

  if (codes.has(-105) || codes.has(-137)) {
    const dnsBaseRank = ctx.hasConfirmedProxy ? 30 : 10;
    actions.push(
      action(ctx, 'user', 'dns-resolve-check', '检查 DNS 配置和解析结果', `检测到域名解析失败（${formatCodes(ctx.codes.filter(code => code === -105 || code === -137))}）。先确认 ${hosts} 在当前网络下能否解析；检查系统 DNS、企业 DNS、DoH/安全 DNS、hosts 配置是否把问题域名解析错或拦截。`, dnsBaseRank),
      action(ctx, 'user', 'dns-network-compare', '切换网络验证 DNS 是否受当前网络影响', `切换到手机热点或其他网络后重新访问 ${hosts}。如果切网后恢复，优先排查当前网络 DNS、企业网关、运营商解析或安全 DNS 策略。`, dnsBaseRank + 1),
      action(ctx, 'it', 'dns-it-policy', '核对企业 DNS 和域名解析策略', `检查企业 DNS、内网 DNS、DoH 策略、DNS 劫持和域名黑白名单，确认 ${hosts} 没有被错误解析、拒绝解析或解析到不可达地址。`, 1, 'needs-approval', 'medium')
    );
  }

  if (codes.has(-101)) {
    const connectionBaseRank = ctx.hasConfirmedProxy ? 6 : 12;
    actions.push(
      action(ctx, 'user', 'connection-reset-security', '检查安全软件或防火墙是否拦截', `连接被 RST 重置常见于安全软件、终端防护、防火墙、TLS SNI 检测或网关策略。确认 ${hosts} 已加入白名单，且没有被 HTTPS 扫描、访问控制或审计策略拦截。`, connectionBaseRank, 'needs-approval', 'medium'),
      action(ctx, 'user', 'connection-reset-network', '切换网络验证连接是否被当前网络重置', `检测到 -101 ${getNetErrorDescription(-101)}。先用手机热点或其他网络重试 ${hosts}；如果换网络恢复，优先排查当前 Wi-Fi、公司网关、防火墙、代理或运营商链路。`, connectionBaseRank + 1),
      action(ctx, 'it', 'connection-reset-it', '核对网关、防火墙和 TLS SNI 检测日志', `按错误码 -101、问题域名 ${hosts} 和复现时间点检查防火墙、准入系统、代理、WAF、TLS SNI 深度检测和连接重置日志。`, 1, 'needs-approval', 'medium')
    );
  }
}

function addCategoryActions(ctx: ErrorContext, actions: KnowledgeAction[]) {
  const hosts = displayHostText(ctx);

  const dnsCodes = ctx.codesByCategory.get('DNS') || [];
  if (dnsCodes.length > 0 && !ctx.codes.some(code => code === -105 || code === -137)) {
    const dnsBaseRank = ctx.hasConfirmedProxy ? 30 : 15;
    actions.push(
      action(ctx, 'user', 'dns-category-check', '检查 DNS 解析链路', `检测到 DNS 类错误（${formatCodes(dnsCodes)}）。检查系统 DNS、企业 DNS、DoH/安全 DNS、hosts、DNS 缓存，并对 ${hosts} 做解析对比。`, dnsBaseRank),
      action(ctx, 'it', 'dns-category-it', '检查 DNS 服务器和解析策略', `核对 DNS 服务器可用性、递归解析、内外网 split-horizon 解析、域名黑白名单和 DoH 策略，确认 ${hosts} 未被错误处理。`, 10, 'needs-approval', 'medium')
    );
  }

  const certCodes = ctx.codesByCategory.get('证书') || [];
  if (certCodes.length > 0 && !ctx.codes.includes(-202)) {
    actions.push(
      action(ctx, 'user', 'cert-category-check', '检查证书详情和系统时间', `检测到证书类错误（${formatCodes(certCodes)}）。先检查系统时间，再查看 ${hosts} 的证书详情、颁发者、有效期、域名匹配和证书链。`, 40),
      action(ctx, 'it', 'cert-category-it', '检查 HTTPS 解密和根证书信任', '确认企业 HTTPS 解密、安全软件证书替换、根证书下发和证书信任策略是否正常。', 10, 'needs-approval', 'medium'),
      action(ctx, 'backend', 'cert-category-backend', '核验服务端证书配置', `检查 ${hosts} 的证书链、SAN/CN、有效期、吊销状态和中间证书是否完整。`, 10, 'safe', 'medium')
    );
  }

  const connectionCodes = sortCodesByTroubleshootingPriority(ctx.codesByCategory.get('连接') || []);
  const primaryConnectionCodes = connectionCodes.filter(code => code !== -173);
  const supplementalConnectionCodes = connectionCodes.filter(code => code === -173);
  if (connectionCodes.length > 0 && !ctx.codes.includes(-101)) {
    const connectionBaseRank = ctx.hasConfirmedProxy ? 6 : 20;
    const codeDescription = primaryConnectionCodes.length > 0
      ? `${formatCodes(primaryConnectionCodes)}${supplementalConnectionCodes.length > 0 ? `；补充观察到 ${formatCodes(supplementalConnectionCodes)}` : ''}`
      : formatCodes(connectionCodes);
    actions.push(
      action(ctx, 'user', 'connection-category-security', '检查防火墙或安全软件拦截', `确认 ${hosts} 未被安全软件、终端防护、防火墙、VPN、网关策略或 HTTPS 扫描拦截。`, connectionBaseRank, 'needs-approval', 'medium'),
      action(ctx, 'user', 'connection-category-network', '验证网络连接是否稳定', `检测到连接类错误（${codeDescription}）。切换网络重试访问域名：${hosts}，确认是否由当前 Wi-Fi、网关、运营商链路或公司网络策略导致。`, connectionBaseRank + 1),
      action(ctx, 'backend', 'connection-category-backend', '核对服务端端口和连接策略', `检查 ${hosts} 的服务监听、负载均衡、连接池、限流、主动断连和服务端错误日志。`, 10, 'safe', 'medium')
    );
  }

  const proxyCodes = ctx.codesByCategory.get('代理') || [];
  if (proxyCodes.length > 0 || ctx.hasConfirmedProxy) {
    actions.push(
      action(ctx, 'user', 'proxy-compare', '临时关闭代理/VPN后重试', `检测到代理线索${proxyCodes.length ? `（${formatCodes(proxyCodes)}）` : ''}。在符合公司安全策略的前提下，临时关闭代理/VPN 或切换到不走代理的网络访问 ${hosts}，判断是否为代理链路问题。`, 5, 'needs-approval'),
      action(ctx, 'it', 'proxy-policy-check', '检查 PAC、代理服务器和域名白名单', `核对 ProxyMode、ProxyPacUrl、ProxyServer、ProxyBypassList、PAC 返回结果、代理认证和 ${hosts} 的分流/白名单策略。`, 10, 'needs-approval', 'medium')
    );
  }

  const protocolCodes = ctx.codesByCategory.get('协议') || [];
  if (protocolCodes.length > 0) {
    actions.push(
      action(ctx, 'user', 'protocol-compare', '对比 HTTP/2、QUIC 或 TLS 协议链路', `检测到协议类错误（${formatCodes(protocolCodes)}）。如果问题集中在 HTTP/2 或 QUIC，优先检查代理/网关是否支持对应协议；必要时做降级对比验证。`, 60, 'needs-approval', 'medium'),
      action(ctx, 'it', 'protocol-it', '检查中间设备协议兼容性', '核对防火墙、代理、网关、WAF 是否修改或阻断 HTTP/2、QUIC、TLS、ALPN、ECH 等协议能力。', 10, 'needs-approval', 'medium')
    );
  }

  const blockedCodes = ctx.codesByCategory.get('阻止') || [];
  if (blockedCodes.length > 0) {
    actions.push(
      action(ctx, 'user', 'blocked-local-check', '检查浏览器插件、安全策略或本机拦截', `检测到阻止类错误（${formatCodes(blockedCodes)}）。检查浏览器插件、系统策略、安全软件、CSP/CORS、私有网络访问策略是否拦截 ${hosts}。`, 30, 'needs-approval'),
      action(ctx, 'it', 'blocked-it-policy', '核对管理员访问控制策略', `检查 URL block list、终端管控、私有网络访问策略、防火墙和公司网关是否阻止 ${hosts}。`, 10, 'needs-approval', 'medium')
    );
  }

  const cacheCodes = ctx.codesByCategory.get('缓存') || [];
  if (cacheCodes.length > 0) {
    actions.push(
      action(ctx, 'user', 'cache-clear', '清理浏览器缓存后重试', `检测到缓存类错误（${formatCodes(cacheCodes)}）。先清理站点缓存或使用无痕窗口重试，确认是否为缓存条目损坏或缓存锁问题。`, 80),
      action(ctx, 'frontend', 'cache-frontend-check', '检查缓存策略和资源更新', `检查 ${hosts} 的 Cache-Control、ETag、Service Worker、资源版本和断点续传策略是否异常。`, 10, 'safe', 'medium')
    );
  }
}

function addSpecialActions(ctx: ErrorContext, actions: KnowledgeAction[]) {
  if (ctx.codes.includes(-173)) {
    actions.push(
      action(ctx, 'user', 'websocket-upgrade-check', '确认 WebSocket / 协议升级链路', `检测到 -173 ${getNetErrorDescription(-173)}。它通常与 WebSocket 升级流程有关，不应单独当作普通网络失败根因；如果业务依赖 WebSocket，请检查网关、代理、安全设备是否允许 Upgrade 头和长连接。`, 90, 'needs-approval', 'medium'),
      action(ctx, 'backend', 'websocket-server-check', '核对服务端 WebSocket 升级配置', `检查 ${hostText(ctx)} 的 Upgrade / Connection 头、长连接超时、网关转发和服务端 WebSocket 握手日志。`, 1, 'safe', 'medium')
    );
  }
}

function dedupeActions(actions: KnowledgeAction[]): KnowledgeAction[] {
  const seen = new Set<string>();
  const result: KnowledgeAction[] = [];
  actions
    .sort((a, b) => a.rank - b.rank)
    .forEach(item => {
      const key = `${item.role}|${item.title}|${item.detail}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
  return result;
}

export function buildNetErrorKnowledgeActionGroups(cards: DiagnosticCard[]): ActionGroup[] {
  const ctx = createContext(cards);
  const actions: KnowledgeAction[] = [];

  if (ctx.codes.length === 0 && !ctx.hasConfirmedProxy) return [];

  addExactCodeActions(ctx, actions);
  addCategoryActions(ctx, actions);
  addSpecialActions(ctx, actions);

  const grouped = new Map<DiagnosticRole, KnowledgeAction[]>();
  dedupeActions(actions).forEach(item => {
    const list = grouped.get(item.role) || [];
    list.push(item);
    grouped.set(item.role, list);
  });

  return Array.from(grouped.entries())
    .map(([role, roleActions]) => ({
      role,
      title: ROLE_TITLES[role],
      actions: roleActions.slice(0, 5),
      priority: ROLE_PRIORITY[role],
    }))
    .filter(group => group.actions.length > 0)
    .sort((a, b) => a.priority - b.priority);
}
