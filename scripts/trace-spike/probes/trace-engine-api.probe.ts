import * as TraceEngine from '__TRACE_ENGINE_PACKAGE__';

export interface TraceEngineApiProbeResult {
  exportNames: string[];
  hasModelNamespace: boolean;
  hasTraceProcessor: boolean;
  parsed: boolean;
  inputEventCount: number;
  handlerNames: string[];
  handlerArrayCounts: Record<string, number>;
  projectFacts: {
    navigations: Array<{
      key: string;
      frameKey: string;
      processId?: number;
      threadId?: number;
      startUs: number;
      endUs: number;
      processCount: number;
    }>;
    requests: Array<{
      requestKey: string;
      navigationKey: string;
      redirectIndex: number;
      result: string;
      statusCode?: number;
      startUs: number;
      endUs?: number;
      url?: string;
      initiatorKey?: string;
    }>;
    milestones: Array<{
      navigationKey: string;
      name: string;
      relativeUs: number;
      candidate: boolean;
    }>;
    mainThreadTasks: Array<{
      navigationKey: string;
      processId: number;
      threadId: number;
      startUs: number;
      durationMs: number;
      selfTimeMs?: number;
    }>;
    interactions: Array<{
      interactionKey: string;
      navigationKey: string;
      startUs: number;
      inputDelayMs: number;
      processingMs: number;
      presentationMs: number;
    }>;
    frames: Array<{
      navigationKey: string;
      startUs: number;
      durationMs: number;
      dropped: boolean;
    }>;
  };
}

function installProbePolyfills(): string[] {
  const installed: string[] = [];
  if (typeof globalThis.DOMRect === 'undefined') {
    class ProbeDOMRect {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
      get top(): number { return this.y; }
      get right(): number { return this.x + this.width; }
      get bottom(): number { return this.y + this.height; }
      get left(): number { return this.x; }
      toJSON(): Record<string, number> {
        return {
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          top: this.top,
          right: this.right,
          bottom: this.bottom,
          left: this.left,
        };
      }
    }
    (globalThis as unknown as { DOMRect: typeof DOMRect }).DOMRect =
      ProbeDOMRect as unknown as typeof DOMRect;
    installed.push('DOMRect');
  }
  return installed;
}

function handlerArrayCounts(data: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [handlerName, handlerData] of Object.entries(data)) {
    if (!handlerData || typeof handlerData !== 'object') continue;
    let count = 0;
    for (const value of Object.values(handlerData as Record<string, unknown>)) {
      if (Array.isArray(value)) count += value.length;
      else if (value instanceof Map || value instanceof Set) count += value.size;
    }
    counts[handlerName] = count;
  }
  return counts;
}

