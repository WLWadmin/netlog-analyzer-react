import { parseLog } from '../parsers/netlog/parser';
import { parseLogFile } from '../logParser';
import { buildNetlogCsvExport, buildNetlogJsonExport } from './netlogExport';
import { buildLogEntriesJson, buildLogEntriesText } from '../components/log/exportLogEntries';

it.each([-101, -202, 0, undefined])('exports recorded NetLog values and error %p by default', error => {
  const result = parseLog({ events: [{
    time: '0', type: 1, phase: 0, source: { id: 1, type: 1 }, params: {},
  }] }).result;
  const url = 'https://api.example.test/orders?id=123';
  result.urlRequests.push({
    id: 7, url, method: 'GET', startTime: 0, duration: 0, error,
    statusCode: 0, events: [], timeline: { wait: { start: -1, end: 0, duration: 1 } },
  });
  result.proxyInfo.proxySettings = { server: '203.0.113.7:8080' };
  result.errors.push({ severity: 'error', category: 'network',
    message: 'Recorded failure api.example.test', detail: '203.0.113.7 connection detail', time: 0 });
  const before = JSON.stringify(result);
  const output = JSON.parse(buildNetlogJsonExport(result));
  expect(output.requests[0]).toEqual({
    url, method: 'GET', duration: 0, error, statusCode: 0,
    timeline: { wait: { start: -1, end: 0, duration: 1 } },
  });
  expect(output.proxyInfo).toEqual(result.proxyInfo);
  expect(output.errors).toEqual(result.errors);
  expect(buildNetlogCsvExport(result)).toContain(url);
  expect(JSON.stringify(result)).toBe(before);
});

it('exports original Go fields and raw TXT, retaining IDs across selection', () => {
  const entries = parseLogFile([
    '[synthetic] Info 2026-11-11 00:00:02 Got Success 200 GET:https://api.example.test/orders?id=123 | body -> null | +0ms',
    '[synthetic] Info 2026-11-11 00:00:01 Got Success 200 GET:https://api.example.test/other | body -> {} | +0ms',
  ].join('\n')).entries;
  expect(entries).toHaveLength(2);
  for (const selection of [entries, [...entries].reverse(), entries.slice(1), entries.filter(e => e.id === entries[0].id)]) {
    expect(JSON.parse(buildLogEntriesJson(selection)).entries).toEqual(JSON.parse(JSON.stringify(selection)));
    expect(buildLogEntriesText(selection)).toBe(selection.map(e => e.rawLine).join('\n'));
  }
});
