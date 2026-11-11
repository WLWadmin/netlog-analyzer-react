import { parseLog } from '../parsers/netlog/parser';
import { parseLogFile, LogEntry } from '../logParser';
import { buildNetlogJsonExport } from './netlogExport';
import { buildLogEntriesJson, buildLogEntriesText } from '../components/log/exportLogEntries';

const generatedAt = new Date('2026-11-11T00:00:00.000Z');
const line = (time = '2026-11-11 00:00:01', tail = '') =>
  `[synthetic] Info ${time} Got Success 200 GET:https://example.test/api | ${tail}+0ms`;
const entries = () => parseLogFile(line()).entries;
const netlog = () => parseLog({ events: [
  { time: '0', type: 1, phase: 0, source: { id: 1, type: 1 }, params: {} },
] }).result;

it('preserves missing/null parent proxyInfo without creating a container', () => {
  const result = netlog();
  Object.defineProperty(result, 'proxyInfo', { value: null, configurable: true });
  expect(JSON.parse(buildNetlogJsonExport(result)).proxyInfo).toBeNull();
  Reflect.deleteProperty(result, 'proxyInfo');
  expect(JSON.parse(buildNetlogJsonExport(result))).not.toHaveProperty('proxyInfo');
});

it.each([-101, -202, 0, undefined])('keeps all phase endpoints, error %p and generated time unchanged', error => {
  const result = netlog();
  const phase = { start: -10.125, end: 0, duration: 10.125 };
  const timeline = { dns: phase, connect: phase, ssl: phase, send: phase, wait: phase, download: phase };
  result.urlRequests.push({
    id: 1, url: '', method: 'GET', startTime: -10.125, duration: 0,
    error, statusCode: 0, events: [], timeline,
  });
  result.errors.push({ severity: 'error', category: 'network', message: 'recorded', detail: 'recorded', time: -1 });
  const data = JSON.parse(buildNetlogJsonExport(result, generatedAt));
  expect(data.requests[0].timeline).toEqual(timeline);
  expect(data.requests[0]).toMatchObject({ statusCode: 0, duration: 0 });
  expect(data.requests[0].error).toBe(error);
  expect(data.errors[0].time).toBe(-1);
  expect(data.exportTime).toBe(generatedAt.toISOString());
});

it.each(['', 'body -> null | ', 'body -> | ', 'body -> {} | ', 'body -> [] | '])(
  'retains parser-recorded Body states and exact optional fields: %s', tail => {
    const values = parseLogFile(line(undefined, tail)).entries;
    const value = values[0];
    const exported = JSON.parse(buildLogEntriesJson(values)).entries[0];
    expect(exported).toEqual(JSON.parse(JSON.stringify(value)));
    expect(Object.prototype.hasOwnProperty.call(exported, 'body')).toBe(value.body !== undefined);
    expect(Object.prototype.hasOwnProperty.call(exported, 'bodyRaw')).toBe(value.bodyRaw !== undefined);
  },
);

it('retains original IDs through filtering, sorting and paging; independent parses can collide', () => {
  const values = parseLogFile([line('2026-11-11 00:00:02'), line()].join('\n')).entries;
  const exported = (items: LogEntry[]) => JSON.parse(buildLogEntriesJson(items));
  for (const selection of [values, [...values].reverse(), values.slice(1), values.filter(e => e.id === 'entry-2')]) {
    expect(exported(selection).entries.map((e: { id: string }) => e.id)).toEqual(selection.map(e => e.id));
    expect(buildLogEntriesText(selection)).toBe(selection.map(e => e.rawLine).join('\n'));
  }
  expect(new Set(values.map(e => e.id)).size).toBe(values.length);
  expect(entries()[0].id).toBe(parseLogFile(line('2026-11-12 00:00:01')).entries[0].id);
});

it.each(['2026-11-11 00:00:01', '2026/11/11 00:00:01.123',
  '2026-11-11T00:00:01.123Z', '2026-11-11T08:00:01+08:00', '00:00:01', 'unrecognized recorded time'])(
  'preserves recorded time text and numeric timing without reinterpretation: %s', timestamp => {
    const value = { ...entries()[0], timestamp };
    const data = JSON.parse(buildLogEntriesJson([value], generatedAt));
    expect(data.entries[0].timestamp).toBe(timestamp);
    expect(data.entries[0].timestampMs).toBe(value.timestampMs);
    expect(data.entries[0].duration).toBe(0);
  },
);

it('keeps exact pre-P0-A JSON serialization including order, null and omitted fields', () => {
  const go = entries();
  const result = netlog();
  result.proxyInfo.proxySettings = null;
  result.urlRequests.push({
    id: 1, url: 'https://example.test/api', method: 'GET', startTime: 0, duration: 0,
    error: -106, events: [], timeline: { wait: { start: -1, end: 0, duration: 1 } },
  });
  expect(buildLogEntriesJson(go, generatedAt)).toBe(JSON.stringify({
    exportTime: generatedAt.toISOString(), total: go.length, entries: go.map(e => ({
      id: e.id, timestamp: e.timestamp, timestampMs: e.timestampMs, worker: e.worker,
      level: e.level, method: e.method, url: e.url, domain: e.domain, path: e.path,
      status: e.status, statusCode: e.statusCode, statusText: e.statusText,
      duration: e.duration, durationText: e.durationText, friendlyName: e.friendlyName,
      headers: e.headers, body: e.body, bodyRaw: e.bodyRaw, rawLine: e.rawLine,
    })),
  }, null, 2));
  expect(buildNetlogJsonExport(result, generatedAt)).toBe(JSON.stringify({
    exportTime: generatedAt.toISOString(),
    overview: { totalEvents: result.totalEvents, uniqueSources: result.uniqueSources,
      peakConcurrency: result.peakConcurrency, urlRequestCount: 1, errorCount: 0,
      warningCount: result.warnings.length, slowRequestCount: result.slowRequests.length },
    proxyInfo: result.proxyInfo,
    requests: [{ url: 'https://example.test/api', method: 'GET', duration: 0, error: -106,
      timeline: { wait: { start: -1, end: 0, duration: 1 } } }],
    errors: [],
  }, null, 2));
});