function nestedScalar(
  value: unknown,
  targetKeys: string[],
  depth = 0,
): Scalar | undefined {
  if (!value || typeof value !== 'object' || depth > 5) return undefined;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (targetKeys.includes(key.toLowerCase())
      && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
      return item;
    }
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const nested = nestedScalar(item, targetKeys, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function detectEventFamilies(
  events: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const families = new Set<string>();
  const navigationIds = new Set<string>();
  let navigationStartCount = 0;
  const frameParents = new Map<string, string>();
  const frameProcesses = new Map<string, Set<number>>();

  for (const event of events) {
    const name = typeof event.name === 'string' ? event.name.toLowerCase() : '';
    const category = typeof event.cat === 'string' ? event.cat.toLowerCase() : '';
    const navigationId = nestedScalar(event.args, ['navigationid']);
    const frameId = nestedScalar(event.args, ['frame', 'frameid']);
    const parentFrameId = nestedScalar(event.args, ['parent', 'parentframe', 'parentframeid']);
    const isOutermost = nestedScalar(event.args, ['isoutermostmainframe', 'isoutmostmainframe']);
    const explicitOopif = nestedScalar(event.args, ['isoopif', 'oopif']);
    const processId = typeof event.pid === 'number'
      ? event.pid
      : Number(nestedScalar(event.args, ['pid', 'processid']));

    if (category.includes('__metadata') || name === 'process_name' || name === 'thread_name') {
      families.add('renderer-main-thread');
    }
    if (name.includes('navigation') || navigationId !== undefined) {
      families.add('navigation');
      if (navigationId !== undefined) navigationIds.add(String(navigationId));
      if (name.includes('navigationstart')) navigationStartCount += 1;
    }
    if (name.includes('resource') || name.includes('request') || name.includes('response')) {
      families.add('network');
    }
    if (name.includes('redirect')) families.add('redirect');
    if (name.includes('response')) families.add('network-response');
    if (name === 'runtask' || category.includes('devtools.timeline')) {
      families.add('renderer-main-thread');
    }
    if (/firstcontentfulpaint|largestcontentfulpaint|domcontentloaded|loadevent/i.test(name)) {
      families.add('page-milestones');
    }
    if (name.includes('eventtiming') || name.includes('interaction')) families.add('event-timing');
    if (name.includes('frame')) families.add('animation-frame');
    if (name.includes('layout')) families.add('layout');
    if (name.includes('paint')) families.add('paint');

    if (frameId !== undefined) {
      const frameKey = String(frameId);
      if (parentFrameId !== undefined && String(parentFrameId) !== frameKey) {
        frameParents.set(frameKey, String(parentFrameId));
      }
      if (Number.isFinite(processId)) {
        const processes = frameProcesses.get(frameKey) || new Set<number>();
        processes.add(processId);
        frameProcesses.set(frameKey, processes);
      }
    }
    if (isOutermost === false) families.add('iframe');
    if (explicitOopif === true) families.add('oopif');
  }

  if (navigationIds.size > 1 || (navigationIds.size === 0 && navigationStartCount > 1)) {
    families.add('multiple-navigation');
  }
  if (frameParents.size > 0) families.add('iframe');
  for (const [childFrame, parentFrame] of frameParents) {
    const childProcesses = frameProcesses.get(childFrame);
    const parentProcesses = frameProcesses.get(parentFrame);
    if (childProcesses && parentProcesses
      && [...childProcesses].some(processId => !parentProcesses.has(processId))) {
      families.add('oopif');
    }
  }
  if ([...frameProcesses.values()].some(processes => processes.size > 1)) {
    families.add('renderer-process-swap');
  }
  return [...families].sort();
}

type Scalar = string | number | boolean;
type FlatRecord = Map<string, Scalar>;

function collectRecords(value: unknown, records: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || records.length >= 50_000 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, records, depth + 1);
    return;
  }
  if (value instanceof Map) {
    for (const item of value.values()) collectRecords(item, records, depth + 1);
    return;
  }
  if (value instanceof Set) {
    for (const item of value) collectRecords(item, records, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const hasDirectScalar = Object.values(record).some(item =>
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
  if (hasDirectScalar) records.push(record);
  for (const item of Object.values(record)) {
    collectRecords(item, records, depth + 1);
  }
}

function flattenScalars(
  value: Record<string, unknown>,
  output: FlatRecord = new Map(),
  depth = 0,
): FlatRecord {
  if (depth > 4) return output;
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      if (!output.has(normalizedKey)) output.set(normalizedKey, item);
    } else if (item && typeof item === 'object' && !Array.isArray(item)
      && !(item instanceof Map) && !(item instanceof Set)) {
      flattenScalars(item as Record<string, unknown>, output, depth + 1);
    }
  }
  return output;
}

function recordsFor(data: Record<string, unknown>, handlerNames: string[]): FlatRecord[] {
  const records: Record<string, unknown>[] = [];
  for (const handlerName of handlerNames) collectRecords(data[handlerName], records);
  return records.map(record => flattenScalars(record));
}

function scalar(record: FlatRecord, names: string[]): Scalar | undefined {
  for (const name of names) {
    const value = record.get(name.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function stringValue(record: FlatRecord, names: string[]): string | undefined {
  const value = scalar(record, names);
  return value === undefined ? undefined : String(value);
}

function numberValue(record: FlatRecord, names: string[]): number | undefined {
  const value = scalar(record, names);
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function eventName(record: FlatRecord): string {
  return (stringValue(record, ['name', 'metricName', 'type']) || '').toLowerCase();
}

function navigationForTime(
  navigations: TraceEngineApiProbeResult['projectFacts']['navigations'],
  processId: number | undefined,
  timestampUs: number,
): string | undefined {
  return navigations.find(item =>
    (processId === undefined || item.processId === processId)
    && timestampUs >= item.startUs
    && timestampUs <= item.endUs)?.key;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map(item => [key(item), item])).values()];
}

export function buildProjectFacts(
  data: Record<string, unknown>,
): TraceEngineApiProbeResult['projectFacts'] {
  const contextRecords = recordsFor(data, ['Meta', 'PageFrames']);
  const processContexts = contextRecords.map(record => ({
    frameKey: stringValue(record, ['frame', 'frameId']),
    processId: numberValue(record, ['pid', 'processId']),
    threadId: numberValue(record, ['tid', 'threadId']),
    startUs: numberValue(record, ['startTime', 'ts', 'startUs']),
    endUs: numberValue(record, ['endTime', 'endUs']),
  })).filter(item =>
    item.frameKey !== undefined
    && item.processId !== undefined
    && item.threadId !== undefined);

  const navigationRecords = recordsFor(data, ['Meta', 'PageFrames', 'PageLoadMetrics']);
  const navigationCandidates = navigationRecords.map(record => {
    const key = stringValue(record, ['navigationId', 'navigation', 'loaderId']);
    const frameKey = stringValue(record, ['frame', 'frameId']);
    const startUs = numberValue(record, ['navigationStart', 'startTime', 'ts', 'startUs']);
    const durationUs = numberValue(record, ['dur', 'duration']);
    const endUs = numberValue(record, ['endTime', 'endUs'])
      ?? (startUs !== undefined && durationUs !== undefined ? startUs + durationUs : undefined);
    if (!key || !frameKey || startUs === undefined) return undefined;
    const frameProcesses = processContexts.filter(item => item.frameKey === frameKey);
    const matchingProcesses = frameProcesses
      .filter(item =>
        (item.startUs === undefined || item.startUs <= startUs)
        && (item.endUs === undefined || item.endUs >= startUs))
      .sort((left, right) => (right.startUs || 0) - (left.startUs || 0));
    const process = matchingProcesses[0] || frameProcesses[0];
    return {
      key,
      frameKey,
      processId: process?.processId,
      threadId: process?.threadId,
      startUs,
      endUs,
      processCount: new Set(frameProcesses.map(item => item.processId)).size,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined);
  const orderedNavigations = uniqueBy(navigationCandidates, item => item.key)
    .sort((left, right) => left.startUs - right.startUs);
  const uniqueNavigations = orderedNavigations.map((navigation, index) => {
    const nextNavigation = orderedNavigations
      .slice(index + 1)
      .find(item => item.frameKey === navigation.frameKey);
    return {
      ...navigation,
      endUs: navigation.endUs ?? nextNavigation?.startUs ?? Number.MAX_SAFE_INTEGER,
    };
  });

  const initiatorRecords = recordsFor(data, ['Initiators', 'NetworkRequests']);
  const initiatorByRequest = new Map<string, string>();
  for (const record of initiatorRecords) {
    const requestKey = stringValue(record, ['requestId', 'requestKey']);
    const initiatorKey = stringValue(record, ['initiatorRequestId', 'initiatorId', 'initiatorRequest']);
    if (requestKey && initiatorKey) initiatorByRequest.set(requestKey, initiatorKey);
  }

  const requests = uniqueBy(recordsFor(data, ['NetworkRequests']).map(record => {
    const requestKey = stringValue(record, ['requestId', 'requestKey']);
    const startUs = numberValue(record, ['ts', 'startTime', 'startUs']);
    if (!requestKey || startUs === undefined) return undefined;
    const statusCode = numberValue(record, ['statusCode', 'status']);
    const failed = scalar(record, ['failed']) === true;
    const hasFinish = numberValue(record, ['finishTime', 'endTime', 'endUs']) !== undefined;
    const result = statusCode !== undefined && statusCode >= 400
      ? 'http-error'
      : (failed ? 'transport-failed' : (hasFinish ? 'success' : 'incomplete-at-trace-end'));
    const processId = numberValue(record, ['pid', 'processId']);
    return {
      requestKey,
      navigationKey: stringValue(record, ['navigationId', 'navigation'])
        || navigationForTime(uniqueNavigations, processId, startUs)
        || '',
      redirectIndex: numberValue(record, ['redirectIndex']) || 0,
      result,
      statusCode,
      startUs,
      endUs: numberValue(record, ['finishTime', 'endTime', 'endUs']),
      url: stringValue(record, ['url']),
      initiatorKey: initiatorByRequest.get(requestKey),
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined),
  item => `${item.requestKey}:${item.redirectIndex}:${item.startUs}`);

  const milestones = uniqueBy(recordsFor(data, ['PageLoadMetrics']).map(record => {
    const name = eventName(record);
    const navigationKey = stringValue(record, ['navigationId', 'navigation']);
    const timestampUs = numberValue(record, ['ts', 'timestamp', 'startTime']);
    const navigation = uniqueNavigations.find(item => item.key === navigationKey);
    if (!navigationKey || !navigation || !name || timestampUs === undefined) return undefined;
    return {
      navigationKey,
      name,
      relativeUs: timestampUs - navigation.startUs,
      candidate: name.includes('lcp'),
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined),
  item => `${item.navigationKey}:${item.name}:${item.relativeUs}`);

  const mainThreadTasks = uniqueBy(recordsFor(data, ['Renderer']).map(record => {
    const name = eventName(record);
    const processId = numberValue(record, ['pid', 'processId']);
    const threadId = numberValue(record, ['tid', 'threadId']);
    const startUs = numberValue(record, ['ts', 'startTime', 'startUs']);
    const durationUs = numberValue(record, ['dur', 'duration']);
    if (!name.includes('runtask') || processId === undefined || threadId === undefined
      || startUs === undefined || durationUs === undefined) return undefined;
    const navigationKey = navigationForTime(uniqueNavigations, processId, startUs);
    if (!navigationKey) return undefined;
    return {
      navigationKey,
      processId,
      threadId,
      startUs,
      durationMs: durationUs / 1000,
      selfTimeMs: numberValue(record, ['selfTime']),
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined),
  item => `${item.processId}:${item.threadId}:${item.startUs}`);

  const interactions = uniqueBy(recordsFor(data, ['UserInteractions']).map(record => {
    const interactionKey = stringValue(record, ['interactionId', 'interactionKey']);
    const startUs = numberValue(record, ['ts', 'startTime', 'startUs']);
    const processingStart = numberValue(record, ['processingStart']);
    const processingEnd = numberValue(record, ['processingEnd']);
    const interactionEnd = numberValue(record, ['interactionEnd', 'nextPaintTime', 'endTime']);
    if (!interactionKey || startUs === undefined || processingStart === undefined
      || processingEnd === undefined || interactionEnd === undefined) return undefined;
    const processId = numberValue(record, ['pid', 'processId']);
    const navigationKey = stringValue(record, ['navigationId', 'navigation'])
      || navigationForTime(uniqueNavigations, processId, startUs);
    if (!navigationKey) return undefined;
    return {
      interactionKey,
      navigationKey,
      startUs,
      inputDelayMs: (processingStart - startUs) / 1000,
      processingMs: (processingEnd - processingStart) / 1000,
      presentationMs: (interactionEnd - processingEnd) / 1000,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined),
  item => `${item.interactionKey}:${item.startUs}`);

  const frames = uniqueBy(recordsFor(data, ['Frames', 'AnimationFrames']).map(record => {
    const startUs = numberValue(record, ['ts', 'startTime', 'startUs']);
    const durationUs = numberValue(record, ['dur', 'duration']);
    if (startUs === undefined || durationUs === undefined) return undefined;
    const processId = numberValue(record, ['pid', 'processId']);
    const navigationKey = stringValue(record, ['navigationId', 'navigation'])
      || navigationForTime(uniqueNavigations, processId, startUs);
    if (!navigationKey) return undefined;
    return {
      navigationKey,
      startUs,
      durationMs: durationUs / 1000,
      dropped: scalar(record, ['dropped', 'isDropped']) === true,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined),
  item => `${item.navigationKey}:${item.startUs}:${item.durationMs}`);

  return {
    navigations: uniqueNavigations,
    requests,
    milestones,
    mainThreadTasks,
    interactions,
    frames,
  };
}

export async function parseTraceEvents(
  traceEvents: ReadonlyArray<Record<string, unknown>>,
): Promise<TraceEngineApiProbeResult & { installedPolyfills: string[] }> {
  const engine = TraceEngine as unknown as Record<string, unknown>;
  const exportNames = Object.keys(engine).sort();
  const processorNamespace = engine.Processor as
    | { TraceProcessor?: { createWithAllHandlers?: () => {
        parse: (events: ReadonlyArray<Record<string, unknown>>) => Promise<void>;
        data?: Record<string, unknown>;
      } } }
    | undefined;
  const createProcessor = processorNamespace?.TraceProcessor?.createWithAllHandlers;
  if (typeof createProcessor !== 'function') {
    throw new Error('TRACE_ENGINE_API_INCOMPATIBLE');
  }
  const installedPolyfills = installProbePolyfills();
  const processor = createProcessor();
  await processor.parse(traceEvents);
  const data = processor.data;
  if (!data || typeof data !== 'object') {
    throw new Error('TRACE_ENGINE_RESULT_MISSING');
  }
  const counts = handlerArrayCounts(data);

  return {
    exportNames,
    hasModelNamespace: typeof engine.Model === 'object',
    hasTraceProcessor: true,
    parsed: true,
    inputEventCount: traceEvents.length,
    handlerNames: Object.keys(data).sort(),
    handlerArrayCounts: counts,
    projectFacts: buildProjectFacts(data),
    installedPolyfills,
  };
}
