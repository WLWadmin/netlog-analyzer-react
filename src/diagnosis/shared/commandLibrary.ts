/**
 * 自助排查命令库
 * 提供按角色分类的常用网络排查命令
 */

import type { DiagnosticCategory, DiagnosticRole } from './types';

export interface TroubleshootingCommand {
  id: string;
  category: DiagnosticCategory;
  role: DiagnosticRole;
  title: string;
  command: string;
  platform: 'windows' | 'macos' | 'linux' | 'all';
  description: string;
  expectedResult: string;
  nextIfFailed?: string;
}

export const COMMAND_LIBRARY: TroubleshootingCommand[] = [
  // ========== DNS 排查 ==========
  {
    id: 'dns-lookup',
    category: 'dns',
    role: 'user',
    title: 'DNS 解析测试',
    command: 'nslookup example.com',
    platform: 'all',
    description: '测试域名是否能正常解析到 IP 地址',
    expectedResult: '应返回一个或多个 IP 地址',
    nextIfFailed: '尝试使用其他 DNS 服务器测试（nslookup example.com 8.8.8.8）',
  },
  {
    id: 'dns-lookup-alidns',
    category: 'dns',
    role: 'user',
    title: '使用阿里 DNS 解析测试',
    command: 'nslookup example.com 223.5.5.5',
    platform: 'all',
    description: '使用阿里公共 DNS 测试域名解析',
    expectedResult: '应返回正确的 IP 地址',
    nextIfFailed: '尝试使用腾讯 DNS（119.29.29.29）或 Google DNS（8.8.8.8）',
  },
  {
    id: 'dns-dig',
    category: 'dns',
    role: 'user',
    title: 'DNS 详细解析（dig）',
    command: 'dig example.com +short',
    platform: 'macos',
    description: '使用 dig 命令获取更详细的 DNS 解析信息',
    expectedResult: '应返回 IP 地址',
  },
  {
    id: 'dns-flush-mac',
    category: 'dns',
    role: 'user',
    title: '清除 DNS 缓存（macOS）',
    command: 'sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder',
    platform: 'macos',
    description: '清除 macOS 系统 DNS 缓存',
    expectedResult: '无输出表示成功',
  },
  {
    id: 'dns-flush-win',
    category: 'dns',
    role: 'user',
    title: '清除 DNS 缓存（Windows）',
    command: 'ipconfig /flushdns',
    platform: 'windows',
    description: '清除 Windows 系统 DNS 缓存',
    expectedResult: '应显示"已成功刷新 DNS 解析缓存"',
  },

  // ========== 连通性排查 ==========
  {
    id: 'conn-ping',
    category: 'connect',
    role: 'user',
    title: 'Ping 连通性测试',
    command: 'ping example.com -n 20',
    platform: 'all',
    description: '测试到目标域名的网络连通性和延迟',
    expectedResult: '丢包率 < 5%，延迟 < 200ms',
    nextIfFailed: '尝试 ping IP 地址排除 DNS 问题；检查防火墙是否拦截 ICMP',
  },
  {
    id: 'conn-traceroute',
    category: 'connect',
    role: 'user',
    title: '路由追踪（macOS/Linux）',
    command: 'traceroute example.com',
    platform: 'macos',
    description: '追踪到目标域名的网络路由路径，定位延迟节点',
    expectedResult: '应显示到目标服务器的完整路由路径',
    nextIfFailed: '如果中间节点超时，可能是该节点禁止 ICMP，不一定表示故障',
  },
  {
    id: 'conn-tracert',
    category: 'connect',
    role: 'user',
    title: '路由追踪（Windows）',
    command: 'tracert example.com',
    platform: 'windows',
    description: 'Windows 下追踪到目标域名的网络路由路径',
    expectedResult: '应显示到目标服务器的完整路由路径',
  },
  {
    id: 'conn-telnet',
    category: 'connect',
    role: 'user',
    title: '端口连通性测试',
    command: 'curl -v --connect-timeout 5 https://example.com:443',
    platform: 'all',
    description: '测试到目标服务器 443 端口的连通性',
    expectedResult: '应成功建立 HTTPS 连接',
    nextIfFailed: '如果连接超时，检查防火墙/代理是否拦截 443 端口',
  },

  // ========== TLS/证书排查 ==========
  {
    id: 'tls-check',
    category: 'tls',
    role: 'user',
    title: 'TLS 握手测试',
    command: 'openssl s_client -connect example.com:443 -servername example.com',
    platform: 'all',
    description: '检查目标服务器的 TLS 握手和证书信息',
    expectedResult: '应显示 "Verify return code: 0 (ok)" 和证书链信息',
    nextIfFailed: '如果证书过期或不匹配，联系服务端更新证书',
  },
  {
    id: 'tls-check-expiry',
    category: 'tls',
    role: 'user',
    title: '证书有效期检查',
    command: 'echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -dates',
    platform: 'all',
    description: '检查服务器证书的有效期',
    expectedResult: 'notBefore 和 notAfter 应显示有效时间范围',
  },

  // ========== 代理排查 ==========
  {
    id: 'proxy-bypass',
    category: 'proxy',
    role: 'user',
    title: '绕过代理测试',
    command: 'curl -v --noproxy \'*\' https://example.com',
    platform: 'all',
    description: '绕过系统代理直接访问目标地址',
    expectedResult: '应能正常访问目标地址',
    nextIfFailed: '如果绕过代理后正常，说明代理配置有问题',
  },
  {
    id: 'proxy-check-mac',
    category: 'proxy',
    role: 'user',
    title: '查看代理配置（macOS）',
    command: 'networksetup -getwebproxy Wi-Fi && networksetup -getsecurewebproxy Wi-Fi',
    platform: 'macos',
    description: '查看 macOS 系统代理配置',
    expectedResult: '应显示当前代理服务器地址和端口',
  },
  {
    id: 'proxy-check-win',
    category: 'proxy',
    role: 'user',
    title: '查看代理配置（Windows）',
    command: 'netsh winhttp show proxy',
    platform: 'windows',
    description: '查看 Windows 系统代理配置',
    expectedResult: '应显示当前代理服务器地址',
  },

  // ========== HTTP 请求排查 ==========
  {
    id: 'http-curl',
    category: 'server',
    role: 'user',
    title: 'HTTP 请求测试',
    command: 'curl -v -o /dev/null -w "HTTP %{http_code} | Time: %{time_total}s | DNS: %{time_namelookup}s | Connect: %{time_connect}s | TLS: %{time_appconnect}s | TTFB: %{time_starttransfer}s" https://example.com',
    platform: 'all',
    description: '使用 curl 测试 HTTP 请求的各阶段耗时',
    expectedResult: 'HTTP 200，各阶段耗时应在合理范围内',
    nextIfFailed: '根据各阶段耗时定位瓶颈（DNS/Connect/TLS/TTFB）',
  },
  {
    id: 'http-headers',
    category: 'server',
    role: 'user',
    title: '查看响应头',
    command: 'curl -sI https://example.com',
    platform: 'all',
    description: '查看服务器返回的响应头信息',
    expectedResult: '应显示完整的 HTTP 响应头',
  },
];

/**
 * 根据诊断类别获取推荐命令
 */
export function getCommandsForCategory(category: DiagnosticCategory): TroubleshootingCommand[] {
  return COMMAND_LIBRARY.filter(cmd => cmd.category === category);
}

/**
 * 根据角色获取推荐命令
 */
export function getCommandsForRole(role: DiagnosticRole): TroubleshootingCommand[] {
  return COMMAND_LIBRARY.filter(cmd => cmd.role === role);
}

/**
 * 获取所有命令，按类别和角色分组
 */
export function getGroupedCommands(): Record<DiagnosticRole, Record<DiagnosticCategory, TroubleshootingCommand[]>> {
  const grouped: Record<string, Record<string, TroubleshootingCommand[]>> = {};
  for (const cmd of COMMAND_LIBRARY) {
    if (!grouped[cmd.role]) grouped[cmd.role] = {};
    if (!grouped[cmd.role][cmd.category]) grouped[cmd.role][cmd.category] = [];
    grouped[cmd.role][cmd.category].push(cmd);
  }
  return grouped as any;
}
