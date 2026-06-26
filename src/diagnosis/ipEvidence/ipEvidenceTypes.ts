export type IpScope =
  | 'public'
  | 'private'
  | 'loopback'
  | 'link-local'
  | 'multicast'
  | 'reserved'
  | 'invalid';

export type IpEvidenceRole =
  | 'cip'
  | 'sip'
  | 'dns-answer'
  | 'dns-server'
  | 'socket-peer'
  | 'unknown';

export type IpEvidenceSource =
  | 'har.serverIPAddress'
  | 'har.x-tt-cip'
  | 'har.x-lsc-source-ip'
  | 'netlog.URLRequest.resolvedIp'
  | 'netlog.URLRequest.remoteIp'
  | 'netlog.failedDomains.ips'
  | 'netlog.dnsRecords.ips'
  | 'netlog.dnsServers'
  | 'netlog.params.ip_endpoint'
  | 'netlog.params.address'
  | 'netlog.params.peer_address';

export type RequestImpact = 'failed' | 'slow' | 'dns' | 'normal';

export interface IpEvidenceItem {
  id: string;
  ip: string;
  host?: string;
  url?: string;
  role: IpEvidenceRole;
  source: IpEvidenceSource;
  impact: RequestImpact;
  statusCode?: number;
  error?: string | number;
  durationMs?: number;
  count: number;
  description: string;
}

export interface CipSipEvidenceRow {
  id: string;
  host: string;
  hostOrUrl: string;
  impact: RequestImpact;
  statusCode?: number;
  error?: string | number;
  durationMs?: number;
  cipIps: string[];
  sipIps: string[];
  representativeRequests: Array<{
    url: string;
    statusCode?: number;
    error?: string | number;
    durationMs?: number;
    impact: RequestImpact;
  }>;
  descriptions: string[];
}

export interface DnsServerEvidence {
  ip: string;
  type:
    | 'overseas-public-dns'
    | 'public-dns'
    | 'local-router-dns'
    | 'private-dns'
    | 'unknown';
  risk: 'none' | 'low' | 'medium';
  label: string;
  explanation: string;
  action: string;
}

export interface DnsAnswerEvidence {
  host: string;
  ips: string[];
  source: 'dns_cache' | 'dns_event' | 'socket_event' | 'unknown';
  time?: number;
}

export interface DnsIpEvidenceSummary {
  dnsServers: DnsServerEvidence[];
  dnsAnswers: DnsAnswerEvidence[];
  dnsEventCount?: number;
  failedOrSlowIps: IpEvidenceItem[];
  cipSipRows: CipSipEvidenceRow[];
  copyableIps: string[];
  copyableDnsServers: string[];
  guidance: string[];
  limitations: string[];
}
