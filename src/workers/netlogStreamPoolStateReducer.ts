import type { StreamPoolStateView } from './netlogDatasetViews';

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

interface JobDraft {
  sourceId: number;
  sourceTypeName: string;
  eventCount: number;
  waitCount: number;
  stalledCount: number;
  reusedSocketCount: number;
  boundSocketCount: number;
  connectJobCount: number;
  errors: Set<number | string>;
  groups: Set<string>;
  urls: Set<string>;
  firstEventId?: number;
  lastEventId?: number;
  firstByteStart?: number;
  lastByteEnd?: number;
  firstTime?: number;
  lastTime?: number;
  sourceDependencyIds: Set<number>;
}

function isStreamPoolEvent(seed: EventSeed): boolean {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  if (text.includes('ALT_SVC') || text.includes('ALTERNATE_SERVICE')) return false;
  return (
    text.includes('HTTP_STREAM') ||
    text.includes('SOCKET_POOL') ||
    text.includes('HTTP2_SESSION_POOL') ||
    text.includes('QUIC_STREAM_FACTORY')
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

function eventKind(typeName: string): StreamPoolStateView['events'][number]['kind'] {
  const upper = typeName.toUpperCase();
  if (upper.includes('WAITING')) return 'waiting';
  if (upper.includes('STALLED') || upper.includes('MAX_SOCKETS')) return 'stalled';
  if (upper.includes('REUSED')) return 'reused-socket';
  if (upper.includes('BOUND_TO_SOCKET')) return 'bound-socket';
  if (upper.includes('CONNECT_JOB')) return 'connect-job';
  if (upper.includes('BOUND_TO_REQUEST')) return 'bound-request';
  if (upper.includes('ORPHANED')) return 'orphaned';
  if (upper.includes('DELAYED') || upper.includes('THROTTLED')) return 'delayed';
  return 'pool-event';
}

function updateRange(draft: JobDraft, seed: EventSeed) {
  const seedTime = seed.time ?? 0;
  draft.eventCount += 1;
  draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
  draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
  draft.firstByteStart = Math.min(draft.firstByteStart ?? seed.byteStart, seed.byteStart);
  draft.lastByteEnd = Math.max(draft.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
  draft.firstTime = Math.min(draft.firstTime ?? seedTime, seedTime);
  draft.lastTime = Math.max(draft.lastTime ?? seedTime, seedTime);
}

export function createNetlogStreamPoolStateReducer() {
  const jobs = new Map<number, JobDraft>();
  const events: StreamPoolStateView['events'] = [];
  const impactSummaries: StreamPoolStateView['impactSummaries'] = [];
  const sourceLinks = new Map<string, StreamPoolStateView['sourceLinks'][number]>();
  let eventCount = 0;
  let waitCount = 0;
  let stalledCount = 0;
  let reusedSocketCount = 0;
  let boundSocketCount = 0;
  let connectJobCount = 0;
  let errorCount = 0;

  const ensureJob = (seed: EventSeed): JobDraft => {
    const existing = jobs.get(seed.sourceId);
    if (existing) return existing;
    const created: JobDraft = {
      sourceId: seed.sourceId,
      sourceTypeName: seed.sourceTypeName,
      eventCount: 0,
      waitCount: 0,
      stalledCount: 0,
      reusedSocketCount: 0,
      boundSocketCount: 0,
      connectJobCount: 0,
      errors: new Set<number | string>(),
      groups: new Set<string>(),
      urls: new Set<string>(),
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seed.time ?? 0,
      lastTime: seed.time ?? 0,
      sourceDependencyIds: new Set<number>(),
    };
    jobs.set(seed.sourceId, created);
    return created;
  };

  const accept = (seed: EventSeed) => {
    if (!isStreamPoolEvent(seed)) return;
    const params = seed.params || {};
    const kind = eventKind(seed.typeName);
    const group = firstString(params.group_name, params.groupName, params.group, params.socket_pool_group, params.host);
    const url = firstString(params.url, params.request_url, params.origin);
    const error = errorValue(params);
    const dependencySourceIds = extractDependencySourceIds(params).filter(id => id !== seed.sourceId);
    const draft = ensureJob(seed);

    eventCount += 1;
    updateRange(draft, seed);
    if (group) draft.groups.add(group);
    if (url) draft.urls.add(url);
    dependencySourceIds.forEach(id => draft.sourceDependencyIds.add(id));
    for (const dependencySourceId of dependencySourceIds) {
      sourceLinks.set(`${seed.sourceId}-${dependencySourceId}-source-dependency`, {
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seed.time,
        typeName: seed.typeName,
        fromSourceId: seed.sourceId,
        toSourceId: dependencySourceId,
        kind: 'source-dependency',
      });
    }
    if (error !== undefined) {
      draft.errors.add(error);
      errorCount += 1;
    }
    if (kind === 'waiting') {
      draft.waitCount += 1;
      waitCount += 1;
    }
    if (kind === 'stalled') {
      draft.stalledCount += 1;
      stalledCount += 1;
    }
    if (kind === 'reused-socket') {
      draft.reusedSocketCount += 1;
      reusedSocketCount += 1;
    }
    if (kind === 'bound-socket') {
      draft.boundSocketCount += 1;
      boundSocketCount += 1;
    }
    if (kind === 'connect-job') {
      draft.connectJobCount += 1;
      connectJobCount += 1;
    }

    const summary = [
      seed.typeName,
      group ? `group=${group}` : undefined,
      url ? `url=${url}` : undefined,
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
      group,
      url,
      error,
      summary,
    });

    const impactKind = kind === 'stalled' || kind === 'waiting' || kind === 'orphaned' || kind === 'delayed'
      ? kind
      : error !== undefined ? 'error' : undefined;
    if (impactKind) {
      const requestScoped = Boolean(url || dependencySourceIds.length > 0);
      impactSummaries.push({
        sourceId: seed.sourceId,
        eventId: seed.eventId,
        byteStart: seed.byteStart,
        byteEnd: seed.byteEnd,
        time: seed.time,
        typeName: seed.typeName,
        kind: impactKind,
        group,
        url,
        error,
        requestScoped,
        unresolvedReason: requestScoped ? undefined : '缺少 URL 或 source_dependency 锚点，不能安全外推到具体请求。',
        summary,
      });
    }
  };

  const finish = (): StreamPoolStateView => {
    const view: StreamPoolStateView = {
      jobs: Array.from(jobs.values()).map(job => ({
        sourceId: job.sourceId,
        sourceTypeName: job.sourceTypeName,
        eventCount: job.eventCount,
        waitCount: job.waitCount,
        stalledCount: job.stalledCount,
        reusedSocketCount: job.reusedSocketCount,
        boundSocketCount: job.boundSocketCount,
        connectJobCount: job.connectJobCount,
        errors: Array.from(job.errors),
        groups: Array.from(job.groups),
        urls: Array.from(job.urls),
        firstEventId: job.firstEventId,
        lastEventId: job.lastEventId,
        firstByteStart: job.firstByteStart,
        lastByteEnd: job.lastByteEnd,
        firstTime: job.firstTime,
        lastTime: job.lastTime,
        sourceDependencyIds: Array.from(job.sourceDependencyIds),
      })),
      events,
      impactSummaries,
      sourceLinks: Array.from(sourceLinks.values()),
      eventCount,
      waitCount,
      stalledCount,
      reusedSocketCount,
      boundSocketCount,
      connectJobCount,
      errorCount,
      requestScopedCandidateCount: 0,
      evidenceGaps: [],
    };
    view.requestScopedCandidateCount = view.impactSummaries.filter(item => item.requestScoped).length;
    if (view.eventCount === 0) {
      view.evidenceGaps.push('未发现 HTTP stream / socket pool 事件；不代表没有连接池行为，只表示当前 Dataset 未捕获相关事件。');
    } else {
      view.evidenceGaps.push('StreamPool State 展示连接复用和等待队列事实，不能单独作为请求失败或慢请求根因。');
    }
    if (view.stalledCount > 0 || view.waitCount > 0) {
      view.evidenceGaps.push('发现 waiting / stalled 时，请结合 Sockets、Proxy、DNS、HTTP/2/QUIC 和请求 source chain 判断是否是连接池容量、代理或协议回退造成。');
    }
    if (view.impactSummaries.some(item => !item.requestScoped)) {
      view.evidenceGaps.push('部分 StreamPool impact 缺少 URL 或 source_dependency 关联；只能作为连接池候选线索。');
    }
    return view;
  };

  return { accept, finish };
}
