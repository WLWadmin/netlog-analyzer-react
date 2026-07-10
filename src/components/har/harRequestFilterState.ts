import type { HarCategory, HarRequestEntry } from '../../harParser';
import { getHarRequestIssue } from '../../diagnosis/shared/harRequestIssue';

export type HarIssueFilter =
  | 'all'
  | 'slow'
  | 'ttfb'
  | 'queueing'
  | 'dns'
  | 'tls'
  | 'status-zero'
  | 'net-error'
  | '5xx'
  | '4xx';

export interface HarRequestFilterState {
  category: HarCategory | 'all';
  status: 'all' | 'failed' | 'slow';
  issue: HarIssueFilter;
  method: 'all' | 'GET' | 'POST' | 'OPTIONS' | 'other';
  domain: string | 'all';
  hasLogid: 'all' | 'yes' | 'no';
  hasServerTiming: 'all' | 'yes' | 'no';
  keyword: string;
  blockedDomains: string[];
  requestIds?: number[];
}

export const DEFAULT_HAR_REQUEST_FILTER_STATE: HarRequestFilterState = {
  category: 'all',
  status: 'all',
  issue: 'all',
  method: 'all',
  domain: 'all',
  hasLogid: 'all',
  hasServerTiming: 'all',
  keyword: '',
  blockedDomains: [],
  requestIds: undefined,
};

function getMethodBucket(method: string): HarRequestFilterState['method'] {
  const normalized = method.toUpperCase();
  if (normalized === 'GET' || normalized === 'POST' || normalized === 'OPTIONS') return normalized;
  return 'other';
}

function matchesIssue(entry: HarRequestEntry, issueFilter: HarIssueFilter): boolean {
  if (issueFilter === 'all') return true;
  const issue = getHarRequestIssue(entry);

  if (issueFilter === 'slow') return issue.kind === 'slow';
  if (issueFilter === 'ttfb') return issue.kind === 'slow' && issue.phase === 'wait';
  if (issueFilter === 'queueing') return issue.kind === 'slow' && issue.phase === 'blocked';
  if (issueFilter === 'dns') return issue.kind === 'slow' && issue.phase === 'dns';
  if (issueFilter === 'tls') return issue.kind === 'slow' && issue.phase === 'ssl';
  if (issueFilter === 'status-zero') return issue.kind === 'status-zero' || issue.kind === 'cors';
  if (issueFilter === 'net-error') return issue.kind === 'net-error';
  if (issueFilter === '5xx') return entry.status >= 500 && entry.status < 600;
  if (issueFilter === '4xx') return entry.status >= 400 && entry.status < 500;

  return true;
}

export function filterHarRequests(entries: HarRequestEntry[], filters: HarRequestFilterState): HarRequestEntry[] {
  const keyword = filters.keyword.trim().toLowerCase();
  const blockedDomains = filters.blockedDomains.map(d => d.toLowerCase()).filter(Boolean);

  return entries.filter(entry => {
    if (filters.category !== 'all' && entry.category !== filters.category) return false;
    if (filters.status === 'failed' && !entry.isFailed) return false;
    if (filters.status === 'slow' && !entry.isSlow) return false;
    if (!matchesIssue(entry, filters.issue)) return false;
    if (filters.method !== 'all' && getMethodBucket(entry.method) !== filters.method) return false;
    if (filters.domain !== 'all' && entry.domain !== filters.domain) return false;
    if (filters.hasLogid === 'yes' && !entry.xTtLogid) return false;
    if (filters.hasLogid === 'no' && entry.xTtLogid) return false;
    if (filters.hasServerTiming === 'yes' && entry.serverTiming.length === 0) return false;
    if (filters.hasServerTiming === 'no' && entry.serverTiming.length > 0) return false;
    if (keyword && !entry.url.toLowerCase().includes(keyword)) return false;
    if (filters.requestIds?.length && !filters.requestIds.includes(entry.id)) return false;
    if (blockedDomains.length > 0 && blockedDomains.some(domain => entry.domain.toLowerCase().includes(domain))) return false;
    return true;
  });
}

export function getTopHarDomains(entries: HarRequestEntry[], limit = 5): string[] {
  const counts = new Map<string, number>();
  entries.forEach(entry => {
    if (!entry.domain || entry.domain === '-') return;
    counts.set(entry.domain, (counts.get(entry.domain) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([domain]) => domain);
}
