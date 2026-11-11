import { parseLog } from '../parsers/netlog/parser';
import { buildNetlogCsvExport, buildNetlogJsonExport, encodeCsvCell } from './netlogExport';

function fixture() {
  const result = parseLog({ events: [{
    time: '0', type: 1, phase: 0, source: { id: 1, type: 1 }, params: {},
  }] }).result;
  result.urlRequests.push({
    id: 7, url: 'https://api.example.test/account?id=123',
    method: 'GET', startTime: 0, duration: 0, statusCode: 0, error: -106, events: [],
    timeline: { dns: { start: 0, end: 0, duration: 0 } },
  });
  result.proxyInfo.proxySettings = { server: '203.0.113.7:8080' };
  result.errors.push({ severity: 'error', category: 'network',
    message: 'Failure api.example.test', detail: 'recorded connection detail', time: 0 });
  return result;
}

it('keeps absent addresses absent rather than fabricating URL/PAC facts', () => {
  const result = fixture();
  Object.defineProperty(result.urlRequests[0], 'url', { value: undefined });
  Object.defineProperty(result.proxyInfo, 'pacUrl', { value: undefined });
  const data = JSON.parse(buildNetlogJsonExport(result));
  expect(data.requests[0]).not.toHaveProperty('url');
  expect(data.proxyInfo).not.toHaveProperty('pacUrl');
  expect(buildNetlogCsvExport(result).split('\r\n')[1].startsWith('"",')).toBe(true);
});

it.each([null, {}, ['synthetic'], 'synthetic', 0, false, undefined])(
  'preserves the original proxy fields and types: %p', settings => {
    const result = fixture();
    result.proxyInfo.proxySettings = settings;
    result.proxyInfo.effectiveProxy = settings;
    result.proxyInfo.originalProxy = settings;
    expect(JSON.parse(buildNetlogJsonExport(result)).proxyInfo).toEqual(JSON.parse(JSON.stringify(result.proxyInfo)));
  },
);

it.each(['', '/relative/private', 'unknown', 'https://[broken', '   ', 'https:///example.test/a'])(
  'keeps recorded address text without normalization or invented hosts: %s', url => {
    const result = fixture();
    result.urlRequests[0].url = url;
    result.proxyInfo.pacUrl = url;
    const data = JSON.parse(buildNetlogJsonExport(result));
    expect(data.requests[0].url).toBe(url);
    expect(data.proxyInfo.pacUrl).toBe(url);
    expect(buildNetlogCsvExport(result).split('\r\n')[1].startsWith(`${encodeCsvCell(url)},`)).toBe(true);
  },
);

it('uses the existing DTO without reading request events/dataset or mutating local input', () => {
  const result = fixture();
  const before = JSON.stringify(result);
  const { events, ...requestBefore } = result.urlRequests[0];
  Object.defineProperty(result.urlRequests[0], 'events', { get() { throw new Error('raw events read'); } });
  Object.freeze(result.urlRequests[0].timeline.dns);
  Object.freeze(result.urlRequests[0]);
  Object.freeze(result);
  const data = JSON.parse(buildNetlogJsonExport(result));
  expect(Object.keys(data)).toEqual(['exportTime', 'overview', 'proxyInfo', 'requests', 'errors']);
  expect(data.proxyInfo).toEqual(result.proxyInfo);
  expect(data.errors).toEqual(result.errors);
  expect(data.requests[0]).toEqual({
    url: requestBefore.url, method: 'GET', statusCode: 0, duration: 0, error: -106,
    timeline: { dns: { start: 0, end: 0, duration: 0 } },
  });
  expect(JSON.parse(JSON.stringify({ ...result, urlRequests: [{ ...requestBefore, events }] }))).toEqual(JSON.parse(before));
});

it('CSV keeps twelve columns, BOM, missing vs zero, and numeric negative values', () => {
  const csv = buildNetlogCsvExport(fixture());
  expect(csv.startsWith('\uFEFFURL,Method,Status,')).toBe(true);
  const cells = csv.split('\r\n')[1].split(',');
  expect(cells).toHaveLength(12);
  expect(cells.slice(2, 7)).toEqual(['""', '"0"', '"0"', '"-106"', '"0"']);
  expect(cells.slice(7)).toEqual(Array(5).fill('""'));
  expect(csv).toContain('https://api.example.test/account?id=123');
});

it.each(['=SUM(1,2)', '+1', '-cmd', '@SUM(1)', '\t=1', '\r+1', '\uFEFF -cmd', ' \t@1', '\ttext', '\ntext'])(
  'protects text formula prefixes without losing text: %s', value => {
    expect(encodeCsvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
  },
);

it('round trips quoted text/newline/comma and preserves numeric cells', () => {
  const value = '中文,"quoted"\nnext';
  const encoded = encodeCsvCell(value);
  expect(encoded.slice(1, -1).replace(/""/g, '"')).toBe(value);
  expect(encodeCsvCell(0)).toBe('"0"');
  expect(encodeCsvCell(-101)).toBe('"-101"');
  expect(encodeCsvCell(-202)).toBe('"-202"');
  expect(encodeCsvCell(undefined)).toBe('""');
});
