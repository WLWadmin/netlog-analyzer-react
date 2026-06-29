import type { CipSipEvidenceRow, DnsIpEvidenceSummary, RequestImpact } from './ipEvidenceTypes';
import type { IpLookupResult, IpRoutingConclusion } from './ipLookupTypes';

function isChina(result?: IpLookupResult): boolean {
  return result?.country === '中国' || result?.country === 'China' || result?.country === 'CN';
}

export function getCarrierGroup(result?: IpLookupResult): string | null {
  const text = `${result?.isp || ''} ${result?.org || ''} ${result?.asname || ''} ${result?.as || ''}`.toLowerCase();
  if (!text) return null;
  const groups: Array<[string, string[]]> = [
    ['tietong', ['tietong', 'railcom', '铁通', '中国铁通']],
    ['telecom', ['chinanet', 'telecom', '中国电信', '电信']],
    ['unicom', ['unicom', 'china169', '中国联通', '联通']],
    ['mobile', ['mobile', 'cmnet', '中国移动', '移动']],
    ['cernet', ['cernet', '教育网']],
    ['broadcast', ['cbn', '中国广电', '广电']],
    ['aliyun', ['aliyun', 'alibaba', '阿里云']],
    ['tencent', ['tencent', '腾讯云']],
    ['huawei', ['huawei', '华为云']],
    ['cloudflare', ['cloudflare']],
    ['google', ['google']],
    ['aws', ['amazon', 'aws']],
    ['azure', ['azure', 'microsoft']],
  ];

  return groups.find(([, keys]) => keys.some(key => text.includes(key)))?.[0] || null;
}

export function getCarrierDisplayName(result?: IpLookupResult): string {
  const group = getCarrierGroup(result);
  const display: Record<string, string> = {
    telecom: '中国电信',
    unicom: '中国联通',
    mobile: '中国移动',
    tietong: '中国铁通',
    cernet: '教育网',
    broadcast: '中国广电',
    aliyun: '阿里云',
    tencent: '腾讯云',
    huawei: '华为云',
    cloudflare: 'Cloudflare',
    google: 'Google',
    aws: 'AWS',
    azure: 'Azure',
  };
  if (group) return display[group];
  return result?.isp || result?.org || result?.asname || '其他运营商 / IDC';
}

export function formatIpLocation(result?: IpLookupResult): string {
  if (!result || result.status !== 'success') return result?.message || '未查询到归属';
  return [result.country, result.regionName, result.city, getCarrierDisplayName(result), result.as]
    .filter(Boolean)
    .join(' / ') || '未查询到归属';
}

function isCarrierDifferent(a?: IpLookupResult, b?: IpLookupResult): boolean {
  const left = getCarrierGroup(a);
  const right = getCarrierGroup(b);
  return Boolean(left && right && left !== right);
}

function impactText(impact: RequestImpact): string {
  if (impact === 'failed') return '失败';
  if (impact === 'slow') return '慢请求';
  if (impact === 'dns') return 'DNS 解析线索';
  return '普通请求';
}

export function buildIpLookupConclusions(
  summary: DnsIpEvidenceSummary,
  lookupMap: Map<string, IpLookupResult>
): IpRoutingConclusion[] {
  const conclusions: IpRoutingConclusion[] = [];

  const overseasDns = summary.dnsServers.filter(item => item.type === 'overseas-public-dns');
  if (overseasDns.length > 0) {
    conclusions.push({
      level: 'warning',
      title: 'DNS 解析入口可能影响 CDN 就近调度',
      detail: `检测到海外公共 DNS：${overseasDns.map(item => `${item.ip} (${item.label})`).join('、')}。访问国内业务时可能导致解析到非最优节点。`,
      evidence: overseasDns.map(item => `${item.ip} ${item.label}`),
      nextAction: '切换运营商 DNS / 企业 DNS 后重新抓取 HAR 或 NetLog 对比。',
    });
  }

  for (const row of summary.cipSipRows) {
    const sipResults = row.sipIps
      .map(ip => lookupMap.get(ip))
      .filter((item): item is IpLookupResult => Boolean(item));
    const overseasSip = sipResults.find(item => item.status === 'success' && !isChina(item));
    if (overseasSip && (row.impact === 'failed' || row.impact === 'slow')) {
      conclusions.push({
        level: 'warning',
        title: '失败/慢请求存在跨境连接目标线索',
        detail: `${row.host} 的 SIP ${overseasSip.ip} 查询结果为 ${formatIpLocation(overseasSip)}。`,
        evidence: [`域名：${row.host}`, `SIP：${overseasSip.ip}`, `问题：${impactText(row.impact)}`],
        nextAction: '补充 MTR / traceroute、客户端出口 IP 和复现时间，确认是否存在跨境绕路或跨境链路质量问题。',
      });
    }

    const cip = row.cipIps.map(ip => lookupMap.get(ip)).find(item => item?.status === 'success');
    const sip = row.sipIps.map(ip => lookupMap.get(ip)).find(item => item?.status === 'success');
    if (cip && sip && isChina(cip) && isChina(sip) && isCarrierDifferent(cip, sip)) {
      conclusions.push({
        level: 'info',
        title: '客户端出口线索与服务端目标运营商不同',
        detail: `${row.host} 的 CIP 为 ${formatIpLocation(cip)}，SIP 为 ${formatIpLocation(sip)}，存在跨运营商访问线索。`,
        evidence: [`CIP：${cip.ip}`, `SIP：${sip.ip}`, `域名：${row.host}`],
        nextAction: '该信息不能直接证明故障。请结合用户当前网络运营商、MTR / traceroute 和同网段对比样本确认。',
      });
    }
  }

  if (conclusions.length === 0 && lookupMap.size > 0) {
    conclusions.push({
      level: 'info',
      title: '暂未发现明显跨境或跨运营商线索',
      detail: '已查询的公网 IP 未显示明确海外目标或可归一化的运营商不一致。仍需结合失败码、DNS、TLS、代理和链路测试继续判断。',
      evidence: [`已查询 IP：${lookupMap.size} 个`],
      nextAction: '优先查看最终诊断结论、错误码和请求阶段；如仍无法定位，补充 MTR / traceroute。',
    });
  }

  return conclusions.slice(0, 6);
}

export function collectRowLookupIps(row: CipSipEvidenceRow): string[] {
  return Array.from(new Set([...row.cipIps, ...row.sipIps]));
}
