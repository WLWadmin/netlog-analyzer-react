import type { PrerenderStateView } from './netlogDatasetViews';

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

interface ActivityDraft {
  sourceId: number;
  kind: PrerenderStateView['activities'][number]['kind'];
  sourceTypeName: string;
  eventCount: number;
  errorCount: number;
  urls: string[];
  firstEventId?: number;
  lastEventId?: number;
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function errorValue(params: Record<string, unknown> | undefined): number | string | undefined {
  const value = params?.net_error ?? params?.error_code ?? params?.error ?? params?.failure ?? params?.status;
  if (value === 0 || value === '0' || value === 'OK') return undefined;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function eventKind(seed: EventSeed): PrerenderStateView['events'][number]['kind'] | undefined {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  if (text.includes('PRERENDER') || text.includes('NO_STATE_PREFETCH')) return 'prerender';
  if (text.includes('PREFETCH')) return 'prefetch';
  if (text.includes('PRECONNECT')) return 'preconnect';
  if (text.includes('SPECULATION')) return 'speculation';
  if (text.includes('PREDICT')) return 'prediction';
  if (text.includes('NAVIGATION')) return 'navigation';
  return undefined;
}

function impactKind(typeName: string, kind: PrerenderStateView['events'][number]['kind'], error: number | string | undefined): PrerenderStateView['impactSummaries'][number]['kind'] | undefined {
  const upper = typeName.toUpperCase();
  if (error !== undefined || upper.includes('FAIL')) return 'failed';
  if (upper.includes('CANCEL')) return 'cancelled';
  if (upper.includes('ACTIVATE') || upper.includes('USE')) return 'activated';
  if (kind === 'prefetch') return 'prefetch';
  if (kind === 'preconnect') return 'preconnect';
  if (kind === 'prediction' || kind === 'speculation') return 'prediction';
  return undefined;
}

function updateRange(draft: ActivityDraft, seed: EventSeed) {
  const seedTime = seed.time ?? 0;
  draft.eventCount += 1;
  draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
  draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
  draft.firstByteStart = Math.min(draft.firstByteStart ?? seed.byteStart, seed.byteStart);
  draft.lastByteEnd = Math.max(draft.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
  draft.firstTime = Math.min(draft.firstTime ?? seedTime, seedTime);
  draft.lastTime = Math.max(draft.lastTime ?? seedTime, seedTime);
}

export function createNetlogPrerenderStateReducer() {
  const activities = new Map<number, ActivityDraft>();
  const events: PrerenderStateView['events'] = [];
  const impactSummaries: PrerenderStateView['impactSummaries'] = [];
  let eventCount = 0;
  let prerenderCount = 0;
  let prefetchCount = 0;
  let preconnectCount = 0;
  let predictionCount = 0;
  let speculationCount = 0;
  let errorCount = 0;

  const accept = (seed: EventSeed) => {
    const kind = eventKind(seed);
    if (!kind) return;
    const params = seed.params || {};
    const url = firstString(params.url, params.prerender_url, params.prefetch_url, params.referrer, params.origin);
    const error = errorValue(params);
    eventCount += 1;
    if (kind === 'prerender') prerenderCount += 1;
    if (kind === 'prefetch') prefetchCount += 1;
    if (kind === 'preconnect') preconnectCount += 1;
    if (kind === 'prediction') predictionCount += 1;
    if (kind === 'speculation') speculationCount += 1;
    if (error !== undefined) errorCount += 1;

    const draft = activities.get(seed.sourceId) || {
      sourceId: seed.sourceId,
      kind,
      sourceTypeName: seed.sourceTypeName,
      eventCount: 0,
      errorCount: 0,
      urls: [],
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seed.time ?? 0,
      lastTime: seed.time ?? 0,
    };
    updateRange(draft, seed);
    if (url && !draft.urls.includes(url)) draft.urls.push(url);
    if (error !== undefined) draft.errorCount += 1;
    activities.set(seed.sourceId, draft);

    const summary = [seed.typeName, url ? `url=${url}` : undefined, error !== undefined ? `error=${error}` : undefined].filter(Boolean).join('；');
    events.push({
      sourceId: seed.sourceId,
      eventId: seed.eventId,
      byteStart: seed.byteStart,
      byteEnd: seed.byteEnd,
      time: seed.time,
      typeName: seed.typeName,
      kind,
      url,
      error,
      summary,
    });

    const impact = impactKind(seed.typeName, kind, error);
    if (impact) {
      const requestScoped = Boolean(url);
      impactSummaries.push({
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seed.time,
        typeName: seed.typeName,
        kind: impact,
        url,
        error,
        requestScoped,
        unresolvedReason: requestScoped ? undefined : '缺少 URL 锚点，不能安全关联到具体页面或请求。',
        summary,
      });
    }
  };

  const finish = (): PrerenderStateView => {
    const view: PrerenderStateView = {
      activities: Array.from(activities.values()).sort((a, b) => b.errorCount - a.errorCount || b.eventCount - a.eventCount),
      events,
      impactSummaries,
      eventCount,
      prerenderCount,
      prefetchCount,
      preconnectCount,
      predictionCount,
      speculationCount,
      errorCount,
      requestScopedCandidateCount: 0,
      evidenceGaps: [],
    };
    view.requestScopedCandidateCount = view.impactSummaries.filter(item => item.requestScoped).length;
    if (eventCount === 0) {
      view.evidenceGaps.push('未发现 Prerender / Prefetch / Preconnect / Prediction 事件；当前文件没有捕获相关浏览器预测行为。');
    } else {
      view.evidenceGaps.push('Prerender/Prefetch/Preconnect 是浏览器预测行为线索，不能单独作为用户可见请求失败根因。');
    }
    if (errorCount > 0) {
      view.evidenceGaps.push('发现预测/预取相关错误时，请结合真实 URL_REQUEST、Source Chain 和用户触发时间确认是否影响用户操作。');
    }
    return view;
  };

  return { accept, finish };
}
