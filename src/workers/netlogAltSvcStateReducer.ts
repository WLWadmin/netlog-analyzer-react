import type { AltSvcStateView } from './netlogDatasetViews';

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

interface AlternativeDraft {
  key: string;
  host?: string;
  origin?: string;
  protocol?: string;
  alternativeService?: string;
  port?: number | string;
  expiration?: string | number;
  eventCount: number;
  brokenCount: number;
  firstEventId?: number;
  lastEventId?: number;
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
}

function isAltSvcEvent(seed: EventSeed): boolean {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  return text.includes('ALT_SVC') || text.includes('ALTERNATE_SERVICE') || text.includes('ALTERNATIVE_SERVICE');
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
  const value = params?.net_error ?? params?.error_code ?? params?.error ?? params?.reason;
  if (value === 0 || value === '0' || value === 'OK') return undefined;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function eventKind(typeName: string, params: Record<string, unknown>): AltSvcStateView['events'][number]['kind'] {
  const upper = typeName.toUpperCase();
  const paramText = JSON.stringify(params).toUpperCase();
  if (upper.includes('FOUND')) return 'found';
  if (upper.includes('BROKEN') || paramText.includes('BROKEN')) return 'broken';
  if (upper.includes('CLEAR') || upper.includes('DELETE')) return 'cleared';
  if (upper.includes('USED') || upper.includes('SELECTED')) return 'used';
  if (upper.includes('MAPPED') || upper.includes('MAP')) return 'mapped';
  return 'alt-svc-event';
}

function updateRange(draft: AlternativeDraft, seed: EventSeed) {
  const seedTime = seed.time ?? 0;
  draft.eventCount += 1;
  draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
  draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
  draft.firstByteStart = Math.min(draft.firstByteStart ?? seed.byteStart, seed.byteStart);
  draft.lastByteEnd = Math.max(draft.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
  draft.firstTime = Math.min(draft.firstTime ?? seedTime, seedTime);
  draft.lastTime = Math.max(draft.lastTime ?? seedTime, seedTime);
}

export function createNetlogAltSvcStateReducer() {
  const alternatives = new Map<string, AlternativeDraft>();
  const events: AltSvcStateView['events'] = [];
  const impactSummaries: AltSvcStateView['impactSummaries'] = [];
  let eventCount = 0;
  let foundCount = 0;
  let usedCount = 0;
  let brokenCount = 0;
  let clearedCount = 0;

  const accept = (seed: EventSeed) => {
    if (!isAltSvcEvent(seed)) return;
    const params = seed.params || {};
    const kind = eventKind(seed.typeName, params);
    const host = firstString(params.host, params.hostname, params.server, params.host_port_pair);
    const origin = firstString(params.origin, params.url, params.network_anonymization_key);
    const protocol = firstString(params.protocol, params.alpn, params.alt_protocol, params.alternate_protocol);
    const alternativeService = firstString(params.alternative_service, params.alt_svc, params.alt_svc_field, params.service, params.alternative_service_info);
    const port = firstNumberOrString(params.port, params.alternate_port, params.destination_port);
    const expiration = firstNumberOrString(params.expiration, params.expires, params.expiration_time);
    const error = errorValue(params);
    const key = [host, origin, protocol, port].filter(Boolean).join('|') || alternativeService || `source#${seed.sourceId}`;

    eventCount += 1;
    if (kind === 'found') foundCount += 1;
    if (kind === 'used') usedCount += 1;
    if (kind === 'broken') brokenCount += 1;
    if (kind === 'cleared') clearedCount += 1;

    const draft = alternatives.get(key) || {
      key,
      host,
      origin,
      protocol,
      alternativeService,
      port,
      expiration,
      eventCount: 0,
      brokenCount: 0,
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seed.time ?? 0,
      lastTime: seed.time ?? 0,
    };
    updateRange(draft, seed);
    draft.host = draft.host || host;
    draft.origin = draft.origin || origin;
    draft.protocol = draft.protocol || protocol;
    draft.alternativeService = draft.alternativeService || alternativeService;
    draft.port = draft.port || port;
    draft.expiration = draft.expiration || expiration;
    if (kind === 'broken') draft.brokenCount += 1;
    alternatives.set(key, draft);

    const summary = [
      seed.typeName,
      host ? `host=${host}` : undefined,
      protocol ? `protocol=${protocol}` : undefined,
      alternativeService ? `alt=${alternativeService}` : undefined,
      port !== undefined ? `port=${port}` : undefined,
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
      host,
      origin,
      protocol,
      alternativeService,
      port,
      error,
      summary,
    });

    const impactKind = kind === 'broken' ? 'broken' : kind === 'mapped' || kind === 'found' ? 'mapped' : error !== undefined ? 'fallback' : undefined;
    if (impactKind) {
      const requestScoped = Boolean(host || origin);
      impactSummaries.push({
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seed.time,
        typeName: seed.typeName,
        kind: impactKind,
        host,
        origin,
        protocol,
        alternativeService,
        error,
        requestScoped,
        unresolvedReason: requestScoped ? undefined : '缺少 host/origin 锚点，不能安全关联到具体请求或域名。',
        summary,
      });
    }
  };

  const finish = (): AltSvcStateView => {
    const view: AltSvcStateView = {
      alternatives: Array.from(alternatives.values()),
      events,
      impactSummaries,
      eventCount,
      foundCount,
      usedCount,
      brokenCount,
      clearedCount,
      requestScopedCandidateCount: 0,
      evidenceGaps: [],
    };
    view.requestScopedCandidateCount = view.impactSummaries.filter(item => item.requestScoped).length;
    if (view.eventCount === 0) {
      view.evidenceGaps.push('未发现 Alt-Svc / Alternative Service 事件；不代表站点没有配置 HTTP/3 或替代服务，只表示当前 Dataset 未捕获相关事件。');
    } else {
      view.evidenceGaps.push('Alt-Svc 是协议选择和 HTTP/3 候选事实，不能单独作为请求失败或慢请求根因。');
    }
    if (view.brokenCount > 0) {
      view.evidenceGaps.push('发现 Alt-Svc broken 线索时，请结合 QUIC、HTTP/2、代理和防火墙 UDP 443 支持判断是否发生协议回退。');
    }
    if (view.impactSummaries.some(item => !item.requestScoped)) {
      view.evidenceGaps.push('部分 Alt-Svc 事件缺少 host/origin 锚点，只能作为协议选择候选线索。');
    }
    return view;
  };

  return { accept, finish };
}
