import Ajv from 'ajv';
import schema from '../../reviews/p0-a/review-c-sharing-v1.schema.json';
import { parseLog } from '../parsers/netlog/parser';
import { parseLogFile, LogEntry } from '../logParser';
import { buildNetlogJsonExport } from './netlogExport';
import { buildLogEntriesJson, buildLogEntriesText } from '../components/log/exportLogEntries';
import { inspectSharingField } from './sharingFieldState';

const validate = new Ajv({ allErrors: true }).compile(schema);
const generatedAt = new Date('2026-11-11T00:00:00.000Z');
const line = (time = '2026-11-11 00:00:01', tail = '') =>
  `[synthetic] Info ${time} Got Success 200 GET:https://example.test/api | ${tail}+0ms`;
const entries = () => parseLogFile(line()).entries;
const netlog = () => parseLog({ events: [
  { time: '0', type: 1, phase: 0, source: { id: 1, type: 1 }, params: {} },
] }).result;

it('validates actual NetLog and Go sharing builders against JSON Schema', () => {
  for (const output of [buildNetlogJsonExport(netlog(), false, generatedAt),
    buildLogEntriesJson(entries(), false, generatedAt)]) {
    const payload = JSON.parse(output);
    expect(validate(payload)).toBe(true);
    expect(payload).toMatchObject({ schema: 'netlog-analyzer-sharing', version: 1, profile: 'safe-sharing' });
    expect(payload.data.exportTime).toBe(generatedAt.toISOString());
  }
});

it('rejects unknown versions, private value slots and impossible metadata combinations', () => {
  const payload = JSON.parse(buildLogEntriesJson(entries(), false, generatedAt));
  expect(validate({ ...payload, version: 2 })).toBe(false);
  expect(validate({ ...payload, profile: 'unknown' })).toBe(false);
  expect(validate({ ...payload, schema: 'unknown' })).toBe(false);
  const value = payload.data.entries[0];
  for (const mutation of [
    { ...value, body: 'SYNTHETIC_PRIVATE' },
    { ...value, redactions: { ...value.redactions, body: { state: 'null', value: 'SYNTHETIC_PRIVATE' } } },
    { ...value, redactions: { ...value.redactions, body: { state: 'redacted', valueType: 'object', emptiness: 'empty' } } },
  ]) {
    expect(validate({ ...payload, data: { ...payload.data, entries: [mutation] } })).toBe(false);
  }
});

const states = [
  [undefined, { state: 'missing', reason: 'undefined-value' }],
  [null, { state: 'null' }],
  ['', { state: 'redacted', valueType: 'string', emptiness: 'empty' }],
  ['SYNTHETIC_PRIVATE', { state: 'redacted', valueType: 'string', emptiness: 'nonempty' }],
  [{}, { state: 'redacted', valueType: 'object', emptiness: 'uninspected' }],
  [{ private: 'SYNTHETIC_PRIVATE' }, { state: 'redacted', valueType: 'object', emptiness: 'uninspected' }],
  [[], { state: 'redacted', valueType: 'array', emptiness: 'uninspected' }],
  [['SYNTHETIC_PRIVATE'], { state: 'redacted', valueType: 'array', emptiness: 'uninspected' }],
  [0, { state: 'redacted', valueType: 'number' }],
  [false, { state: 'redacted', valueType: 'boolean' }],
  [Symbol('synthetic'), { state: 'uninspected', reason: 'unsupported-value' }],
  [() => 'synthetic', { state: 'uninspected', reason: 'unsupported-value' }],
] as const;

it.each(states)('preserves field state without exporting content (%#)', (value, expected) => {
  const go = entries()[0];
  const result = netlog();
  for (const field of ['headers', 'body', 'bodyRaw']) Object.defineProperty(go, field, { value });
  for (const field of ['proxySettings', 'effectiveProxy', 'originalProxy']) {
    Object.defineProperty(result.proxyInfo, field, { value });
  }
  const goJson = buildLogEntriesJson([go], false, generatedAt);
  const netlogJson = buildNetlogJsonExport(result, false, generatedAt);
  for (const output of [goJson, netlogJson]) {
    expect(validate(JSON.parse(output))).toBe(true);
    expect(output.includes('SYNTHETIC_PRIVATE')).toBe(false);
  }
  for (const state of Object.values(JSON.parse(goJson).data.entries[0].redactions)) expect(state).toEqual(expected);
  for (const state of Object.values(JSON.parse(netlogJson).data.proxyInfo.redactions)) expect(state).toEqual(expected);
});

