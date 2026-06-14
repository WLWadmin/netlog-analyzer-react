import { AnalysisResult } from './parser';
import { getNetErrorDescription } from './constants';

export interface Suggestion {
  icon: string;
  title: string;
  detail: string;
  conclusion: string;
  actions: string[];
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
// Based on: net_error knowledge base + 网络oncall排查.md + Chromium official net_error_list.h
// ============================================================

const ERROR_SOLUTIONS: Record<number, ErrorSolution> = {
  // ---- DNS Errors (-100~-199 range includes DNS) ----
  [-105]: {
    title: 'ERR_NAME_NOT_RESOLVED (-105) — DNS 域名解析失败',
    detail: 'DNS 服务器无法解析目标域名，返回 NXDOMAIN 或超时无响应。根据 oncall 经验，此类问题通常由以下原因导致：1) 本地 DNS 服务器（Local DNS）故障或不稳定；2) 域名确实不存在或已下线；3) hosts 文件被异常修改；4) 企业自建 DNS 配置错误；5) 网络环境变更后 DNS 未更新。',
    conclusion: 'DNS 解析失败是网络访问的首要关卡故障。根据字节跳动网络 oncall 统计，80% 以上的 DNS 问题可通过更换公共 DNS 解决。优先排查 DNS 配置，其次检查 hosts 文件和域名有效性。',
    actions: [
      '【首选】国内用户修改 DNS 为 223.5.5.5（阿里云）或 119.29.29.29（腾讯云）；海外用户修改 DNS 为 8.8.8.8（Google）或 1.1.1.1（Cloudflare）',
      '【重要】避免使用 114.114.114.114（已停止维护，2024 年后频繁出现解析异常）',
      '【自查】检查 hosts 文件是否有异常映射（Windows: C:\\Windows\\System32\\drivers\\etc\\hosts | Mac: /etc/hosts）',
      '清除 DNS 缓存：Windows 执行 ipconfig /flushdns，Mac 执行 sudo killall -HUP mDNSResponder',
      '在 Chrome 地址栏输入 chrome://net-internals/#dns，点击 "clear host cache" 清除浏览器 DNS 缓存',
      '使用 nslookup <域名> 223.5.5.5（国内）或 8.8.8.8（海外）测试 DNS 解析结果',
      '如果使用了 VPN/代理，检查其是否接管了 DNS 设置，尝试断开 VPN 后测试',
    ],
  },
  [-106]: {
    title: 'ERR_NAME_RESOLUTION_FAILED (-106) — DNS 配置异常',
    detail: '系统 DNS 配置存在错误，如 DNS 服务器地址无效、网络适配器配置冲突、或 VPN/代理接管了 DNS 设置。根据 oncall 经验，常见于 VPN 软件修改 DNS 后未恢复、或 DHCP 分配了错误的 DNS。',
    conclusion: 'DNS 配置异常会影响所有网络请求，需要立即排查并修正。建议优先检查网络适配器的 DNS 配置和 VPN 的 DNS 接管状态。',
    actions: [
      '检查当前网络适配器的 DNS 配置，确认首选/备用 DNS 是否有效',
      '如果使用了 VPN，检查 VPN 是否接管了 DNS 设置，尝试断开 VPN 后测试',
      '将 DNS 改为国内 223.5.5.5/119.29.29.29 或海外 8.8.8.8/1.1.1.1，排除 ISP DNS 故障',
      '清除 DNS 缓存后重试',
      '联系公司 IT 检查 DHCP 服务器配置的 DNS 是否正确',
    ],
  },
  [-137]: {
    title: 'ERR_NAME_RESOLUTION_FAILED (-137) — 域名解析失败',
    detail: 'DNS 解析请求失败，DNS 服务器未响应或返回错误。与 ERR_NAME_NOT_RESOLVED 类似，但更强调解析过程中的网络层失败。',
    conclusion: 'DNS 解析失败通常由 DNS 服务器不可达或网络层阻断导致，建议更换 DNS 并检查网络连通性。',
    actions: [
      '【首选】国内用户更换 DNS 为 223.5.5.5 或 119.29.29.29；海外用户更换为 8.8.8.8 或 1.1.1.1',
      '使用 ping 223.5.5.5（国内）或 8.8.8.8（海外）测试到 DNS 服务器的连通性',
      '检查防火墙是否阻止了 DNS 查询（UDP 53 端口）',
      '尝试使用 DoH（DNS over HTTPS）绕过可能的 DNS 劫持',
    ],
  },

  // ---- Connection Errors (-100~-199 range) ----
  [-100]: {
    title: 'ERR_CONNECTION_CLOSED (-100) — 连接被关闭（收到 FIN 报文）',
    detail: 'TCP 连接在数据传输阶段收到了对端的 FIN 报文，连接被正常或异常关闭。根据字节跳动网络 oncall 实战经验，此错误绝大部分发生在数据传输阶段（非握手阶段），主要原因为：1) 代理服务器或安全软件中断了连接；2) 服务器主动关闭了连接；3) 网络中间设备（如负载均衡器）断开了长连接。',
    conclusion: 'ERR_CONNECTION_CLOSED 在企业环境中 80% 以上由代理或安全软件导致。如果仅个别用户出现，优先排查本地安全软件；如果大面积出现，排查代理服务器或网络中间设备。',
    actions: [
      '【关键】检查是否使用了代理/VPN，尝试关闭代理后对比测试',
      '临时禁用杀毒软件/安全软件（如 360、火绒、卡巴斯基等）后测试',
      '联系 IT 排查防火墙是否有连接数限制或空闲超时策略',
      '检查目标服务器是否存在连接池满或主动断连策略',
      '如果是 HTTP/2 连接，尝试在 chrome://flags 中禁用 HTTP/2 进行对比测试',
    ],
  },
  [-101]: {
    title: 'ERR_CONNECTION_RESET (-101) — 连接被重置（收到 RST 报文）',
    detail: 'TCP 连接在建立后收到了对端的 RST 报文，连接被强制重置。根据 oncall 实战经验，此错误最常见且最难排查：1) 大部分发生在 SSL/TLS 握手阶段（已完成 TCP 三次握手）；2) 企业环境中 70% 以上由防火墙 TLS SNI 深度检测或审计准入系统导致；3) 安全软件（如 360、火绒）拦截；4) 少数情况下是 GFW（国家防火墙）阻断。',
    conclusion: 'ERR_CONNECTION_RESET 是最常见的网络错误之一。根据 2024-2025 年字节跳动 oncall 统计，企业环境中 70% 以上的此类问题由防火墙 TLS SNI 深度检测或审计准入系统导致，需要联系 IT 排查安全策略。',
    actions: [
      '【关键】联系 IT 排查防火墙是否有针对目标域名的 TLS SNI 拦截或深度检测规则',
      '检查目标域名是否已加入防火墙白名单（建议使用泛域名形式，如 *.feishu.cn、*.larkoffice.com）',
      '临时禁用杀毒软件/安全软件后测试，确认是否为安全软件干扰',
      '在 Chrome 地址栏输入 chrome://flags，搜索 QUIC，将 Experimental QUIC protocol 设为 Disabled 后测试',
      '使用 openssl s_client -connect <域名>:443 -servername <域名> 检查 TLS 握手是否正常',
      '尝试使用手机热点（切换运营商）对比测试，排除办公网特定策略影响',
      '如果是 HTTPS 网站，检查证书链是否被中间设备替换',
    ],
  },
  [-102]: {
    title: 'ERR_CONNECTION_REFUSED (-102) — 连接被拒绝（TCP 握手阶段收到 RST）',
    detail: 'TCP 三次握手阶段收到了对端的 RST 报文，连接被明确拒绝。根据 oncall 经验：1) 一般出现在 TCP 握手阶段（与 -101 不同，-101 出现在握手完成后）；2) 主要原因是 IP 未加白或端口未放行（常见于企业防火墙）；3) 使用了非常用端口（非 80/443）且未放行；4) DNS 劫持到本地地址（127.0.0.1/0.0.0.0）。',
    conclusion: '连接被拒绝通常意味着网络层可达但应用层拒绝，需优先排查 DNS 劫持和防火墙 IP/端口白名单策略。',
    actions: [
      '【优先】使用 nslookup <域名> 检查解析结果，如果解析到 127.0.0.1、0.0.0.0 或 ::1，说明存在 DNS 劫持',
      '将 DNS 服务器更改为国内 223.5.5.5/119.29.29.29 或海外 8.8.8.8/1.1.1.1，排除运营商 DNS 劫持',
      '联系 IT 排查防火墙是否有 IP/端口封禁策略，确认目标 IP 和端口是否已加白',
      '如果使用了非标准端口（非 80/443），确认该端口是否已放行',
      '使用 telnet <域名> <端口> 测试目标端口是否开放',
      '检查目标服务是否正常运行',
    ],
  },
  [-103]: {
    title: 'ERR_CONNECTION_ABORTED (-103) — 连接异常终止',
    detail: '连接异常终止，与 -101（CONNECTION_RESET）表现类似。根据 oncall 经验：1) 可能是防火墙或安全软件导致的连接中断；2) 少数情况下是 GFW（国家防火墙）阻断；3) 如果仅个别用户出现，大概率是本地安全软件导致；4) 如果大面积出现，可能是企业防火墙策略或网络中间设备问题。',
    conclusion: '-103 与 -101 根因高度相似，大部分由防火墙或安全软件导致。个别用户问题优先排查本地安全软件，大面积问题排查企业防火墙策略。',
    actions: [
      '【关键】联系 IT 排查防火墙是否有拦截规则',
      '临时禁用杀毒软件/安全软件后测试',
      '检查目标域名是否已加入防火墙白名单',
      '尝试切换网络环境（如手机热点）对比测试',
      '如果是 HTTPS 请求，检查是否有中间人设备干扰 TLS 握手',
    ],
  },
  [-118]: {
    title: 'ERR_CONNECTION_TIMED_OUT (-118) — TCP 连接超时',
    detail: 'TCP 连接在超时时间内未完成三次握手。根据 Chromium 源码，默认 TCP 连接超时约为 75 秒（Linux）或 21 秒（Windows）。根据 oncall 经验：1) 主要原因是防火墙静默丢弃（不返回 RST，直接丢弃 SYN 包）；2) IP 跨网或跨境访问导致路由不可达；3) DNS 解析到错误节点（如解析到已下线的 IP）；4) 网络链路质量差，丢包严重。',
    conclusion: '连接超时通常与防火墙静默丢弃、DNS 解析到错误节点或跨网/跨境访问有关。建议从 DNS 解析结果和网络链路两个方向排查。',
    actions: [
      '【第一步】检查 DNS 解析结果是否正确，避免解析到海外或远距离节点',
      '使用 ping <域名> -n 20 测试网络连通性和丢包率',
      '使用 tracert（Windows）或 traceroute（Mac）检查路由路径，确认是否有异常跳数',
      '访问 https://cip.cc 或 https://ip.skk.moe 查看出口 IP，确认是否与公司办公网一致',
      '尝试切换网络环境（如手机热点）对比测试',
      '联系 IT 排查防火墙是否有静默丢弃策略（SYN 包被丢弃不返回 RST）',
      '检查是否存在跨网或跨境访问问题（对比出口 IP 和远端 IP 的运营商/地域）',
    ],
  },

  // ---- Timeout Errors ----
  [-7]: {
    title: 'ERR_TIMED_OUT (-7) — 请求超时',
    detail: '网络请求在超时时间内未得到响应。与 ERR_CONNECTION_TIMED_OUT 不同，此错误发生在连接建立后的数据传输阶段。可能原因：服务器处理缓慢、网络延迟高、防火墙中间设备延迟、代理服务器响应慢。',
    conclusion: '请求超时通常与服务器性能或网络链路质量有关，但也可能是防火墙/代理增加了额外延迟。',
    actions: [
      '检查 DNS 是否配置为 8.8.8.8（国内使用会导致路由绕远，海外使用正常）',
      '使用 ping 和 tracert 检查到目标服务器的网络质量',
      '如果使用了代理，检查代理服务器是否响应缓慢',
      '尝试在不同时间段测试，排除服务器负载高峰影响',
      '联系 IT 排查防火墙是否有流量审查导致的延迟',
    ],
  },
  [-109]: {
    title: 'ERR_ADDRESS_UNREACHABLE (-109) — 地址不可达',
    detail: 'IP 地址不可达，没有到目标主机或网络的路由。根据 Chromium 文档，这通常意味着路由表问题、网络分区、或 DNS 解析到了不可达的 IP。',
    conclusion: '地址不可达通常与路由问题或 DNS 解析错误有关，建议排查路由路径和 DNS 配置。',
    actions: [
      '使用 tracert（Windows）或 traceroute（Mac）排查路由路径，确认在哪一跳出现不可达',
      '检查 DNS 解析的 IP 地址是否正确，是否解析到了已下线的节点',
      '尝试换运营商（如手机热点）对比测试，排除特定网络路由问题',
      '联系网络管理员检查路由表和接入节点状态',
    ],
  },

  // ---- SSL/TLS Errors (-200~-299 range) ----
  [-107]: {
    title: 'ERR_SSL_PROTOCOL_ERROR (-107) — SSL/TLS 协议错误',
    detail: 'SSL/TLS 握手过程中发生协议级错误。根据 oncall 实战经验：1) 如果该错误大量出现（多个请求、多个域名），则 90% 以上是防火墙 SSL 解密或 HTTPS Inspection 导致；2) 服务器使用了不支持的 SSL 版本；3) 证书链不完整；4) 中间人设备修改了 TLS 握手数据；5) 浏览器与服务器密码套件不兼容。',
    conclusion: 'SSL 协议错误如果大面积出现，极大概率是防火墙 SSL 解密或中间设备干扰导致。个别请求可能是服务器配置问题。',
    actions: [
      '【第一步】更新 Chrome 到最新版本，排除浏览器版本过旧导致的协议不兼容',
      '【关键】如果大面积出现，联系 IT 排查防火墙/安全软件是否有 SSL 解密、HTTPS Inspection 功能',
      '在 Chrome 地址栏输入 chrome://flags，搜索 TLS，尝试调整 TLS 版本设置',
      '使用 openssl s_client -connect <域名>:443 -servername <域名> 检查服务器 SSL 配置',
      '联系 IT 排查网络中间设备（如审计系统、准入网关）是否干扰了 TLS 握手',
    ],
  },
  [-113]: {
    title: 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH (-113) — SSL 版本或密码套件不匹配',
    detail: '客户端和服务器没有共同的 SSL/TLS 协议版本或密码套件。根据 Chromium 官方说明，这通常发生在服务器仅支持旧版 TLS（如 TLS 1.0/1.1）或使用了已被淘汰的密码套件。',
    conclusion: 'TLS 版本不匹配通常由服务器配置过旧或防火墙强制降级 TLS 版本导致，需要检查服务器配置和中间设备。',
    actions: [
      '更新 Chrome 到最新版本',
      '在 chrome://flags 中检查 TLS 1.3 设置，尝试恢复为 Default',
      '排查防火墙是否强制修改了 TLS 版本或密码套件',
      '使用 SSL Labs (https://www.ssllabs.com/ssltest/) 测试服务器 SSL 配置',
      '联系服务端运维人员确认服务器支持的 TLS 版本',
    ],
  },
  [-200]: {
    title: 'ERR_CERT_COMMON_NAME_INVALID (-200) — 证书域名不匹配',
    detail: '服务器返回的证书公共名称（CN）或 Subject Alternative Name（SAN）与访问的域名不匹配。根据 oncall 实战经验：1) 排查 SSL 块中的 server_cert_common_name，如果关键字包含 "wifi" 之类，是没登录 Wi-Fi 认证页面；2) 如果收到 *.bytedance.net 证书，大概率也是没登录工区 Wi-Fi；3) 防火墙/审计系统替换证书；4) 中间人攻击；5) 操作系统 DNS 搜索后缀导致域名缩短。',
    conclusion: '证书域名不匹配极大概率是中间人攻击或企业安全设备（防火墙/审计系统）替换证书导致，也可能是未登录 Wi-Fi 认证页面。需要立即排查安全软件和 Wi-Fi 认证状态。',
    actions: [
      '【关键】点击浏览器地址栏域名前的"小锁"图标，查看证书详情，确认颁发者和证书链',
      '【自查】检查是否连接了需要认证的 Wi-Fi（如酒店、机场、公司访客网络），尝试访问任意网页完成 Wi-Fi 认证',
      '检查证书链是否完整：正常应为 DigCert/DigiCert Global Root CA → Encryption Everywhere DV TLS CA - G1 → *.目标域名',
      '联系 IT 排查防火墙、审计准入系统、安全软件是否进行了 HTTPS 解密/证书替换',
      '检查是否有病毒或恶意软件进行中间人攻击，运行杀毒软件全盘扫描',
      '检查系统时间是否正确（证书有效期验证依赖系统时间）',
    ],
  },
  [-201]: {
    title: 'ERR_CERT_DATE_INVALID (-201) — 证书已过期',
    detail: '服务器证书已超过有效期，或客户端系统时间不正确导致证书验证失败。',
    conclusion: '证书过期需要首先确认系统时间正确，然后联系服务端更新证书。如果多个网站都出现此错误，可能是系统时间严重偏差或中间人替换证书。',
    actions: [
      '检查系统时间是否正确（时区、日期、时间）',
      '如果仅单个网站报错，联系该网站运维人员更新证书',
      '如果多个网站都报证书错误，排查是否有防火墙/安全软件替换证书',
      '检查证书透明度（Certificate Transparency）信息是否完整',
    ],
  },
  [-202]: {
    title: 'ERR_CERT_AUTHORITY_INVALID (-202) — 证书颁发机构不受信任',
    detail: '服务器证书的颁发机构（CA）不在客户端信任列表中。根据 oncall 实战经验：1) 防火墙/审计系统想要进行中间人攻击（MITM），替换了原始证书；2) 使用了自签名证书；3) 企业私有 CA 未导入；4) 证书链不完整（中间证书缺失）。这是企业环境中最头疼的证书问题之一。',
    conclusion: '-202 错误在企业环境中 90% 以上由防火墙/安全软件的 HTTPS 解密（MITM）导致。需要客户 IT 配合查清拦截软件或防火墙，并单独对目标域名流量进行加白，避免劫持证书。',
    actions: [
      '【关键】联系 IT 排查防火墙、审计系统、安全软件是否进行了 HTTPS 解密/证书替换',
      '【建议】使用飞书医生（或类似工具）的域名检测功能，可以检测出证书劫持问题',
      '如果是企业内网应用，联系 IT 导入企业根证书到系统信任 store',
      '检查证书链是否完整，中间证书是否缺失',
      '如果是自签名证书，考虑更换为受信任的 CA 签发的证书',
      '参考文档：[飞书webview证书劫持类问题排查和解决指引]',
    ],
  },

  // ---- Proxy Errors ----
  [-111]: {
    title: 'ERR_TUNNEL_CONNECTION_FAILED (-111) — 代理隧道连接失败',
    detail: '无法通过代理服务器建立 CONNECT 隧道（用于 HTTPS）。根据 Chromium 网络栈行为，这通常意味着代理服务器拒绝连接、代理配置错误、或代理服务器本身无法访问目标地址。',
    conclusion: '代理隧道失败表明代理服务器无法正常工作，建议检查代理配置或尝试直连排除代理问题。',
    actions: [
      '检查代理服务器地址和端口是否正确',
      'Mac：系统偏好设置 → 网络 → 高级 → 代理，检查并取消异常代理配置',
      'Windows：设置 → 网络和 Internet → 代理，关闭"使用代理服务器"',
      '如果使用了 PAC 脚本，检查 PAC 文件是否可访问且规则正确',
      '尝试完全关闭代理后直连测试，确认是否为代理导致',
      '联系 IT 确认代理服务器是否正常运行',
    ],
  },
  [-130]: {
    title: 'ERR_PROXY_CONNECTION_FAILED (-130) — 代理连接失败',
    detail: '无法连接到代理服务器。与 ERR_TUNNEL_CONNECTION_FAILED 不同，此错误发生在连接代理服务器阶段，而非建立隧道阶段。',
    conclusion: '无法连接代理服务器通常由代理地址错误或代理服务器宕机导致，建议验证代理配置。',
    actions: [
      '验证代理服务器地址和端口是否可达（使用 telnet 代理地址 端口）',
      '检查代理服务器是否正常运行',
      '尝试更换代理服务器或临时关闭代理',
      '联系 IT 确认代理服务状态',
    ],
  },

  // ---- HTTP/2 Errors (-300~-399 range) ----
  [-352]: {
    title: 'ERR_HTTP2_PROTOCOL_ERROR (-352) — HTTP/2 协议错误（连接黑洞）',
    detail: 'HTTP/2 连接出现协议错误，通常表现为连接"黑洞"——请求发出后无响应。根据 oncall 经验：1) 最常见原因是应用切后台休眠后恢复，HTTP/2 连接状态不一致；2) 代理服务器对 HTTP/2 支持不佳；3) 网络中间设备（如防火墙）修改了 HTTP/2 帧；4) 服务器端 HTTP/2 实现异常。',
    conclusion: '-352 错误最常见于移动端/桌面端应用切后台后恢复的场景。如果频繁出现，建议检查代理对 HTTP/2 的支持，或考虑强制降级到 HTTP/1.1 测试。',
    actions: [
      '【建议】在 chrome://flags 中搜索 HTTP/2，尝试禁用 HTTP/2 强制走 HTTP/1.1 进行对比测试',
      '检查代理服务器是否支持 HTTP/2（部分代理对 H2 支持不佳）',
      '如果是应用切后台后出现，属于已知问题，尝试重启应用',
      '联系 IT 排查网络中间设备是否支持 HTTP/2',
      '检查是否有安全软件拦截了 HTTP/2 流量',
    ],
  },

  // ---- QUIC Errors (-300~-399 range) ----
  [-356]: {
    title: 'ERR_QUIC_PROTOCOL_ERROR (-356) — QUIC 协议错误',
    detail: 'QUIC 连接出现协议错误。根据 oncall 经验：1) 大多数是网络波动造成 QUIC 请求异常（弱网环境）；2) 少数情况下是用户内网开启了 UDP Flood 防护，对 QUIC（基于 UDP）支持不友好；3) 防火墙阻止了 UDP 443 端口；4) 网络中间设备不支持 QUIC。',
    conclusion: 'QUIC 协议错误大部分由弱网环境或防火墙 UDP 拦截导致。建议先禁用 QUIC 进行对比测试，如果问题解决则说明与 QUIC/UDP 有关。',
    actions: [
      '【首选】在 Chrome 地址栏输入 chrome://flags，搜索 QUIC，将 Experimental QUIC protocol 设为 Disabled 后测试',
      '检查防火墙是否阻止了 UDP 端口 443（QUIC 使用 UDP 443）',
      '检查网络质量（ping 丢包率、延迟），QUIC 对弱网敏感',
      '联系 IT 排查是否有 UDP Flood 防护策略影响了 QUIC',
      '检查网络中间设备是否支持 QUIC 协议',
    ],
  },

  // ---- Network Change ----
  [-21]: {
    title: 'ERR_NETWORK_CHANGED (-21) — 网络环境变更',
    detail: '请求过程中检测到网络环境发生变化（如 Wi-Fi 切换、VPN 连接/断开、网络接口变化）。Chromium 会主动取消正在进行的请求并返回此错误。',
    conclusion: '网络变更是正常的系统行为，但如果频繁出现，说明网络连接不稳定或 VPN 切换过于频繁。',
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
    detail: '请求被浏览器扩展（如广告拦截器、隐私保护插件）或客户端安全策略阻止。',
    conclusion: '此错误通常由浏览器扩展或安全软件导致，建议禁用扩展后测试。',
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
// Generate suggestions based on knowledge base
// ============================================================

export function generateSuggestions(r: AnalysisResult): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // ---- Connection failures: use knowledge base mapping ----
  if (r.connectionFailures.length > 0) {
    const errCodes = [...new Set(r.connectionFailures.map(f => f.error))];
    for (const code of errCodes) {
      const numCode = typeof code === 'number' ? code : Number(code);
      // Check knowledge base first
      if (ERROR_SOLUTIONS[numCode]) {
        const sol = ERROR_SOLUTIONS[numCode];
        suggestions.push({
          icon: '🔍',
          title: sol.title,
          detail: sol.detail,
          conclusion: sol.conclusion,
          actions: sol.actions,
        });
      } else {
        const desc = getNetErrorDescription(code);
        // Fallback: pattern matching based on error code ranges
        const codeNum = typeof code === 'number' ? code : parseInt(String(code), 10);
        
        if (!isNaN(codeNum) && codeNum >= -99 && codeNum <= -1) {
          // (-1)~(-99): Business logic / application layer errors
          suggestions.push({
            icon: '⚙️',
            title: `应用层错误 (${desc})`,
            detail: `检测到错误码 ${code}，属于应用层/业务逻辑错误。这类错误通常与客户端内部逻辑、请求取消或超时配置有关，需要结合具体业务场景分析。`,
            conclusion: '应用层错误需要结合具体请求场景分析，建议查看请求详情和客户端日志。',
            actions: [
              '检查请求是否在发送过程中被取消',
              '查看客户端日志获取更详细的错误上下文',
              '检查是否有业务逻辑拦截了请求',
              '如果是超时类错误，检查超时配置是否合理',
            ],
          });
        } else if (!isNaN(codeNum) && codeNum >= -199 && codeNum <= -100) {
          // (-100)~(-199): Network link errors
          suggestions.push({
            icon: '🔗',
            title: `网络链路错误 (${desc})`,
            detail: `检测到错误码 ${code}，属于网络链路层错误。根据 oncall 经验，此类错误通常与防火墙、代理、安全软件或网络链路质量有关。`,
            conclusion: '网络链路错误需要排查防火墙、代理、安全软件和网络链路质量。',
            actions: [
              '【关键】联系 IT 排查防火墙策略',
              '检查是否使用了代理/VPN，尝试关闭后测试',
              '临时禁用安全软件后测试',
              '使用 ping/tracert 检查网络链路质量',
              '尝试切换网络环境（手机热点）对比测试',
            ],
          });
        } else if (!isNaN(codeNum) && codeNum >= -299 && codeNum <= -200) {
          // (-200)~(-299): Certificate errors
          suggestions.push({
            icon: '🔒',
            title: `证书错误 (${desc})`,
            detail: `检测到错误码 ${code}，属于 SSL/TLS 证书错误。根据 oncall 经验，企业环境中 90% 以上的证书错误由防火墙/安全软件的 HTTPS 解密（MITM）导致。`,
            conclusion: '证书错误极大概率是安全设备替换证书导致，需要排查防火墙和审计系统。',
            actions: [
              '【关键】联系 IT 排查防火墙/审计系统是否进行了 HTTPS 解密',
              '点击浏览器域名前"小锁"查看证书详情',
              '检查是否连接了需要认证的 Wi-Fi',
              '检查系统时间是否正确',
              '尝试使用飞书医生等工具检测证书劫持',
            ],
          });
        } else if (!isNaN(codeNum) && codeNum >= -399 && codeNum <= -300) {
          // (-300)~(-399): Protocol errors (HTTP/2, QUIC)
          suggestions.push({
            icon: '📡',
            title: `协议错误 (${desc})`,
            detail: `检测到错误码 ${code}，属于应用层协议错误（HTTP/2 或 QUIC）。根据 oncall 经验，此类错误通常与代理不支持新协议、网络中间设备干扰或弱网环境有关。`,
            conclusion: '协议错误建议先禁用相关协议进行对比测试，排查代理和中间设备兼容性。',
            actions: [
              '在 chrome://flags 中禁用 HTTP/2 或 QUIC 进行对比测试',
              '检查代理服务器是否支持 HTTP/2 / QUIC',
              '检查防火墙是否阻止了 UDP 443（QUIC）',
              '检查网络质量（弱网环境容易导致 QUIC 错误）',
            ],
          });
        } else if (desc.includes('DNS') || desc.includes('NAME_NOT_RESOLVED')) {
          suggestions.push({
            icon: '🌐',
            title: `DNS 解析问题 (${desc})`,
            detail: 'DNS 解析失败可能导致所有请求无法发起。',
            conclusion: 'DNS 问题是网络故障的常见根因，建议优先排查 DNS 配置。',
            actions: [
              '【首选】国内用户修改 DNS 为 223.5.5.5（阿里云）或 119.29.29.29（腾讯云）；海外用户修改 DNS 为 8.8.8.8（Google）或 1.1.1.1（Cloudflare）',
              '【重要】避免使用 114.114.114.114（已停止维护，不稳定）',
              '清除 DNS 缓存后重试',
              '使用 nslookup 检查域名解析结果',
            ],
          });
        } else if (desc.includes('TIMED_OUT') || desc.includes('超时')) {
          suggestions.push({
            icon: '⏱',
            title: `连接超时 (${desc})`,
            detail: '连接超时，可能是网络质量差、防火墙拦截或 DNS 配置错误。',
            conclusion: '连接超时涉及多个环节，建议从 DNS 到网络链路逐步排查。',
            actions: [
              '检查 DNS 是否为 8.8.8.8（国内使用会导致路由绕远，海外使用正常）',
              '访问 cip.cc 查看出口 IP，确认接入节点',
              '使用 ping/tracert 检查网络连通性和路由',
              '尝试切换网络环境（手机热点）对比',
            ],
          });
        } else if (desc.includes('REFUSED') || desc.includes('拒绝')) {
          suggestions.push({
            icon: '🚫',
            title: `连接被拒绝 (${desc})`,
            detail: '服务器主动拒绝连接，可能是域名劫持或防火墙限制。',
            conclusion: '连接被拒绝需优先排查 DNS 劫持和防火墙策略。',
            actions: [
              '使用 nslookup 检查是否被劫持到 127.0.0.1 或 0.0.0.0',
              '将 DNS 更改为国内 223.5.5.5/119.29.29.29 或海外 8.8.8.8/1.1.1.1',
              '联系 IT 排查防火墙策略',
            ],
          });
        } else if (desc.includes('RESET') || desc.includes('重置')) {
          suggestions.push({
            icon: '🔄',
            title: `连接被重置 (${desc})`,
            detail: '连接被重置，可能是防火墙 TLS SNI 拦截。',
            conclusion: '连接被重置极大概率是防火墙 TLS SNI 拦截导致，需要联系 IT 排查。',
            actions: [
              '【关键】联系 IT 排查防火墙 TLS SNI 拦截规则',
              '将域名加入防火墙白名单（泛域名形式）',
              '检查是否有审计准入系统干扰',
            ],
          });
        } else if (desc.includes('SSL') || desc.includes('CERT') || desc.includes('证书')) {
          suggestions.push({
            icon: '🔒',
            title: `SSL/TLS 证书问题 (${desc})`,
            detail: 'SSL 握手失败，可能是防火墙/审计系统或中间人攻击。',
            conclusion: '证书异常通常是安全软件或中间人攻击导致，需要立即排查。',
            actions: [
              '【关键】联系 IT 排查防火墙和审计准入系统',
              '检查证书链是否完整',
              '点击浏览器域名前"小锁"查看证书详情',
              '可能需要杀毒处理',
            ],
          });
        } else if (desc.includes('QUIC')) {
          suggestions.push({
            icon: '📡',
            title: `QUIC 协议问题 (${desc})`,
            detail: 'QUIC 连接失败，可能是 UDP 443 端口被阻止。',
            conclusion: 'QUIC 协议问题通常由防火墙阻止 UDP 443 或弱网环境导致。',
            actions: [
              '检查防火墙是否阻止了 UDP 端口 443',
              '在 chrome://flags 中禁用 QUIC 进行对比测试',
              '检查网络中间设备是否支持 QUIC',
            ],
          });
        } else {
          suggestions.push({
            icon: '❓',
            title: `网络错误 (${desc})`,
            detail: `检测到错误码 ${code}。`,
            conclusion: '未知错误建议按照通用排查流程处理。',
            actions: [
              '检查网络连接是否正常',
              '尝试清除浏览器缓存和 Cookie',
              '禁用浏览器扩展后重试',
              '尝试使用其他网络环境',
            ],
          });
        }
      }
    }
  }

  // ---- Slow requests: replaced with Wireshark capture suggestion ----
  if (r.slowRequests.length > 0) {
    suggestions.push({
      icon: '🦈',
      title: '慢请求排查建议 — 使用 Wireshark 抓包分析',
      detail: `检测到 ${r.slowRequests.length} 个慢请求（>3s）。NetLog 已记录各阶段耗时，但具体是 DNS、TCP 握手、SSL 还是数据传输阶段慢，需要通过 Wireshark 抓包进一步确认。`,
      conclusion: 'Wireshark 抓包是定位慢请求根因的最有效手段，可精确到每个 TCP 包的时间戳。',
      actions: [
        '【安装】下载 Wireshark：https://www.wireshark.org/#download',
        '【安装】Windows 安装教程：https://blog.51cto.com/u_5001660/2116582',
        '【安装】Mac 安装教程：https://www.xstnet.com/article-155.html',
        '【抓包】打开 Wireshark，选择网卡，点击左上角蓝色鲨鱼鳍开始抓包',
        '【抓包】复现问题后点击红色正方形停止抓包',
        '【保存】点击文件 → 保存，将抓包内容保存为 .pcapng 文件',
        '【过滤】显示过滤器输入 "host <目标域名或IP>"，只查看目标流量',
        '【分析】关注 DNS 查询响应时间（>500ms 为慢）',
        '【分析】关注 TCP SYN → SYN-ACK 时间（>1s 为慢）',
        '【分析】关注 SSL ClientHello → ServerHello 时间（>1s 为慢）',
        '【分析】关注 HTTP 请求 → 第一个响应字节时间（TTFB >2s 为慢）',
        '【对比】同时抓取正常请求和慢请求，对比差异',
      ],
    });
  }

  // ---- Proxy/VPN ----
  const pi = r.proxyInfo;
  if (pi.isVPN) {
    suggestions.unshift({
      icon: '🚨',
      title: '检测到 VPN 环境',
      detail: '日志中检测到 VPN 使用迹象。VPN 可能导致网络延迟增加、域名被拦截或 DNS 被接管。根据 oncall 经验，VPN 还可能导致跨境访问问题（如国内用户通过 VPN 出口到海外，再回源国内）。',
      conclusion: 'VPN 会改变网络出口路径，可能导致访问异常、跨境绕路。建议关闭 VPN 后对比测试。',
      actions: [
        '【建议】临时关闭 VPN 后重试，对比网络表现',
        '检查 VPN 是否导致跨境访问（国内用户出口到海外 IP）',
        '检查 VPN 是否拦截了目标域名',
        '如果必须使用 VPN，确认 VPN 服务器出口网络正常',
      ],
    });
  } else if (pi.hasProxy) {
    suggestions.unshift({
      icon: '⚠️',
      title: '检测到代理服务器配置',
      detail: `当前配置了代理（模式: ${pi.proxyType}，服务器: ${pi.proxyList.join(', ')}）。代理可能导致请求被拦截、延迟增加或对 HTTP/2 支持不佳。根据 oncall 经验，代理类问题一般需要客户 IT 进行优化解决。`,
      conclusion: '代理服务器故障或配置不当会导致请求异常，建议检查代理状态或尝试直连。',
      actions: [
        '检查代理服务器是否正常运行',
        'Mac：系统偏好设置 → 网络 → 高级 → 代理，检查代理配置',
        'Windows：设置 → 网络和 Internet → 代理，检查代理设置',
        '尝试关闭代理后直连对比测试',
        '检查 PAC 脚本是否正确配置了 Bypass 列表',
        '如果代理对 HTTP/2 支持不佳，可尝试强制走 HTTP/1.1',
      ],
    });
  }

  // ---- Failed domains ----
  if (r.failedDomains.length > 0) {
    const domainList = r.failedDomains.slice(0, 10).map(d => `${d.domain} (${d.count}次)`).join('、');
    suggestions.push({
      icon: '❌',
      title: `报错域名汇总 (${r.failedDomains.length}个)`,
      detail: `以下域名出现网络错误：${domainList}`,
      conclusion: '多个域名报错通常指向 DNS 或防火墙层面的问题，建议统一排查。',
      actions: [
        '检查这些域名是否被防火墙/代理拦截',
        '使用 ping/nslookup 确认网络可达性和 DNS 解析',
        '检查 DNS 解析结果是否正确（是否被劫持到异常 IP）',
        '将相关域名加入防火墙白名单（建议使用泛域名形式）',
      ],
    });
  }

  // ---- DNS hijack detection ----
  const hijackedDomains = r.failedDomains.filter(d =>
    d.ips.some(ip => ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1')
  );
  if (hijackedDomains.length > 0) {
    suggestions.push({
      icon: '🚨',
      title: `检测到 DNS 劫持 (${hijackedDomains.length}个域名)`,
      detail: `以下域名被解析到本地地址：${hijackedDomains.map(d => `${d.domain} → ${d.ips.filter(ip => ip === '127.0.0.1' || ip === '0.0.0.0').join(', ')}`).join('、')}`,
      conclusion: 'DNS 劫持是严重的网络故障，通常是运营商 LOCAL DNS 故障导致，需要立即更换 DNS。',
      actions: [
        '【紧急】国内用户立即将 DNS 更改为 223.5.5.5 或 119.29.29.29；海外用户更改为 8.8.8.8 或 1.1.1.1',
        '联系公司 IT 修改 DHCP 出口 DNS',
        '清除 DNS 缓存：Windows 执行 ipconfig /flushdns',
        '在 Chrome 地址栏输入 chrome://net-internals/#dns，点击 "clear host cache"',
      ],
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
      title: '跨网/跨境自查建议',
      detail: `以下域名请求失败时有 IP 记录：${crossNetworkDomains.slice(0, 5).map(d => d.domain).join('、')}。本工具无法直接查询 IP 的运营商和地域信息，请按以下步骤自查。`,
      conclusion: '跨运营商（如联通访问电信 IP）或跨境访问会显著影响网络质量。通过 ip138.com 等工具自查即可确认。',
      actions: [
        '【步骤1】访问 https://ip.skk.moe/ 或 https://cip.cc 查看本机出口 IP 和运营商',
        '【步骤2】使用 nslookup <域名> 查看解析到的远端 IP',
        '【步骤3】在 https://www.ip138.com/ 分别查询出口 IP 和远端 IP 的运营商/地域',
        '【判断】如果两个 IP 运营商不同 → 存在跨网问题',
        '【判断】如果国内用户解析到海外 IP → 存在跨境问题（DNS 异常）',
        '【解决】跨网/跨境问题：国内用户修改 DNS 为 223.5.5.5，海外用户修改 DNS 为 8.8.8.8',
      ],
    });
  }

  // ---- Network change detection ----
  if (r.networkChanges.length > 0) {
    suggestions.push({
      icon: '🔄',
      title: `会话期间检测到 ${r.networkChanges.length} 次网络变更`,
      detail: '网络环境发生变化可能导致连接中断或请求重试。',
      conclusion: '网络变更会导致连接不稳定，建议检查网络设备和 VPN 状态。',
      actions: [
        '检查是否有 Wi-Fi/有线网络切换',
        '检查 VPN 连接是否不稳定',
        '检查网络设备是否正常',
      ],
    });
  }

  // ---- HTTP/2 GOAWAY detection ----
  const goawayEvents = r.http2Events?.filter(e => e.type === 212 || e.type === 213);
  if (goawayEvents && goawayEvents.length > 0) {
    suggestions.push({
      icon: '📡',
      title: `检测到 HTTP/2 GOAWAY 帧 (${goawayEvents.length} 个)`,
      detail: '服务器主动发送了 HTTP/2 GOAWAY 帧，关闭了连接。根据 oncall 经验，GOAWAY 帧携带的错误码如果是 0x1（协议错误），可能是服务端或中间节点（如 TLB）的问题。',
      conclusion: 'HTTP/2 GOAWAY 通常由服务端或中间负载均衡器（TLB）主动关闭连接导致。如果频繁出现，建议排查代理对 HTTP/2 的支持或联系服务端排查。',
      actions: [
        '检查 GOAWAY 帧的错误码（0x1 表示协议错误）',
        '排查代理服务器是否支持 HTTP/2',
        '尝试禁用 HTTP/2 强制走 HTTP/1.1 进行对比测试',
        '如果是企业内网，联系 IT 排查 TLB/负载均衡器配置',
      ],
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

export function generateNextStepInfo(r: AnalysisResult): NextStepInfo[] {
  const steps: NextStepInfo[] = [];

  // Always include basic info collection
  steps.push({
    category: '📋 基础信息收集',
    description: '以下信息有助于进一步定位问题根因，请用户配合提供：',
    items: [
      '访问 https://ip.skk.moe/ 截图提供检测结果（查看出口 IP、运营商、是否有海外出口）',
      '访问 https://cip.cc 查看出口 IP 和运营商信息',
      '在终端执行 nslookup <问题域名> 查看 DNS 解析结果',
      '在终端执行 ping <问题域名> -n 20 查看丢包率和延迟',
      '在终端执行 tracert <问题域名>（Windows）或 traceroute <问题域名>（Mac）查看路由路径',
    ],
  });

  // DNS related
  const hasDnsErrors = r.connectionFailures.some(f => {
    const code = typeof f.error === 'number' ? f.error : Number(f.error);
    return code === -105 || code === -106 || code === -137;
  });
  if (hasDnsErrors || r.failedDomains.some(d => d.ips.some(ip => ip === '127.0.0.1' || ip === '0.0.0.0'))) {
    steps.push({
      category: '🌐 DNS 问题进一步排查',
      description: '检测到 DNS 相关问题，需要进一步确认 DNS 配置和解析结果：',
      items: [
        '执行 nslookup <问题域名> 查看当前 DNS 服务器和解析结果',
        '执行 nslookup <问题域名> 223.5.5.5（国内）或 8.8.8.8（海外）对比公共 DNS 解析结果',
        '检查 hosts 文件是否有异常映射（Windows: C:\\Windows\\System32\\drivers\\etc\\hosts）',
        '提供当前网络适配器的 DNS 配置截图',
        '如果使用了 VPN/代理，确认其是否接管了 DNS 设置',
      ],
    });
  }

  // Firewall related
  const hasFirewallErrors = r.connectionFailures.some(f => {
    const code = typeof f.error === 'number' ? f.error : Number(f.error);
    return code === -101 || code === -102 || code === -103 || code === -118 || code === -107;
  });
  if (hasFirewallErrors) {
    steps.push({
      category: '🛡️ 防火墙/安全软件排查',
      description: '检测到疑似防火墙或安全软件拦截，请按以下步骤排查：',
      items: [
        '【快速判断】使用手机访问同一网址，如果手机正常而电脑异常，大概率是电脑防火墙/安全软件问题',
        '临时关闭杀毒软件/安全软件（360、火绒、卡巴斯基、Windows Defender 等）后测试',
        '检查企业防火墙是否有目标域名的拦截日志',
        '联系 IT 确认以下域名是否已加白：*.feishu.cn、*.larkoffice.com、*.feishucdn.com',
        '如果防火墙不支持泛域名（如山石防火墙），需要结合 IP 白名单放行',
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
        '点击浏览器地址栏域名前的"小锁"图标，查看证书详情（颁发者、有效期、证书链）',
        '检查是否连接了需要认证的 Wi-Fi（如酒店、机场、公司访客网络）',
        '使用飞书医生（或类似工具）的域名检测功能检测证书劫持',
        '检查系统时间是否正确（时区、日期、时间）',
        '联系 IT 排查防火墙/审计系统是否进行了 HTTPS 解密（MITM）',
        '如果是企业内网，确认企业根证书是否已导入系统信任 store',
      ],
    });
  }

  // Cross-network related
  if (r.failedDomains.some(d => (d.resolvedIp || d.remoteIp) && d.errors.length > 0)) {
    steps.push({
      category: '🌍 跨网/跨境排查',
      description: '需要确认是否存在跨运营商或跨境访问问题：',
      items: [
        '在 https://www.ip138.com/ 查询出口 IP（cip）的运营商和地域',
        '在 https://www.ip138.com/ 查询远端 IP（remote ip）的运营商和地域',
        '对比两个 IP 的运营商：如果不同，说明存在跨网问题',
        '对比两个 IP 的地域：如果国内用户解析到海外 IP，说明存在跨境问题',
        '如果存在跨网/跨境，尝试修改 DNS 为国内 223.5.5.5 或海外 8.8.8.8 后重新测试',
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
        '临时关闭代理/VPN 后对比测试',
        '检查 PAC 脚本是否正确配置了 Bypass 列表',
        '确认代理服务器是否支持 HTTP/2（部分代理对 H2 支持不佳）',
        '检查代理是否导致跨境访问（国内用户出口到海外 IP）',
      ],
    });
  }

  // Wireshark capture for slow requests
  if (r.slowRequests.length > 0) {
    steps.push({
      category: '🦈 Wireshark 抓包分析',
      description: `检测到 ${r.slowRequests.length} 个慢请求（>3s），需要通过 Wireshark 抓包定位根因：`,
      items: [
        '【安装】下载 Wireshark：https://www.wireshark.org/#download',
        '【安装】Windows 安装教程：https://blog.51cto.com/u_5001660/2116582',
        '【安装】Mac 安装教程：https://www.xstnet.com/article-155.html',
        '【抓包】打开 Wireshark，选择网卡，点击左上角蓝色鲨鱼鳍开始抓包',
        '【抓包】复现问题后点击红色正方形停止抓包',
        '【保存】点击文件 → 保存，将抓包内容保存为 .pcapng 文件',
        '【过滤】显示过滤器输入 "host <目标域名或IP>"，只查看目标流量',
        '【分析】关注 DNS 查询响应时间（>500ms 为慢）',
        '【分析】关注 TCP SYN → SYN-ACK 时间（>1s 为慢）',
        '【分析】关注 SSL ClientHello → ServerHello 时间（>1s 为慢）',
        '【分析】关注 HTTP 请求 → 第一个响应字节时间（TTFB >2s 为慢）',
        '【对比】同时抓取正常请求和慢请求，对比差异',
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

  // DNS check
  items.push({
    category: '🌐 DNS 检查',
    items: [
      { label: '修改 DNS 服务器', description: '推荐国内用户使用 223.5.5.5（阿里云）或 119.29.29.29（腾讯云），海外用户使用 8.8.8.8（Google）或 1.1.1.1（Cloudflare），避免使用 114.114.114.114', checked: false },
      { label: '清除 DNS 缓存', description: 'Windows: ipconfig /flushdns | Mac: sudo killall -HUP mDNSResponder | Chrome: chrome://net-internals/#dns → clear host cache', checked: false },
      { label: '验证 DNS 解析结果', description: `nslookup ${r.failedDomains[0]?.domain || '<域名>'} 223.5.5.5（国内）或 8.8.8.8（海外）`, checked: false },
      { label: '检查 DNS 劫持', description: '使用 nslookup 检查域名是否被解析到 127.0.0.1 或 0.0.0.0', checked: false },
    ],
  });

  // Network connectivity
  items.push({
    category: '🔗 网络连通性',
    items: [
      { label: 'Ping 目标域名', description: `ping ${r.failedDomains[0]?.domain || '<域名>'} -n 20，查看丢包率和延迟`, checked: false },
      { label: 'Traceroute 路由追踪', description: `Windows: tracert <域名> | Mac: traceroute <域名>，检查路由路径是否正常`, checked: false },
      { label: '检查出口 IP', description: '访问 https://cip.cc 或 https://ip.skk.moe 查看出口 IP 和运营商信息', checked: false },
      { label: '检查跨网/跨境', description: '在 ip138.com 查询出口 IP 和远端 IP 的运营商/地域，确认是否跨网或跨境', checked: false },
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
        { label: '对比直连测试', description: '关闭代理后重新访问，对比网络表现', checked: false },
      ],
    });
  }

  // Firewall
  items.push({
    category: '🛡️ 防火墙/安全',
    items: [
      { label: '快速判断防火墙', description: '使用手机访问同一网址，如果手机正常而电脑异常，大概率是防火墙问题', checked: false },
      { label: '检查防火墙策略', description: '确认防火墙是否有针对目标域名的拦截规则', checked: false },
      { label: '域名白名单', description: '将相关域名加入防火墙白名单（建议使用泛域名形式，如 *.feishu.cn）', checked: false },
      { label: '检查安全软件', description: '排查是否有安全软件/杀毒软件/审计准入系统干扰网络', checked: false },
      { label: 'SSL 证书检查', description: '点击浏览器域名前"小锁"查看证书链是否完整', checked: false },
    ],
  });

  // Browser
  items.push({
    category: '💻 浏览器排查',
    items: [
      { label: '无痕模式测试', description: '使用浏览器无痕模式访问，排除插件影响', checked: false },
      { label: '清除缓存', description: '清除浏览器缓存和 Cookie 后重试', checked: false },
      { label: '禁用扩展', description: '逐个禁用浏览器扩展，找出干扰项', checked: false },
      { label: '更新浏览器', description: '确保使用最新版 Chrome 浏览器', checked: false },
      { label: '禁用 QUIC', description: '在 chrome://flags 中将 Experimental QUIC protocol 设为 Disabled 后测试', checked: false },
      { label: '禁用 HTTP/2', description: '在 chrome://flags 中禁用 HTTP/2 强制走 HTTP/1.1 进行对比测试', checked: false },
    ],
  });

  return items;
}

// ============================================================
// Export report
// ============================================================

export function exportReport(r: AnalysisResult): string {
  let report = `# NetLog 网络日志定因分析报告\n`;
  report += `生成时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

  // ---- Compressed Overview (Section 1) ----
  report += `## 概览\n`;
  report += `| 指标 | 数值 |\n`;
  report += `|------|------|\n`;
  report += `| 总事件数 | ${r.totalEvents.toLocaleString()} |\n`;
  report += `| 活跃来源 | ${r.uniqueSources.toLocaleString()} |\n`;
  report += `| 峰值并发 | ${r.peakConcurrency} |\n`;
  report += `| URL 请求 | ${r.urlRequests.length} |\n`;
  report += `| 错误 | ${r.errors.length} |\n`;
  report += `| 警告 | ${r.warnings.length} |\n`;
  report += `| 慢请求(>3s) | ${r.slowRequests.length} |\n`;
  if (r.proxyInfo.isVPN) {
    report += `| VPN | ${r.proxyInfo.vpnHints.join(', ')} |\n`;
  } else if (r.proxyInfo.hasProxy) {
    report += `| 代理 | ${r.proxyInfo.proxyType} (${r.proxyInfo.proxyList.join(', ')}) |\n`;
  }
  report += `\n`;

  // ---- Root Cause Suggestions (Section 2 - High Priority) ----
  const suggestions = generateSuggestions(r);
  if (suggestions.length > 0) {
    report += `## 根因建议\n\n`;
    suggestions.forEach((s, i) => {
      report += `### ${i + 1}. ${s.title}\n\n`;
      report += `**问题描述:**\n${s.detail}\n\n`;
      report += `**处理结论:**\n${s.conclusion}\n\n`;
      if (s.actions && s.actions.length > 0) {
        report += `**排查步骤:**\n`;
        s.actions.forEach((a, j) => {
          report += `${j + 1}. ${a}\n`;
        });
        report += `\n`;
      }
      report += `---\n\n`;
    });
  }

  // ---- Next Step Info (Section 3) ----
  const nextSteps = generateNextStepInfo(r);
  if (nextSteps.length > 0) {
    report += `## 下一步定因所需信息\n\n`;
    nextSteps.forEach((step, i) => {
      report += `### ${step.category}\n`;
      report += `${step.description}\n\n`;
      step.items.forEach((item, j) => {
        report += `${j + 1}. ${item}\n`;
      });
      report += `\n`;
    });
  }

  // ---- Checklist (Section 4) ----
  const checklist = generateChecklist(r);
  report += `## 排查清单\n\n`;
  checklist.forEach(cat => {
    report += `### ${cat.category}\n`;
    cat.items.forEach(item => {
      report += `- [ ] **${item.label}**: ${item.description}\n`;
    });
    report += `\n`;
  });

  // ---- Failed Domains (Section 5) ----
  if (r.failedDomains.length > 0) {
    report += `## 报错域名\n\n`;
    report += `| 域名 | 错误次数 | 解析IP |\n`;
    report += `|------|----------|--------|\n`;
    for (const fd of r.failedDomains.slice(0, 30)) {
      report += `| ${fd.domain} | ${fd.count} | ${fd.ips.join(', ') || '未解析'} |\n`;
    }
    report += `\n`;
  }

  // ---- Error & Warning Lists (Section 6 - Bottom) ----
  if (r.errors.length > 0) {
    report += `## 错误列表\n\n`;
    r.errors.forEach((e, i) => {
      report += `${i + 1}. **[${e.category}]** ${e.message}\n`;
      report += `   - ${e.detail}\n\n`;
    });
  }

  if (r.warnings.length > 0) {
    report += `## 警告列表\n\n`;
    r.warnings.forEach((e, i) => {
      report += `${i + 1}. **[${e.category}]** ${e.message}\n`;
      report += `   - ${e.detail}\n\n`;
    });
  }

  return report;
}
