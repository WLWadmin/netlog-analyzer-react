import type { AnalysisResult, URLRequest } from '../parsers/netlog/parser';
import type { HarAnalysisResult, HarRequestEntry } from '../harParser';
import type { HarSummary, NetlogRequestPreview, NetlogSummary } from './summaryTypes';
import { TOP_REQUESTS_COUNT } from '../constants/analysisThresholds';

function toRequestPreview(req: URLRequest): NetlogRequestPreview {
  return {
    id: req.id,
    url: req.url,
    method: req.method,
    startTime: req.startTime,
    endTime: req.endTime,
    duration: req.duration,
    status: req.status,
    statusCode: req.statusCode,
    error: req.error,
    errorDesc: req.errorDesc,
    resolvedIp: req.resolvedIp,
    remoteIp: req.remoteIp,
    protocol: req.protocol,
    timeline: {
      dns: req.timeline?.dns?.duration,
      connect: req.timeline?.connect?.duration,
      ssl: req.timeline?.ssl?.duration,
      send: req.timeline?.send?.duration,
      wait: req.timeline?.wait?.duration,
      download: req.timeline?.download?.duration,
    },
  };
}

export function buildNetlogSummary(result: AnalysisResult): NetlogSummary {
  const slowRequestPreviews = [...result.urlRequests]
    .filter(r => typeof r.duration === 'number')
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, TOP_REQUESTS_COUNT)
    .map(toRequestPreview);

  const failedDomainPreviews = [...result.failedDomains]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map(d => ({
      domain: d.domain,
      count: d.count,
      errorCodes: d.errorCodes,
      firstTime: d.firstTime,
      lastTime: d.lastTime,
    }));

  return {
    kind: 'netlog',
    totalEvents: result.totalEvents,
    uniqueSources: result.uniqueSources,
    peakConcurrency: result.peakConcurrency,
    timeRange: result.timeRange,
    protocols: result.protocols,
    issueCounts: {
      error: result.errors.length,
      warning: result.warnings.length,
      info: result.info.length,
    },
    proxyInfo: result.proxyInfo,
    systemInfo: result.systemInfo,
    requestCount: result.urlRequests.length,
    slowRequestPreviews,
    failedDomainPreviews,
  };
}

function toHarEntryPreview(e: HarRequestEntry) {
  return {
    id: e.id,
    url: e.url,
    method: e.method,
    status: e.status,
    time: e.time,
    startMs: e.startMs,
    domain: e.domain,
    path: e.name,
    isSlow: e.isSlow,
    isFailed: e.isFailed,
    xTtLogid: e.xTtLogid,
  };
}

export function buildHarSummary(result: HarAnalysisResult): HarSummary {
  const slowEntryPreviews = [...result.entries]
    .filter(e => e.isSlow)
    .sort((a, b) => b.time - a.time)
    .slice(0, 20)
    .map(toHarEntryPreview);

  const domainSet = new Set<string>();
  result.entries.forEach(e => { if (e.domain) domainSet.add(e.domain); });

  return {
    kind: 'har',
    totalRequests: result.totalRequests,
    failedRequests: result.failedCount,
    slowRequests: result.slowCount,
    domainCount: domainSet.size,
    slowEntryPreviews,
    repairInfo: (result as any).repairInfo,
  };
}
