import type { ModulesStateView } from './netlogDatasetViews';

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

interface ModuleDraft {
  key: string;
  name?: string;
  category: ModulesStateView['modules'][number]['category'];
  eventCount: number;
  errorCount: number;
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
  const value = params?.net_error ?? params?.error_code ?? params?.error ?? params?.status;
  if (value === 0 || value === '0' || value === 'OK') return undefined;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function isModuleEvent(seed: EventSeed): boolean {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  return text.includes('MODULE') || text.includes('COMPONENT') || text.includes('NETWORK_SERVICE');
}

function category(seed: EventSeed): ModulesStateView['modules'][number]['category'] {
  const text = `${seed.typeName} ${seed.sourceTypeName}`.toUpperCase();
  if (text.includes('MODULE')) return 'module';
  if (text.includes('COMPONENT')) return 'component';
  if (text.includes('SERVICE')) return 'service';
  return 'unknown';
}

function kind(typeName: string, error: number | string | undefined): ModulesStateView['events'][number]['kind'] {
  const upper = typeName.toUpperCase();
  if (error !== undefined || upper.includes('FAIL') || upper.includes('ERROR')) return 'failed';
  if (upper.includes('LOAD')) return 'loaded';
  if (upper.includes('INIT') || upper.includes('START')) return 'initialized';
  if (upper.includes('UPDATE')) return 'updated';
  return 'module-event';
}

function updateRange(draft: ModuleDraft, seed: EventSeed) {
  const seedTime = seed.time ?? 0;
  draft.eventCount += 1;
  draft.firstEventId = Math.min(draft.firstEventId ?? seed.eventId, seed.eventId);
  draft.lastEventId = Math.max(draft.lastEventId ?? seed.eventId, seed.eventId);
  draft.firstByteStart = Math.min(draft.firstByteStart ?? seed.byteStart, seed.byteStart);
  draft.lastByteEnd = Math.max(draft.lastByteEnd ?? seed.byteEnd, seed.byteEnd);
  draft.firstTime = Math.min(draft.firstTime ?? seedTime, seedTime);
  draft.lastTime = Math.max(draft.lastTime ?? seedTime, seedTime);
}

export function createNetlogModulesStateReducer() {
  const modules = new Map<string, ModuleDraft>();
  const events: ModulesStateView['events'] = [];
  let eventCount = 0;
  let errorCount = 0;

  const accept = (seed: EventSeed) => {
    if (!isModuleEvent(seed)) return;
    const params = seed.params || {};
    const name = firstString(params.module, params.module_name, params.name, params.component, params.service, params.process, seed.sourceTypeName);
    const eventError = errorValue(params);
    const eventKind = kind(seed.typeName, eventError);
    const eventCategory = category(seed);
    const key = `${eventCategory}:${name || seed.sourceTypeName || seed.sourceId}`;

    eventCount += 1;
    if (eventError !== undefined || eventKind === 'failed') errorCount += 1;

    const draft = modules.get(key) || {
      key,
      name,
      category: eventCategory,
      eventCount: 0,
      errorCount: 0,
      firstEventId: seed.eventId,
      lastEventId: seed.eventId,
      firstByteStart: seed.byteStart,
      lastByteEnd: seed.byteEnd,
      firstTime: seed.time ?? 0,
      lastTime: seed.time ?? 0,
    };
    updateRange(draft, seed);
    draft.name = draft.name || name;
    if (eventError !== undefined || eventKind === 'failed') draft.errorCount += 1;
    modules.set(key, draft);

    events.push({
      sourceId: seed.sourceId,
      eventId: seed.eventId,
      byteStart: seed.byteStart,
      byteEnd: seed.byteEnd,
      time: seed.time,
      typeName: seed.typeName,
      kind: eventKind,
      name,
      category: eventCategory,
      error: eventError,
      summary: [seed.typeName, name ? `name=${name}` : undefined, eventError !== undefined ? `error=${eventError}` : undefined].filter(Boolean).join('；'),
    });
  };

  const finish = (): ModulesStateView => ({
    modules: Array.from(modules.values()).sort((a, b) => b.errorCount - a.errorCount || b.eventCount - a.eventCount),
    events,
    eventCount,
    errorCount,
    evidenceGaps: eventCount === 0
      ? ['未发现 Modules / Components / Network Service 事件；这通常不影响常规网络故障定位。']
      : ['Modules State 用于理解浏览器内部模块/组件状态，不能单独作为网络请求失败根因。'],
  });

  return { accept, finish };
}
