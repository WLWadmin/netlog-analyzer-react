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
      action: '查看系统、路由器或企业网络配置，确认真实上游 DNS；存在 DNS 错误时再对比组织批准的解析器。',
    };
  }

  const overseasLabel = OVERSEAS_PUBLIC_DNS.get(ip);
  if (overseasLabel) {
    return {
      ip,
      type: 'overseas-public-dns',
      risk: 'none',
      label: overseasLabel,
      explanation: '已识别为公共 DNS。服务地址和地域本身不代表故障；解析结果可能受 ECS、Anycast、CDN 和出口位置影响。',
      action: '仅在存在 DNS 或调度异常证据时，与组织批准的企业/运营商解析器对比返回结果。',
    };
  }

  const chinaPublicLabel = CHINA_PUBLIC_DNS.get(ip);
  if (chinaPublicLabel) {
    return {
      ip,
      type: 'public-dns',
      risk: 'low',
      label: chinaPublicLabel,
      explanation: '已识别为公共 DNS。仅凭服务地址不能评价解析质量、合规性或 CDN 调度结果。',
      action: '存在 DNS 错误时，再与组织批准的企业/运营商解析器对比返回状态和地址。',
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
