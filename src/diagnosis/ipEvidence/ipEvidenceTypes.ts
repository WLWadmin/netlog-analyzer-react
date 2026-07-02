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
  | 'server-observed-client-ip'
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
  | 'netlog.params.peer_address'
  | 'netlog.headers.x-request-ip';

export type RequestImpact = 'failed' | 'slow' | 'dns' | 'normal';

export type IpEvidenceAssociation =
  | 'direct-url-request'
  | 'source-graph'
  | 'global-candidate'
  | 'dns-only'
  | 'header-only';

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
  sourceId?: number;
  eventId?: number;
  byteStart?: number;
  byteEnd?: number;
  association?: IpEvidenceAssociation;
  count: number;
  description: string;
}

export interface NetlogEvidenceTrace {
  eventId?: number;
  sourceId?: number;
  byteStart?: number;
  byteEnd?: number;
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
  socketPeerIps?: string[];
  dnsAnswerIps?: string[];
  serverObservedClientIps?: string[];
  representativeRequests: Array<{
    url: string;
    statusCode?: number;
    error?: string | number;
    durationMs?: number;
    impact: RequestImpact;
  }>;
  descriptions: string[];
  evidenceTraces?: NetlogEvidenceTrace[];
  evidenceAssociations?: IpEvidenceAssociation[];
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
  sourceId?: number;
  eventId?: number;
  byteStart?: number;
  byteEnd?: number;
}

export interface DohCandidateEvidence {
  value: string;
  source: 'polledData' | 'dns_event' | 'unknown';
}

export interface DnsIpEvidenceSummary {
  dnsServers: DnsServerEvidence[];
  dnsAnswers: DnsAnswerEvidence[];
  dohCandidates?: DohCandidateEvidence[];
  dnsEventCount?: number;
  failedOrSlowIps: IpEvidenceItem[];
  cipSipRows: CipSipEvidenceRow[];
  copyableIps: string[];
  copyableDnsServers: string[];
  guidance: string[];
  limitations: string[];
  sourceGraphStats?: {
    socketPeerTotal: number;
    socketPeerSourceGraphAssociated: number;
    socketPeerGlobalCandidate: number;
    sourceDependencyEdges: number;
    sourceDependencyUnparsed: number;
  };
}
