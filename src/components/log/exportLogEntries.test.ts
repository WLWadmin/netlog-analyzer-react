import type { LogEntry } from '../../logParser';
import { buildLogEntriesJson, buildLogEntriesText, exportLogEntriesAsJson, exportLogEntriesAsText } from './exportLogEntries';
import { downloadTextFile } from '../../utils/downloadTextFile';

jest.mock('../../utils/downloadTextFile', () => ({ downloadTextFile: jest.fn() }));

function entry(): LogEntry {
  return {
    id: 'local-entry', worker: 'synthetic-worker', level: 'Error', timestamp: '12:00:00',
    timestampMs: 0, method: 'POST', url: 'https://api.example.test/account?id=123',
    domain: 'api.example.test', path: '/account', status: 'Error', statusCode: 0,
    headers: { 'X-Synthetic': 'recorded header' }, body: { value: 'recorded body' },
    bodyRaw: '{"value":"recorded body"}', rawLine: 'SYNTHETIC_RAW_LINE', duration: 0,
    durationText: '0ms', friendlyName: 'request',
  };
}

it('default JSON keeps the original DTO and TXT keeps all raw lines exactly without mutation', () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({ ...entry(), id: `local-${index}` }));
  const before = JSON.stringify(entries);
  Object.freeze(entries[0]);
  expect(JSON.parse(buildLogEntriesJson(entries)).entries).toEqual(entries);
  expect(buildLogEntriesText(entries)).toBe(entries.map(e => e.rawLine).join('\n'));
  expect(JSON.stringify(entries)).toBe(before);
});

it.each(['', '/relative/private', 'unknown', 'https://[broken'])(
  'retains the recorded Go JSON URL %s', url => {
    expect(JSON.parse(buildLogEntriesJson([{ ...entry(), url }])).entries[0].url).toBe(url);
  },
);

it('keeps a missing Go JSON URL absent and retains TXT as the recorded raw line', () => {
  const value = entry();
  Object.defineProperty(value, 'url', { value: undefined });
  expect(JSON.parse(buildLogEntriesJson([value])).entries[0]).not.toHaveProperty('url');
  expect(buildLogEntriesText([value])).toBe(value.rawLine);
});

it.each([undefined, null, {}, ['synthetic'], 0, false, 'synthetic'])(
  'preserves original body types and absent optional fields: %p', body => {
    const value = { ...entry(), body, bodyRaw: undefined };
    const exported = JSON.parse(buildLogEntriesJson([value])).entries[0];
    expect(exported).toEqual(JSON.parse(JSON.stringify(value)));
    expect(exported.headers).toEqual(value.headers);
    expect(exported.body).toEqual(body);
    expect(Object.prototype.hasOwnProperty.call(exported, 'body')).toBe(body !== undefined);
    expect(exported).not.toHaveProperty('bodyRaw');
    expect(exported.id).toBe(value.id);
  },
);

it('legacy local helpers download the same complete diagnostic builders', () => {
  const entries = [entry()];
  exportLogEntriesAsJson(entries, 'selected');
  exportLogEntriesAsText(entries, 'selected');
  expect(downloadTextFile).toHaveBeenCalledWith(expect.stringMatching(/^selected-.*\.json$/),
    expect.stringContaining(entries[0].url), 'application/json;charset=utf-8');
  expect(downloadTextFile).toHaveBeenCalledWith(expect.stringMatching(/^selected-.*\.txt$/),
    entries[0].rawLine, 'text/plain;charset=utf-8');
});
