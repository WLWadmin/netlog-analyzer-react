import type {
  FileFormatProbeAdapter,
  FileParserId,
  ProbeInput,
  ProbeVerdict,
} from './fileFormatTypes';
import {
  isNetlogEventRecord,
  netlogEventsFromRoot,
} from '../parsers/shared/rootFormatGuard';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function verdict(
  kind: ProbeVerdict['kind'],
  parserId: FileParserId,
  evidenceCodes: string[],
): ProbeVerdict {
  return { kind, parserId, evidenceCodes } as ProbeVerdict;
}

function harProbe(input: ProbeInput): ProbeVerdict {
  const parserId: FileParserId = 'har@1';
  if (!isRecord(input.value) || !isRecord(input.value.log)) {
    return verdict('no-match', parserId, ['HAR_LOG_MISSING']);
  }
  const entries = input.value.log.entries;
  if (!Array.isArray(entries)) {
    return verdict('no-match', parserId, ['HAR_ENTRIES_MISSING']);
  }
  if (entries.length === 0) {
    return verdict('possible-match', parserId, ['HAR_ENTRIES_EMPTY']);
  }
  const firstEntry = entries[0];
  if (
    isRecord(firstEntry)
    && isRecord(firstEntry.request)
    && isRecord(firstEntry.response)
  ) {
    return verdict('definite-match', parserId, [
      'HAR_LOG_OBJECT',
      'HAR_ENTRIES_ARRAY',
      'HAR_ENTRY_REQUEST_RESPONSE',
    ]);
  }
  return verdict('possible-match', parserId, [
    'HAR_LOG_OBJECT',
    'HAR_ENTRIES_ARRAY',
    'HAR_ENTRY_STRUCTURE_INCOMPLETE',
  ]);
}

function netlogProbe(input: ProbeInput): ProbeVerdict {
  const parserId: FileParserId = 'chromium-netlog@1';
  const events = netlogEventsFromRoot(input.value);
  if (!events) {
    return verdict('no-match', parserId, ['NETLOG_EVENTS_MISSING']);
  }
  const hasConstants = isRecord(input.value)
    && isRecord(input.value.constants);
  const firstEvent = events[0];
  const hasEventSemantics = isNetlogEventRecord(firstEvent);
  if (hasConstants || hasEventSemantics) {
    return verdict('definite-match', parserId, [
      Array.isArray(input.value)
        ? 'NETLOG_ROOT_ARRAY'
        : isRecord(input.value) && Array.isArray(input.value.logEvents)
          ? 'NETLOG_LOG_EVENTS_ARRAY'
          : 'NETLOG_EVENTS_ARRAY',
      hasConstants ? 'NETLOG_CONSTANTS_OBJECT' : 'NETLOG_EVENT_SEMANTICS',
    ]);
  }
  return verdict('possible-match', parserId, ['NETLOG_GENERIC_EVENTS_ARRAY']);
}

function traceProbe(input: ProbeInput): ProbeVerdict {
  const parserId: FileParserId = 'chromium-performance-trace@1';
  if (!isRecord(input.value) || !Array.isArray(input.value.traceEvents)) {
    return verdict('no-match', parserId, ['TRACE_EVENTS_MISSING']);
  }
  const events = input.value.traceEvents;
  if (events.length === 0) {
    return verdict('possible-match', parserId, ['TRACE_EVENTS_EMPTY']);
  }
  const firstEvent = events[0];
  if (
    isRecord(firstEvent)
    && typeof firstEvent.name === 'string'
    && typeof firstEvent.ph === 'string'
    && typeof firstEvent.ts === 'number'
    && (typeof firstEvent.pid === 'number' || typeof firstEvent.tid === 'number')
  ) {
    return verdict('definite-match', parserId, [
      'TRACE_EVENTS_ARRAY',
      'TRACE_EVENT_TIMING_FIELDS',
      'TRACE_EVENT_THREAD_FIELDS',
    ]);
  }
  return verdict('possible-match', parserId, [
    'TRACE_EVENTS_ARRAY',
    'TRACE_EVENT_STRUCTURE_INCOMPLETE',
  ]);
}

function logProbe(input: ProbeInput): ProbeVerdict {
  const parserId: FileParserId = 'go-service-log@1';
  if (typeof input.value !== 'string') {
    return verdict('no-match', parserId, ['GO_LOG_TEXT_REQUIRED']);
  }
  const lines = input.value.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) {
    return verdict('no-match', parserId, ['GO_LOG_EMPTY']);
  }
  const matchedLines = lines.filter(
    line => /^\[[^\]]+\]\s+(Info|Error|Warn|Debug)\b/.test(line),
  ).length;
  if (matchedLines > 0 && matchedLines / lines.length >= 0.5) {
    return verdict('definite-match', parserId, [
      'GO_LOG_TEXT',
      'GO_LOG_LINE_SYNTAX',
    ]);
  }
  return verdict('no-match', parserId, ['GO_LOG_LINE_SYNTAX_MISSING']);
}

export const BUILT_IN_FORMAT_PROBES: readonly FileFormatProbeAdapter[] = [
  {
    parserId: 'har@1',
    sourceKind: 'har',
    family: 'network',
    extensions: ['.har', '.json'],
    probe: async input => harProbe(input),
  },
  {
    parserId: 'chromium-netlog@1',
    sourceKind: 'netlog',
    family: 'network',
    extensions: ['.json'],
    probe: async input => netlogProbe(input),
  },
  {
    parserId: 'chromium-performance-trace@1',
    sourceKind: 'trace',
    family: 'performance',
    extensions: ['.json', '.trace', '.json2'],
    probe: async input => traceProbe(input),
  },
  {
    parserId: 'go-service-log@1',
    sourceKind: 'log',
    family: 'server',
    extensions: ['.log'],
    probe: async input => logProbe(input),
  },
];

export class FileFormatRegistry {
  private readonly adapters = new Map<FileParserId, FileFormatProbeAdapter>();

  constructor(adapters: readonly FileFormatProbeAdapter[] = []) {
    adapters.forEach(adapter => this.register(adapter));
  }

  register(adapter: FileFormatProbeAdapter): void {
    if (this.adapters.has(adapter.parserId)) {
      throw new Error(`Duplicate file parser registration: ${adapter.parserId}`);
    }
    this.adapters.set(adapter.parserId, adapter);
  }

  get(parserId: FileParserId): FileFormatProbeAdapter | undefined {
    return this.adapters.get(parserId);
  }

  list(): FileFormatProbeAdapter[] {
    return [...this.adapters.values()];
  }
}

export async function probeRegisteredFormats(
  registry: FileFormatRegistry,
  input: ProbeInput,
): Promise<ProbeVerdict[]> {
  return Promise.all(registry.list().map(adapter => probeRegisteredFormat(
    adapter,
    input,
  )));
}

export function probeRegisteredFormat(
  adapter: FileFormatProbeAdapter,
  input: ProbeInput,
): Promise<ProbeVerdict> {
  const preflightVerdict = input.probeVerdicts?.find(
    verdict => verdict.parserId === adapter.parserId,
  );
  return preflightVerdict
    ? Promise.resolve(preflightVerdict)
    : adapter.probe(input);
}
