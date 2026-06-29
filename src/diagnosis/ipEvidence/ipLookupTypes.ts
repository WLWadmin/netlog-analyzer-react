export type IpLookupStatus = 'idle' | 'loading' | 'success' | 'failed';

export interface IpLookupResult {
  ip: string;
  status: 'success' | 'fail';
  country?: string;
  regionName?: string;
  city?: string;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
  message?: string;
  self?: boolean;
}

export interface IpLookupState {
  status: IpLookupStatus;
  result?: IpLookupResult;
  error?: string;
}

export interface LookupIpContext {
  ip: string;
  roles: string[];
  hosts: string[];
  impacts: string[];
}

export interface IpRoutingConclusion {
  level: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  evidence: string[];
  nextAction: string;
}

export interface IpLookupBatchSummary {
  requested: number;
  skipped: number;
  queued: number;
  queried: number;
  stoppedByRateLimit: boolean;
}
