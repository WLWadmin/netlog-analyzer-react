import type { CipSipEvidenceRow, DnsIpEvidenceSummary } from './ipEvidenceTypes';

export function buildIpListText(ips: string[]): string {
  return Array.from(new Set(ips)).filter(Boolean).join('\n');
}

export function buildCipSipRowsText(rows: CipSipEvidenceRow[]): string {
  return rows.map(row => [
    `域名: ${row.host}`,
    `状态: ${row.impact}${row.statusCode ? ` ${row.statusCode}` : ''}${row.error ? ` error=${row.error}` : ''}`,
    `耗时: ${row.durationMs ?? '-'}ms`,
    `CIP: ${row.cipIps.join(', ') || '-'}`,
    `SIP: ${row.sipIps.join(', ') || '-'}`,
    `Socket peer: ${(row.socketPeerIps || []).join(', ') || '-'}`,
    `DNS answer: ${(row.dnsAnswerIps || []).join(', ') || '-'}`,
    `服务端观察客户端 IP: ${(row.serverObservedClientIps || []).join(', ') || '-'}`,
    `代表请求: ${row.representativeRequests.map(req => `${req.url} (${req.durationMs ?? '-'}ms)`).join('；') || '-'}`,
  ].join('\n')).join('\n\n');
}

export function buildDnsIpEvidenceCopyText(summary: DnsIpEvidenceSummary): string {
  return [
    '# DNS 服务器',
    buildIpListText(summary.copyableDnsServers) || '-',
    '',
    '# 失败/慢请求 CIP/SIP',
    buildCipSipRowsText(summary.cipSipRows) || '-',
  ].join('\n');
}
