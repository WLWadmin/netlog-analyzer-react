import { AnalysisResult } from './parser';
import { getNetErrorDescription } from './constants';
import { classifyNetError } from './errorClassifier';
import type { IpRoutingConclusion } from '../../diagnosis/ipEvidence';
import {
  CONNECTION_RESET_SECURITY_EXAMPLES,
  MAINLAND_CHINA_DNS_COMPARISON_LIST,
  MAINLAND_CHINA_DNS_NON_DEFAULT_LIST,
} from '../../diagnosis/shared/networkTroubleshootingExperience';

export interface Suggestion {
  icon: string;
  title: string;
  detail: string;
  conclusion: string;
  actions: string[];
  /** 结构化错误码，避免下游正则提取 */
  errorCode?: number;
  /** 结构化分类，避免下游从标题推断 */
  category?: 'dns' | 'proxy' | 'tls' | 'connect' | 'protocol' | 'network-change' | 'security' | 'performance' | 'cache' | 'server' | 'client' | 'unknown';
  /** 结构化严重程度 */
  severity?: 'critical' | 'warning' | 'info';
}

// ============================================================
// Error code to solution mapping (based on net_error knowledge base)
// ============================================================

interface ErrorSolution {
  title: string;
  detail: string;
  conclusion: string;
  actions: string[];
}

// ============================================================
// Error code to solution mapping
// Chromium error semantics come from net/base/net_error_list.h. Candidate causes
// below stay deliberately non-exclusive until a source chain or comparison adds evidence.
// ============================================================

