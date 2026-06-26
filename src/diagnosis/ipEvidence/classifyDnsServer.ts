import { classifyIpScope } from './ipNormalize';
import type { DnsServerEvidence } from './ipEvidenceTypes';

const OVERSEAS_PUBLIC_DNS = new Map<string, string>([
  ['8.8.8.8', 'Google Public DNS'],
  ['8.8.4.4', 'Google Public DNS'],
  ['1.1.1.1', 'Cloudflare DNS'],
  ['1.0.0.1', 'Cloudflare DNS'],
  ['9.9.9.9', 'Quad9 DNS'],
]);

const CHINA_PUBLIC_DNS = new Map<string, string>([
  ['114.114.114.114', '114DNS'],
  ['114.114.115.115', '114DNS'],
  ['223.5.5.5', 'AliDNS'],
  ['223.6.6.6', 'AliDNS'],
  ['119.29.29.29', 'DNSPod'],
  ['180.76.76.76', 'Baidu DNS'],
]);

export function classifyDnsServer(ip: string): DnsServerEvidence {
  const scope = classifyIpScope(ip);

  if (scope === 'private' || scope === 'loopback' || scope === 'link-local') {
    return {
      ip,
      type: scope === 'private' ? 'local-router-dns' : 'private-dns',
      risk: 'low',
      label: '本地网关 DNS',
      explanation: '本地网关 DNS。真实上游 DNS 需要在路由器、系统或企业网络配置中继续确认。',
      action: '查看系统、路由器或企业网络配置，确认真实上游 DNS；如怀疑 DNS/CDN 调度异常，切换运营商/企业 DNS 后复测。',
    };
  }

  const overseasLabel = OVERSEAS_PUBLIC_DNS.get(ip);
  if (overseasLabel) {
    return {
      ip,
      type: 'overseas-public-dns',
      risk: 'medium',
      label: overseasLabel,
      explanation: '海外公共 DNS。访问国内业务时可能影响 CDN 就近解析，形成跨境或跨运营商调度线索。',
      action: '切换运营商 DNS / 企业 DNS 后重新抓取 HAR 或 NetLog 对比。',
    };
  }

  const chinaPublicLabel = CHINA_PUBLIC_DNS.get(ip);
  if (chinaPublicLabel) {
    return {
      ip,
      type: 'public-dns',
      risk: 'low',
      label: chinaPublicLabel,
      explanation: '公共 DNS。它不一定代表当前运营商本地最优解析；如问题表现为跨省、跨运营商、跨境或 CDN 节点异常，建议与运营商 DNS / 企业 DNS 结果对比。',
      action: '对比运营商 DNS / 企业 DNS 与当前公共 DNS 的解析结果。',
    };
  }

  return {
    ip,
    type: 'unknown',
    risk: 'none',
    label: '未知 DNS',
    explanation: '发现 DNS 服务器，但无法仅凭地址判断其维护方或调度策略。',
    action: '如存在 DNS 相关错误，补充系统 DNS 配置截图或 nslookup / dig 结果。',
  };
}