it.each(['absent', 'inherited', 'accessor', 'container', 'revoked'] as const)(
  'does not read opaque fields or infer uninspected emptiness: %s', mode => {
    const go = entries()[0];
    const result = netlog();
    const fail = jest.fn(() => { throw new Error('opaque content must not be read'); });
    for (const [record, field] of [[go, 'body'], [result.proxyInfo, 'proxySettings']] as const) {
      Reflect.deleteProperty(record, field);
      if (mode === 'inherited') Object.setPrototypeOf(record, Object.defineProperty({}, field, { get: fail }));
      if (mode === 'accessor') Object.defineProperty(record, field, { get: fail });
      if (mode === 'container') Object.defineProperty(record, field, {
        value: new Proxy({}, { get: fail, ownKeys: fail, getOwnPropertyDescriptor: fail }),
      });
      if (mode === 'revoked') {
        const revocable = Proxy.revocable({}, {});
        revocable.revoke();
        Object.defineProperty(record, field, { value: revocable.proxy });
      }
    }
    const outputs = [JSON.parse(buildLogEntriesJson([go], false, generatedAt)),
      JSON.parse(buildNetlogJsonExport(result, false, generatedAt))];
    const expected = mode === 'absent' ? { state: 'missing', reason: 'absent-property' }
      : mode === 'container' ? { state: 'redacted', valueType: 'object', emptiness: 'uninspected' }
      : { state: 'uninspected', reason: mode === 'inherited' ? 'inherited-property-not-read'
        : mode === 'accessor' ? 'accessor-not-read' : 'descriptor-unavailable' };
    expect(outputs[0].data.entries[0].redactions.body).toEqual(expected);
    expect(outputs[1].data.proxyInfo.redactions.proxySettings).toEqual(expected);
    outputs.forEach(payload => expect(validate(payload)).toBe(true));
    expect(fail).not.toHaveBeenCalled();
  },
);

it('preserves missing/null parent proxyInfo without creating a proxy container', () => {
  const result = netlog();
  Object.defineProperty(result, 'proxyInfo', { value: null, configurable: true });
  expect(JSON.parse(buildNetlogJsonExport(result)).data.proxyInfo).toBeNull();
  Reflect.deleteProperty(result, 'proxyInfo');
  const safe = JSON.parse(buildNetlogJsonExport(result));
  expect(safe.data).not.toHaveProperty('proxyInfo');
  expect(validate(safe)).toBe(true);
});

it('marks unavailable local descriptors as uninspected without running accessors', () => {
  const fail = jest.fn(() => { throw new Error('descriptor unavailable'); });
  const record = new Proxy({}, { getOwnPropertyDescriptor: fail });
  expect(inspectSharingField(record, 'body')).toEqual({ state: 'uninspected', reason: 'descriptor-unavailable' });
  expect(fail).toHaveBeenCalledTimes(1);
});

it('does not invoke nested getters, toJSON or enumerate protected contents', () => {
  const fail = jest.fn(() => { throw new Error('opaque content read'); });
  const opaque = Object.defineProperties({}, {
    toJSON: { value: fail }, private: { get: fail, enumerable: true },
  });
  const go = entries()[0];
  const result = netlog();
  for (const key of ['headers', 'body', 'bodyRaw']) Object.defineProperty(go, key, { value: opaque });
  for (const key of ['proxySettings', 'effectiveProxy', 'originalProxy']) {
    Object.defineProperty(result.proxyInfo, key, { value: opaque });
  }
  expect(validate(JSON.parse(buildLogEntriesJson([go])))).toBe(true);
  expect(validate(JSON.parse(buildNetlogJsonExport(result)))).toBe(true);
  expect(fail).not.toHaveBeenCalled();
});

it('keeps all NetLog phase endpoints, zero/negative times, errors and generated time unchanged', () => {
  const result = netlog();
  const phase = { start: -10.125, end: 0, duration: 10.125 };
  const timeline = { dns: phase, connect: phase, ssl: phase, send: phase, wait: phase, download: phase };
  result.urlRequests.push({
    id: 1, url: '', method: 'GET', startTime: -10.125, duration: 0,
    error: -106, statusCode: 0, events: [], timeline,
  });
  result.errors.push({ severity: 'error', category: 'network', message: 'synthetic', detail: 'synthetic', time: -1 });
  const safe = JSON.parse(buildNetlogJsonExport(result, false, generatedAt));
  expect(validate(safe)).toBe(true);
  expect(safe.data.requests[0].timeline).toEqual(timeline);
  expect(safe.data.requests[0]).toMatchObject({ statusCode: 0, duration: 0, error: -106 });
  expect(safe.data.errors[0].time).toBe(-1);
  expect(safe.data.exportTime).toBe(generatedAt.toISOString());
});