const ERROR_SOLUTIONS: Record<number, ErrorSolution> = {
  [-2]: {
    title: 'ERR_FAILED (-2) — 通用请求失败',
    detail: '浏览器只记录到通用失败，没有提供足以区分 DNS、TCP、TLS、代理或服务端阶段的专用错误码。',
    conclusion: '可以确认请求失败，但 ERR_FAILED 本身不能说明失败层级或责任方，需要查看同一 URL_REQUEST 的 source chain、相邻 net_error 和 HAR 表现。',
    actions: [
      '先在网络稳定的情况下重新执行刚才操作；若仍失败，再切换手机热点或其他网络做对比',
      '打开失败请求的 Source Chain，查找更具体的 DNS、TCP、TLS、代理或协议事件',
      '在稳定网络下重新复现，并同时采集 HAR 与 NetLog 对齐失败请求',
      '对比手机热点或其他网络；仅在结果随网络变化时再转交 IT 排查',
    ],
  },
  // ---- DNS Errors (-100~-199 range includes DNS) ----
  [-105]: {
    title: 'ERR_NAME_NOT_RESOLVED (-105) — DNS 域名解析失败',
    detail: 'Chromium 记录到目标主机名无法解析。该错误本身不区分 NXDOMAIN、解析超时、本地 hosts、企业 DNS、Secure DNS/DoH 或代理解析策略。',
    conclusion: '可以确认名称解析失败，但不能仅凭 -105 判断解析器故障或域名不存在；需要查看 DNS task 结果、当前解析配置和对照解析结果。',
    actions: [
      `先执行 nslookup/dig 查看当前解析器、返回状态和地址；中国大陆网络可用 ${MAINLAND_CHINA_DNS_COMPARISON_LIST} 逐个做临时解析对照`,
      '若需要临时修改系统 DNS 验证能否恢复，先记录原配置，确认不影响企业内网/Split DNS，测试完成后恢复原 DNS',
      `基于项目排障经验，中国大陆首轮不默认选择 ${MAINLAND_CHINA_DNS_NON_DEFAULT_LIST}；这是一项对照策略，不是对节点状态的故障判断`,
      '公共解析器的结果只用于对照；内网域名、Split DNS 和 CDN 调度可能按解析器或出口返回不同结果',
      '【自查】检查 hosts 文件是否有异常映射（Windows: C:\\Windows\\System32\\drivers\\etc\\hosts | Mac: /etc/hosts）',
      '仅在怀疑缓存过期且符合运维要求时清除系统 DNS 缓存，然后使用同一域名重新验证',
      '如果使用 VPN、代理或 Secure DNS，检查其是否改变了解析路径；切换对比只能证明路径相关性',
    ],
  },
  [-106]: {
    title: 'ERR_INTERNET_DISCONNECTED (-106) — 网络已断开',
    detail: 'Chromium 记录到 Internet 连接已经丢失。该错误不说明是 Wi-Fi、有线网络、网关、VPN 还是系统网络策略导致。',
    conclusion: '可以确认请求发生时浏览器观察到网络断开；先恢复基础连通性，再判断是否还存在 DNS、代理或目标服务问题。',
    actions: [
      '优先检查 Wi‑Fi / 有线网络是否已连接，确认系统网络图标和网络适配器状态正常',
      '尝试访问其他常见网站或执行 ping 网关 / ping 公网 IP，确认是否为整机断网',
      '如果使用 VPN 或代理，可在符合组织策略的前提下临时断开后重试；安全软件只先查看拦截日志和策略，不建议用户自行停用防护',
      '重连当前网络，或切换到手机热点 / 其他网络做对比测试',
      '若公司网络环境持续异常，联系 IT 检查本机网络策略、网关和 DHCP 分配状态',
    ],
  },
  [-137]: {
    title: 'ERR_NAME_RESOLUTION_FAILED (-137) — 域名解析失败',
    detail: 'Chromium 记录到名称解析过程发生错误。该通用错误没有进一步说明解析器响应、传输方式或失败责任方。',
    conclusion: '可以确认名称解析过程失败；需要查看 DNS task、解析器配置和网络连通性后再区分具体原因。',
    actions: [
      '查看同一请求的 HOST_RESOLVER / DNS task 事件和具体 net_error',
      `使用当前解析器查询问题域名；中国大陆网络可与 ${MAINLAND_CHINA_DNS_COMPARISON_LIST} 逐个对照，并记录返回状态和地址差异`,
      '临时修改系统 DNS 前先记录原配置，测试后恢复；恢复只说明原解析器或其网络路径与现象相关',
      '检查系统 DNS、企业 DNS、Secure DNS/DoH、VPN 和代理是否改变了解析路径',
      '如解析器不可达，再由 IT 核对对应传输路径和策略；不要默认只检查 UDP 53',
    ],
  },

  // ---- Connection Errors (-100~-199 range) ----
  [-100]: {
    title: 'ERR_CONNECTION_CLOSED (-100) — 连接被关闭（收到 FIN 报文）',
    detail: 'Chromium 记录到连接被关闭，对应 TCP FIN。仅凭该错误无法确认 FIN 来自源站、代理、负载均衡还是其他连接端点。',
    conclusion: '连接在数据传输阶段被关闭。关闭方可能是服务端、代理、安全软件或其他网络中间设备，需要结合同一 source chain 的 TCP/TLS/代理事件判断。',
    actions: [
      '查看同一 URL_REQUEST / socket source chain，确认关闭发生在建连、TLS 还是响应传输阶段',
      '检查请求是否成功重试，以及关闭前是否存在 GOAWAY、代理隧道或服务端响应事件',
      '用另一网络做同请求对比；恢复只说明当前路径相关，不直接确定具体设备',
      '由 IT 或服务端按复现时间核对代理、负载均衡和连接关闭日志',
    ],
  },
  [-101]: {
    title: 'ERR_CONNECTION_RESET (-101) — 连接被重置（收到 RST 报文）',
    detail: 'Chromium 记录到连接被重置，对应 TCP RST。错误码不包含重置方身份，也不说明发生在 TLS 握手还是数据传输阶段。',
    conclusion: '连接收到了 RST，可确认连接被重置，但无法仅凭该错误判断重置来自服务端、代理、防火墙、安全软件还是链路设备。',
    actions: [
      '先查看同一 socket / URL_REQUEST source chain，确认 RST 前后的 TLS、代理和协议事件',
      '用同一设备、同一目标切换手机热点或其他网络复测；若多次稳定恢复，后续优先检查工区网络路径，但仍不能直接确认具体设备',
      `【自查】确认本机是否启用了 ${CONNECTION_RESET_SECURITY_EXAMPLES}，只查看拦截记录、开关状态和白名单配置，不把厂商名当作已确认责任方`,
      '使用 openssl s_client -connect <域名>:443 -servername <域名> 检查 TLS 握手是否正常',
      `由 IT 按复现时间核对防火墙、代理、${CONNECTION_RESET_SECURITY_EXAMPLES} 的拦截日志与域名/IP/端口白名单，再与服务端 RST 日志交叉验证`,
    ],
  },
  [-102]: {
    title: 'ERR_CONNECTION_REFUSED (-102) — 连接尝试被拒绝',
    detail: 'Chromium 记录到连接尝试被拒绝。常见候选包括目标端口未监听、代理/网关拒绝或访问控制策略，但错误码本身不标识拒绝方。',
    conclusion: 'TCP 建连阶段收到拒绝响应。可能是目标端口未监听、服务或负载均衡异常，也可能是防火墙/代理主动拒绝；DNS 只有在解析结果异常时才应进入排查。',
    actions: [
      '确认 NetLog 中实际连接的目标地址、端口和是否经过代理',
      '使用 curl 或平台端口测试工具验证同一 host:port，记录是拒绝、超时还是成功',
      '由服务端确认监听和负载均衡状态，由 IT/代理团队核对明确的拒绝日志',
      '只有解析地址与预期不一致时，再进入 DNS/hosts 排查',
    ],
  },
  [-103]: {
    title: 'ERR_CONNECTION_ABORTED (-103) — 连接因发送数据未获 ACK 而中止',
    detail: 'Chromium 将该错误定义为已发送数据（也可能包括 FIN）未收到 ACK，最终导致连接超时中止。它不同于收到 RST 的 ERR_CONNECTION_RESET。',
    conclusion: '可以确认连接因数据未获确认而中止；仍需结合 socket 事件、重传/超时证据和网络对比判断发生在哪一段路径。',
    actions: [
      '查看同一 socket source chain 中发送、超时和关闭事件的顺序',
      '切换网络做同请求对比，并记录是否仍出现 -103',
      '由 IT 和服务端按五元组/复现时间核对丢包、连接跟踪和负载均衡日志',
    ],
  },
  [-118]: {
    title: 'ERR_CONNECTION_TIMED_OUT (-118) — TCP 连接超时',
    detail: 'Chromium 记录到一次连接尝试超时。该错误不提供固定超时阈值、丢包位置或责任设备，也不等同于 TLS 协议错误。',
    conclusion: '可以确认连接尝试没有在浏览器等待窗口内完成；目标地址、路由、代理、防火墙和服务端可达性都需要独立验证。',
    actions: [
      '从 NetLog 确认实际目标 IP、端口、代理路径和连接尝试时间',
      '使用 curl/connect 测试同一目标端点；ping 不响应不能单独证明端点不可达',
      '使用 traceroute/MTR 和另一网络复现，记录路径或结果差异',
      '由 IT、代理和服务端按复现时间核对访问控制、路由和监听状态',
    ],
  },

  // ---- Timeout Errors ----
  [-7]: {
    title: 'ERR_TIMED_OUT (-7) — 请求超时',
    detail: 'Chromium 记录到一次操作超时。该通用错误可能出现在不同操作阶段，不能仅凭 -7 断言连接已经建立或服务端响应缓慢。',
    conclusion: '可以确认操作超时；需要结合同一请求生命周期和相邻事件确定超时阶段。',
    actions: [
      '查看同一 URL_REQUEST 的 DNS、connect、TLS、send、wait 和 receive 事件，确定最后完成的阶段',
      '对同一请求补采 HAR；只有已收到请求/响应证据时才进入服务端耗时排查',
      '使用另一网络对比；结果变化只作为路径相关证据',
    ],
  },
  [-109]: {
    title: 'ERR_ADDRESS_UNREACHABLE (-109) — 地址不可达',
    detail: 'Chromium 记录到目标地址不可达。该错误不说明不可达发生在本机路由、网关、上游路径还是目标网络。',
    conclusion: '可以确认浏览器使用的目标地址不可达；需要核对实际目标 IP、路由结果和另一网络的对照，不能仅凭 -109 判断 DNS 或具体链路设备故障。',
    actions: [
      '从同一 source chain 记录实际目标 IP、端口和是否经过代理',
      '使用 tracert/traceroute/MTR 记录路径；中间跳不响应不能单独证明该跳故障',
      '在另一网络访问同一目标端点并记录差异；恢复只说明当前路径相关',
      '将目标 IP、复现时间和两侧路由结果交给网络团队核对',
    ],
  },

  // ---- SSL/TLS Errors (-200~-299 range) ----
  [-107]: {
    title: 'ERR_SSL_PROTOCOL_ERROR (-107) — SSL/TLS 协议错误',
    detail: 'Chromium 记录到 SSL/TLS 协议错误。该通用错误不区分服务端协议配置、客户端兼容性、代理或 HTTPS Inspection。',
    conclusion: 'TLS 握手记录到协议错误。服务端 TLS 配置、客户端兼容性、代理或 HTTPS Inspection 都是候选方向，必须结合握手事件和证书字段确认。',
    actions: [
      '查看同一 SSL_CONNECT_JOB / socket source chain 中的 TLS alert、版本、ALPN 和证书字段',
      '使用受支持的最新浏览器版本和 openssl s_client 对同一主机做握手对照',
      '如果仅企业网络复现，由 IT 核对代理或 HTTPS Inspection；如果跨网络均复现，由服务端核对 TLS 配置',
    ],
  },
  [-113]: {
    title: 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH (-113) — SSL 版本或密码套件不匹配',
    detail: 'Chromium 记录到客户端与实际 TLS 对端没有共同启用的协议版本或密码套件；实际对端可能是源站、代理或 HTTPS Inspection 设备。',
    conclusion: '可以确认客户端与对端没有共同启用的 TLS 版本或密码套件；仍需确认实际对端是否为源站、代理或 HTTPS Inspection 设备。',
    actions: [
      '更新 Chrome 到最新版本',
      '确认浏览器使用受支持的默认 TLS 配置，不建议通过实验性开关放宽安全要求',
      '使用 openssl s_client 核对目标端点支持的 TLS 版本、密码套件和证书链',
      '确认实际证书颁发者和连接端点，区分源站、代理与 HTTPS Inspection',
    ],
  },
  [-200]: {
    title: 'ERR_CERT_COMMON_NAME_INVALID (-200) — 证书域名不匹配',
    detail: '对端证书的标识与访问主机名不匹配。候选包括源站证书配置错误、强制门户、DNS/代理指向其他端点或中间设备替换证书。',
    conclusion: '证书名称与访问域名不匹配。可能是服务端证书/SAN 配置错误、未完成 Wi-Fi 门户认证、DNS 指向错误或中间设备替换证书，需要先查看实际证书主题、SAN 和颁发者。',
    actions: [
      '【关键】点击浏览器地址栏域名前的"小锁"图标，查看证书详情，确认颁发者和证书链',
      '【自查】检查是否连接了需要认证的 Wi-Fi（如酒店、机场、公司访客网络），尝试访问任意网页完成 Wi-Fi 认证',
      '对照访问主机名检查证书 SAN；不要假设固定 CA 或固定证书链',
      '若证书颁发者或指纹与预期不符，由 IT 核对代理、审计或终端安全策略是否替换证书',
      '检查系统时间是否正确（证书有效期验证依赖系统时间）',
    ],
  },
  [-201]: {
    title: 'ERR_CERT_DATE_INVALID (-201) — 证书日期无效',
    detail: '按客户端时钟判断，对端证书尚未生效或已经过期；客户端系统时间错误也会产生相同现象。',
    conclusion: '可以确认证书日期校验失败；先核对系统时间和证书有效期，再确定由客户端还是证书提供方处理。',
    actions: [
      '检查系统时间是否正确（时区、日期、时间）',
      '如果仅单个网站报错，联系该网站运维人员更新证书',
      '如果多个网站都报证书错误，记录实际颁发者和指纹，再核对系统时间、信任库及网络路径',
      '检查证书透明度（Certificate Transparency）信息是否完整',
    ],
  },
  [-202]: {
    title: 'ERR_CERT_AUTHORITY_INVALID (-202) — 证书颁发机构不受信任',
    detail: '对端证书无法链到客户端信任的证书颁发机构。候选包括自签名证书、企业私有 CA 未受信任、中间证书缺失或 HTTPS Inspection。',
    conclusion: '证书链无法建立到受信任根。候选原因包括自签名证书、企业私有 CA 未导入、中间证书缺失或 HTTPS Inspection；需要查看实际证书链后再确定处理方。',
    actions: [
      '记录实际证书链、颁发者、指纹和验证错误，不根据错误码假定固定证书来源',
      '如果是企业内网应用，由 IT 核对企业根证书下发与 HTTPS Inspection 策略',
      '由服务端核对是否返回完整中间证书链，以及证书是否应受客户端信任',
    ],
  },

  // ---- Proxy Errors ----
  [-111]: {
    title: 'ERR_TUNNEL_CONNECTION_FAILED (-111) — 代理隧道连接失败',
    detail: 'Chromium 记录到经代理建立 CONNECT 隧道失败；错误码本身不区分代理连接、认证、CONNECT 响应或代理到目标端点的连接阶段。',
    conclusion: '可以确认经代理建立隧道失败；还需区分代理连接、认证、CONNECT 响应和代理到目标端点的连接阶段。',
    actions: [
      '查看代理地址、端口、认证、CONNECT 响应码和同一请求的代理 source chain',
      '如果使用 PAC，记录该目标的 PAC 返回结果和 Bypass 匹配结果',
      '在符合组织安全策略的前提下做直连/代理对照；恢复只提高代理路径相关性',
      '由 IT 按复现时间核对代理可达性、认证、CONNECT 和目标端点日志',
    ],
  },
  [-130]: {
    title: 'ERR_PROXY_CONNECTION_FAILED (-130) — 代理连接失败',
    detail: '无法连接到代理服务器。与 ERR_TUNNEL_CONNECTION_FAILED 不同，此错误发生在连接代理服务器阶段，而非建立隧道阶段。',
    conclusion: '可以确认浏览器没有连上代理端点；代理名称解析、地址/端口、网络可达性和代理服务状态都需要验证。',
    actions: [
      '从代理配置和 source chain 记录实际代理地址与端口',
      '使用组织批准的端口测试工具验证代理端点可达性并记录结果',
      '在符合组织安全策略的前提下做另一代理路径或直连对照',
      '由 IT 按复现时间核对代理监听、访问控制和服务状态',
    ],
  },

  // ---- HTTP/2 Errors (-300~-399 range) ----
  [-337]: {
    title: 'ERR_HTTP2_PROTOCOL_ERROR (-337) — HTTP/2 协议错误',
    detail: 'Chromium 记录到 HTTP/2 协议错误。需要结合 GOAWAY/RST_STREAM 方向、错误码、stream id 和重试结果区分连接级与流级影响。',
    conclusion: '可以确认 HTTP/2 会话发生协议错误；单个 net_error 不能确定是客户端、服务端还是中间设备违反协议。',
    actions: [
      '查看 HTTP/2 session 的 GOAWAY、RST_STREAM、SETTINGS 和具体错误码',
      '确认受影响 stream 是否被安全重试，以及重试后是否成功',
      '由服务端和代理/网关团队按连接时间核对 HTTP/2 日志；协议降级仅作为受控对照',
    ],
  },
  [-352]: {
    title: 'ERR_HTTP2_PING_FAILED (-352) — HTTP/2 PING 未收到响应',
    detail: 'Chromium 记录到 HTTP/2 对端未响应 PING。它表示该会话的存活检测失败，不等同于通用 HTTP/2 协议错误。',
    conclusion: '可以确认 HTTP/2 会话未及时响应 PING；需要结合连接关闭、网络切换、代理和请求重试判断用户影响。',
    actions: [
      '查看同一 HTTP/2 session 的 PING、GOAWAY、关闭事件和未完成 stream',
      '确认连接是否自动重建，以及原请求是否在新连接上成功重试',
      '由服务端或中间设备团队核对空闲超时和连接保活策略',
    ],
  },

  // ---- QUIC Errors (-300~-399 range) ----
  [-356]: {
    title: 'ERR_QUIC_PROTOCOL_ERROR (-356) — QUIC 协议错误',
    detail: 'Chromium 记录到 QUIC 协议错误。需要结合 QUIC error、connection close、握手阶段、网络变更和回退结果判断影响。',
    conclusion: '可以确认 QUIC 会话发生协议错误；UDP 路径、客户端、服务端和中间设备都只是候选，不能仅凭 -356 排序责任方。',
    actions: [
      '查看 QUIC session 的具体 transport/application error、关闭方向和握手阶段',
      '确认请求是否回退到 HTTP/2/TCP 并成功；成功回退会降低用户影响',
      '如仅特定网络复现，由 IT 核对 UDP 路径和策略；如跨网络复现，由服务端核对 QUIC 配置',
    ],
  },

  // ---- Network Change ----
  [-21]: {
    title: 'ERR_NETWORK_CHANGED (-21) — 网络环境变更',
    detail: '请求过程中检测到网络环境发生变化（如 Wi-Fi 切换、VPN 连接/断开、网络接口变化）。Chromium 会主动取消正在进行的请求并返回此错误。',
    conclusion: '可以确认请求期间网络配置发生变化；只有与失败请求时间和 source chain 对齐时，才能认为它与当前问题相关。',
    actions: [
      '检查 Wi-Fi 信号是否稳定，尝试靠近路由器或使用有线连接',
      '如果使用了 VPN，检查 VPN 连接是否频繁断开重连',
      '禁用不必要的网络适配器（如虚拟网卡）',
      '检查是否有多个网络接口同时活跃导致路由冲突',
    ],
  },

  // ---- Blocked ----
  [-20]: {
    title: 'ERR_BLOCKED_BY_CLIENT (-20) — 请求被客户端阻止',
    detail: 'Chromium 记录到客户端选择阻止请求。扩展、浏览器功能或本机策略都是候选，但错误码不标识具体阻止者。',
    conclusion: '可以确认阻止发生在客户端侧；需要用扩展清单、策略页面或可控浏览器配置进一步定位。',
    actions: [
      '禁用所有浏览器扩展，逐个启用排查干扰项',
      '使用 Chrome 无痕模式测试，排除扩展影响',
      '检查是否有安全软件阻止了特定域名的访问',
    ],
  },
  [-22]: {
    title: 'ERR_BLOCKED_BY_ADMINISTRATOR (-22) — 请求被管理员阻止',
    detail: '请求被系统管理员策略或企业安全策略阻止。常见于企业环境中通过组策略或 MDM 限制了特定网站访问。',
    conclusion: '此错误表明企业安全策略阻止了访问，需要联系 IT 确认策略配置。',
    actions: [
      '联系 IT 确认是否有网站访问限制策略',
      '检查企业安全软件（如 DLP、上网行为管理）是否拦截了目标域名',
      '确认目标域名是否在企业白名单中',
    ],
  },
};

