import type { ReportingStateView } from './netlogDatasetViews';

interface EventSeed {
  eventId: number;
  byteStart: number;
  byteEnd: number;
  time?: number;
  typeName: string;
  sourceId: number;
  sourceTypeName: string;
  params?: Record<string, unknown>;
}

interface EndpointDraft {
  key: string;
  origin?: string;
  group?: string;
  url?: string;
  priority?: number | string;
  weight?: number | string;
  expires?: string | number;
  eventCount: number;
  uploadCount: number;
  failureCount: number;
  firstEventId?: number;
  lastEventId?: number;
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
}

function isReportingEvent(seed: EventSeed): boolean {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  return text.includes('REPORTING') || text.includes('NETWORK_ERROR_LOGGING') || /(^|_)NEL(_|$)/.test(text);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstNumberOrString(...values: unknown[]): number | string | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function errorValue(params: Record<string, unknown> | undefined): number | string | undefined {
  const value = params?.net_error ?? params?.error_code ?? params?.error ?? params?.failure ?? params?.reason;
  if (value === 0 || value === '0' || value === 'OK') return undefined;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function eventKind(typeName: string, params: Record<string, unknown>): ReportingStateView['events'][number]['kind'] {
  const upper = typeName.toUpperCase();
  const paramText = JSON.stringify(params).toUpperCase();
  if (upper.includes('CACHE')) return 'cache';
  if (upper.includes('HEADER') || upper.includes('POLICY') || upper.includes('CONFIG') || upper.includes('ENDPOINT')) return 'endpoint-config';
  if (upper.includes('QUEUE') || upper.includes('QUEUED') || paramText.includes('QUEUED')) return 'queued';
  if (upper.includes('SUCCESS') || upper.includes('SUCCEEDED')) return 'succeeded';
  if (upper.includes('FAIL') || upper.includes('ERROR') || paramText.includes('FAILED')) return 'failed';
  if (upper.includes('UPLOAD') || upper.includes('SEND') || upper.includes('DELIVER')) return errorValue(params) !== undefined ? 'failed' : 'uploaded';
  return 'reporting-event';
}

function updateRange(draft: EndpointDraft, seed: EventSeed) {
  const seedTime = seed.time ?? 0;
  draft.eventCount += 1;
  draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
  draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
  draft.firstByteStart = Math.min(draft.firstByteStart ?? seed.byteStart, seed.byteStart);
  draft.lastByteEnd = Math.max(draft.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
  draft.firstTime = Math.min(draft.firstTime ?? seedTime, seedTime);
  draft.lastTime = Math.max(draft.lastTime ?? seedTime, seedTime);
}

export function createNetlogReportingStateReducer() {
  const endpoints = new Map<string, EndpointDraft>();
  const events: ReportingStateView['events'] = [];
  const impactSummaries: ReportingStateView['impactSummaries'] = [];
  let eventCount = 0;
  let queuedCount = 0;
  let uploadCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let cacheCount = 0;

  const accept = (seed: EventSeed) => {
    if (!isReportingEvent(seed)) return;
    const params = seed.params || {};
    const kind = eventKind(seed.typeName, params);
    const origin = firstString(params.origin, params.origin_url, params.host, params.domain, params.network_anonymization_key);
    const group = firstString(params.group, params.group_name, params.endpoint_group, params.reporting_group);
    const url = firstString(params.url, params.report_url, params.request_url, params.document_url);
    const endpointUrl = firstString(params.endpoint_url, params.endpoint, params.upload_url, params.reporting_endpoint, params.report_uri, params.uri);
    const reportType = firstString(params.report_type, params.type, params.network_error_type);
    const priority = firstNumberOrString(params.priority);
    const weight = firstNumberOrString(params.weight);
    const expires = firstNumberOrString(params.expires, params.expiration, params.expiration_time, params.ttl);
    const statusCode = firstNumberOrString(params.status_code, params.http_status_code, params.response_code);
    const error = errorValue(params);
    const key = [origin, group, endpointUrl].filter(Boolean).join('|') || endpointUrl || origin || `source#${seed.sourceId}`;
    const tracksEndpoint = Boolean(endpointUrl) || kind === 'endpoint-config' || kind === 'uploaded' || kind === 'succeeded' || kind === 'failed';

    eventCount += 1;
    if (kind === 'queued') queuedCount += 1;
    if (kind === 'uploaded') uploadCount += 1;
    if (kind === 'succeeded') successCount += 1;
    if (kind === 'failed') failureCount += 1;
    if (kind === 'cache') cacheCount += 1;

    if (tracksEndpoint) {
      const draft = endpoints.get(key) || {
        key,
        origin,
        group,
        url: endpointUrl,
        priority,
        weight,
        expires,
        eventCount: 0,
        uploadCount: 0,
        failureCount: 0,
        firstEventId: seed.eventId,
        lastEventId: seed.eventId,
        firstByteStart: seed.byteStart,
        lastByteEnd: seed.byteEnd,
        firstTime: seed.time ?? 0,
        lastTime: seed.time ?? 0,
      };
      updateRange(draft, seed);
      draft.origin = draft.origin || origin;
      draft.group = draft.group || group;
      draft.url = draft.url || endpointUrl;
      draft.priority = draft.priority || priority;
      draft.weight = draft.weight || weight;
      draft.expires = draft.expires || expires;
      if (kind === 'uploaded' || kind === 'succeeded') draft.uploadCount += 1;
      if (kind === 'failed') draft.failureCount += 1;
      endpoints.set(key, draft);
    }

    const summary = [
      seed.typeName,
      origin ? `origin=${origin}` : undefined,
      group ? `group=${group}` : undefined,
      endpointUrl ? `endpoint=${endpointUrl}` : undefined,
      reportType ? `reportType=${reportType}` : undefined,
      statusCode !== undefined ? `status=${statusCode}` : undefined,
      error !== undefined ? `error=${error}` : undefined,
    ].filter(Boolean).join('；');

    events.push({
      sourceId: seed.sourceId,
      eventId: seed.eventId,
      byteStart: seed.byteStart,
      byteEnd: seed.byteEnd,
      time: seed.time,
      typeName: seed.typeName,
      kind,
      origin,
      group,
      url,
      endpointUrl,
      reportType,
      statusCode,
      error,
      summary,
    });

    const impactKind =
      kind === 'failed' ? 'upload-failure' :
        kind === 'endpoint-config' ? 'endpoint-config' :
          kind === 'queued' ? 'queued' :
            kind === 'cache' ? 'cache' :
              error !== undefined ? 'upload-failure' : undefined;
    if (impactKind) {
      const requestScoped = Boolean(origin || url);
      impactSummaries.push({
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seed.time,
        typeName: seed.typeName,
        kind: impactKind,
        origin,
        group,
        url,
        endpointUrl,
        reportType,
        statusCode,
        error,
        requestScoped,
        unresolvedReason: requestScoped ? undefined : '缺少 origin/url 锚点，不能安全关联到具体站点或请求。',
        summary,
      });
    }
  };

  const finish = (): ReportingStateView => {
    const view: ReportingStateView = {
      endpoints: Array.from(endpoints.values()),
      events,
      impactSummaries,
      eventCount,
      endpointCount: endpoints.size,
      queuedCount,
      uploadCount,
      successCount,
      failureCount,
      cacheCount,
      requestScopedCandidateCount: 0,
      evidenceGaps: [],
    };
    view.requestScopedCandidateCount = view.impactSummaries.filter(item => item.requestScoped).length;
    if (view.eventCount === 0) {
      view.evidenceGaps.push('未发现 Reporting / Network Error Logging 事件；不代表站点没有配置 NEL，只表示当前 Dataset 未捕获相关事件。');
    } else {
      view.evidenceGaps.push('Reporting/NEL 是浏览器上报网络错误的旁路机制，不能单独作为用户请求失败根因。');
    }
    if (view.failureCount > 0) {
      view.evidenceGaps.push('Reporting upload failure 只说明报告上报失败；需要结合原始请求、DNS、代理和连接层证据判断实际业务请求是否失败。');
    }
    if (view.impactSummaries.some(item => !item.requestScoped)) {
      view.evidenceGaps.push('部分 Reporting/NEL 事件缺少 origin/url 锚点，只能作为全局上报状态线索。');
    }
    return view;
  };

  return { accept, finish };
}
