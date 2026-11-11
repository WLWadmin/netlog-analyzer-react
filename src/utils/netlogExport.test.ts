import { parseLog } from '../parsers/netlog/parser';
import { buildNetlogCsvExport, buildNetlogJsonExport, encodeCsvCell } from './netlogExport';
import { createSharingTextSanitizer, findSensitiveDataLeaks } from '../diagnosis/shared/maskedExport';

function fixture() {
  const result = parseLog({ events: [{
    time: '0', type: 1, phase: 0, source: { id: 1, type: 1 }, params: {},
  }] }).result;
  result.urlRequests.push({
    id: 7, url: 'https://user:FAKE_PASSWORD@private.example.test/account?token=FAKE_QUERY',
    method: 'GET', startTime: 0, duration: 0, statusCode: 0, error: -106, events: [],
    timeline: { dns: { start: 0, end: 0, duration: 0 } },
  });
  result.proxyInfo.proxySettings = { Authorization: 'Bearer FAKE_PROXY_SECRET' };
  result.errors.push({
    severity: 'error', category: 'network', message: 'Failure private.example.test',
    detail: 'opaque-private-value /Users/synthetic/example.txt', time: 0,
  });
  return result;
}

describe('NetLog export boundary', () => {
  it('uses a whitelist without reading raw event/dataset/proxy objects or mutating local input', () => {
    const result = fixture();
    const before = JSON.stringify(result);
    Object.defineProperty(result.urlRequests[0], 'events', { get() { throw new Error('raw events read'); } });
    Object.defineProperty(result.proxyInfo, 'proxySettings', { get() { throw new Error('opaque settings read'); } });
    Object.freeze(result.urlRequests[0].timeline.dns);
    Object.freeze(result.urlRequests[0]);
    Object.freeze(result.urlRequests);
    Object.freeze(result.errors);
    Object.freeze(result);
    const safe = buildNetlogJsonExport(result);
    for (const value of ['FAKE_PASSWORD', 'FAKE_QUERY', 'FAKE_PROXY_SECRET', 'private.example.test', 'opaque-private-value', '/Users/']) {
      expect(safe.includes(value)).toBe(false);
    }
    // 既有启发式 scanner 把 ISO 日期当电话号码；检查所有非受控文本字段。
    const scanPayload = JSON.parse(safe);
    expect(Number.isNaN(Date.parse(scanPayload.exportTime))).toBe(false);
    delete scanPayload.exportTime;
    expect(findSensitiveDataLeaks(JSON.stringify(scanPayload))).toEqual([]);
    expect(safe).toContain('"statusCode": 0');
    expect(safe).toContain('"error": -106');
    expect(before.includes('FAKE_QUERY')).toBe(true);
    expect(result.urlRequests[0].url.includes('FAKE_QUERY')).toBe(true);
    expect(result.errors[0].detail.includes('opaque-private-value')).toBe(true);
  });

  it('expert JSON preserves existing top-level and request keys, raw proxy and detail', () => {
    const result = fixture();
    const expert = JSON.parse(buildNetlogJsonExport(result, true));
    expect(Object.keys(expert)).toEqual(['exportTime', 'overview', 'proxyInfo', 'requests', 'errors']);
    expect(expert.proxyInfo).toEqual(result.proxyInfo);
    expect(expert.requests[0]).toEqual({
      url: result.urlRequests[0].url, method: 'GET', statusCode: 0,
      duration: 0, error: -106, timeline: { dns: { start: 0, end: 0, duration: 0 } },
    });
    expect(expert.errors).toEqual(result.errors);
  });

  it('CSV keeps twelve columns, BOM, missing vs zero, and safe numeric negative values', () => {
    const result = fixture();
    const safe = buildNetlogCsvExport(result);
    expect(safe.startsWith('\uFEFFURL,Method,Status,')).toBe(true);
    const cells = safe.split('\r\n')[1].split(',');
    expect(cells).toHaveLength(12);
    expect(cells.slice(2, 7)).toEqual(['""', '"0"', '"0"', '"-106"', '"0"']);
    expect(cells.slice(7)).toEqual(Array(5).fill('""'));
    expect(safe.includes('FAKE_QUERY')).toBe(false);
    expect(buildNetlogCsvExport(result, true).includes('FAKE_QUERY')).toBe(true);
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
    expect(encodeCsvCell(undefined)).toBe('""');
  });

  it('keeps aliases stable within a report without collisions or credential/proxy leakage', () => {
    const sanitize = createSharingTextSanitizer();
    const url = 'https://private.example.test/account?debug=FAKE_VALUE';
    expect(sanitize(url)).toBe('https://host-1.invalid/resource-1');
    expect(sanitize(url)).toBe('https://host-1.invalid/resource-1');
    expect(sanitize('private.example.test')).toBe('host-1.invalid');
    expect(sanitize('https://other.example.test/a')).toBe('https://host-2.invalid/resource-2');
    expect(sanitize('2026-11-11T00:00:00.000Z')).toBe('2026-11-11T00:00:00.000Z');
    expect(sanitize('/private/account', true)).toContain('/resource-3');
    expect(sanitize('/private/account', true)).not.toContain('/private/account');
    for (const raw of ['user:FAKE_VALUE@proxy.example.test:80', '[2001:db8::1]', '2001:db8::2',
      '203.0.113.1', '/Users/example/private.txt', '/relative/path?debug=FAKE_VALUE',
      'https://[broken?token=FAKE_VALUE', 'Authorization: Bearer FAKE_VALUE',
      'args={"custom":"FAKE_VALUE"}']) {
      const shared = sanitize(raw);
      expect(shared.includes('FAKE_VALUE')).toBe(false);
      expect(shared.includes('2001:db8')).toBe(false);
      expect(shared.includes('203.0.113.1')).toBe(false);
      expect(findSensitiveDataLeaks(shared)).toEqual([]);
    }
  });

  it('does not treat original hosts matching the alias spelling as already sanitized', () => {
    const sanitize = createSharingTextSanitizer();
    expect(sanitize('https://real.example.test/a')).toBe('https://host-1.invalid/resource-1');
    expect(sanitize('https://host-1.invalid/resource-1')).toBe('https://host-2.invalid/resource-2');
    expect(sanitize('host-1.invalid')).toBe('host-2.invalid');
  });
});