// ============================================================
// Error category classification
// ============================================================

interface CategoryGroup {
  catName: string;
  icon: string;
  sortWeight: number;
  codes: (string | number)[];
  requests: { url: string; error: number | string; time: number }[];
  domains: Set<string>;
  actions: string[];
  detailParts: string[];
  conclusionParts: Set<string>;
}

function _getErrorCategory(code: string | number | null): { catName: string; icon: string; sortWeight: number } {
  return classifyNetError(code);
}

function _dedupActions(actions: string[]): string[] {
  const seen = new Set<string>();
  return actions.filter(a => {
    const key = a.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================
// Generate suggestions based on knowledge base
// ============================================================

export function generateSuggestions(r: AnalysisResult): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // ---- Connection failures: group by category and merge ----
  if (r.connectionFailures.length > 0) {
    const errCodes = [...new Set(r.connectionFailures.map(f => f.error).filter(Boolean))];
    const categoryGroups = new Map<string, CategoryGroup>();

    for (const code of errCodes) {
      const { catName, icon, sortWeight } = _getErrorCategory(code);
      const key = `${sortWeight.toString().padStart(2, '0')}_${catName}`;

      if (!categoryGroups.has(key)) {
        categoryGroups.set(key, {
          catName,
          icon,
          sortWeight,
          codes: [],
          requests: [],
          domains: new Set(),
          actions: [],
          detailParts: [],
          conclusionParts: new Set(),
        });
      }

      const group = categoryGroups.get(key)!;
      group.codes.push(code);

      const affected = r.connectionFailures.filter(f => f.error === code);
      group.requests.push(...affected);
      for (const f of affected) {
        try {
          const url = new URL(f.url);
          if (url.hostname) group.domains.add(url.hostname);
        } catch { /* ignore */ }
      }

      const numCode = typeof code === 'number' ? code : Number(code);
      if (!isNaN(numCode) && ERROR_SOLUTIONS[numCode]) {
        const sol = ERROR_SOLUTIONS[numCode];
        group.actions.push(...sol.actions);
        group.detailParts.push(`${code}: ${sol.title}`);
        group.conclusionParts.add(sol.conclusion);
      } else {
        const desc = getNetErrorDescription(code);
        group.detailParts.push(`${code}: ${desc}`);
        const defaultConclusions: Record<string, string> = {
          '应用层': '应用层错误需要结合具体请求场景分析。',
          '连接': '网络链路错误需要排查防火墙、代理、安全软件和网络链路质量。',
          '客户端': '客户端请求被取消或本地处理失败，需要结合请求生命周期和调用方行为确认。',
          '证书': '已记录证书类错误，需要查看证书链、系统信任和中间设备证据后判断原因。',
          '协议': '已记录协议类错误，可通过协议对比验证相关性，但不能仅凭错误码确定责任方。',
          'DNS': '已记录 DNS 类错误，需要结合解析结果、解析器响应和网络连通性判断原因。',
        };
        group.conclusionParts.add(defaultConclusions[catName] || '未知错误建议按照通用排查流程处理。');

        const defaultActions: Record<string, string[]> = {
          '应用层': [
            '检查请求是否在发送过程中被取消',
            '查看客户端日志获取更详细的错误上下文',
            '检查是否有业务逻辑拦截了请求',
          ],
          '连接': [
            '先查看同一请求的 socket/source chain，确定连接失败发生在哪个阶段',
            '确认实际目标 IP、端口和代理路径，再用 curl/connect 工具做同端点验证',
            '切换手机热点或其他网络复现；若同一请求多次稳定恢复，后续优先检查工区网络路径，但不直接确认责任设备',
          ],
          '客户端': [
            '检查请求是否被页面卸载、AbortController、超时器或用户操作取消',
            '在稳定网络下重新复现，并查看同一 URL_REQUEST 的完整 source chain',
          ],
          '证书': [
            '查看证书详情中的 SAN、颁发者、有效期和证书链',
            '检查系统时间是否正确',
            '根据实际证书链区分源站配置、企业私有 CA 与 HTTPS Inspection',
          ],
          '协议': [
            '查看协议错误码、方向、连接/stream id 和重试结果',
            '确认问题是否只发生在特定协议路径；受控降级只能作为相关性验证',
            '由服务端和代理/网关团队核对同一时间窗口的协议日志',
          ],
          'DNS': [
            '使用 nslookup/dig 查看当前解析器的返回状态和地址',
            `中国大陆网络可与 ${MAINLAND_CHINA_DNS_COMPARISON_LIST} 逐个对照；临时改系统 DNS 前记录原配置，测试后恢复`,
            `项目首轮不默认选择 ${MAINLAND_CHINA_DNS_NON_DEFAULT_LIST}，但解析器地址本身仍不是故障证据`,
            '检查 hosts、Secure DNS/DoH、VPN、代理和 Split DNS 策略',
          ],
        };
        if (defaultActions[catName]) {
          group.actions.push(...defaultActions[catName]);
        }
      }
    }

    // Sort by weight and build suggestions
    const sortedGroups = Array.from(categoryGroups.values()).sort((a, b) => a.sortWeight - b.sortWeight);
    for (const g of sortedGroups) {
      const codeList = g.codes.slice(0, 5).join(', ') + (g.codes.length > 5 ? ` 等${g.codes.length}个` : '');
      const detail = `检测到以下错误：\n${g.detailParts.map(p => `  - ${p}`).join('\n')}\n\n影响范围: ${g.requests.length}个请求, ${g.domains.size}个域名`;
      const conclusion = Array.from(g.conclusionParts).join('；');
      const actions = _dedupActions(g.actions);

      // 结构化字段映射：将 errorClassifier 的分类映射到 Suggestion 结构化字段
      const categoryMap: Record<string, Suggestion['category']> = {
        'DNS': 'dns',
        '证书': 'tls',
        '代理': 'proxy',
        '网络变更': 'network-change',
        '阻止': 'security',
        '协议': 'protocol',
        '连接': 'connect',
        '客户端': 'client',
        '应用层': 'server',
        '缓存': 'cache',
        '其他': 'unknown',
      };

      const singleCode = g.codes.length === 1 ? Number(g.codes[0]) : Number.NaN;
      const singleSolution = Number.isFinite(singleCode) ? ERROR_SOLUTIONS[singleCode] : undefined;
      suggestions.push({
        icon: g.icon,
        title: singleSolution?.title || `${g.catName}问题 -- 涉及错误码: ${codeList}`,
        detail,
        conclusion,
        actions,
        errorCode: typeof g.codes[0] === 'number' ? g.codes[0] : Number(g.codes[0]),
        category: categoryMap[g.catName] || 'unknown',
        severity: g.catName === 'DNS' || g.catName === '证书' ? 'critical' : 'warning',
      });
    }
  }

  // ---- Slow requests ----
  if (r.slowRequests.length > 0) {
    suggestions.push({
      icon: '🦈',
      title: '慢请求排查建议 — 先看 NetLog 请求生命周期',
      detail: `检测到 ${r.slowRequests.length} 个慢请求（>3s）。优先使用 NetLog 的请求生命周期和 source chain 判断慢在哪个阶段；若阶段仍无法解释，再补同次 HAR 或抓包。`,
      conclusion: '慢请求应先按 DNS、TCP、TLS、请求发送和响应等待阶段缩小范围；Wireshark 是证据不足时的进阶补充，不是所有慢请求的默认第一步。',
      actions: [
        '【第一步】在请求详情查看生命周期和 source chain，确认主要耗时阶段',
        '【第二步】补采同次 HAR，对比 Waiting/TTFB 与下载阶段',
        '仅在 HAR/NetLog 仍无法解释时，由具备权限的人员采集脱敏抓包并做正常/异常对照',
      ],
    });
  }

  // ---- Proxy/VPN ----
  const pi = r.proxyInfo;
  if (pi.isVPN) {
    suggestions.unshift({
      icon: '🚨',
      title: '检测到 VPN 环境',
      detail: '日志中检测到 VPN 使用迹象。VPN 可能改变出口、路由和解析路径，但配置存在本身不是故障证据。',
      conclusion: '已观察到 VPN 环境。VPN 会改变出口路径，但不能仅凭配置判断它导致了当前问题；可在符合安全策略的前提下关闭后对比。',
      actions: [
        '【建议】在符合安全策略的前提下临时关闭 VPN 后重试；测试完成后恢复组织要求的 VPN 设置',
        '记录启用/停用 VPN 时的解析结果、目标 IP 和请求结果差异',
        '若关闭后同一请求多次稳定恢复，优先核对 VPN 路由、DNS 和访问控制；这仍不是唯一根因证明',
        '如果必须使用 VPN，由 IT 核对配置并提供合规修复方案',
      ],
      category: 'proxy',
      severity: 'info',
    });
  } else if (pi.hasProxy) {
    suggestions.unshift({
      icon: '⚠️',
      title: '检测到代理服务器配置',
      detail: `当前配置了代理（模式: ${pi.proxyType}，服务器: ${pi.proxyList.join(', ')}）。这是环境事实，只有代理类错误、PAC/CONNECT 失败或受控对比才能提高关联置信度。`,
      conclusion: '已观察到代理配置。配置存在不等于代理故障；只有代理类 net_error、PAC/CONNECT 失败或开关对比结果才能提高关联置信度。',
      actions: [
        '记录代理模式、代理端点和 PAC 对问题域名的返回结果',
        '查看是否存在代理类 net_error、认证失败或 CONNECT 隧道失败',
        '在符合组织安全策略的前提下做直连/代理对照，记录同一请求结果，测试完成后恢复原代理设置',
        '若直连多次稳定恢复，优先核对 PAC、代理认证、CONNECT 和白名单；只提高代理路径关联置信度',
      ],
      category: 'proxy',
      severity: 'info',
    });
  }

  // ---- Failed domains ----
  if (r.failedDomains.length > 0) {
    const domainList = r.failedDomains.slice(0, 10).map(d => `${d.domain} (${d.count}次)`).join('、');
    const failedCategories = new Set(r.failedDomains.flatMap(domain =>
      domain.errorCodes.map(code => classifyNetError(code).catName)
    ));
    const singleCategory = failedCategories.size === 1 ? Array.from(failedCategories)[0] : null;
    const categoryMap: Record<string, Suggestion['category']> = {
      DNS: 'dns',
      证书: 'tls',
      代理: 'proxy',
      网络变更: 'network-change',
      阻止: 'security',
      协议: 'protocol',
      连接: 'connect',
      客户端: 'client',
      应用层: 'server',
      缓存: 'cache',
    };
    suggestions.push({
      icon: '❌',
      title: `报错域名汇总 (${r.failedDomains.length}个)`,
      detail: `以下域名出现网络错误：${domainList}`,
      conclusion: `多个域名记录到错误，错误类别为 ${Array.from(failedCategories).join('、') || '未知'}；不能仅凭域名数量判断为 DNS 或防火墙问题，应按错误码和 source chain 分组排查。`,
      actions: [
        '按错误码类别和 URL_REQUEST source chain 分组，不要把所有失败域名合并为同一原因',
        '使用 nslookup/dig、curl/connect 和请求详情分别验证解析、连接和应用层结果',
        '只有看到明确策略拒绝日志后，才进入白名单或访问控制变更流程',
      ],
      category: singleCategory ? (categoryMap[singleCategory] || 'unknown') : 'unknown',
      severity: 'warning',
    });
  }

  // ---- DNS hijack detection ----
  const hijackedDomains = r.failedDomains.filter(d =>
    d.ips.some(ip => ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1')
  );
  if (hijackedDomains.length > 0) {
    suggestions.push({
      icon: '🚨',
      title: `DNS 解析到本地地址 (${hijackedDomains.length}个域名)`,
      detail: `以下域名被解析到本地地址：${hijackedDomains.map(d => `${d.domain} → ${d.ips.filter(ip => ip === '127.0.0.1' || ip === '0.0.0.0').join(', ')}`).join('、')}`,
      conclusion: '域名解析到本地地址可能来自 hosts、广告拦截/安全软件、企业策略、本地代理或解析器异常；不能单独确认运营商 DNS 故障，需要先对比 hosts 和不同解析器结果。',
      actions: [
        '【第一步】检查 hosts 文件、广告拦截扩展和本地安全软件是否配置了该域名',
        `【对比】使用当前 DNS、企业 DNS 和 ${MAINLAND_CHINA_DNS_COMPARISON_LIST} 分别执行 nslookup，记录结果差异`,
        '若企业 DNS 返回本地地址，联系 IT 确认是否为预期的安全或分流策略',
        '若确认缓存与当前权威结果不一致，再清除系统 DNS 缓存并复测',
      ],
      category: 'dns',
      severity: 'warning',
    });
  }

  // ---- Cross-network detection: user self-check suggestion ----
  // The tool cannot query IP ISP info, so provide self-check guidance
  const crossNetworkDomains = r.failedDomains.filter(d => {
    return (d.resolvedIp || d.remoteIp) && d.errors.length > 0;
  });
  if (crossNetworkDomains.length > 0) {
    suggestions.push({
      icon: '🔍',
      title: '目标 IP 与路径补证建议',
      detail: `以下域名请求失败时记录到目标 IP：${crossNetworkDomains.slice(0, 5).map(d => d.domain).join('、')}。IP 归属和地域只能作为路径背景。`,
      conclusion: '目标 IP 的运营商或地域不能单独证明链路故障；还需要出口信息、路由/MTR、复现时间和不同网络的请求结果。',
      actions: [
        '记录客户端出口 IP、NetLog 目标 IP、问题域名和复现时间',
        '使用产品内 IP 证据查询或组织批准的查询源核对归属',
        '补充 MTR/traceroute 和另一网络的同请求结果；差异只作为待验证线索',
      ],
      category: 'unknown',
      severity: 'info',
    });
  }

  // ---- Network change detection ----
  if (r.networkChanges.length > 0) {
    suggestions.push({
      icon: '🔄',
      title: `会话期间检测到 ${r.networkChanges.length} 次网络变更`,
      detail: 'NetLog 记录到网络环境发生变化；该事实是否影响具体请求取决于时间和 source chain 对齐。',
      conclusion: '会话中记录到网络变更。只有失败请求与变更发生在同一 source chain 和时间窗口时，才能认为两者可能相关。',
      actions: [
        '检查是否有 Wi-Fi/有线网络切换',
        '检查 VPN 连接是否不稳定',
        '将变更时间与失败请求、重试结果和 source chain 对齐',
      ],
      category: 'network-change',
      severity: r.networkChanges.length > 3 ? 'warning' : 'info',
    });
  }

  // ---- HTTP/2 GOAWAY detection ----
  const goawayCount = r.eventCategoryStats?.http2.suggestionGoawayCount
    ?? r.http2Events?.filter(e => e.type === 212 || e.type === 213).length
    ?? 0;
  if (goawayCount > 0) {
    suggestions.push({
      icon: '📡',
      title: `检测到 HTTP/2 GOAWAY 帧 (${goawayCount} 个)`,
      detail: '记录到 HTTP/2 GOAWAY 帧，可能是本端发送或从对端接收。错误码如果是 0x1（协议错误），可能与服务端、中间节点（如 TLB）或客户端连接生命周期有关。',
      conclusion: '检测到 HTTP/2 GOAWAY。GOAWAY 可以是正常优雅关闭，也可能携带协议或内部错误；需要先查看错误码、last_stream_id 和请求是否成功重试。',
      actions: [
        '检查 GOAWAY 帧的错误码（0x1 表示协议错误）',
        '排查代理服务器是否支持 HTTP/2',
        '确认受影响 stream 是否自动重试并在新连接成功',
        '由服务端、代理或负载均衡团队核对同一连接时间的 GOAWAY 记录',
      ],
      category: 'protocol',
      severity: 'warning',
    });
  }

  return suggestions;
}

// ============================================================
// Next step information collection (based on oncall experience)
// ============================================================

export interface NextStepInfo {
  category: string;
  description: string;
  items: string[];
}

function hasDnsTroubleshootingEvidence(r: AnalysisResult): boolean {
  const hasDnsErrorCode = [
    ...r.connectionFailures.map(failure => failure.error),
    ...r.failedDomains.flatMap(domain => domain.errorCodes),
  ].some(code => classifyNetError(code).catName === 'DNS');
  const hasLocalAddressMapping = r.failedDomains.some(domain =>
    domain.ips.some(ip => ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1')
  );
  const hasDnsIssue = [...r.errors, ...r.warnings].some(issue => /DNS|域名解析/i.test(`${issue.category} ${issue.message}`));
  return hasDnsErrorCode || hasLocalAddressMapping || hasDnsIssue;
}

export function generateNextStepInfo(r: AnalysisResult): NextStepInfo[] {
  const steps: NextStepInfo[] = [];

  steps.push({
    category: '📋 基础信息收集',
    description: '先收集能与 NetLog 请求和时间线对齐的事实，避免只根据错误码猜测责任方：',
    items: [
      '记录问题域名、复现时间、网络环境以及失败请求的 NetLog source ID / net_error',
      '执行 nslookup/dig 记录当前解析器、返回状态和目标地址',
      '使用 curl 或等价工具验证同一 host:port，区分拒绝、超时、TLS 和 HTTP 结果',
      '需要链路信息时使用 tracert/traceroute/MTR；中间跳不响应 ICMP 不等于该跳故障',
    ],
  });

  // DNS related
  const hasDnsErrors = hasDnsTroubleshootingEvidence(r);
  const hasDisconnected = r.connectionFailures.some(f => {
    const code = typeof f.error === 'number' ? f.error : Number(f.error);
    return code === -106;
  });
  if (hasDisconnected) {
    steps.push({
      category: '📶 本机网络连接恢复',
      description: '检测到浏览器记录网络已断开，先恢复设备联网，再继续判断 DNS、代理或目标服务。',
      items: [
        '确认 Wi-Fi / 有线网络已连接，并尝试访问其他常见网站',
        '重连当前网络；仍无网络时切换手机热点做对比',
        '如使用 VPN、代理或安全软件，在符合安全策略的前提下临时断开后重试',
        '若整机仍无法联网，联系 IT 检查网卡、DHCP、网关和终端网络策略',
      ],
    });
  }
  if (hasDnsErrors || r.failedDomains.some(d => d.ips.some(ip => ip === '127.0.0.1' || ip === '0.0.0.0'))) {
    steps.push({
      category: '🌐 DNS 问题进一步排查',
      description: '检测到 DNS 相关问题，需要进一步确认 DNS 配置和解析结果：',
      items: [
        '执行 nslookup <问题域名> 查看当前 DNS 服务器和解析结果',
        `中国大陆网络可用 ${MAINLAND_CHINA_DNS_COMPARISON_LIST} 逐个做临时解析对照`,
        '如需临时修改系统 DNS，先记录原配置，测试后恢复；企业内网和 Split DNS 场景先联系 IT',
        `基于项目经验，首轮不默认选择 ${MAINLAND_CHINA_DNS_NON_DEFAULT_LIST}；不同结果不自动表示当前解析器错误`,
        '检查 hosts 文件是否有异常映射（Windows: C:\\Windows\\System32\\drivers\\etc\\hosts）',
        '记录系统 DNS、Secure DNS/DoH、VPN、代理和 Split DNS 配置',
      ],
    });
  }

  const hasConnectionOrTlsErrors = r.connectionFailures.some(f => {
    const code = typeof f.error === 'number' ? f.error : Number(f.error);
    return code === -101 || code === -102 || code === -103 || code === -118 || code === -107;
  });
  if (hasConnectionOrTlsErrors) {
    steps.push({
      category: '🔗 连接 / TLS 进一步排查',
      description: '检测到连接或 TLS 错误；防火墙、安全软件、代理和服务端都只是候选：',
      items: [
        '查看同一 URL_REQUEST / socket source chain，确定失败阶段、目标端点和代理路径',
        '同一设备切换手机热点或其他网络复测；若多次稳定恢复，后续优先检查工区 DNS、网关、防火墙、准入和代理路径',
        `检查 ${CONNECTION_RESET_SECURITY_EXAMPLES} 的拦截记录与白名单配置；厂商名只是排查范围示例`,
        '由 IT、代理和服务端团队按复现时间核对明确的拒绝、重置、超时或 TLS 日志',
        '只有存在策略命中证据时才修改白名单或安全策略，并保留回退方案',
      ],
    });
  }

  // Certificate related
  const hasCertErrors = r.connectionFailures.some(f => {
    const code = typeof f.error === 'number' ? f.error : Number(f.error);
    return code >= -299 && code <= -200;
  });
  if (hasCertErrors) {
    steps.push({
      category: '🔒 证书问题进一步排查',
      description: '检测到 SSL/TLS 证书错误，需要进一步确认证书状态：',
      items: [
        '查看证书详情中的 SAN、颁发者、有效期、指纹和证书链',
        '检查是否连接了需要认证的 Wi-Fi（如酒店、机场、公司访客网络）',
        '检查系统时间是否正确（时区、日期、时间）',
        '根据实际颁发者区分源站证书、企业私有 CA 和 HTTPS Inspection，再确定处理方',
      ],
    });
  }

  if (r.failedDomains.some(d => (d.resolvedIp || d.remoteIp) && d.errors.length > 0)) {
    steps.push({
      category: '🧭 目标 IP 与路径补证',
      description: '目标 IP 归属只提供路径背景，不能单独确认链路故障：',
      items: [
        '记录客户端出口、目标 IP、问题域名和复现时间',
        '使用产品内 IP 证据或组织批准的查询源核对归属',
        '补充 MTR/traceroute 和另一网络的同请求结果，并确认 CDN/业务调度是否符合预期',
      ],
    });
  }

  // Proxy related
  if (r.proxyInfo.hasProxy || r.proxyInfo.isVPN) {
    steps.push({
      category: '🔀 代理/VPN 排查',
      description: '检测到代理/VPN 配置，需要进一步确认其影响：',
      items: [
        `当前代理模式: ${r.proxyInfo.proxyType || '未知'}，代理服务器: ${r.proxyInfo.proxyList.join(', ') || '未知'}`,
        '在符合组织策略的前提下临时关闭代理/VPN 后对比，测试完成后恢复原设置',
        '检查 PAC 脚本是否正确配置了 Bypass 列表',
        '查看 PAC 选择、代理连接、认证和 CONNECT 隧道事件',
        '若关闭后同一请求多次稳定恢复，优先核对 PAC、CONNECT、路由和 DNS；仍不直接确认唯一根因',
      ],
    });
  }

  if (r.slowRequests.length > 0) {
    steps.push({
      category: '⏱️ 慢请求补证',
      description: `检测到 ${r.slowRequests.length} 个慢请求；先按现有证据缩小阶段，再决定是否抓包：`,
      items: [
        '查看请求生命周期和同次 HAR，区分 DNS、connect、TLS、响应等待与下载阶段',
        '将阈值命中视为异常提示，不直接转成责任方或根因',
        '仍无法解释时，由具备权限的人员采集脱敏的正常/异常对照抓包',
      ],
    });
  }

  return steps;
}

// ============================================================
// Network troubleshooting checklist (based on knowledge base)
// ============================================================

export interface CheckItem {
  category: string;
  items: { label: string; description: string; checked: boolean }[];
}

export function generateChecklist(r: AnalysisResult): CheckItem[] {
  const items: CheckItem[] = [];
  const targetDomain = r.failedDomains[0]?.domain || '<域名>';
  const hasDnsEvidence = hasDnsTroubleshootingEvidence(r);

  items.push({
    category: '🌐 DNS 检查',
    items: [
      { label: '记录当前解析', description: `执行 nslookup/dig ${targetDomain}，记录解析器、返回状态和地址`, checked: false },
      ...(hasDnsEvidence ? [
        { label: '对照解析结果', description: `中国大陆网络依次测试 ${MAINLAND_CHINA_DNS_COMPARISON_LIST}；结果不同不自动表示故障`, checked: false },
        { label: '恢复原 DNS', description: `临时修改前记录原配置，测试后恢复；首轮不默认使用 ${MAINLAND_CHINA_DNS_NON_DEFAULT_LIST}`, checked: false },
      ] : []),
      { label: '检查解析路径', description: '核对 hosts、Secure DNS/DoH、VPN、代理和 Split DNS 配置', checked: false },
      { label: '核对本地地址', description: '解析到 loopback/空地址时，确认是否为预期的 hosts、过滤或企业策略', checked: false },
    ],
  });

  items.push({
    category: '🔗 网络连通性',
    items: [
      { label: '验证目标端点', description: `使用 curl 或等价工具访问 ${targetDomain} 的实际端口，记录拒绝、超时、TLS 或 HTTP 结果`, checked: false },
      { label: '查看路由路径', description: `Windows: tracert ${targetDomain} | macOS/Linux: traceroute ${targetDomain}`, checked: false },
      { label: '解释 ICMP 限制', description: 'ping 或中间跳不响应不能单独证明目标或该跳故障', checked: false },
      { label: '执行网络对比', description: '同一请求在热点多次正常、工区网络多次失败时，优先检查工区网络路径，但不锁定具体设备', checked: false },
    ],
  });

  // Proxy/VPN
  if (r.proxyInfo.hasProxy || r.proxyInfo.isVPN) {
    items.push({
      category: '🔀 代理/VPN 排查',
      items: [
        { label: '检查代理配置', description: `当前代理: ${r.proxyInfo.proxyList.join(', ') || '未知'}，模式: ${r.proxyInfo.proxyType || '未知'}`, checked: false },
        { label: '尝试关闭代理', description: 'Mac: 系统偏好设置 → 网络 → 高级 → 代理 | Windows: 设置 → 网络和 Internet → 代理', checked: false },
        { label: '检查 PAC 脚本', description: r.proxyInfo.pacUrl ? `PAC 地址: ${r.proxyInfo.pacUrl}` : '检查是否配置了 PAC 自动代理脚本', checked: false },
        { label: '对比直连测试', description: '关闭代理/VPN 后重新访问；若恢复则优先核对 PAC、CONNECT、路由和 DNS，测试后恢复原设置', checked: false },
      ],
    });
  }

  items.push({
    category: '🛡️ 策略与安全证据',
    items: [
      { label: '检查安全软件和防火墙', description: `查看 ${CONNECTION_RESET_SECURITY_EXAMPLES}、防火墙的拦截日志及域名/IP/端口白名单；示例不代表已确认拦截`, checked: false },
      { label: '查看策略命中日志', description: '由 IT 按域名、目标 IP、端口和复现时间查找明确的允许/拒绝记录', checked: false },
      { label: '核对证书链', description: '记录证书 SAN、颁发者、有效期和指纹，判断实际连接端点', checked: false },
      { label: '变更需有证据', description: '只有明确策略命中后才修改白名单或安全策略，并准备回退', checked: false },
    ],
  });

  items.push({
    category: '💻 浏览器排查',
    items: [
      { label: '使用受支持版本', description: '在受支持的稳定版 Chrome/Edge 中复现，不依赖实验性 flags', checked: false },
      { label: '隔离扩展影响', description: '只有出现 ERR_BLOCKED_BY_CLIENT 等客户端阻止证据时，再用受控配置对比扩展', checked: false },
      { label: '保留原始证据', description: '记录失败请求、source/event ID 和复现时间后再修改缓存或配置', checked: false },
    ],
  });

  return items;
}

// ============================================================
// Export report
// ============================================================

function reportHostFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function uniqueAffectedDomains(r: AnalysisResult): string[] {
  const domains = new Set<string>();
  for (const fd of r.failedDomains || []) {
    if (fd.domain) domains.add(fd.domain);
  }
  for (const req of [...(r.urlRequests || []), ...(r.slowRequests || [])]) {
    const host = reportHostFromUrl(req.url);
    if (host && (req.error || (req.statusCode && req.statusCode >= 400) || (req.duration || 0) >= 3000)) {
      domains.add(host);
    }
  }
  for (const failure of r.connectionFailures || []) {
    const host = reportHostFromUrl(failure.url);
    if (host) domains.add(host);
  }
  return Array.from(domains).sort();
}

function buildUserFacingReason(r: AnalysisResult, suggestions: Suggestion[]): string {
  if (r.proxyInfo.isVPN || r.proxyInfo.hasProxy) {
    return '当前环境记录到 VPN / 代理配置；这是路径背景，是否影响请求仍需结合代理错误或开关对比。';
  }
  if (r.failedDomains.length > 0) {
    return '存在失败请求；应先按每个请求的 net_error 和 source chain 区分解析、连接、TLS、代理或协议阶段。';
  }
  if (r.slowRequests.length > 0) {
    return '存在慢请求；需要按请求生命周期区分浏览器排队、网络阶段、响应等待和下载阶段。';
  }
  if (suggestions[0]?.conclusion) {
    return suggestions[0].conclusion;
  }
  return '未发现单一明确根因，建议按下方步骤补充可与请求对齐的证据。';
}

function buildImmediateActions(r: AnalysisResult): string[] {
  const actions: string[] = [];
  const hasConnectionReset = r.connectionFailures.some(failure => failure.error === -101)
    || r.failedDomains.some(domain => domain.errorCodes.includes(-101));
  if (r.proxyInfo.isVPN || r.proxyInfo.hasProxy) {
    actions.push('在符合组织安全策略的前提下做 VPN / 代理开关对比，记录同一请求结果，测试完成后恢复原设置。');
  }
  if (hasConnectionReset) {
    actions.push(`检查 ${CONNECTION_RESET_SECURITY_EXAMPLES} 和防火墙的拦截日志、域名/IP/端口白名单；这些只是排查范围，不代表已确认拦截。`);
    actions.push('同一设备切换手机热点复测；若热点多次正常、工区网络多次失败，后续优先检查工区网络路径。');
  }
  if (hasDnsTroubleshootingEvidence(r)) {
    actions.push(`先记录当前解析，再用 ${MAINLAND_CHINA_DNS_COMPARISON_LIST} 逐个做临时对照；修改系统 DNS 前记录原配置，测试后恢复。`);
  } else if (r.failedDomains.length > 0) {
    actions.push('按错误码和 source chain 区分失败阶段，不要把所有失败请求都归为 DNS 问题。');
  }
  if (r.slowRequests.length > 0 || r.connectionFailures.length > 0) {
    actions.push('记录问题域名、目标 IP、复现时间和 curl/traceroute 结果，交给对应团队按时间核对。');
  }
  if (actions.length === 0) {
    actions.push('换一个网络环境（如手机热点）重试，用于区分本机/办公网问题。');
    actions.push('如果仍复现，请把本报告和复现时间发给 IT 或网络团队。');
  }
  return actions.slice(0, 3);
}

function formatReportList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

export interface ExportReportOptions {
  ipRoutingConclusions?: IpRoutingConclusion[];
}

function extraActionsForIpConclusion(conclusion: IpRoutingConclusion): string[] {
  const text = `${conclusion.title} ${conclusion.detail}`;
  if (text.includes('跨境')) {
    return [
      '记录 VPN / 代理开关前后的出口、目标 IP 和同一请求结果。',
      '确认该地域/线路是否符合 CDN 或业务调度预期，并补充 MTR/traceroute。',
    ];
  }
  if (text.includes('运营商')) {
    return [
      '使用另一网络做同请求对比，并记录出口、目标 IP、时延和路由差异。',
      '运营商不同只作为路径线索，把对比结果提供给网络团队继续核对。',
    ];
  }
  return [];
}

function appendIpRoutingConclusions(report: string, conclusions: IpRoutingConclusion[]): string {
  const effectiveConclusions = conclusions.filter(item => item.title || item.detail);
  if (effectiveConclusions.length === 0) return report;

  let nextReport = report;
  nextReport += `## IP 归属结论\n\n`;
  effectiveConclusions.forEach((conclusion, index) => {
    nextReport += `### ${index + 1}. ${conclusion.title}\n\n`;
    nextReport += `${conclusion.detail}\n\n`;
    if (conclusion.evidence.length > 0) {
      nextReport += `证据：${conclusion.evidence.join('；')}\n\n`;
    }
    const actions = Array.from(new Set([
      conclusion.nextAction,
      ...extraActionsForIpConclusion(conclusion),
    ].filter(Boolean)));
    if (actions.length > 0) {
      nextReport += `建议：\n${formatReportList(actions)}\n\n`;
    }
  });
  return nextReport;
}

export function exportReport(r: AnalysisResult, options: ExportReportOptions = {}): string {
  const suggestions = generateSuggestions(r);
  const affectedDomains = uniqueAffectedDomains(r);
  const reason = buildUserFacingReason(r, suggestions);
  const immediateActions = buildImmediateActions(r);

  let report = `# 网络问题处理建议\n`;
  report += `生成时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

  report += `## 先看这里\n\n`;
  report += `**可能原因：** ${reason}\n\n`;
  report += `**你现在该做什么：**\n${formatReportList(immediateActions)}\n\n`;
  report += `**是否需要找 IT / 网络团队：** ${r.connectionFailures.length > 0 || r.failedDomains.length > 0 || r.proxyInfo.hasProxy ? '建议联系。请附上本报告、复现时间和受影响域名。' : '可先按上方步骤自查；若仍复现，再联系 IT / 网络团队。'}\n\n`;

  if (r.largeFileMode?.enabled) {
    report += `> 大文件模式：已完整扫描 ${(r.largeFileMode.bytesRead / 1024 / 1024).toFixed(1)}MB，解析事件 ${r.largeFileMode.parsedEvents.toLocaleString()} 条，跳过异常事件 ${r.largeFileMode.skippedEvents.toLocaleString()} 条。为避免浏览器内存溢出，报告不包含完整原始 JSON。\n\n`;
  }

  report += `## 关键发现\n\n`;
  const findings: string[] = [];
  if (r.failedDomains.length > 0) findings.push(`发现 ${r.failedDomains.length} 个失败域名。`);
  if (r.slowRequests.length > 0) findings.push(`发现 ${r.slowRequests.length} 个慢请求。`);
  if (r.connectionFailures.length > 0) findings.push(`发现 ${r.connectionFailures.length} 条连接失败记录。`);
  if (r.dnsServers.length > 0) findings.push(`NetLog 记录到 DNS server：${r.dnsServers.join('、')}；地址本身不等于故障。`);
  if (r.proxyInfo.isVPN) findings.push(`检测到 VPN 线索：${r.proxyInfo.vpnHints.join('、') || '代理配置含 VPN 特征'}。`);
  else if (r.proxyInfo.hasProxy) findings.push(`检测到代理配置：${r.proxyInfo.proxyType || '未知模式'}。`);
  if (findings.length === 0) findings.push('未发现明显 DNS、代理、失败域名或慢请求集中异常。');
  report += findings.map(item => `- ${item}`).join('\n') + `\n\n`;

  if (hasDnsTroubleshootingEvidence(r)) {
    report += `## DNS 建议\n\n`;
    report += `只有错误码或 DNS task 指向解析阶段时，才进入 DNS 排查。先记录当前解析器的返回状态和地址；中国大陆网络可用 ${MAINLAND_CHINA_DNS_COMPARISON_LIST} 逐个做临时对照。修改系统 DNS 前记录原配置，测试后恢复；基于项目经验首轮不默认选择 ${MAINLAND_CHINA_DNS_NON_DEFAULT_LIST}。不要仅凭 DNS server 地址或地域直接修改系统 DNS，解析器地址或一次恢复都不能单独证明唯一根因。\n\n`;
  }

  if (suggestions.length > 0) {
    report += `## 建议操作\n\n`;
    suggestions.slice(0, 3).forEach((s, i) => {
      const actions = (s.actions || []).slice(0, 2);
      report += `### ${i + 1}. ${s.title}\n\n`;
      report += `${s.conclusion}\n\n`;
      if (actions.length > 0) {
        report += actions.map((action, index) => `${index + 1}. ${action}`).join('\n') + `\n\n`;
      }
    });
  }

  report = appendIpRoutingConclusions(report, options.ipRoutingConclusions || []);

  if (affectedDomains.length > 0) {
    const visibleDomains = affectedDomains.slice(0, 10);
    const hiddenCount = affectedDomains.length - visibleDomains.length;
    report += `## 受影响域名\n\n`;
    visibleDomains.forEach(domain => {
      report += `- ${domain}\n`;
    });
    if (hiddenCount > 0) {
      report += `- 另有 ${hiddenCount} 个域名未展示\n`;
    }
    report += `\n`;
  }

  report += `## 技术摘要\n\n`;
  report += `| 指标 | 数值 |\n`;
  report += `|------|------|\n`;
  report += `| 总事件数 | ${r.totalEvents.toLocaleString()} |\n`;
  report += `| URL 请求 | ${r.urlRequests.length} |\n`;
  report += `| 错误 | ${r.errors.length} |\n`;
  report += `| 警告 | ${r.warnings.length} |\n`;
  report += `| 慢请求(>3s) | ${r.slowRequests.length} |\n`;
  report += `| DNS 服务器 | ${(r.dnsServers || []).join(', ') || '未记录'} |\n`;
  if (r.largeFileMode?.enabled) {
    report += `| 大文件模式 | 已启用，关键事件样本${r.largeFileMode.truncatedEventsPreview ? '已截断' : '未截断'} |\n`;
  }
  if (r.proxyInfo.isVPN) {
    report += `| VPN | ${r.proxyInfo.vpnHints.join(', ')} |\n`;
  } else if (r.proxyInfo.hasProxy) {
    report += `| 代理 | ${r.proxyInfo.proxyType} (${r.proxyInfo.proxyList.join(', ')}) |\n`;
  }
  report += `\n`;

  return report;
}
