import type { LogEntry } from '../../logParser';
import { buildLogEntriesJson, buildLogEntriesText, exportLogEntriesAsJson, exportLogEntriesAsText } from './exportLogEntries';
import { downloadTextFile } from '../../utils/downloadTextFile';

jest.mock('../../utils/downloadTextFile', () => ({ downloadTextFile: jest.fn() }));

function entry(): LogEntry {
  return {
    id: 'local-entry', worker: 'private-worker', level: 'Error', timestamp: '12:00:00',
    timestampMs: 0, method: 'POST', url: 'https://private.example.test/account?token=FAKE_VALUE',
    domain: 'private.example.test', path: '/account', status: 'Error', statusCode: 0,
    headers: { Authorization: 'Bearer FAKE_HEADER' }, body: { private: 'FAKE_BODY' },
    bodyRaw: 'FAKE_BODY_RAW', rawLine: 'FAKE_RAW_LINE', duration: 0,
    durationText: '0ms', friendlyName: 'request',
  };
}

it('sharing JSON/TXT do not access opaque fields and retain all selected entries', () => {
  const value = entry();
  for (const field of ['headers', 'body', 'bodyRaw', 'rawLine']) {
    Object.defineProperty(value, field, { get() { throw new Error('opaque field read'); } });
  }
  Object.freeze(value);
  const entries = Array(120).fill(value);
  const json = buildLogEntriesJson(entries);
  const text = buildLogEntriesText(entries);
  expect(JSON.parse(json).data.entries).toHaveLength(120);
  expect(text.split('\n')).toHaveLength(120);
  for (const output of [json, text]) {
    expect(output.includes('FAKE_')).toBe(false);
    expect(output.includes('private.example.test')).toBe(false);
  }
});

it('explicit expert JSON keeps the original DTO and TXT keeps raw lines exactly', () => {
  const entries = [entry()];
  const before = JSON.stringify(entries);
  expect(JSON.parse(buildLogEntriesJson(entries, true)).entries).toEqual(entries);
  expect(buildLogEntriesText(entries, true)).toBe('FAKE_RAW_LINE');
  expect(JSON.stringify(entries)).toBe(before);
});

it.each(['', '/relative/private', 'unknown', 'https://[broken'])(
  'Go JSON/TXT never invent a known host from %s', url => {
    const value = { ...entry(), url };
    expect(JSON.parse(buildLogEntriesJson([value])).data.entries[0].url.startsWith('https://')).toBe(false);
    expect(buildLogEntriesText([value]).includes('https://')).toBe(false);
    expect(JSON.parse(buildLogEntriesJson([value], true)).entries[0].url).toBe(url);
  },
);

it('keeps a missing Go JSON URL absent and marks its TXT absence', () => {
  const value = entry();
  Object.defineProperty(value, 'url', { value: undefined });
  expect(Object.prototype.hasOwnProperty.call(JSON.parse(buildLogEntriesJson([value])).data.entries[0], 'url')).toBe(false);
  expect(buildLogEntriesText([value])).toContain('[address missing]');
});

it.each([undefined, null, {}, ['synthetic'], 0, false, 'synthetic'])(
  'preserves explicit body metadata and original expert value %p', body => {
    const value = { ...entry(), body, bodyRaw: undefined };
    const safe = JSON.parse(buildLogEntriesJson([value])).data.entries[0];
    const expert = JSON.parse(buildLogEntriesJson([value], true)).entries[0];
    expect(safe.redactions.headers).toEqual({ state: 'redacted', valueType: 'object', emptiness: 'uninspected' });
    expect(expert.headers).toEqual(value.headers);
    expect(safe).not.toHaveProperty('body');
    expect(safe).not.toHaveProperty('bodyRaw');
    expect(safe.redactions.body.state).toBe(body === undefined ? 'missing' : body === null ? 'null' : 'redacted');
    expect(safe.redactions.bodyRaw).toEqual({ state: 'missing', reason: 'undefined-value' });
    expect(expert.body).toEqual(body);
    expect(Object.prototype.hasOwnProperty.call(expert, 'body')).toBe(body !== undefined);
    expect(Object.prototype.hasOwnProperty.call(expert, 'bodyRaw')).toBe(false);
    expect(safe.id).toBe(value.id);
    expect(expert.id).toBe(value.id);
  },
);

it('legacy local download helpers remain present and default to sharing projection', () => {
  exportLogEntriesAsJson([entry()], 'selected');
  exportLogEntriesAsText([entry()], 'selected');
  expect(downloadTextFile).toHaveBeenCalledWith(expect.stringMatching(/^selected-.*\.json$/),
    expect.not.stringContaining('FAKE_'), 'application/json;charset=utf-8');
  expect(downloadTextFile).toHaveBeenCalledWith(expect.stringMatching(/^selected-.*\.txt$/),
    expect.not.stringContaining('FAKE_'), 'text/plain;charset=utf-8');
});
