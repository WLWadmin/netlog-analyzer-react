import type { CipSipEvidenceRow, DnsIpEvidenceSummary, IpEvidenceSource } from './ipEvidenceTypes';

function formatSources(sources: IpEvidenceSource[]): string {
  return Array.from(new Set(sources)).join(', ') || '-';
}

export function buildIpListText(ips: string[]): string {
  return Array.from(new Set(ips)).filter(Boolean).join('\n');
}

export function buildCipSipRowsText(rows: CipSipEvidenceRow[]): string {
  return rows.map(row => [
    `URL/域名: ${row.hostOrUrl}`,
    `状态: ${row.impact}${row.statusCode ? ` ${row.statusCode}` : ''}${row.error ? ` error=${row.error}` : ''}`,
    `耗时: ${row.durationMs ?? '-'}ms`,
    `CIP: ${row.cipIps.join(', ') || '-'}`,
    `CIP 来源: ${formatSources(row.cipSources)}`,
    `SIP: ${row.sipIps.join(', ') || '-'}`,
    `SIP 来源: ${formatSources(row.sipSources)}`,
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
