import type { CacheStateView } from './netlogDatasetViews';

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

interface CacheEntryDraft {
  sourceId: number;
  sourceTypeName: string;
  eventCount: number;
  operationKinds: Set<string>;
  urls: Set<string>;
  cacheKeys: Set<string>;
  errorCount: number;
  firstEventId?: number;
  lastEventId?: number;
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
  sourceDependencyIds: Set<number>;
}

function isCacheEvent(seed: EventSeed): boolean {
  const type = seed.typeName.toUpperCase();
  const source = seed.sourceTypeName.toUpperCase();
  return (
    type.includes('HTTP_CACHE') ||
    type.includes('DISK_CACHE') ||
    type.includes('SIMPLE_CACHE') ||
    source.includes('DISK_CACHE') ||
    source.includes('HTTP_CACHE') ||
    source.includes('SIMPLE_CACHE')
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function errorValue(params: Record<string, unknown> | undefined): number | string | undefined {
  const value = params?.net_error ?? params?.error_code ?? params?.error ?? params?.result;
  if (value === 0 || value === '0' || value === 'OK') return undefined;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function extractSourceIdFromObject(value: Record<string, unknown>): number | undefined {
  const id = Number(value.id ?? value.source_id ?? value.sourceId);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function extractDependencySourceIds(params: Record<string, unknown> | undefined): number[] {
  if (!params) return [];
  const roots = [
    params.source,
    params.source_dependency,
    params.sourceDependency,
    params.source_dependencies,
    params.sourceDependencies,
    params.dependencies,
  ].filter(value => value !== undefined);
  const ids = new Set<number>();
  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const value = node as Record<string, unknown>;
    const id = extractSourceIdFromObject(value);
    if (id) ids.add(id);
    [
      value.source,
      value.source_dependency,
      value.sourceDependency,
      value.source_dependencies,
      value.sourceDependencies,
      value.dependency,
      value.dependencies,
    ].filter(item => item !== undefined).forEach(item => visit(item, depth + 1));
  };
  roots.forEach(root => visit(root));
  return Array.from(ids);
}

function operationKind(typeName: string): CacheStateView['operations'][number]['kind'] {
  const upper = typeName.toUpperCase();
  if (upper.includes('OPEN')) return 'open';
  if (upper.includes('CREATE')) return 'create';
  if (upper.includes('READ')) return 'read';
  if (upper.includes('WRITE') || upper.includes('ADD_TO_ENTRY')) return 'write';
  if (upper.includes('DOOM') || upper.includes('DELETE')) return 'doom';
  if (upper.includes('VALIDATE') || upper.includes('REVALIDATE')) return 'validation';
  if (upper.includes('BYPASS')) return 'bypass';
  if (upper.includes('NETWORK')) return 'network';
  return 'cache-event';
}

function impactKind(
  typeName: string,
  kind: CacheStateView['operations'][number]['kind'],
  error: number | string | undefined
): CacheStateView['impactSummaries'][number]['kind'] | undefined {
  const upper = typeName.toUpperCase();
  if (error !== undefined) return 'error';
  if (upper.includes('MISS') || upper.includes('NOT_FOUND')) return 'miss';
  if (kind === 'doom') return 'doom';
  if (kind === 'bypass') return 'bypass';
  if (kind === 'validation') return 'validation';
  return undefined;
}

function updateRange(draft: CacheEntryDraft, seed: EventSeed) {
  const seedTime = seed.time ?? 0;
  draft.eventCount += 1;
  draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
  draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
  draft.firstByteStart = Math.min(draft.firstByteStart ?? seed.byteStart, seed.byteStart);
  draft.lastByteEnd = Math.max(draft.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
  draft.firstTime = Math.min(draft.firstTime ?? seedTime, seedTime);
  draft.lastTime = Math.max(draft.lastTime ?? seedTime, seedTime);
}

export function createNetlogCacheStateReducer() {
  const entries = new Map<number, CacheEntryDraft>();
  const operations: CacheStateView['operations'] = [];
  const impactSummaries: CacheStateView['impactSummaries'] = [];
  let eventCount = 0;
  let openCount = 0;
  let createCount = 0;
  let readCount = 0;
  let writeCount = 0;
  let doomCount = 0;
  let bypassCount = 0;
  let validationCount = 0;
  let errorCount = 0;

  const ensureEntry = (seed: EventSeed): CacheEntryDraft => {
    const existing = entries.get(seed.sourceId);
    if (existing) return existing;
    const created: CacheEntryDraft = {
      sourceId: seed.sourceId,
      sourceTypeName: seed.sourceTypeName,
      eventCount: 0,
      operationKinds: new Set<string>(),
      urls: new Set<string>(),
      cacheKeys: new Set<string>(),
      errorCount: 0,
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seed.time ?? 0,
      lastTime: seed.time ?? 0,
      sourceDependencyIds: new Set<number>(),
    };
    entries.set(seed.sourceId, created);
    return created;
  };

  const accept = (seed: EventSeed) => {
    if (!isCacheEvent(seed)) return;
    eventCount += 1;
    const params = seed.params || {};
    const kind = operationKind(seed.typeName);
    const url = firstString(params.url, params.original_url, params.request_url, params.response_url);
    const cacheKey = firstString(params.key, params.cache_key, params.entry_key, params.entry_hash, params.url);
    const error = errorValue(params);
    const dependencySourceIds = extractDependencySourceIds(params).filter(id => id !== seed.sourceId);
    const draft = ensureEntry(seed);
    updateRange(draft, seed);
    draft.operationKinds.add(kind);
    if (url) draft.urls.add(url);
    if (cacheKey) draft.cacheKeys.add(cacheKey);
    dependencySourceIds.forEach(id => draft.sourceDependencyIds.add(id));
    if (error !== undefined) {
      draft.errorCount += 1;
      errorCount += 1;
    }

    if (kind === 'open') openCount += 1;
    if (kind === 'create') createCount += 1;
    if (kind === 'read') readCount += 1;
    if (kind === 'write') writeCount += 1;
    if (kind === 'doom') doomCount += 1;
    if (kind === 'bypass') bypassCount += 1;
    if (kind === 'validation') validationCount += 1;

    const summary = [
      seed.typeName,
      url ? `url=${url}` : undefined,
      cacheKey && cacheKey !== url ? `key=${cacheKey}` : undefined,
      error !== undefined ? `error=${error}` : undefined,
    ].filter(Boolean).join('；');

    operations.push({
      sourceId: seed.sourceId,
      eventId: seed.eventId,
      byteStart: seed.byteStart,
      byteEnd: seed.byteEnd,
      time: seed.time,
      typeName: seed.typeName,
      kind,
      url,
      cacheKey,
      error,
      summary,
    });

    const impact = impactKind(seed.typeName, kind, error);
    if (impact) {
      const requestScoped = Boolean(url || dependencySourceIds.length > 0);
      impactSummaries.push({
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seed.time,
        typeName: seed.typeName,
        kind: impact,
        url,
        cacheKey,
        error,
        requestScoped,
        unresolvedReason: requestScoped ? undefined : '缺少 URL 或 source_dependency 锚点，不能安全外推到具体请求。',
        summary,
      });
    }

    entries.set(seed.sourceId, draft);
  };

  const finish = (): CacheStateView => {
    const view: CacheStateView = {
      entries: Array.from(entries.values()).map(entry => ({
        sourceId: entry.sourceId,
        sourceTypeName: entry.sourceTypeName,
        eventCount: entry.eventCount,
        operationKinds: Array.from(entry.operationKinds),
        urls: Array.from(entry.urls),
        cacheKeys: Array.from(entry.cacheKeys),
        errorCount: entry.errorCount,
        firstEventId: entry.firstEventId,
        lastEventId: entry.lastEventId,
        firstByteStart: entry.firstByteStart,
        lastByteEnd: entry.lastByteEnd,
        firstTime: entry.firstTime,
        lastTime: entry.lastTime,
        sourceDependencyIds: Array.from(entry.sourceDependencyIds),
      })),
      operations,
      impactSummaries,
      eventCount,
      openCount,
      createCount,
      readCount,
      writeCount,
      doomCount,
      bypassCount,
      validationCount,
      errorCount,
      requestScopedCandidateCount: 0,
      evidenceGaps: [],
    };
    view.requestScopedCandidateCount = view.impactSummaries.filter(item => item.requestScoped).length;
    if (view.eventCount === 0) {
      view.evidenceGaps.push('未发现 HTTP/DISK/SIMPLE cache 事件；不代表没有使用缓存，只表示当前 Dataset 未捕获缓存层事件。');
    } else {
      view.evidenceGaps.push('Cache State 展示浏览器缓存层事实，不能单独把 cache miss、revalidation 或 doom 当成请求失败根因。');
    }
    if (view.errorCount > 0 || view.bypassCount > 0 || view.doomCount > 0) {
      view.evidenceGaps.push('发现 cache error / bypass / doom 时，请结合请求状态码、网络请求、代理和服务端缓存头判断影响范围。');
    }
    if (view.impactSummaries.some(item => !item.requestScoped)) {
      view.evidenceGaps.push('部分 Cache impact 缺少 URL 或 source_dependency 关联；只能作为缓存层候选线索。');
    }
    return view;
  };

  return { accept, finish };
}