it.each(['', 'body -> null | ', 'body -> | ', 'body -> {} | ', 'body -> [] | '])(
  'retains parser-recorded Body states and exact expert optional fields: %s', tail => {
    const values = parseLogFile(line(undefined, tail)).entries;
    const value = values[0];
    const safe = JSON.parse(buildLogEntriesJson(values));
    const expert = JSON.parse(buildLogEntriesJson(values, true));
    expect(safe.data.entries[0]).not.toHaveProperty('body');
    expect(safe.data.entries[0]).not.toHaveProperty('bodyRaw');
    expect(expert.entries[0]).toEqual(JSON.parse(JSON.stringify(value)));
    expect(Object.prototype.hasOwnProperty.call(expert.entries[0], 'body')).toBe(value.body !== undefined);
    expect(Object.prototype.hasOwnProperty.call(expert.entries[0], 'bodyRaw')).toBe(value.bodyRaw !== undefined);
    expect(safe.data.entries[0].redactions.body.state).toBe(value.body === undefined ? 'missing'
      : value.body === null ? 'null' : 'redacted');
  },
);

it('retains original IDs through filtering, sorting and paging; independent parses can collide', () => {
  const values = parseLogFile([line('2026-11-11 00:00:02'), line()].join('\n')).entries;
  const exported = (items: LogEntry[]) => JSON.parse(buildLogEntriesJson(items)).data;
  for (const selection of [values, [...values].reverse(), values.slice(1), values.filter(e => e.id === 'entry-2')]) {
    expect(exported(selection).entries.map((e: { id: string }) => e.id)).toEqual(selection.map(e => e.id));
    selection.forEach(e => expect(buildLogEntriesText([e]).startsWith(`${e.id} `)).toBe(true));
  }
  expect(new Set(values.map(e => e.id)).size).toBe(values.length);
  const firstAnalysis = entries();
  const secondAnalysis = parseLogFile(line('2026-11-12 00:00:01')).entries;
  expect(firstAnalysis[0].id).toBe(secondAnalysis[0].id);
  expect(firstAnalysis[0].timestamp).not.toBe(secondAnalysis[0].timestamp);
  expect(exported(values).identity).toEqual({ scope: 'analysis-local', crossFileUnique: false });
});

it.each(['2026-11-11 00:00:01', '2026/11/11 00:00:01.123',
  '2026-11-11T00:00:01.123Z', '2026-11-11T08:00:01+08:00', '00:00:01'])(
  'preserves recorded time text and numeric timing without reinterpretation: %s', timestamp => {
    const value = { ...entries()[0], timestamp };
    const safe = JSON.parse(buildLogEntriesJson([value], false, generatedAt)).data;
    expect(safe.entries[0].timestamp).toBe(timestamp);
    expect(safe.entries[0].timestampMs).toBe(value.timestampMs);
    expect(safe.entries[0].duration).toBe(0);
    expect(buildLogEntriesText([value])).toContain(` ${timestamp} `);
  },
);

it('does not whitelist arbitrary text merely because it starts with a timestamp', () => {
  const value = { ...entries()[0], timestamp: '2026-11-11 00:00:01 token=SYNTHETIC_PRIVATE' };
  expect(buildLogEntriesJson([value]).includes('SYNTHETIC_PRIVATE')).toBe(false);
  expect(buildLogEntriesText([value]).includes('SYNTHETIC_PRIVATE')).toBe(false);
  expect(JSON.parse(buildLogEntriesJson([value], true)).entries[0].timestamp).toBe(value.timestamp);
});

it('keeps exact legacy expert JSON serialization including order, null and omitted fields', () => {
  const go = entries();
  const result = netlog();
  result.proxyInfo.proxySettings = null;
  result.urlRequests.push({
    id: 1, url: 'https://example.test/api', method: 'GET', startTime: 0, duration: 0,
    error: -106, events: [], timeline: { wait: { start: -1, end: 0, duration: 1 } },
  });
  expect(buildLogEntriesJson(go, true, generatedAt)).toBe(JSON.stringify({
    exportTime: generatedAt.toISOString(), total: go.length, entries: go.map(e => ({
      id: e.id, timestamp: e.timestamp, timestampMs: e.timestampMs, worker: e.worker,
      level: e.level, method: e.method, url: e.url, domain: e.domain, path: e.path,
      status: e.status, statusCode: e.statusCode, statusText: e.statusText,
      duration: e.duration, durationText: e.durationText, friendlyName: e.friendlyName,
      headers: e.headers, body: e.body, bodyRaw: e.bodyRaw, rawLine: e.rawLine,
    })),
  }, null, 2));
  expect(buildNetlogJsonExport(result, true, generatedAt)).toBe(JSON.stringify({
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
