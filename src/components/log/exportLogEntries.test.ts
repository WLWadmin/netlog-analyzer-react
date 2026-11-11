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
  expect(JSON.parse(json).entries).toHaveLength(120);
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

it('legacy local download helpers remain present and default to sharing projection', () => {
  exportLogEntriesAsJson([entry()], 'selected');
  exportLogEntriesAsText([entry()], 'selected');
  expect(downloadTextFile).toHaveBeenCalledWith(expect.stringMatching(/^selected-.*\.json$/),
    expect.not.stringContaining('FAKE_'), 'application/json;charset=utf-8');
  expect(downloadTextFile).toHaveBeenCalledWith(expect.stringMatching(/^selected-.*\.txt$/),
    expect.not.stringContaining('FAKE_'), 'text/plain;charset=utf-8');
});
